import { timingSafeEqual } from "node:crypto";

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
