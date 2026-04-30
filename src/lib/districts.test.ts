import { describe, expect, it } from "vitest";
import {
  canonicalizeDistrictList,
  canonicalizeDistrictName,
  expandDistrictQueryValues,
  districtMatches,
} from "./districts";

describe("district aliases", () => {
  it("matches Trivandrum with Thiruvananthapuram", () => {
    expect(districtMatches("Trivandrum", "Thiruvananthapuram")).toBe(true);
    expect(districtMatches("TVM", "Thiruvananthapuram")).toBe(true);
  });

  it("canonicalizes common aliases to the configured district name", () => {
    expect(canonicalizeDistrictName("Trivandrum")).toBe("Thiruvananthapuram");
    expect(canonicalizeDistrictName("TVM")).toBe("Thiruvananthapuram");
  });

  it("dedupes district lists after canonicalization", () => {
    expect(
      canonicalizeDistrictList(["Trivandrum", "Thiruvananthapuram", "  TVM  "]),
    ).toEqual(["Thiruvananthapuram"]);
  });

  it("expands query values to cover legacy spellings", () => {
    expect(expandDistrictQueryValues(["Trivandrum"])).toEqual(
      expect.arrayContaining(["Trivandrum", "Thiruvananthapuram", "TVM"]),
    );
  });
});
