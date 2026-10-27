import { afterEach, describe, expect, it, vi } from "vitest";

const EMPLOYEE_DOC: Record<string, unknown> = {
  fullName: "Test Guard",
  identityProofUrlFront: "employees/test-employee/idProofs/front.jpg",
};

type Metadata = { contentType?: string };

function mockModules(contentType: string | undefined) {
  const file = {
    download: vi.fn(async () => [Buffer.from("binary-document")]),
    getMetadata: vi.fn(async () => [{ contentType } satisfies Metadata]),
  };
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "sensitiveDocumentAuditLogs") {
        return { add: vi.fn(async () => ({ id: "audit-1" })) };
      }
      return {
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({ exists: true, data: () => EMPLOYEE_DOC })),
        })),
      };
    }),
  };
  const storage = {
    bucket: vi.fn(() => ({ name: "ciss-workforce.firebasestorage.app", file: vi.fn(() => file) })),
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db, storage }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => ({
      uid: "guard-uid-1",
      employeeId: "CISS/TEST/001",
      employeeDocId: "test-employee",
    })),
  }));

  return { file, db };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function getDocument(contentType: string | undefined) {
  mockModules(contentType);
  const { GET } = await import("./route");
  return GET(new Request("https://example.test/api/guard/profile/documents?category=identity&side=front"));
}

describe("guard document streaming", () => {
  it("serves an allow-listed raster image inline", async () => {
    const response = await getDocument("image/jpeg");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="document\.jpg"$/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cache-control")).toBe("no-store, private, max-age=0");
  });

  it("serves a PDF as a download attachment", async () => {
    const response = await getDocument("application/pdf; charset=binary");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="document\.pdf"$/);
  });

  it("never replays a script-capable stored type such as SVG", async () => {
    const response = await getDocument("image/svg+xml");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("falls back to an opaque download when the stored type is missing", async () => {
    const response = await getDocument(undefined);

    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe("attachment");
  });
});
