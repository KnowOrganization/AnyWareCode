import type { Guild } from "@anywherecode/db";

/** Billing-only guild snapshot for audit logs + API responses (never leaks
 * credential columns). */
export function guildAuditView(g: Guild | null) {
  if (!g) return null;
  return {
    id: g.id,
    planId: g.planId,
    subStatus: g.subStatus,
    subSource: g.subSource,
    taskCap: g.taskCap,
    concurrency: g.concurrency,
    packTasksRemaining: g.packTasksRemaining,
    tasksUsedThisMonth: g.tasksUsedThisMonth,
    asksUsedThisMonth: g.asksUsedThisMonth,
    suspended: g.suspended,
    currentPeriodEnd: g.currentPeriodEnd,
    trialEndsAt: g.trialEndsAt,
    updatedAt: g.updatedAt,
  };
}
