import { describe, expect, it } from "vitest";
import { buildBinaryFileHash, buildTcsExamContentHash } from "./tcs-exam-hash";

describe("buildBinaryFileHash", () => {
  it("returns the same hash for the same bytes regardless of input type", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);

    expect(buildBinaryFileHash(payload)).toBe(buildBinaryFileHash(payload.buffer));
  });
});

describe("buildTcsExamContentHash", () => {
  it("ignores row ordering while keeping exam scope in the hash", () => {
    const rowsA = [
      {
        siteId: "site-a",
        siteName: "Center A",
        district: "Kollam",
        date: "2026-04-15",
        examCode: "bitsat",
        maleGuardsRequired: 2,
        femaleGuardsRequired: 1,
      },
      {
        siteId: "site-b",
        siteName: "Center B",
        district: "Kollam",
        date: "2026-04-16",
        examCode: "bitsat",
        maleGuardsRequired: 3,
        femaleGuardsRequired: 0,
      },
    ];

    const rowsB = [...rowsA].reverse();

    expect(buildTcsExamContentHash("bitsat", rowsA)).toBe(buildTcsExamContentHash("bitsat", rowsB));
    expect(buildTcsExamContentHash("bitsat", rowsA)).not.toBe(
      buildTcsExamContentHash("jee", rowsA),
    );
  });
});
