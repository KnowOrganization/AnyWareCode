/**
 * Pure-TS audio munging: Discord gives 48kHz stereo Int16LE PCM; Whisper wants
 * mono 16kHz WAV. Averaging channels + taking every 3rd sample (48000/16000)
 * is plenty for speech — no ffmpeg in the loop.
 */

export function stereo48kToMono16k(pcm: Buffer): Buffer {
  // 1 stereo frame = 4 bytes (2 × Int16). Decimate by 3 frames.
  const frames = Math.floor(pcm.length / 4);
  const outSamples = Math.floor(frames / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const frame = i * 3 * 4;
    const left = pcm.readInt16LE(frame);
    const right = pcm.readInt16LE(frame + 2);
    out.writeInt16LE(Math.round((left + right) / 2), i * 2);
  }
  return out;
}

export function wavFromMono16k(pcm: Buffer): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32); // block align
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
