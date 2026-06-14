import { randomUUID } from "node:crypto";
import { Events, type Entitlement } from "discord.js";
import { eq, sql } from "drizzle-orm";
import {
  applyGuildSubscription,
  getPlan,
  recordTaskPackPurchase,
  schema,
} from "@anywherecode/db";
import type { Config } from "../config.js";
import { captureError, log } from "../observability.js";
import type { BotContext } from "./interactions.js";

/**
 * Discord Premium Apps — the second billing rail, inert until DISCORD_SKU_*
 * env vars exist. Both rails funnel through the same packages/db choke points
 * (applyGuildSubscription / recordTaskPackPurchase); each rail's destructive
 * writes are guarded by guilds.subSource so a stale event from one can't
 * wipe the other's plan.
 *
 * Discord never reliably delivers a "subscription ended" event (DELETE fires
 * on refund/removal only; the period-end UPDATE is best-effort) — so renewals
 * refresh currentPeriodEnd here, the 6-hourly sweep reconciles missed events,
 * and ensureGuild lazily expires a Discord-funded sub 24h past its period end.
 */

const SWEEP_INTERVAL_MS = 6 * 3_600_000;

function skuPlanId(config: Config, skuId: string): string | null {
  if (skuId === config.DISCORD_SKU_PRO) return "pro";
  if (skuId === config.DISCORD_SKU_STUDIO) return "studio";
  return null;
}

function premiumEnabled(config: Config): boolean {
  return Boolean(
    config.DISCORD_SKU_PRO || config.DISCORD_SKU_STUDIO || config.DISCORD_SKU_PACK,
  );
}

export function registerEntitlementHandlers(ctx: BotContext): void {
  if (!premiumEnabled(ctx.config)) return;
  ctx.client.on(Events.EntitlementCreate, (entitlement) => {
    void applyEntitlement(ctx, entitlement).catch((err) =>
      captureError(err, { msg: "entitlement create failed" }),
    );
  });
  ctx.client.on(Events.EntitlementUpdate, (_old, entitlement) => {
    void applyEntitlement(ctx, entitlement).catch((err) =>
      captureError(err, { msg: "entitlement update failed" }),
    );
  });
  ctx.client.on(Events.EntitlementDelete, (entitlement) => {
    void revokeEntitlement(ctx, entitlement).catch((err) =>
      captureError(err, { msg: "entitlement delete failed" }),
    );
  });
}

export async function applyEntitlement(
  ctx: Pick<BotContext, "db" | "config" | "client">,
  entitlement: Entitlement,
): Promise<void> {
  if (!entitlement.guildId) return; // user-scoped — not a guild purchase
  if (process.env.NODE_ENV === "production" && entitlement.isTest()) return;

  if (entitlement.skuId === ctx.config.DISCORD_SKU_PACK) {
    await creditPackEntitlement(ctx, entitlement);
    return;
  }
  const planId = skuPlanId(ctx.config, entitlement.skuId);
  if (!planId) return;
  const plan = await getPlan(ctx.db, planId);
  if (!plan) {
    log.error(`[operator] Discord SKU maps to missing plan row: ${planId}`);
    return;
  }
  await applyGuildSubscription(ctx.db, entitlement.guildId, {
    subStatus: "active",
    subSource: "discord",
    planId: plan.id,
    taskCap: plan.taskCap,
    concurrency: plan.concurrency,
    currentPeriodEnd: entitlement.endsAt ?? null,
  });
  log.info(
    { guildId: entitlement.guildId, planId },
    "discord entitlement applied",
  );
}

/**
 * Consumable pack: credit FIRST (idempotent on the discord:<id> ledger key —
 * replays and sweep re-runs are no-ops), then consume. Never flip the order:
 * consume-then-credit loses the purchase if the credit write fails.
 */
async function creditPackEntitlement(
  ctx: Pick<BotContext, "db" | "client">,
  entitlement: Entitlement,
): Promise<void> {
  if (!entitlement.guildId || entitlement.consumed) return;
  const purchaser = entitlement.userId
    ? await entitlement.fetchUser().catch(() => null)
    : null;
  const credited = await recordTaskPackPurchase(ctx.db, {
    id: randomUUID(),
    guildId: entitlement.guildId,
    purchasedBy: entitlement.userId ?? "unknown",
    purchaserName: purchaser?.username ?? "a member",
    tasks: 50,
    amountCents: 1000,
    razorpayPaymentId: `discord:${entitlement.id}`,
  });
  await ctx.client.application?.entitlements
    .consume(entitlement.id)
    .catch((err) =>
      captureError(err, {
        msg: "entitlement consume failed (credit already idempotent)",
        entitlementId: entitlement.id,
      }),
    );
  if (credited) {
    log.info(
      { guildId: entitlement.guildId, entitlementId: entitlement.id },
      "discord pack credited",
    );
  }
}

