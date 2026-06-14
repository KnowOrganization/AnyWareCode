import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coarse pre-lambda guard: bounce un-authed requests off the admin surface
 * before they hit a node route. The authoritative allowlist check (requireAdmin)
 * still runs in the admin layout + every /api/admin mutation — this is only a
 * cheap "is there a session cookie at all" filter. Auth.js sets one of these
 * cookies on login.
 */
export function middleware(req: NextRequest) {
  // Bearer-token (CLI/programmatic) requests carry no session cookie — let them
  // through to the route, where requireAdmin/isAdminRequest validates the token.
  if (req.headers.get("authorization")?.startsWith("Bearer ")) {
    return NextResponse.next();
  }
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");
  if (hasSession) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // UI: send to the Discord OAuth sign-in (operators only; there is no user web).
  const signIn = new URL("/api/auth/signin", req.url);
  signIn.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
