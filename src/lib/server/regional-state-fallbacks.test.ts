import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("regional state fallbacks", () => {
  it("uses the deployment region for linked field officers without state metadata", async () => {
    vi.stubEnv("REGION_CODE", "TN");
    vi.stubEnv("NEXT_PUBLIC_REGION_CODE", "TN");
    vi.resetModules();
    const { resolveActiveFieldOfficerProfile } = await import("./linked-profiles");
    const db = {
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({
              docs: [{ id: "fo-1", data: () => ({ uid: "uid-1", name: "Officer" }) }],
            }),
          }),
        }),
      }),
    } as never;

    const profile = await resolveActiveFieldOfficerProfile(db, { uid: "uid-1" });
    expect(profile?.stateCode).toBe("TN");
  });

  it("trims explicit stored state codes while keeping the deployment fallback", async () => {
    vi.stubEnv("REGION_CODE", "TN");
    vi.stubEnv("NEXT_PUBLIC_REGION_CODE", "TN");
    vi.resetModules();
    const { resolveActiveFieldOfficerProfile } = await import("./linked-profiles");
    const db = {
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({
              docs: [{ id: "fo-1", data: () => ({ uid: "uid-1", stateCode: "  KL  " }) }],
            }),
          }),
        }),
      }),
    } as never;

    const profile = await resolveActiveFieldOfficerProfile(db, { uid: "uid-1" });
    expect(profile?.stateCode).toBe("KL");
  });

  it("serializes missing site state from the deployment region and preserves stored state", async () => {
    vi.stubEnv("REGION_CODE", "TN");
    vi.stubEnv("NEXT_PUBLIC_REGION_CODE", "TN");
    vi.resetModules();
    const { resolveReportSite } = await import("../reports/report-server");
    const makeDb = (stateCode?: string) =>
      ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              id: "site-1",
              exists: true,
              data: () => ({ stateCode }),
            }),
          }),
        }),
      }) as never;

    expect(await resolveReportSite(makeDb(), "site-1")).toMatchObject({ stateCode: "TN" });
    expect(await resolveReportSite(makeDb("KL"), "site-1")).toMatchObject({ stateCode: "KL" });
  });

  it("authorizes missing-state reports against the deployment region", async () => {
    vi.stubEnv("REGION_CODE", "TN");
    vi.stubEnv("NEXT_PUBLIC_REGION_CODE", "TN");
    vi.resetModules();
    const { reportMatchesAdminScope } = await import("../reports/report-server");
    const decoded = { role: "admin" } as never;

    expect(reportMatchesAdminScope({}, decoded)).toBe(true);
    expect(reportMatchesAdminScope({ stateCode: "KL" }, decoded)).toBe(false);
  });

  it("routes admin report queries through the regional fallback for both report types", () => {
    for (const route of [
      "src/app/api/admin/training-reports/route.ts",
      "src/app/api/admin/visit-reports/route.ts",
    ]) {
      const code = source(route);
      expect(code).toContain("getRegionStateCode(decoded.stateCode)");
      expect(code).not.toContain('decoded.stateCode || "KL"');
    }
  });

  it("uses the deployment region when regional state discovery has no records", () => {
    const code = source("src/app/api/admin/states/route.ts");
    expect(code).toContain("codes.add(REGION_CODE)");
    expect(code).not.toContain('codes.add("KL")');
  });

  it("does not seed retired global compliance defaults for a future region", async () => {
    const { REGION_DEFAULT_SEEDED_DOCS } = await import("./region-onboarding");
    expect(REGION_DEFAULT_SEEDED_DOCS).toEqual([
      "systemConfig/runtime",
      "enrollmentFormConfig/global",
      "regionSetupProgress/default",
    ]);
    const code = source("src/lib/server/region-onboarding.ts");
    expect(code).not.toContain('collection("complianceSettings")');
    expect(code).not.toContain("DEFAULT_COMPLIANCE_SETTINGS");
  });
});
