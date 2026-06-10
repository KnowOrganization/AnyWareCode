import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string, ssl = false) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Supabase/managed PG terminate TLS with their own chain; we require
    // encryption but don't pin a CA.
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  return drizzle(pool, { schema });
}

export * as schema from "./schema.js";
