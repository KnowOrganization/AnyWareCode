CREATE TYPE "public"."task_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "channel_repos" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"repo_full_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"github_installation_id" bigint,
	"allowed_role_id" text,
	"task_cap" integer DEFAULT 50 NOT NULL,
	"tasks_used_this_month" integer DEFAULT 0 NOT NULL,
	"asks_used_this_month" integer DEFAULT 0 NOT NULL,
	"cap_reset_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"mode" text DEFAULT 'code' NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"pr_number" integer,
	"container_id" text,
	"prompt" text NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
