import { describe, expect, it } from "vitest";
import { stereo48kToMono16k, wavFromMono16k } from "./pcm.js";

function stereoBuffer(frames: Array<[number, number]>): Buffer {
  const buf = Buffer.alloc(frames.length * 4);
  frames.forEach(([l, r], i) => {
    buf.writeInt16LE(l, i * 4);
    buf.writeInt16LE(r, i * 4 + 2);
  });
  return buf;
}

describe("stereo48kToMono16k", () => {
  it("averages channels and keeps every 3rd frame", () => {
    const input = stereoBuffer([
      [100, 200], // kept → 150
      [1, 1],
      [2, 2],
      [-100, -300], // kept → -200
      [3, 3],
      [4, 4],
    ]);
    const out = stereo48kToMono16k(input);
    expect(out.length).toBe(4);
    expect(out.readInt16LE(0)).toBe(150);
    expect(out.readInt16LE(2)).toBe(-200);
  });

  it("handles empty input", () => {
    expect(stereo48kToMono16k(Buffer.alloc(0)).length).toBe(0);
  });
});

describe("wavFromMono16k", () => {
  it("writes a valid 16kHz mono PCM header", () => {
    const pcm = Buffer.alloc(320); // 10ms
    const wav = wavFromMono16k(pcm);
    expect(wav.length).toBe(44 + 320);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(16_000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(40)).toBe(320); // data size
  });
});
