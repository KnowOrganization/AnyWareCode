-- Capture the Discord server name on guilds for the company admin panel
-- (display + search). Nullable; the bot backfills it best-effort. Hand-authored
-- (matches the 0008/0009 convention).
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "name" text;
