import { createDb } from "@anywarecode/db";

// Reuse a single pool across hot reloads / serverless invocations.
const globalForDb = globalThis as unknown as {
  __awcDb?: ReturnType<typeof createDb>;
};

export const db =
  globalForDb.__awcDb ??
  (globalForDb.__awcDb = createDb(
    process.env.DATABASE_URL ?? "",
    process.env.DATABASE_SSL === "true",
  ));
