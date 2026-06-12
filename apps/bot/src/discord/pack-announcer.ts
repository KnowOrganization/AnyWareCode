import type { Client } from "discord.js";
import {
  listUnannouncedPackPurchases,
  markPackPurchaseAnnounced,
  type Db,
} from "@anywherecode/db";
import { captureError } from "../observability.js";
import { findAnnounceChannel } from "./welcome.js";

const SWEEP_INTERVAL_MS = 45_000;

/**
 * Public credit for community-funded compute. The web app records purchases
 * (Stripe webhook); the bot polls for unannounced rows — DB polling keeps the
 * web→bot path decoupled (no queue, no webhook between our own processes).
 * Rows are marked announced even when no channel is postable: no retry loop.
 */
export function startPackAnnouncer(db: Db, client: Client): NodeJS.Timeout {
  const sweep = async (): Promise<void> => {
    const purchases = await listUnannouncedPackPurchases(db);
    for (const p of purchases) {
      try {
        const guild = await client.guilds.fetch(p.guildId).catch(() => null);
        const channel = guild ? findAnnounceChannel(guild) : null;
        if (channel) {
          await channel.send({
            content: `🔋 <@${p.purchasedBy}> powered **${p.tasks} tasks** for this server!`,
            allowedMentions: { users: [p.purchasedBy] },
          });
        }
      } catch (err) {
        captureError(err, { msg: "pack announce failed", guildId: p.guildId });
      } finally {
        await markPackPurchaseAnnounced(db, p.id).catch((err) =>
          captureError(err, { msg: "pack announce mark failed", id: p.id }),
        );
      }
    }
  };
  const timer = setInterval(() => {
    void sweep().catch((err) =>
      captureError(err, { msg: "pack announcer sweep failed" }),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
