import { afterEach, describe, expect, it, vi } from "vitest";

const GUARD = {
  uid: "guard-uid-1",
  employeeId: "CISS/TCS/2025-26/871",
  employeeDocId: "emp-doc-1",
};

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "latin1");

type Harness = {
  requestedPaths: string[];
};

function mockModules(
  options: {
    doc?: Record<string, any> | null;
    downloadFails?: boolean;
    guardDenied?: boolean;
  } = {},
): Harness {
  const requestedPaths: string[] = [];

  const db = {
    collection: vi.fn(() => ({
      doc: vi.fn((id: string) => ({
        get: vi.fn(async () => ({
          exists: Boolean(options.doc),
          id,
          data: () => options.doc ?? undefined,
        })),
      })),
    })),
  };

  const storage = {
    bucket: vi.fn(() => ({
      file: vi.fn((path: string) => ({
        download: vi.fn(async () => {
          requestedPaths.push(path);
          if (options.downloadFails) {
            throw Object.assign(new Error(`No such object: ${path}`), { code: 404 });
          }
          return [PDF_BYTES];
        }),
      })),
    })),
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db, storage }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => {
      if (options.guardDenied) throw new Error("Guard access required.");
      return GUARD;
    }),
  }));

  return { requestedPaths };
}

async function download(id = "slip-1") {
  const { GET } = await import("./route");
  const response = await GET(
    new Request(`https://example.test/api/guard/payslips/${id}/payslip`, { method: "GET" }),
    { params: Promise.resolve({ id }) },
  );
  const contentType = response.headers.get("content-type");
  const body = contentType === "application/pdf"
    ? Buffer.from(new Uint8Array(await response.arrayBuffer()))
    : null;
  return { response, body, headers: response.headers };
}

function ownSlip(overrides: Record<string, any> = {}) {
  return {
    employeeDocId: GUARD.employeeDocId,
    employeeId: GUARD.employeeId,
    period: "2026-01",
    storagePath: `employees/${GUARD.employeeDocId}/payslips/2026-01/slip.pdf`,
    sizeBytes: PDF_BYTES.byteLength,
    ...overrides,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("GET /api/guard/payslips/[id]/payslip", () => {
  it("streams the caller's own payslip as a no-store attachment", async () => {
    const harness = mockModules({ doc: ownSlip() });

    const { response, body, headers } = await download();

    expect(response.status).toBe(200);
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(headers.get("content-disposition")).toBe('attachment; filename="payslip-2026-01.pdf"');
    expect(headers.get("cache-control")).toBe("no-store, private");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(body?.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(harness.requestedPaths).toEqual([ownSlip().storagePath]);
  });

  it("denies a payslip that belongs to another employee", async () => {
    const harness = mockModules({
      doc: ownSlip({
        employeeDocId: "emp-doc-OTHER",
        storagePath: "employees/emp-doc-OTHER/payslips/2026-01/slip.pdf",
      }),
    });

    const { response, headers } = await download();

    expect(response.status).toBe(403);
    expect(headers.get("content-type")).not.toBe("application/pdf");
    // Ownership is checked before the object is ever fetched.
    expect(harness.requestedPaths).toHaveLength(0);
  });

  it("refuses a document whose storage path points outside the caller's prefix", async () => {
    const harness = mockModules({
      doc: ownSlip({ storagePath: "employees/emp-doc-OTHER/payslips/2026-01/slip.pdf" }),
    });

    const { response } = await download();

    expect(response.status).toBe(409);
    expect(harness.requestedPaths).toHaveLength(0);
  });

  it("returns 404 for an unknown payslip", async () => {
    mockModules({ doc: null });

    const { response } = await download();

    expect(response.status).toBe(404);
  });

  it("returns 404 when the stored file is gone", async () => {
    mockModules({ doc: ownSlip(), downloadFails: true });

    const { response } = await download();

    expect(response.status).toBe(404);
  });

  it("denies a caller without guard access (for example an admin token)", async () => {
    mockModules({ doc: ownSlip(), guardDenied: true });

    const { response } = await download();

    expect(response.status).toBe(403);
  });
});
