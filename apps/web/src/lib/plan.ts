import type { Guild } from "@anywarecode/db";

// Read-only billing view for the dashboard. Enforcement lives in the bot
// (gates.ts); this just mirrors the same fields for display.

export const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  oss: "OSS Community",
  pro: "Pro",
  studio: "Studio",
};

/** Mirror of the bot's packSpendable — every tier is entitled, so packs are
 * always purchasable/spendable. */
export function packPurchasable(_guild: Guild): boolean {
  return true;
}

export interface PlanView {
  tier: string;
  status: Guild["subStatus"];
  codeCap: number;
  codeUsed: number;
  /** Always Infinity — /ask is unlimited on every plan. */
  askCap: number;
  askUsed: number;
  packRemaining: number;
  renewsAt: Date | null;
}

/** Mirror of the bot's resolveTier/planSummary: Free is the universal floor. */
export function planView(guild: Guild): PlanView {
  const isOss =
    guild.planId === "oss" &&
    guild.ossStatus === "approved" &&
    guild.subStatus !== "canceled";
  const isPaid =
    Boolean(guild.planId) &&
    guild.planId !== "oss" &&
    (guild.subStatus === "active" || guild.subStatus === "past_due");
  const tier = isOss
    ? (PLAN_LABELS["oss"] ?? "OSS Community")
    : isPaid
      ? `${PLAN_LABELS[guild.planId!] ?? guild.planId}${
          guild.subStatus === "past_due" ? " (payment overdue)" : ""
        }`
      : (PLAN_LABELS["free"] ?? "Free");
  return {
    tier,
    status: guild.subStatus,
    codeCap: guild.taskCap,
    codeUsed: guild.tasksUsedThisMonth,
    askCap: Number.POSITIVE_INFINITY,
    askUsed: guild.asksUsedThisMonth,
    packRemaining: guild.packTasksRemaining,
    renewsAt: guild.subStatus === "active" ? guild.currentPeriodEnd : null,
  };
}
