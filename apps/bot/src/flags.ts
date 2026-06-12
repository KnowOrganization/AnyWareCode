import { getSetting, type Db } from "@anywherecode/db";
import { captureError } from "./observability.js";

/**
 * DB-backed runtime flags with a short in-memory TTL cache, so an operator can
 * flip behavior (admin route or SQL) without a redeploy and the bot picks it
 * up within a minute.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expiresAt: number }>();

async function readFlag(
  db: Db,
  key: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value = defaultValue;
  try {
    const raw = await getSetting(db, key);
    if (typeof raw === "boolean") value = raw;
  } catch (err) {
    captureError(err, { msg: `flag read failed: ${key}` });
  }
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/** Kill switch for Claude Pro/Max subscription-token connections. */
export async function isClaudeOauthEnabled(db: Db): Promise<boolean> {
  return readFlag(db, "claude_oauth_enabled", true);
}

/** Test hook. */
export function clearFlagCache(): void {
  cache.clear();
}
