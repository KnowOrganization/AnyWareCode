import * as Sentry from "@sentry/node";
import pino from "pino";

/**
 * Central logging + error tracking. `log` is the structured logger used across
 * the bot; `captureError` records an exception to both the log and Sentry (a
 * no-op sink until `initSentry` runs with a DSN). Keep all error-path reporting
 * going through `captureError` so nothing is swallowed silently.
 */

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

let sentryReady = false;

export function initSentry(dsn: string | undefined, environment: string): void {
  if (!dsn) {
    log.info("Sentry disabled (no SENTRY_DSN)");
    return;
  }
  Sentry.init({ dsn, environment, tracesSampleRate: 0 });
  sentryReady = true;
  log.info("Sentry initialized");
}

export function captureError(
  err: unknown,
  context: { msg: string } & Record<string, unknown>,
): void {
  const { msg, ...extra } = context;
  log.error({ err, ...extra }, msg);
  if (sentryReady) {
    Sentry.captureException(err, { extra: { msg, ...extra } });
  }
}
