-- Razorpay migration + admin panel tables. Hand-authored so column RENAMEs
-- preserve data (drizzle-kit would emit drop+add and prompt interactively).

-- guilds: rename Stripe id columns, add updatedAt, rewrite legacy subSource.
ALTER TABLE "guilds" RENAME COLUMN "stripe_customer_id" TO "razorpay_customer_id";--> statement-breakpoint
ALTER TABLE "guilds" RENAME COLUMN "stripe_subscription_id" TO "razorpay_subscription_id";--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "guilds" SET "sub_source" = 'razorpay' WHERE "sub_source" = 'stripe';--> statement-breakpoint

-- plans: one Razorpay plan id per currency.
ALTER TABLE "plans" RENAME COLUMN "stripe_price_id" TO "razorpay_plan_id_inr";--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "razorpay_plan_id_usd" text;--> statement-breakpoint

-- task pack ledger: rename the idempotency key + its unique constraint.
ALTER TABLE "task_pack_purchases" RENAME COLUMN "stripe_checkout_session_id" TO "razorpay_payment_id";--> statement-breakpoint
ALTER TABLE "task_pack_purchases" RENAME CONSTRAINT "task_pack_purchases_stripe_checkout_session_id_unique" TO "task_pack_purchases_razorpay_payment_id_unique";--> statement-breakpoint

-- Razorpay webhook event dedup.
CREATE TABLE "razorpay_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Admin mutation audit trail.
CREATE TABLE "admin_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_discord_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_idx" ON "admin_audit_log" USING btree ("target_type","target_id");
