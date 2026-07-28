import { describe, expect, it } from "vitest";

import { toValidAttendanceDate } from "./date-value";

describe("attendance date values", () => {
  it("accepts Firestore Timestamp instances", () => {
    const expected = new Date("2026-07-28T08:30:00.000Z");
    expect(
      toValidAttendanceDate({
        toDate: () => expected,
      }),
    ).toEqual(expected);
  });

  it("accepts public and serialized Firestore timestamp shapes", () => {
    expect(
      toValidAttendanceDate({ seconds: 1_775_000_000, nanoseconds: 500_000_000 }),
    )?.toEqual(new Date(1_775_000_000_500));
    expect(
      toValidAttendanceDate({ _seconds: 1_775_000_000, _nanoseconds: 500_000_000 }),
    )?.toEqual(new Date(1_775_000_000_500));
  });

  it("accepts ISO strings and Date objects", () => {
    const expected = new Date("2026-07-28T08:30:00.000Z");
    expect(toValidAttendanceDate(expected.toISOString())).toEqual(expected);
    expect(toValidAttendanceDate(expected)).toEqual(expected);
  });

  it("returns null for missing or invalid values", () => {
    expect(toValidAttendanceDate(null)).toBeNull();
    expect(toValidAttendanceDate("")).toBeNull();
    expect(toValidAttendanceDate("not-a-date")).toBeNull();
    expect(toValidAttendanceDate({ seconds: Number.NaN })).toBeNull();
    expect(toValidAttendanceDate({ toDate: () => new Date(Number.NaN) })).toBeNull();
  });
});
