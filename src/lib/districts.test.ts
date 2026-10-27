import { describe, expect, it } from "vitest";
import {
  canonicalizeDistrictList,
  canonicalizeDistrictName,
  expandDistrictQueryValues,
  districtMatches,
  inferKeralaDistrictFromText,
  mergeDistrictOptions,
  resolveWorkOrderDistrict,
  resolveKeralaDistrictFromRow,
  getRegionDistricts,
  getDefaultDistrictSuggestions,
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

  it("resolves close spelling and case variants to one district", () => {
    expect(canonicalizeDistrictName("Thiruvanathapuram")).toBe("Thiruvananthapuram");
    expect(canonicalizeDistrictName("THIRUVANATHAPURAM DISTRICT")).toBe("Thiruvananthapuram");
    expect(districtMatches("Thiruvanathapuram", "THIRUVANANTHAPURAM")).toBe(true);
    expect(canonicalizeDistrictName("THIRUVANANTHAPU")).toBe("Thiruvananthapuram");
    expect(canonicalizeDistrictName("Kothamangalam")).toBe("Ernakulam");
  });

  it("does not guess from unrelated or ambiguous place names", () => {
    expect(canonicalizeDistrictName("South Kerala Region")).toBe("South Kerala Region");
    expect(canonicalizeDistrictName("Kottayam and Kollam")).toBe("Kottayam and Kollam");
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
    expect(resolveKeralaDistrictFromRow("South 2", ["South 2", "College, Thrissur"])).toBe("Thrissur");
  });

  it("infers district from site names and addresses when the district cell is empty", () => {
    expect(
      resolveKeralaDistrictFromRow("", [
        "TCS iON Digital Zone",
        "Near Civil Station, Kakkanad, Kerala",
      ]),
    ).toBe("Ernakulam");
  });

  it("keeps the explicit district over conflicting venue text", () => {
    expect(resolveKeralaDistrictFromRow("Thiruvanathapuram", [
      "Campus near Kollam Road", "Thiruvanathapuram",
    ])).toBe("Thiruvananthapuram");
  });

  it("deduplicates display options under the canonical district name", () => {
    expect(mergeDistrictOptions(["THIRUVANATHAPURAM", "Thiruvananthapuram"])).toEqual([
      "Thiruvananthapuram",
    ]);
  });

  it("uses the uploaded work-order district before stale site metadata", () => {
    expect(resolveWorkOrderDistrict("Thiruvanathapuram", "Kollam")).toBe("Thiruvananthapuram");
    expect(resolveWorkOrderDistrict("", "THIRUVANATHAPURAM")).toBe("Thiruvananthapuram");
    expect(resolveWorkOrderDistrict("  ", "Kollam")).toBe("Kollam");
  });

  it("canonicalizes district aliases before field-officer matching", () => {
    expect(resolveKeralaDistrictFromRow("Cochin", ["Cochin", "Center A"])).toBe("Ernakulam");
    expect(inferKeralaDistrictFromText("Venue at Calicut")).toBe("Kozhikode");
  });
});


describe("regional district suggestions", () => {
  it("lists Tamil Nadu districts for the Tamil Nadu deployment", () => {
    const districts = getRegionDistricts("Tamil Nadu", "TN");
    expect(districts).toContain("Chennai");
    expect(districts).toContain("Coimbatore");
    expect(districts).toContain("Vellore");
    expect(districts).toContain("Kanyakumari");
    expect(districts).toHaveLength(38);
    expect(getDefaultDistrictSuggestions("TN", "Tamil Nadu")).toEqual(districts);
    expect(getRegionDistricts("Andhra Pradesh", "AP")).toEqual(
      expect.arrayContaining(["Tirupati", "NTR", "Anakapalli"]),
    );
    expect(getRegionDistricts("Karnataka", "KA")).toContain("Vijayanagara");
  });

  it("keeps Kerala districts for the Kerala deployment and unknown states empty", () => {
    expect(getRegionDistricts("Kerala", "KL")).toContain("Thiruvananthapuram");
    expect(getRegionDistricts("Unknown", "XX")).toEqual([]);
  });
});
