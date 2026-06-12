import { EndBehaviorType, type VoiceReceiver } from "@discordjs/voice";
import prism from "prism-media";

/**
 * Captures one utterance from one speaker: Discord hands per-user Opus
 * streams (speaker labels for free), ended after 1s of silence. The PCM
 * stays in memory and is force-flushed at the utterance ceiling so a stuck
 * stream can't grow without bound.
 */
export function captureUtterance(
  receiver: VoiceReceiver,
  userId: string,
  maxSeconds: number,
): Promise<Buffer> {
  return new Promise((resolve) => {
    const opus = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });
    const decoder = new prism.opus.Decoder({
      rate: 48_000,
      channels: 2,
      frameSize: 960,
    });
    const chunks: Buffer[] = [];
    let total = 0;
    // 48kHz stereo Int16 = 192,000 bytes/sec.
    const maxBytes = maxSeconds * 192_000;

    const finish = (): void => {
      clearTimeout(flush);
      resolve(Buffer.concat(chunks));
    };
    const flush = setTimeout(() => opus.destroy(), maxSeconds * 1000);

    decoder.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= maxBytes) opus.destroy();
    });
    decoder.on("end", finish);
    decoder.on("error", finish);
    opus.on("error", () => decoder.destroy());
    opus.on("close", () => decoder.end());
    opus.pipe(decoder);
  });
}
