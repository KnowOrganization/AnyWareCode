import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { ensureGuild } from "./discord/gates.js";
import { handleInteraction, type BotContext } from "./discord/interactions.js";
import { findAnnounceChannel, welcomeMessage } from "./discord/welcome.js";
import { GitHubService } from "./github/app.js";
import { signState } from "./github/state.js";
import { buildServer } from "./http/server.js";
import { TaskOrchestrator } from "./orchestrator/taskRunner.js";
import { DockerWorkspace } from "./orchestrator/workspace.js";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const github = new GitHubService(config);
const orchestrator = new TaskOrchestrator(
  db,
  github,
  new DockerWorkspace(config),
  config,
);
const ctx: BotContext = { db, config, github, orchestrator };

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.on(Events.ClientReady, (ready) => {
  console.log(`Logged in as ${ready.user.tag}`);
});

// Onboarding step 1: bot joins -> welcome message with Connect GitHub button.
client.on(Events.GuildCreate, async (guild) => {
  await ensureGuild(db, guild.id, config.DEFAULT_TASK_CAP);
  const channel = findAnnounceChannel(guild);
  if (!channel) return;
  const state = signState(config.STATE_SECRET, guild.id);
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
  onInstallationLinked: async (guildId) => {
    const guild = await client.guilds.fetch(guildId);
    const channel = findAnnounceChannel(guild);
    await channel?.send(
      "✅ GitHub connected. Pick a repo with `/repo set`, then type `/code` in any channel.",
    );
  },
});

await server.listen({ port: config.HTTP_PORT, host: "0.0.0.0" });
await client.login(config.DISCORD_TOKEN);
