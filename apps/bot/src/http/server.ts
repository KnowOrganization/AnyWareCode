import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import { schema, type Db } from "../db/index.js";
import type { GitHubService } from "../github/app.js";
import { consumeInstallState } from "../github/install-state.js";

export interface ServerDeps {
  db: Db;
  config: Config;
  github: GitHubService;
  /** Lets the Discord side announce "Ready" once the link lands. */
  onInstallationLinked: (guildId: string) => Promise<void>;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/healthz", async () => ({ ok: true }));

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
    if (!(await deps.github.validateInstallation(installationId))) {
      return reply
        .code(403)
        .send("Could not verify that installation. Start over from Discord.");
    }

    await deps.db
      .update(schema.guilds)
      .set({ githubInstallationId: installationId })
      .where(eq(schema.guilds.id, guildId));
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
