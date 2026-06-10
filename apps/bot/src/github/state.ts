import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed `state` param carried through the GitHub App install flow. It is the
 * only thing tying an installation back to a Discord guild, so it must be
 * unforgeable: state = base64url(guildId) + "." + HMAC(secret, guildId).
 */

function hmac(secret: string, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function signState(secret: string, guildId: string): string {
  const payload = Buffer.from(guildId, "utf8").toString("base64url");
  return `${payload}.${hmac(secret, guildId).toString("base64url")}`;
}

/** Returns the guild id, or null if the state is malformed or forged. */
export function verifyState(secret: string, state: string): string | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  let guildId: string;
  let provided: Buffer;
  try {
    guildId = Buffer.from(payload, "base64url").toString("utf8");
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  const expected = hmac(secret, guildId);
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? guildId : null;
}
