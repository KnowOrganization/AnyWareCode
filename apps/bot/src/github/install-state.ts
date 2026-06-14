import { randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { schema, type Db } from "@anywarecode/db";
import { signState, verifyState } from "./state.js";

/**
 * GitHub-App install linking. The `state` param carried through the install
 * redirect is `signState(secret, nonce)`; the nonce maps to a guild via a
 * single-use DB row with a short TTL. This makes the link unforgeable (HMAC)
 * AND unreplayable (the row is deleted on first use and expires on its own),
 * closing the replay hole of a purely stateless signed guild id.
 */

export async function createInstallState(
  db: Db,
  secret: string,
  guildId: string,
  ttlMinutes: number,
): Promise<string> {
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await db.insert(schema.setupStates).values({ nonce, guildId, expiresAt });
  return signState(secret, nonce);
}

/**
 * Verifies the signed state, then atomically consumes the matching, unexpired
 * nonce. Returns the linked guild id, or null if forged, unknown, expired, or
 * already used.
 */
export async function consumeInstallState(
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
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  // User-link states (user-link.ts) share this table; never accept one here.
  if (row.guildId.startsWith("user:")) return null;
  return row.guildId;
}

/** Best-effort cleanup of expired, never-completed links. */
export async function pruneExpiredInstallStates(db: Db): Promise<void> {
  await db
    .delete(schema.setupStates)
    .where(lt(schema.setupStates.expiresAt, new Date()));
}
