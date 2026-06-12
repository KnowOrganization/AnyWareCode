import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@anywherecode/db";
import type { Config } from "../config.js";
import { signState, verifyState } from "./state.js";

/**
 * GitHub identity linking for provenance receipts. Identity-ONLY by design:
 * the OAuth code is exchanged, the login fetched, and the token discarded in
 * the same function — nothing user-scoped is ever stored except the login.
 *
 * State rows ride the setup_states table with a `user:` prefix so they get
 * the same unforgeable (HMAC) + unreplayable (single-use, TTL) properties as
 * install links without a second table.
 */

const USER_PREFIX = "user:";

export function userLinkingEnabled(config: Config): boolean {
  return Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
}

export async function createUserLinkState(
  db: Db,
  secret: string,
  discordUserId: string,
  ttlMinutes: number,
): Promise<string> {
  const nonce = randomUUID();
  await db.insert(schema.setupStates).values({
    nonce,
    guildId: `${USER_PREFIX}${discordUserId}`,
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
  });
  return signState(secret, nonce);
}

export async function consumeUserLinkState(
  db: Db,
  secret: string,
  state: string,
): Promise<string | null> {
  const nonce = verifyState(secret, state);
  if (!nonce) return null;
  const [row] = await db
    .delete(schema.setupStates)
    .where(eq(schema.setupStates.nonce, nonce))
    .returning();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  if (!row.guildId.startsWith(USER_PREFIX)) return null;
  return row.guildId.slice(USER_PREFIX.length);
}

export function userLinkAuthorizeUrl(config: Config, state: string): string {
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID ?? "",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * OAuth code → GitHub login. The access token lives only inside this call.
 * Returns null on any failure (expired code, API error).
 */
export async function exchangeCodeForLogin(
  config: Config,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const tokenRes = await fetchFn(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: config.GITHUB_CLIENT_ID,
          client_secret: config.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
    );
    if (tokenRes.status !== 200) return null;
    const { access_token } = (await tokenRes.json()) as {
      access_token?: string;
    };
    if (!access_token) return null;
    const userRes = await fetchFn("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${access_token}`,
        accept: "application/vnd.github+json",
      },
    });
    if (userRes.status !== 200) return null;
    const { login } = (await userRes.json()) as { login?: string };
    return login ?? null;
  } catch {
    return null;
  }
}

export async function upsertUserLink(
  db: Db,
  discordUserId: string,
  githubLogin: string,
): Promise<void> {
  await db
    .insert(schema.userLinks)
    .values({ discordUserId, githubLogin, verifiedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userLinks.discordUserId,
      set: { githubLogin, verifiedAt: new Date() },
    });
}

export async function getUserLink(db: Db, discordUserId: string) {
  return (
    (await db.query.userLinks.findFirst({
      where: eq(schema.userLinks.discordUserId, discordUserId),
    })) ?? null
  );
}

export async function removeUserLink(
  db: Db,
  discordUserId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(schema.userLinks)
    .where(eq(schema.userLinks.discordUserId, discordUserId))
    .returning();
  return deleted.length > 0;
}
