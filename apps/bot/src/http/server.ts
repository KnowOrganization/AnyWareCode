import Fastify, { type FastifyInstance } from "fastify";
import { eq, lt, sql } from "drizzle-orm";
import type { Config } from "../config.js";
import {
  addGuildInstallation,
  schema,
  type Db,
} from "@anywarecode/db";
import type { GitHubService } from "../github/app.js";
import { consumeInstallState } from "../github/install-state.js";
import {
  consumeUserLinkState,
  exchangeCodeForLogin,
  upsertUserLink,
  userLinkingEnabled,
} from "../github/user-link.js";

export interface ServerDeps {
  db: Db;
  config: Config;
  github: GitHubService;
  /** Lets the Discord side announce "Ready" once the link lands. */
  onInstallationLinked: (guildId: string) => Promise<void>;
  /** Readiness probes (Discord gateway, container runtime). */
  isDiscordReady: () => boolean;
  pingDocker: () => Promise<boolean>;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  // Liveness: the process is up. Platform uses this to decide on restarts.
  app.get("/livez", async () => ({ ok: true }));

  // Readiness: dependencies reachable. 503 pulls the instance from rotation
  // without killing it.
  app.get("/healthz", async (_req, reply) => {
    const checks = { db: false, discord: deps.isDiscordReady(), docker: false };
    try {
      await deps.db.execute(sql`select 1`);
      checks.db = true;
    } catch {
      /* db unreachable */
    }
    checks.docker = await deps.pingDocker();
    const ok = checks.db && checks.discord && checks.docker;
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });

  /**
   * GitHub App "Setup URL". GitHub redirects here after install with
   * ?installation_id=...&state=<signed nonce>. The state is verified (HMAC)
   * and consumed (single-use, TTL'd DB row), and the installation id is
   * independently confirmed against the App, so neither a forged/replayed
   * state nor a forged installation id can link a guild.
   */
  app.get<{
    Querystring: { installation_id?: string; state?: string };
  }>("/github/setup", async (request, reply) => {
    const { installation_id, state } = request.query;
    const installationId = Number(installation_id);
    if (!installation_id || !Number.isInteger(installationId) || !state) {
      return reply.code(400).send("Missing installation_id or state.");
    }
    const guildId = await consumeInstallState(
      deps.db,
      deps.config.STATE_SECRET,
      state,
    );
    if (!guildId) {
      return reply
        .code(403)
        .send("Invalid or expired link. Start over from the Connect GitHub button in Discord.");
    }
    const installation = await deps.github.validateInstallation(installationId);
    if (!installation) {
      return reply
        .code(403)
        .send("Could not verify that installation. Start over from Discord.");
    }

    // Append — a guild links its personal account AND any number of orgs;
    // re-running setup never overwrites earlier links.
    await addGuildInstallation(deps.db, {
      guildId,
      installationId,
      accountLogin: installation.accountLogin ?? "",
    });
    await deps.onInstallationLinked(guildId).catch((err) => {
      request.log.warn({ err }, "failed to announce link in Discord");
    });

    return reply
      .type("text/html")
      .send(
        "<h1>✅ AnyWareCode is connected</h1><p>Head back to Discord, run <code>/connect llm</code> to add your AI provider, then <code>/repo set</code> and <code>/code</code> in any channel. Connect more orgs anytime with <code>/connect github</code>.</p>",
      );
  });

  /**
   * GitHub user-OAuth callback (/link github). The state is HMAC-signed and
   * single-use; the OAuth token never outlives exchangeCodeForLogin — only
   * the verified login is stored, for provenance receipts.
   */
  if (userLinkingEnabled(deps.config)) {
    app.get<{
      Querystring: { code?: string; state?: string };
    }>("/github/user-callback", async (request, reply) => {
      const { code, state } = request.query;
      if (!code || !state) {
        return reply.code(400).send("Missing code or state.");
      }
      const discordUserId = await consumeUserLinkState(
        deps.db,
        deps.config.STATE_SECRET,
        state,
      );
      if (!discordUserId) {
        return reply
          .code(403)
          .send("Invalid or expired link. Run /link github in Discord again.");
      }
      const login = await exchangeCodeForLogin(deps.config, code);
      if (!login) {
        return reply
          .code(502)
          .send("GitHub didn't confirm your identity. Run /link github again.");
      }
      await upsertUserLink(deps.db, discordUserId, login);
      return reply
        .type("text/html")
        .send(
          `<h1>✅ Linked as ${login}</h1><p>Your agent contributions now carry your verified GitHub identity. You can close this tab.</p>`,
        );
    });
  }

  /**
   * GitHub App webhook receiver. Scoped plugin so the raw-string body parser
   * (needed for HMAC verification) doesn't leak to other routes. Order:
   * dedup insert on the delivery id first (replay → 200 without re-running),
   * then signature verification (bad sig → 401). Handlers never throw, so a
   * non-401 response never reflects downstream Discord failures — GitHub
   * doesn't auto-redeliver anyway.
   */
  if (deps.config.GITHUB_WEBHOOK_SECRET) {
    void app.register(async (scope) => {
      scope.addContentTypeParser(
        "application/json",
        { parseAs: "string", bodyLimit: 3 * 1024 * 1024 },
        (_req, body, done) => done(null, body),
      );
      scope.post("/github/webhook", async (request, reply) => {
        const id = request.headers["x-github-delivery"];
        const name = request.headers["x-github-event"];
        const signature = request.headers["x-hub-signature-256"];
        if (
          typeof id !== "string" ||
          typeof name !== "string" ||
          typeof signature !== "string" ||
          typeof request.body !== "string"
        ) {
          return reply.code(400).send({ error: "malformed webhook" });
        }
        const inserted = await deps.db
          .insert(schema.webhookDeliveries)
          .values({ deliveryId: id, event: name })
          .onConflictDoNothing()
          .returning({ id: schema.webhookDeliveries.deliveryId });
        if (inserted.length === 0) {
          return reply.code(200).send({ duplicate: true });
        }
        try {
          await deps.github.webhooks.verifyAndReceive({
            id,
            name,
            signature,
            payload: request.body,
          });
        } catch {
          return reply.code(401).send({ error: "bad signature" });
        }
        return reply.code(200).send({ ok: true });
      });
    });
  }

  return app;
}

/**
 * Boot housekeeping: keep delivery ids long enough to cover GitHub's full
 * redelivery window (~5 days) so a late retry can't re-process as new. 7d margin.
 */
export async function pruneWebhookDeliveries(db: Db): Promise<void> {
  await db
    .delete(schema.webhookDeliveries)
    .where(
      lt(schema.webhookDeliveries.receivedAt, new Date(Date.now() - 7 * 86_400_000)),
    );
}
