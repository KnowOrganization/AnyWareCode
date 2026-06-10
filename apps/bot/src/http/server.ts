import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import { schema, type Db } from "../db/index.js";
import { verifyState } from "../github/state.js";

export interface ServerDeps {
  db: Db;
  config: Config;
  /** Lets the Discord side announce "Ready" once the link lands. */
  onInstallationLinked: (guildId: string) => Promise<void>;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/healthz", async () => ({ ok: true }));

  /**
   * GitHub App "Setup URL". GitHub redirects here after install with
   * ?installation_id=...&state=<signed guild id>. The signed state is the
   * only authority linking installation -> guild, so reject anything that
   * doesn't verify.
   */
  app.get<{
    Querystring: { installation_id?: string; state?: string };
  }>("/github/setup", async (request, reply) => {
    const { installation_id, state } = request.query;
    const installationId = Number(installation_id);
    if (!installation_id || !Number.isInteger(installationId) || !state) {
      return reply.code(400).send("Missing installation_id or state.");
    }
    const guildId = verifyState(deps.config.STATE_SECRET, state);
    if (!guildId) {
      return reply
        .code(403)
        .send("Invalid state. Start over from the Connect GitHub button in Discord.");
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
