import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { getPlan, schema, type Db, type Guild } from "@anywherecode/db";
import type { Config } from "../config.js";
import { decryptCredential, encryptCredential } from "../llm/credentials.js";
import { captureError } from "../observability.js";
import { ensureGuild, resolveTier } from "./gates.js";
import type { BotContext } from "./interactions.js";

/**
 * MCP extensions: servers attach remote MCP servers (Sentry, DBs, trackers)
 * to their agent. Remote http/sse only — no stdio (arbitrary commands inside
 * the sandbox is a different threat model). Auth tokens are encrypted at rest
 * exactly like LLM credentials (AES-256-GCM, AAD = guildId) and travel to the
 * runner via stdin. Prod note: the egress proxy allowlist must include the
 * MCP host or the connection dies at the proxy — MCP_HOST_ALLOWLIST should
 * mirror infra/egress-proxy/filter.
 */

async function mcpAllowed(
  ctx: Pick<BotContext, "db">,
  guild: Guild,
): Promise<boolean> {
  const tier = resolveTier(guild);
  const planId =
    tier.kind === "oss" ? "oss" : tier.kind === "paid" ? tier.planId : null;
  const plan = planId ? await getPlan(ctx.db, planId) : null;
  return Boolean(plan?.features.includes("mcp_extensions"));
}

function hostAllowed(config: Config, url: string): boolean {
  const allowlist = config.MCP_HOST_ALLOWLIST.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return true; // dev mode
  try {
    return allowlist.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function handleConnectMcp(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server admins can manage MCP extensions.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId!;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  const action = interaction.options.getString("action", true);

  if (action === "list") {
    const rows = await ctx.db.query.mcpServers.findMany({
      where: eq(schema.mcpServers.guildId, guildId),
    });
    await interaction.reply({
      content:
        rows.length === 0
          ? "No MCP servers attached. Add one with `/connect mcp action:add`."
          : rows
              .map(
                (r) =>
                  `${r.enabled ? "🔌" : "💤"} **${r.name}** (${r.type}) — ${r.url}${r.authHeaderEnc ? " 🔑" : ""}`,
              )
              .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const name = interaction.options.getString("name")?.toLowerCase().trim();
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    await interaction.reply({
      content: "Give the server a `name` (lowercase letters, digits, dashes).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "remove") {
    const deleted = await ctx.db
      .delete(schema.mcpServers)
      .where(
        and(
          eq(schema.mcpServers.guildId, guildId),
          eq(schema.mcpServers.name, name),
        ),
      )
      .returning();
    await interaction.reply(
      deleted.length > 0
        ? `🔌 MCP server \`${name}\` detached.`
        : `No MCP server named \`${name}\` here.`,
    );
    return;
  }

  // add
  if (!(await mcpAllowed(ctx, guild))) {
    await interaction.reply({
      content: "MCP extensions need a plan with the feature (Pro or Studio). See `/billing`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const url = interaction.options.getString("url");
  if (!url || !/^https:\/\//.test(url)) {
    await interaction.reply({
      content: "Provide an https `url` for the MCP server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!hostAllowed(ctx.config, url)) {
    await interaction.reply({
      content: "That host isn't on this bot's MCP allowlist. Ask the operator to add it (and to the egress proxy).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const type = (interaction.options.getString("type") ?? "http") as
    | "http"
    | "sse";
  const token = interaction.options.getString("auth_token")?.trim();
  const authHeaderEnc = token
    ? encryptCredential(ctx.config.CREDENTIAL_SECRET, guildId, token)
    : null;

  await ctx.db
    .insert(schema.mcpServers)
    .values({
      guildId,
      name,
      type,
      url,
      authHeaderEnc,
      createdBy: interaction.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.mcpServers.guildId, schema.mcpServers.name],
      set: { type, url, authHeaderEnc, enabled: true },
    });
  await interaction.reply({
    content: `🔌 MCP server **${name}** attached (${type}). Its tools join every agent run as \`mcp__${name}__*\`.${
      ctx.config.MCP_HOST_ALLOWLIST
        ? ""
        : "\n⚠️ No MCP_HOST_ALLOWLIST set — fine for dev; in prod the egress proxy must allow this host."
    }`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Resolve a guild's enabled MCP servers into TaskSpec entries (decrypting
 * auth). Undecryptable rows are skipped loudly — never silently. */
export async function mcpServersForSpec(
  db: Db,
  config: Config,
  guildId: string,
): Promise<{
  servers: Array<{
    name: string;
    type: "http" | "sse";
    url: string;
    headers?: Record<string, string>;
  }>;
  warnings: string[];
}> {
  const rows = await db.query.mcpServers.findMany({
    where: and(
      eq(schema.mcpServers.guildId, guildId),
      eq(schema.mcpServers.enabled, true),
    ),
  });
  const servers: Array<{
    name: string;
    type: "http" | "sse";
    url: string;
    headers?: Record<string, string>;
  }> = [];
  const warnings: string[] = [];
  for (const row of rows) {
    if (!row.authHeaderEnc) {
      servers.push({ name: row.name, type: row.type, url: row.url });
      continue;
    }
    try {
      const token = decryptCredential(
        config.CREDENTIAL_SECRET,
        guildId,
        row.authHeaderEnc,
      );
      servers.push({
        name: row.name,
        type: row.type,
        url: row.url,
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (err) {
      captureError(err, { msg: "mcp credential decrypt failed", guildId });
      warnings.push(
        `⚠️ MCP server \`${row.name}\` skipped — its credential can't be decrypted. Re-add it with \`/connect mcp\`.`,
      );
    }
  }
  return { servers, warnings };
}
