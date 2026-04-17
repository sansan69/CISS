import { describe, expect, it } from "vitest";
import { normalizeGuardDob } from "./identity-utils";

describe("normalizeGuardDob", () => {
  it("keeps YYYY-MM-DD strings unchanged", () => {
    expect(normalizeGuardDob("1998-12-04")).toBe("1998-12-04");
  });

  it("normalizes ISO datetime strings to date only", () => {
    expect(normalizeGuardDob("1998-12-04T00:00:00.000Z")).toBe("1998-12-04");
  });

  it("normalizes Date instances", () => {
    expect(normalizeGuardDob(new Date("1998-12-04T10:30:00.000Z"))).toBe(
      "1998-12-04",
    );
  });

  it("normalizes Firestore Timestamp-like values", () => {
    const fakeTimestamp = {
      toDate() {
        return new Date("1998-12-04T00:00:00.000Z");
      },
    };

    expect(normalizeGuardDob(fakeTimestamp)).toBe("1998-12-04");
  });

  it("normalizes serialized timestamp shapes", () => {
    expect(
      normalizeGuardDob({
        seconds: Date.parse("1998-12-04T00:00:00.000Z") / 1000,
      }),
    ).toBe("1998-12-04");
  });

  it("returns empty string for unsupported values", () => {
    expect(normalizeGuardDob(null)).toBe("");
    expect(normalizeGuardDob(undefined)).toBe("");
    expect(normalizeGuardDob({ nope: true })).toBe("");
  });
});
