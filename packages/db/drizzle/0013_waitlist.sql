-- Beta waitlist email signups. Email is the PK so re-submits dedup for free.
-- Additive and idempotent, matching the 0008–0012 hand-authored convention.
CREATE TABLE IF NOT EXISTS "waitlist_signups" (
	"email" text PRIMARY KEY NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
