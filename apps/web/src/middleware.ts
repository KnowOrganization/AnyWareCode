import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coarse pre-lambda guard for the admin surface: is there a Supabase auth cookie
 * at all? Bearer-token (CLI) requests pass through to the route. The AUTHORITATIVE
 * check — validate the Supabase JWT + the ADMIN_EMAILS allowlist — runs in the
 * admin layout (requireAdmin) and every /api/admin mutation, so a stale/forged
 * cookie still gets rejected there. Kept dependency-free so it stays on the Edge
 * runtime without pulling in supabase-js.
 */
export function middleware(req: NextRequest) {
  // Bearer (CLI/programmatic) → let the route validate the secret.
  if (req.headers.get("authorization")?.startsWith("Bearer ")) {
    return NextResponse.next();
  }
  const hasSession = req.cookies
    .getAll()
    .some((c) => /^sb-.*-auth-token/.test(c.name));
  if (hasSession) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
