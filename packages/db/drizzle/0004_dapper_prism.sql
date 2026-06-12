CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'free');--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"task_cap" integer NOT NULL,
	"stripe_price_id" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "sub_status" "subscription_status" DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "current_period_end" timestamp with time zone;