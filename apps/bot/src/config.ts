import { z } from "zod";

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  GITHUB_APP_ID: z.string().min(1),
  /** PEM, with literal \n allowed for env-file friendliness. */
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((key) => key.replaceAll("\\n", "\n")),
  /** Slug from app registration; used to build the install URL. */
  GITHUB_APP_SLUG: z.string().min(1).default("anywherecode"),
  ANTHROPIC_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  /** Public base URL GitHub redirects to after install (no trailing slash). */
  PUBLIC_URL: z.string().url(),
  /** Secret for signing the install `state` param linking guild<->installation. */
  STATE_SECRET: z.string().min(16),
  HTTP_PORT: z.coerce.number().int().default(3000),
  RUNNER_IMAGE: z.string().default("anywherecode-runner"),
  /** Docker network the runner joins; empty string = default bridge (dev). */
  RUNNER_NETWORK: z.string().default(""),
  /** http://host:port of the egress allowlist proxy, if RUNNER_NETWORK is set. */
  RUNNER_HTTPS_PROXY: z.string().default(""),
  DEFAULT_TASK_CAP: z.coerce.number().int().default(50),
  /** Hard wall-clock limit per task. */
  TASK_TIMEOUT_MINUTES: z.coerce.number().int().default(30),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid configuration: ${missing}`);
  }
  return result.data;
}
