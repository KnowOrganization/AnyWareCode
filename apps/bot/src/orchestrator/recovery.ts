import Docker from "dockerode";
import { inArray } from "drizzle-orm";
import { schema, type Db } from "../db/index.js";
import { refundUsage } from "./usage.js";

export async function recoverStaleTasks(
  db: Db,
  notify: (threadId: string, message: string) => Promise<void>,
): Promise<void> {
  const stale = await db
    .update(schema.tasks)
    .set({ status: "failed", finishedAt: new Date() })
    .where(inArray(schema.tasks.status, ["queued", "running"]))
    .returning();

  for (const task of stale) {
    await refundUsage(db, task.guildId, task.mode);
    await notify(
      task.threadId,
      "⚠️ Bot restarted mid-task. Task marked failed and quota refunded — rerun `/code` to retry.",
    ).catch(() => {});
  }
}

export async function killStaleContainers(): Promise<void> {
  const docker = new Docker();
  try {
    const containers = await docker.listContainers({
      filters: JSON.stringify({ label: ["anywherecode.task"] }),
    });
    await Promise.all(
      containers.map((c) =>
        docker
          .getContainer(c.Id)
          .kill()
          .catch(() => {}),
      ),
    );
  } catch {
    // Docker unavailable in some environments; not fatal
  }
}
