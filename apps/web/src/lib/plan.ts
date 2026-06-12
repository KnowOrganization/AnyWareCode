import type { Guild } from "@anywherecode/db";

// Read-only billing view for the dashboard. Enforcement lives in the bot
// (gates.ts); this just mirrors the same fields for display.
const ASK_CAP_MULTIPLIER = 4;
const DAY_MS = 86_400_000;

export const PLAN_LABELS: Record<string, string> = {
  oss: "OSS Community",
  pro: "Pro",
  studio: "Studio",
};

/** Mirror of the bot's resolveTier — packs spend only on OSS or a live paid plan. */
export function packPurchasable(guild: Guild): boolean {
  if (guild.planId === "oss" && guild.ossStatus === "approved") return true;
  return Boolean(
    guild.planId &&
      (guild.subStatus === "active" || guild.subStatus === "past_due"),
  );
}

export interface PlanView {
  tier: string;
  status: Guild["subStatus"];
  codeCap: number;
  codeUsed: number;
  /** Infinity = unlimited (OSS /ask). */
  askCap: number;
  askUsed: number;
  packRemaining: number;
  trialDaysLeft: number | null;
  renewsAt: Date | null;
}

export function planView(guild: Guild, now: Date = new Date()): PlanView {
  const isOss = guild.planId === "oss" && guild.ossStatus === "approved";
  const trialDaysLeft =
    guild.subStatus === "trialing" && guild.trialEndsAt
      ? Math.max(0, Math.ceil((guild.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null;
  const tier =
    guild.subStatus === "trialing"
      ? "Trial"
      : isOss
        ? (PLAN_LABELS["oss"] ?? "OSS Community")
        : guild.planId &&
            (guild.subStatus === "active" || guild.subStatus === "past_due")
          ? `${PLAN_LABELS[guild.planId] ?? guild.planId}${
              guild.subStatus === "past_due" ? " (payment overdue)" : ""
            }`
          : guild.subStatus === "canceled"
            ? "Canceled"
            : "No plan";
  return {
    tier,
    status: guild.subStatus,
    codeCap: guild.taskCap,
    codeUsed: guild.tasksUsedThisMonth,
    askCap: isOss ? Number.POSITIVE_INFINITY : guild.taskCap * ASK_CAP_MULTIPLIER,
    askUsed: guild.asksUsedThisMonth,
    packRemaining: guild.packTasksRemaining,
    trialDaysLeft,
    renewsAt: guild.subStatus === "active" ? guild.currentPeriodEnd : null,
  };
}
