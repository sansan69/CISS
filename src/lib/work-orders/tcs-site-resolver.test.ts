import { describe, expect, it } from "vitest";
import { resolveOneSiteId, resolveParsedRowSiteIds, type SiteLookupMaps } from "./tcs-site-resolver";

describe("resolveParsedRowSiteIds", () => {
  it("does not match another venue through a generic text TC code", () => {
    const site = {
      id: "rajagiri",
      siteId: "College",
      siteName: "Rajagiri School of Engineering",
      district: "Ernakulam",
    };
    const maps: SiteLookupMaps = {
      byCodeDistrict: new Map([["college|district:ernakulam", site]]),
      byFallback: new Map(),
      byCode: new Map([["code:college", site]]),
      byName: new Map(),
    };

    expect(resolveOneSiteId({
      siteId: "College",
      siteName: "Mar Athanasius College of Engineering",
      district: "Ernakulam",
      date: "2026-09-18",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      examName: "TCS Exam",
      examCode: "tcs-exam",
      sourceRowNumber: 3,
      sourceSheetName: "Sheet1",
    }, maps)).toBeNull();
  });

  it("keeps the uploaded canonical district when an existing site has an old spelling", () => {
    const site = {
      id: "site-tvm",
      siteId: "123",
      siteName: "College A",
      district: "THIRUVANATHAPURAM",
    };
    const maps: SiteLookupMaps = {
      byCodeDistrict: new Map([["123|district:thiruvananthapuram", site]]),
      byFallback: new Map(),
      byCode: new Map([["code:123", site]]),
      byName: new Map(),
    };
    const rows = resolveParsedRowSiteIds([{
      siteId: "123",
      siteName: "College A",
      district: "Thiruvananthapuram",
      date: "2026-04-16",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      examName: "TCS Exam",
      examCode: "tcs-exam",
      sourceRowNumber: 3,
      sourceSheetName: "Sheet1",
    }], maps);

    expect(rows[0]).toMatchObject({ siteId: "site-tvm", district: "Thiruvananthapuram" });
  });
});
