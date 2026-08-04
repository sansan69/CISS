import { describe, expect, it } from "vitest";

import { resolveClientEnrollmentProfile } from "./client-enrollment-profile";

describe("resolveClientEnrollmentProfile", () => {
  it("uses stored Firebase profile metadata", () => {
    expect(resolveClientEnrollmentProfile("lng-petronet", "Renamed Terminal Client")).toBe("lng-petronet");
  });

  it("falls back to historical client aliases", () => {
    expect(resolveClientEnrollmentProfile(undefined, "Petronet LNG Ltd.")).toBe("lng-petronet");
    expect(resolveClientEnrollmentProfile(undefined, "TCS")).toBe("tcs");
  });

  it("uses the standard profile for other clients", () => {
    expect(resolveClientEnrollmentProfile(undefined, "Federal Bank Ltd.")).toBe("standard");
  });
});
