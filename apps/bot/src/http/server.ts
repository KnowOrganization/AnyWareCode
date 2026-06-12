import Fastify, { type FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import type { Config } from "../config.js";
import { claimOrgTrial, schema, type Db } from "@anywherecode/db";
import type { GitHubService } from "../github/app.js";
import { consumeInstallState } from "../github/install-state.js";

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

    await deps.db
      .update(schema.guilds)
      .set({
        githubInstallationId: installationId,
        githubAccountLogin: installation.accountLogin,
      })
      .where(eq(schema.guilds.id, guildId));
    // Claim the org's one platform-key trial; first guild to link wins. The
    // claim is permanent — re-linking elsewhere can't mint a fresh trial.
    if (installation.accountLogin) {
      await claimOrgTrial(deps.db, installation.accountLogin, guildId).catch(
        (err) => request.log.warn({ err }, "org trial claim failed"),
      );
    }
    await deps.onInstallationLinked(guildId).catch((err) => {
      request.log.warn({ err }, "failed to announce link in Discord");
    });

    return reply
      .type("text/html")
      .send(
        "<h1>✅ AnywhereCode is connected</h1><p>Head back to Discord and type <code>/repo set</code>, then <code>/code</code> in any channel.</p>",
      );
  });

  return app;
}
