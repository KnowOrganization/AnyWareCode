import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

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

/** CSV of email addresses allowed into the admin panel. Unset = nobody (the
 * panel is fail-closed; signups are disabled in Supabase so accounts only
 * exist if we create them, but the allowlist is a second gate). */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | undefined | null): boolean {
  return Boolean(email) && adminEmails().has((email as string).toLowerCase());
}

export class AdminForbidden extends Error {
  constructor() {
    super("Forbidden");
    this.name = "AdminForbidden";
  }
}

/**
 * Gate for admin UI pages and /api/admin/* routes. Accepts either the bearer
 * token (programmatic/CLI → actor "cli") OR a Supabase-authenticated user whose
 * email is in ADMIN_EMAILS. Throws AdminForbidden otherwise. Pass `req` to
 * enable the bearer path; omit it for UI pages (session only).
 */
export async function requireAdmin(req?: Request): Promise<{ actorId: string }> {
  if (req && isAdminRequest(req)) return { actorId: "cli" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (isAdminEmail(user?.email)) return { actorId: user!.email! };
  throw new AdminForbidden();
}
