import type { Guild } from "@anywherecode/db";

// Read-only billing view for the dashboard. Enforcement lives in the bot
// (gates.ts); this just mirrors the same fields for display.
const ASK_CAP_MULTIPLIER = 4;
const DAY_MS = 86_400_000;

export interface PlanView {
  tier: string;
  status: Guild["subStatus"];
  codeCap: number;
  codeUsed: number;
  askCap: number;
  askUsed: number;
  trialDaysLeft: number | null;
  renewsAt: Date | null;
}

export function planView(guild: Guild, now: Date = new Date()): PlanView {
  const trialDaysLeft =
    guild.subStatus === "trialing" && guild.trialEndsAt
      ? Math.max(0, Math.ceil((guild.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null;
  const tier =
    guild.subStatus === "active"
      ? "Paid"
      : guild.subStatus === "trialing"
        ? "Trial"
        : guild.subStatus === "past_due"
          ? "Past due"
          : guild.subStatus === "canceled"
            ? "Canceled"
            : "Free";
  return {
    tier,
    status: guild.subStatus,
    codeCap: guild.taskCap,
    codeUsed: guild.tasksUsedThisMonth,
    askCap: guild.taskCap * ASK_CAP_MULTIPLIER,
    askUsed: guild.asksUsedThisMonth,
    trialDaysLeft,
    renewsAt: guild.subStatus === "active" ? guild.currentPeriodEnd : null,
  };
}
