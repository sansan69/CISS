import { describe, expect, it } from "vitest";

import { normalizeDutyDate } from "./duty-date";

describe("normalizeDutyDate", () => {
  it("accepts a valid ISO date and trims surrounding whitespace", () => {
    expect(normalizeDutyDate(" 2026-11-15 ")).toBe("2026-11-15");
  });

  it("rejects calendar dates that would roll over", () => {
    expect(normalizeDutyDate("2026-02-30")).toBeNull();
    expect(normalizeDutyDate("2025-02-29")).toBeNull();
    expect(normalizeDutyDate("2026-13-01")).toBeNull();
  });

  it("rejects non-ISO formats", () => {
    expect(normalizeDutyDate("15/11/2026")).toBeNull();
    expect(normalizeDutyDate("")).toBeNull();
    expect(normalizeDutyDate(null)).toBeNull();
  });
});
