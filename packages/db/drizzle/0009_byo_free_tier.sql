-- BYO-LLM + flat-feature pricing: retire the platform-key trial. The new
-- default tier is Free (every plan ships every feature; only the monthly /code
-- count differs). Hand-authored to backfill data and drop trial machinery
-- (matches the 0008 convention; drizzle-kit would prompt interactively).

-- Backfill existing rows onto the Free floor BEFORE dropping the trial columns.
-- Trialing guilds and orphaned free rows both land on the Free plan + cap.
UPDATE "guilds" SET "sub_status" = 'free', "plan_id" = 'free', "task_cap" = 15, "concurrency" = 1 WHERE "sub_status" = 'trialing';--> statement-breakpoint
UPDATE "guilds" SET "plan_id" = 'free', "task_cap" = 15 WHERE "sub_status" = 'free' AND "plan_id" IS NULL;--> statement-breakpoint

-- New guilds default to Free, not trialing. (The 'trialing' enum value is left
-- in place but dormant — removing a PG enum value is disruptive.)
ALTER TABLE "guilds" ALTER COLUMN "sub_status" SET DEFAULT 'free';--> statement-breakpoint

-- Trial machinery is gone: no platform-key trial, no abuse-gate cache, no
-- one-trial-per-org ledger.
ALTER TABLE "guilds" DROP COLUMN IF EXISTS "trial_ends_at";--> statement-breakpoint
ALTER TABLE "guilds" DROP COLUMN IF EXISTS "trial_gates_passed_at";--> statement-breakpoint
DROP TABLE IF EXISTS "github_org_trials";
