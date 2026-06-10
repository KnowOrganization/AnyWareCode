import { fileURLToPath } from "node:url";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { ensureGuild } from "./discord/gates.js";
import { handleInteraction, type BotContext } from "./discord/interactions.js";
import { registerCommands } from "./discord/register.js";
import { findAnnounceChannel, welcomeMessage } from "./discord/welcome.js";
import { GitHubService } from "./github/app.js";
import { createInstallState } from "./github/install-state.js";
import { buildServer } from "./http/server.js";
import { killStaleContainers, recoverStaleTasks } from "./orchestrator/recovery.js";
import { TaskOrchestrator } from "./orchestrator/taskRunner.js";
import { DockerWorkspace } from "./orchestrator/workspace.js";

const config = loadConfig();
const db = createDb(config.DATABASE_URL, config.DATABASE_SSL);

// Run migrations on every boot (idempotent). Keeps DB schema in sync without
// a separate migration step in the deploy pipeline.
await migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});

const github = new GitHubService(config);
const orchestrator = new TaskOrchestrator(
  db,
  github,
  new DockerWorkspace(config),
  config,
);
const ctx: BotContext = { db, config, github, orchestrator };

// Register slash commands (global PUT, idempotent — safe to run on every boot).
await registerCommands(config);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.on(Events.ClientReady, async (ready) => {
  console.log(`Logged in as ${ready.user.tag}`);

  // Kill any containers left over from before the restart, then mark their
  // tasks failed and refund quota. Notifications require the Discord client.
  await killStaleContainers();
  await recoverStaleTasks(db, async (threadId, message) => {
    const ch = await ready.channels.fetch(threadId).catch(() => null);
    if (ch?.isThread()) await ch.send(message).catch(() => {});
  });
});

// Onboarding step 1: bot joins -> welcome message with Connect GitHub + LLM buttons.
client.on(Events.GuildCreate, async (guild) => {
  await ensureGuild(db, guild.id, config.DEFAULT_TASK_CAP);
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

// Shared-session feature: replies in an active task thread reach the agent.
client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || !message.channel.isThread()) return;
  if (!message.content.trim()) return;
  orchestrator.forwardThreadMessage(
    message.channel.id,
    message.author.username,
    message.content,
  );
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
});

await server.listen({ port: config.HTTP_PORT, host: "0.0.0.0" });
await client.login(config.DISCORD_TOKEN);
