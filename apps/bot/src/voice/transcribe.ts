import { log } from "../observability.js";

/**
 * Whisper batch transcription, one call per utterance. The audio buffer never
 * touches disk or the DB — it lives exactly as long as this request. Failures
 * return null (one lost utterance, not a dead session).
 */
export async function transcribeWav(
  apiKey: string,
  wav: Buffer,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "utterance.wav",
  );
  form.append("model", "whisper-1");
  try {
    const res = await fetchFn("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (res.status !== 200) {
      log.warn({ status: res.status }, "whisper non-200");
      return null;
    }
    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim();
    return text ? text : null;
  } catch (err) {
    log.warn({ err }, "whisper request failed");
    return null;
  }
}