/** DELETE = refund/removal. Branch by SKU: pack refund claws back the
 * balance; sub removal cancels — but only a Discord-sourced sub. */
export async function revokeEntitlement(
  ctx: Pick<BotContext, "db" | "config">,
  entitlement: Entitlement,
): Promise<void> {
  if (!entitlement.guildId) return;

  if (entitlement.skuId === ctx.config.DISCORD_SKU_PACK) {
    const ledger = await ctx.db.query.taskPackPurchases.findFirst({
      where: eq(
        schema.taskPackPurchases.razorpayPaymentId,
        `discord:${entitlement.id}`,
      ),
    });
    if (!ledger) return;
    await ctx.db
      .update(schema.guilds)
      .set({
        packTasksRemaining: sql`greatest(${schema.guilds.packTasksRemaining} - ${ledger.tasks}, 0)`,
      })
      .where(eq(schema.guilds.id, entitlement.guildId));
    log.info(
      { guildId: entitlement.guildId },
      "discord pack refunded — balance clawed back",
    );
    return;
  }

  if (!skuPlanId(ctx.config, entitlement.skuId)) return;
  const guild = await ctx.db.query.guilds.findFirst({
    where: eq(schema.guilds.id, entitlement.guildId),
  });
  // Source guard: never cancel another rail's (Razorpay/admin) plan off a
  // Discord event.
  if (guild?.subSource !== "discord") return;
  await applyGuildSubscription(ctx.db, entitlement.guildId, {
    subStatus: "canceled",
    subSource: null,
    planId: null,
    taskCap: 0,
    concurrency: 1,
  });
  log.info({ guildId: entitlement.guildId }, "discord subscription revoked");
}

/**
 * Reconciliation sweep (boot + every 6h): one paginated fetch closes the
 * offline gaps — missed CREATEs, packs whose consume() failed, renewal
 * period-end refreshes, and Discord-funded guilds whose entitlement is gone.
 */
export async function sweepEntitlements(
  ctx: Pick<BotContext, "db" | "config" | "client">,
): Promise<void> {
  if (!premiumEnabled(ctx.config)) return;
  const application = ctx.client.application;
  if (!application) return;
  const entitlements = await application.entitlements.fetch({
    excludeEnded: true,
  });

  const activeSubGuilds = new Set<string>();
  for (const entitlement of entitlements.values()) {
    if (!entitlement.guildId) continue;
    if (entitlement.skuId === ctx.config.DISCORD_SKU_PACK) {
      if (!entitlement.consumed) await creditPackEntitlement(ctx, entitlement);
      continue;
    }
    if (skuPlanId(ctx.config, entitlement.skuId)) {
      activeSubGuilds.add(entitlement.guildId);
      await applyEntitlement(ctx, entitlement);
    }
  }

  // Discord-funded guilds with no live entitlement and a lapsed period: end them.
  const discordFunded = await ctx.db.query.guilds.findMany({
    where: eq(schema.guilds.subSource, "discord"),
  });
  for (const guild of discordFunded) {
    if (guild.subStatus !== "active" || activeSubGuilds.has(guild.id)) continue;
    if (guild.currentPeriodEnd && guild.currentPeriodEnd.getTime() < Date.now()) {
      await applyGuildSubscription(ctx.db, guild.id, {
        subStatus: "canceled",
        subSource: null,
        planId: null,
        taskCap: 0,
        concurrency: 1,
      });
      log.info({ guildId: guild.id }, "discord subscription lapsed (sweep)");
    }
  }
}

export function startEntitlementSweeper(
  ctx: Pick<BotContext, "db" | "config" | "client">,
): NodeJS.Timeout | null {
  if (!premiumEnabled(ctx.config)) return null;
  const timer = setInterval(() => {
    void sweepEntitlements(ctx).catch((err) =>
      captureError(err, { msg: "entitlement sweep failed" }),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

export { premiumEnabled };
