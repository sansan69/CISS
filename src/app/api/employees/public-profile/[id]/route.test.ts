import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

function mockEmployee(data: Record<string, unknown> | null) {
  vi.doMock("@/lib/firebaseAdmin", () => ({
    db: {
      collection: () => ({
        doc: () => ({
          get: async () =>
            data
              ? { exists: true, id: "employee-doc-1", data: () => data }
              : { exists: false },
        }),
      }),
    },
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
});

describe("public employee profile", () => {
  it("never returns the signed attendance badge for an unauthenticated caller", async () => {
    mockEmployee({
      fullName: "Test Guard",
      employeeId: "CISS/TEST/001",
      clientName: "TCS",
      status: "Active",
      qrCodeUrl: "data:image/png;base64,AAAA",
      publicProfile: {
        fullName: "Test Guard",
        employeeId: "CISS/TEST/001",
        status: "Active",
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://example.test/api/employees/public-profile/employee-doc-1"),
      { params: Promise.resolve({ id: "employee-doc-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.fullName).toBe("Test Guard");
    expect(body).not.toHaveProperty("qrCodeUrl");
    expect(JSON.stringify(body)).not.toContain("data:image/png");
  });

  it("strips the badge from the unpublished-profile fallback too", async () => {
    mockEmployee({
      fullName: "Pending Guard",
      employeeId: "CISS/TEST/002",
      status: "PendingReview",
      qrCodeUrl: "data:image/png;base64,BBBB",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("https://example.test/api/employees/public-profile/employee-doc-1"),
      { params: Promise.resolve({ id: "employee-doc-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("qrCodeUrl");
    expect(JSON.stringify(body)).not.toContain("data:image/png");
  });
});
