CREATE TABLE "mcp_servers" (
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'http' NOT NULL,
	"url" text NOT NULL,
	"auth_header_enc" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_servers_guild_id_name_pk" PRIMARY KEY("guild_id","name")
);
--> statement-breakpoint
CREATE TABLE "squads" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"prompt" text NOT NULL,
	"requested_by" text NOT NULL,
	"attempt_task_ids" jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"vote_message_id" text,
	"winner_task_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_links" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"github_login" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "sub_source" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "require_linked_sponsor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "repro_gate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_approved_by" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "diff_summary" jsonb;