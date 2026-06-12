CREATE TYPE "public"."oss_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_org_trials" (
	"org_login" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"rules" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_settings" (
	"guild_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"issue_channel_id" text,
	"issue_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_min_assoc" text DEFAULT 'any' NOT NULL,
	"issue_daily_cap" integer DEFAULT 10 NOT NULL,
	"issue_count_today" integer DEFAULT 0 NOT NULL,
	"issue_count_date" timestamp with time zone,
	"auto_review" boolean DEFAULT false NOT NULL,
	"review_channel_id" text,
	"fail_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "repo_settings_guild_id_repo_full_name_pk" PRIMARY KEY("guild_id","repo_full_name")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"prompt" text NOT NULL,
	"cadence" text NOT NULL,
	"hour_utc" integer NOT NULL,
	"day_of_week" integer,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_memories" (
	"guild_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"content" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_memories_guild_id_repo_full_name_pk" PRIMARY KEY("guild_id","repo_full_name")
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_pack_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"purchased_by" text NOT NULL,
	"purchaser_name" text NOT NULL,
	"tasks" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"announced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_pack_purchases_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guilds" ALTER COLUMN "task_cap" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "github_account_login" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "pack_tasks_remaining" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "oss_status" "oss_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "oss_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "oss_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "trial_gates_passed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "shiplog_channel_id" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "plan_vote_mode" text DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "plan_vote_role_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "source" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "issue_number" integer;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "schedule_id" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "plan_text" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "funded_by" text DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "pr_message_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "preview_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "shiplog_posted_at" timestamp with time zone;