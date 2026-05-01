import { describe, expect, it } from "vitest";
import {
  canonicalizeDistrictList,
  canonicalizeDistrictName,
  expandDistrictQueryValues,
  districtMatches,
  inferKeralaDistrictFromText,
  resolveKeralaDistrictFromRow,
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

  it("maps TCS operational zones to the canonical district", () => {
    expect(resolveKeralaDistrictFromRow("South 2", ["South 2", "TC Address"])).toBe("Ernakulam");
  });

  it("infers district from site names and addresses when the district cell is empty", () => {
    expect(
      resolveKeralaDistrictFromRow("", [
        "TCS iON Digital Zone",
        "Near Civil Station, Kakkanad, Kerala",
      ]),
    ).toBe("Ernakulam");
  });

  it("canonicalizes district aliases before field-officer matching", () => {
    expect(resolveKeralaDistrictFromRow("Cochin", ["Cochin", "Center A"])).toBe("Ernakulam");
    expect(inferKeralaDistrictFromText("Venue at Calicut")).toBe("Kozhikode");
  });
});
