CREATE TABLE "setup_states" (
	"nonce" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
