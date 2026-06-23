import { NextResponse } from "next/server";
import { z } from "zod";
import { addWaitlistSignup } from "@anywarecode/db";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// Public beta-waitlist capture. Email is the table PK, so re-submits dedup.
// ponytail: no rate limit; add an IP/Upstash throttle if spammed.
const Body = z.object({
  email: z.string().email().max(254),
  source: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  const { email, source } = parsed.data;
  await addWaitlistSignup(db, email.toLowerCase().trim(), source);
  return NextResponse.json({ ok: true });
}
