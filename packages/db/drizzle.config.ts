import { defineConfig } from "drizzle-kit";

const useSsl =
  process.env.DATABASE_SSL === "true" || process.env.DATABASE_SSL === "1";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://anywherecode:anywherecode@localhost:5432/anywherecode",
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  },
});
