CREATE TABLE "guild_installations" (
	"guild_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_installations_guild_id_installation_id_pk" PRIMARY KEY("guild_id","installation_id")
);
--> statement-breakpoint
ALTER TABLE "channel_repos" ADD COLUMN "installation_id" bigint;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "installation_id" bigint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "installation_id" bigint;--> statement-breakpoint
CREATE INDEX "guild_installations_installation_idx" ON "guild_installations" USING btree ("installation_id");--> statement-breakpoint
INSERT INTO "guild_installations" ("guild_id", "installation_id", "account_login", "linked_at")
  SELECT "id", "github_installation_id", coalesce("github_account_login", ''), now()
  FROM "guilds" WHERE "github_installation_id" IS NOT NULL;--> statement-breakpoint
UPDATE "channel_repos" cr SET "installation_id" = g."github_installation_id"
  FROM "guilds" g WHERE g."id" = cr."guild_id";--> statement-breakpoint
UPDATE "proposals" p SET "installation_id" = g."github_installation_id"
  FROM "guilds" g WHERE g."id" = p."guild_id";--> statement-breakpoint
UPDATE "tasks" t SET "installation_id" = g."github_installation_id"
  FROM "guilds" g WHERE g."id" = t."guild_id";--> statement-breakpoint
ALTER TABLE "guilds" DROP COLUMN "github_installation_id";--> statement-breakpoint
ALTER TABLE "guilds" DROP COLUMN "github_account_login";