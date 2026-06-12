import { describe, expect, it } from "vitest";
import { parseVerdict } from "./repro.js";

describe("parseVerdict", () => {
  it("reads the first-line prefix, case-insensitively", () => {
    expect(parseVerdict("REPRODUCED: failing test described")).toBe("reproduced");
    expect(parseVerdict("reproduced: yes")).toBe("reproduced");
    expect(parseVerdict("NOT-REPRODUCED: `h3_stream_cycle` does not exist")).toBe(
      "not-reproduced",
    );
    expect(parseVerdict("not reproduced: symbol missing")).toBe("not-reproduced");
    expect(parseVerdict("UNCLEAR: needs hardware")).toBe("unclear");
  });

  it("defaults to unclear on anything else", () => {
    expect(parseVerdict(undefined)).toBe("unclear");
    expect(parseVerdict("")).toBe("unclear");
    expect(parseVerdict("I looked into the issue and it seems fine")).toBe("unclear");
    // The token must lead the summary, not merely appear in it.
    expect(parseVerdict("The bug could be REPRODUCED in theory")).toBe("unclear");
  });

  it("ignores trailing lines", () => {
    expect(parseVerdict("NOT-REPRODUCED: nope\nREPRODUCED elsewhere")).toBe(
      "not-reproduced",
    );
  });
});
