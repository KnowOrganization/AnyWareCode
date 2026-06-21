-- Add tasks.charged: whether a quota unit was actually spent for this task.
-- Plan-mode ("propose a plan") runs are free, so the boot recovery sweep
-- (recovery.ts) must NOT refund them — it has no in-memory flag, only this row.
-- Backfill existing rows to true: historical tasks were charged (plan-mode rows
-- already finished won't be re-refunded). Idempotent and additive, matching the
-- 0008–0011 hand-authored convention.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "charged" boolean DEFAULT true NOT NULL;
