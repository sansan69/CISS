import { describe, expect, it } from "vitest";
import {
  isClientEnrollmentEnabled,
  isClientPortalEnabled,
  sortClientOptionsByActiveGuardCount,
} from "./client-options";

describe("client enrollment availability", () => {
  it("keeps clients enabled when the flag is absent for legacy records", () => {
    expect(isClientPortalEnabled({})).toBe(true);
    expect(isClientPortalEnabled({ portalEnabled: true })).toBe(true);
  });

  it("hides clients explicitly disabled by the admin", () => {
    expect(isClientPortalEnabled({ portalEnabled: false })).toBe(false);
  });

  it("keeps portal access separate from guard registration availability", () => {
    expect(isClientEnrollmentEnabled({ portalEnabled: true })).toBe(true);
    expect(isClientEnrollmentEnabled({ portalEnabled: true, enrollmentEnabled: false })).toBe(false);
    expect(isClientEnrollmentEnabled({ portalEnabled: false, enrollmentEnabled: true })).toBe(false);
  });

  it("ranks clients by active guard count and leaves inactive clients at the end", () => {
    const clients = [
      { id: "geodis", name: "Geodis India Ltd.", activeGuardCount: 0 },
      { id: "tcs", name: "TCS", activeGuardCount: 12 },
      { id: "lulu", name: "Lulu", activeGuardCount: 0 },
      { id: "corrohealth", name: "Corrohealth", activeGuardCount: 6 },
      { id: "federal", name: "Federal Bank Ltd.", activeGuardCount: 0 },
    ];

    expect(sortClientOptionsByActiveGuardCount(clients).map((client) => client.name)).toEqual([
      "TCS",
      "Corrohealth",
      "Federal Bank Ltd.",
      "Geodis India Ltd.",
      "Lulu",
    ]);
  });
});
