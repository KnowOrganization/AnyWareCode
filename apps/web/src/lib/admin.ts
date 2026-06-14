import { timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";

/** Bearer-token check for operator admin routes. Unset secret = all denied. */
export function isAdminRequest(req: Request): boolean {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** CSV of Discord user ids allowed into the admin panel. Unset = nobody. */
export function adminDiscordIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_DISCORD_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isAdminDiscordId(id: string | undefined | null): boolean {
  return Boolean(id) && adminDiscordIds().has(id as string);
}

export class AdminForbidden extends Error {
  constructor() {
    super("Forbidden");
    this.name = "AdminForbidden";
  }
}

/**
 * Gate for admin UI pages and /api/admin/* routes. Accepts either the bearer
 * token (programmatic/CLI → actor "cli") OR a logged-in Discord session whose
 * id is in ADMIN_DISCORD_IDS. Throws AdminForbidden otherwise. Pass `req` to
 * enable the bearer path; omit it for UI pages (session only).
 */
export async function requireAdmin(req?: Request): Promise<{ actorId: string }> {
  if (req && isAdminRequest(req)) return { actorId: "cli" };
  const session = await auth();
  if (isAdminDiscordId(session?.discordId)) {
    return { actorId: session!.discordId! };
  }
  throw new AdminForbidden();
}
