import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateUploadToken, verifyUploadToken } from "./upload-token";

describe("attendance upload token", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
    process.env.UPLOAD_TOKEN_SECRET = "upload-test-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.UPLOAD_TOKEN_SECRET;
  });

  it("binds an upload to employee, site, and attendance attempt", () => {
    const token = generateUploadToken(
      "employee-doc-1",
      "site-1",
      "10000000-1000-4000-8000-100000000000",
    );

    expect(verifyUploadToken(token)).toMatchObject({
      employeeDocId: "employee-doc-1",
      siteId: "site-1",
      attemptId: "10000000-1000-4000-8000-100000000000",
    });
  });

  it("rejects an expired upload session", () => {
    const token = generateUploadToken(
      "employee-doc-1",
      "site-1",
      "10000000-1000-4000-8000-100000000000",
      60,
    );
    vi.advanceTimersByTime(61_000);

    expect(verifyUploadToken(token)).toBeNull();
  });
});
