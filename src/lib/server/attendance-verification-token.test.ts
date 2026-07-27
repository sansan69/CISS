import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateAttendanceVerificationToken,
  verifyAttendanceVerificationToken,
} from "./attendance-verification-token";

describe("attendance verification tokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
    process.env.ATTENDANCE_VERIFICATION_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ATTENDANCE_VERIFICATION_SECRET;
  });

  it("round-trips a signed employee identity", () => {
    const token = generateAttendanceVerificationToken({
      employeeDocId: "employee-doc-1",
      method: "phone",
    });

    expect(verifyAttendanceVerificationToken(token)).toMatchObject({
      employeeDocId: "employee-doc-1",
      method: "phone",
    });
  });

  it("rejects tampering", () => {
    const token = generateAttendanceVerificationToken({
      employeeDocId: "employee-doc-1",
      method: "employeeId",
    });

    expect(verifyAttendanceVerificationToken(`${token}tampered`)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = generateAttendanceVerificationToken({
      employeeDocId: "employee-doc-1",
      method: "qr",
      ttlSeconds: 60,
    });
    vi.advanceTimersByTime(61_000);

    expect(verifyAttendanceVerificationToken(token)).toBeNull();
  });
});
