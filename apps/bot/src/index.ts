import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "./config.js";
import {
  closeDb,
  createDb,
  deleteGuildData,
  migrationsDir,
} from "@anywherecode/db";
import { ensureGuild } from "./discord/gates.js";
import { handleInteraction, type BotContext } from "./discord/interactions.js";
import {
  botRoleIdsOf,
  handleMention,
  isBotMentioned,
  stripBotMention,
} from "./discord/mentions.js";
import { startPackAnnouncer } from "./discord/pack-announcer.js";
import { sweepExpiredProposals } from "./discord/proposals.js";
import { registerCommands } from "./discord/register.js";
import { findAnnounceChannel, welcomeMessage } from "./discord/welcome.js";
import { GitHubService } from "./github/app.js";
import { createInstallState, pruneExpiredInstallStates } from "./github/install-state.js";
import { registerWebhookHandlers } from "./github/webhooks.js";
import { buildServer, pruneWebhookDeliveries } from "./http/server.js";
import { captureError, initSentry, log } from "./observability.js";
import {
  killStaleContainers,
  pingDocker,
  recoverStaleTasks,
} from "./orchestrator/recovery.js";
import { TaskOrchestrator } from "./orchestrator/taskRunner.js";
import { DockerWorkspace } from "./orchestrator/workspace.js";

const config = loadConfig();
initSentry(config.SENTRY_DSN, config.NODE_ENV);
const db = createDb(config.DATABASE_URL, config.DATABASE_SSL);

// Run migrations on every boot (idempotent). Keeps DB schema in sync without
// a separate migration step in the deploy pipeline.
await migrate(db, { migrationsFolder: migrationsDir });

const github = new GitHubService(config);
const orchestrator = new TaskOrchestrator(
  db,
  github,
  new DockerWorkspace(config),
  config,
);
if (!config.GITHUB_WEBHOOK_SECRET) {
  log.warn(
    "GITHUB_WEBHOOK_SECRET unset — /github/webhook disabled (issue feed, auto-review, ship-log webhook trigger, proactive previews off)",
  );
}

// Register slash commands (global PUT, idempotent — safe to run on every boot).
await registerCommands(config);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});
const ctx: BotContext = { db, config, github, orchestrator, client };
registerWebhookHandlers(ctx);

client.on(Events.ClientReady, async (ready) => {
  log.info(`Logged in as ${ready.user.tag}`);

  // Kill any containers left over from before the restart, then mark their
  // tasks failed and refund quota. Notifications require the Discord client.
  await killStaleContainers();
  await recoverStaleTasks(db, async (threadId, message) => {
    const ch = await ready.channels.fetch(threadId).catch(() => null);
    if (ch?.isThread()) await ch.send(message).catch(() => {});
  });
  await sweepExpiredProposals(db);
  await pruneExpiredInstallStates(db);
  await pruneWebhookDeliveries(db);
  startPackAnnouncer(db, client);
});

// Bot removed from a server: erase the guild's data (privacy + housekeeping).
client.on(Events.GuildDelete, async (guild) => {
  await deleteGuildData(db, guild.id).catch((err) =>
    captureError(err, { msg: "guild data deletion failed", guildId: guild.id }),
  );
  log.info(`Removed from guild ${guild.id}; data deleted`);
});

// Onboarding step 1: bot joins -> welcome message with Connect GitHub + LLM buttons.
client.on(Events.GuildCreate, async (guild) => {
  await ensureGuild(db, guild.id, config);
  const channel = findAnnounceChannel(guild);
  if (!channel) return;
  const state = await createInstallState(
    db,
    config.STATE_SECRET,
    guild.id,
    config.INSTALL_STATE_TTL_MINUTES,
  );
  await channel.send(welcomeMessage(github.installUrl(state)));
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(ctx, interaction);
});

// Message routing: replies in an active task thread reach the agent
// (shared-session feature); @mentions anywhere else go to the classifier.
client.on(Events.MessageCreate, (message) => {
  void (async () => {
    if (message.author.bot || !message.inGuild()) return;
    if (!message.content.trim()) return;
    const botId = client.user!.id;
    const botRoleIds = botRoleIdsOf(message);
    const mentioned = isBotMentioned(message.content, botId, botRoleIds);

    if (message.channel.isThread()) {
      if (orchestrator.activeByThread(message.channel.id)) {
        // Active task owns the thread — forward only, never also classify.
        const text = mentioned
          ? stripBotMention(message.content, botId, botRoleIds)
          : message.content;
        if (text.trim()) {
          orchestrator.forwardThreadMessage(
            message.channel.id,
            message.author.username,
            text,
          );
        }
        return;
      }
      if (!mentioned) return;
      await handleMention(ctx, message);
      return;
    }
    if (!mentioned) return;
    await handleMention(ctx, message);
  })().catch((err) => captureError(err, { msg: "message handling failed" }));
});

const server = buildServer({
  db,
  config,
  github,
  onInstallationLinked: async (guildId) => {
    const guild = await client.guilds.fetch(guildId);
    const channel = findAnnounceChannel(guild);
    await channel?.send(
      "✅ GitHub connected. Next: run `/connect llm` to add your LLM credential, then `/repo set` in a channel.",
    );
  },
  isDiscordReady: () => client.isReady(),
  pingDocker,
});

await server.listen({ port: config.HTTP_PORT, host: "0.0.0.0" });
await client.login(config.DISCORD_TOKEN);

// Graceful shutdown: stop taking new events, drain connections, exit. In-flight
// containers keep running detached; the next boot's recovery sweep settles them.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — shutting down`);
  const force = setTimeout(() => {
    log.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  force.unref();
  try {
    await server.close();
    await client.destroy();
    await closeDb(db);
    log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    captureError(err, { msg: "shutdown error" });
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
