ALTER TABLE "guilds" ADD COLUMN "llm_provider_type" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "llm_credential_enc" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "llm_base_url" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "llm_model" text;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "llm_credential_set_at" timestamp with time zone;