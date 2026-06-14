import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminForbidden, requireAdmin } from "@/lib/admin";

/** Per-actor in-memory rate limit (best-effort; per lambda instance). */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function rateLimited(actorId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(actorId) ?? []).filter((t) => t > now - WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(actorId, recent);
    return true;
  }
  recent.push(now);
  hits.set(actorId, recent);
  return false;
}

export interface AdminHandlerArgs<T> {
  body: T;
  actorId: string;
  req: Request;
}

/**
 * Wrap an admin mutation route: gate (session/bearer) → rate-limit → strict zod
 * parse → handler. Maps AdminForbidden→403, ZodError→400, anything else→500
 * with a generic message (never leaks internals).
 */
export function withAdmin<T extends z.ZodTypeAny>(
  schema: T,
  handler: (args: AdminHandlerArgs<z.infer<T>>) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let actorId: string;
    try {
      ({ actorId } = await requireAdmin(req));
    } catch (err) {
      if (err instanceof AdminForbidden) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    if (rateLimited(actorId)) {
      return NextResponse.json({ error: "Rate limited" }, { status: 429 });
    }
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Bad request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    try {
      return await handler({ body: parsed.data, actorId, req });
    } catch (err) {
      if (err instanceof AdminForbidden) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Generic — never echo internals/secrets.
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}
