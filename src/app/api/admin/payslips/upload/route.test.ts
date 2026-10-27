import { afterEach, describe, expect, it, vi } from "vitest";

const EMPLOYEE_A = {
  id: "emp-doc-1",
  employeeId: "CISS/TCS/2025-26/871",
  fullName: "Rahul Kumar",
  clientName: "TCS",
};

function buildMinimalPdf(lines: string[]): Buffer {
  const content = lines
    .map((line, index) => `BT /F1 12 Tf 20 ${700 - index * 20} Td (${line.replace(/([()\\])/g, "\\$1")}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

type Harness = {
  employees: Record<string, any>[];
  savedDocs: Record<string, any>[];
  savedFiles: Array<{ path: string; options: Record<string, any> }>;
  deletedFiles: string[];
  pdfText: string;
};

/**
 * Minimal Firestore/storage fake: enough of the query API for the payslip
 * lookup helpers, plus save/delete capture.
 */
function mockModules(
  options: {
    employees?: Record<string, any>[];
    pdfText?: string;
    saveFails?: boolean;
    unauthorized?: boolean;
    storageReadFails?: boolean;
    extractionComplete?: boolean;
    docs?: Record<string, any>[];
  } = {},
): Harness {
  const employees = options.employees ?? [EMPLOYEE_A];
  const savedDocs: Record<string, any>[] = [];
  const savedFiles: Array<{ path: string; options: Record<string, any> }> = [];
  const deletedFiles: string[] = [];
  const docs = options.docs ?? [];

  const fieldsOf = (doc: Record<string, any>): Record<string, any> =>
    typeof doc.data === "function" ? doc.data() : doc;
  const matchesFilters = (doc: Record<string, any>, filters: Array<[string, unknown]>) =>
    filters.every(([field, value]) => fieldsOf(doc)[field] === value);

  const makeQuery = (name: string, filters: Array<[string, unknown]> = [], limitCount?: number) => ({
    where(field: string, op: string, value: unknown) {
      return makeQuery(name, [...filters, [field, value]], limitCount);
    },
    limit(count: number) {
      return makeQuery(name, filters, count);
    },
    async get() {
      const source = name === "employees" ? employees : docs;
      const rows = source.filter((doc) => matchesFilters(doc, filters));
      const sliced = typeof limitCount === "number" ? rows.slice(0, limitCount) : rows;
      // Fixtures are either plain objects or { id, data() } snapshots.
      const toSnapshot = (doc: Record<string, any>) => ({
        id: doc.id,
        data: () => (typeof doc.data === "function" ? doc.data() : doc),
      });
      return {
        docs: sliced.map(toSnapshot),
        size: sliced.length,
      };
    },
  });

  const db = {
    collection: vi.fn((name: string) => ({
      ...makeQuery(name, [], undefined),
      doc: vi.fn((id?: string) => {
        const docId = id ?? `generated-${savedDocs.length + 1}`;
        return {
          id: docId,
          set: vi.fn(async (data: Record<string, any>) => {
            savedDocs.push({ id: docId, ...data });
          }),
          get: vi.fn(async () => {
            const found = docs.find((doc) => doc.id === docId);
            return {
              exists: Boolean(found),
              id: docId,
              data: () =>
                found
                  ? typeof found.data === "function"
                    ? found.data()
                    : found
                  : undefined,
            };
          }),
        };
      }),
    })),
  };

  const file = vi.fn((path: string) => ({
    save: vi.fn(async (_buffer: Buffer, fileOptions: Record<string, any>) => {
      if (options.saveFails) throw new Error("storage unavailable");
      savedFiles.push({ path, options: fileOptions });
    }),
    delete: vi.fn(async () => {
      deletedFiles.push(path);
    }),
    download: vi.fn(async () => {
      if (options.storageReadFails) throw Object.assign(new Error("No such object: " + path), { code: 404 });
      return [buildMinimalPdf(["CISS/TCS/2025-26/871"])];
    }),
  }));

  const storage = { bucket: vi.fn(() => ({ file })) };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db, storage }));
  vi.doMock("@/lib/server/auth", () => ({
    requireAdmin: vi.fn(async () => {
      if (options.unauthorized) throw new Error("Missing bearer token.");
      return { uid: "admin-1", email: "admin@example.test", role: "admin" };
    }),
  }));
  vi.doMock("@/lib/server/payslip-pdf", () => ({
    extractPdfText: vi.fn(async () => options.pdfText ?? ""),
    extractPdfTextDetailed: vi.fn(async () => ({
      text: options.pdfText ?? "",
      complete: options.extractionComplete ?? true,
      pagesRead: 1,
      totalPages: 1,
    })),
  }));

  return {
    employees,
    savedDocs,
    savedFiles,
    deletedFiles,
    pdfText: options.pdfText ?? "",
  };
}

async function postUpload(form: FormData) {
  const { POST } = await import("./route");
  const response = await POST(
    new Request("https://example.test/api/admin/payslips/upload", {
      method: "POST",
      body: form,
    }),
  );
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

function uploadForm(
  files: Array<{ name: string; pdf?: Buffer }>,
  extra: Record<string, string> = {},
) {
  const form = new FormData();
  form.append("period", extra.period ?? "2026-01");
  if (extra.dryRun) form.append("dryRun", extra.dryRun);
  for (const file of files) {
    const bytes = file.pdf ?? buildMinimalPdf(["Employee ID: CISS/TCS/2025-26/871"]);
    form.append(
      "files",
      new File([new Uint8Array(bytes)], file.name, { type: "application/pdf" }),
    );
  }
  return form;
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/admin/payslips/upload", () => {
  it("stores a matched payslip and returns the documented payload", async () => {
    const harness = mockModules({ pdfText: "Employee ID: CISS/TCS/2025-26/871\nEmployee Name: Rahul Kumar" });

    const { response, text, body } = await postUpload(
      uploadForm([{ name: "payslip.pdf" }]),
    );

    expect(response.status).toBe(201);
    expect(body.period).toBe("2026-01");
    expect(body.dryRun).toBe(false);
    expect(body.counts).toEqual({ uploaded: 1, unmatched: 0, errors: 0 });
    expect(body.uploaded[0]).toMatchObject({
      employeeDocId: "emp-doc-1",
      employeeId: "CISS/TCS/2025-26/871",
      employeeName: "Rahul Kumar",
      period: "2026-01",
      fileName: "payslip.pdf",
      parseMethod: "employeeId",
      dryRun: false,
    });
    expect(body.uploaded[0].storagePath).toMatch(
      /^employees\/emp-doc-1\/payslips\/2026-01\/[0-9a-f-]{36}\.pdf$/,
    );

    // Stored object + document.
    expect(harness.savedFiles).toHaveLength(1);
    expect(harness.savedFiles[0].path).toBe(body.uploaded[0].storagePath);
    expect(harness.savedFiles[0].options.contentType).toBe("application/pdf");
    expect(harness.savedDocs).toHaveLength(1);
    expect(harness.savedDocs[0]).toMatchObject({
      employeeDocId: "emp-doc-1",
      employeeId: "CISS/TCS/2025-26/871",
      period: "2026-01",
      storagePath: body.uploaded[0].storagePath,
      uploadedBy: "admin-1",
      parseMethod: "employeeId",
    });

    // No file content or credential material is echoed.
    expect(text).not.toContain("%PDF");
    expect(text).not.toContain("private_key");
  });

  it("parses the employee id from the filename when the PDF has no text", async () => {
    mockModules({ pdfText: "" });

    const { response, body } = await postUpload(
      uploadForm([{ name: "CISS_TCS_2025-26_871.pdf" }]),
    );

    expect(response.status).toBe(201);
    expect(body.uploaded[0]).toMatchObject({
      employeeId: "CISS/TCS/2025-26/871",
      parseMethod: "filename",
    });
  });

  it("dryRun parses and matches without writing anything", async () => {
    const harness = mockModules({ pdfText: "Employee ID: CISS/TCS/2025-26/871" });

    const { response, body } = await postUpload(
      uploadForm([{ name: "payslip.pdf" }], { dryRun: "true" }),
    );

    expect(response.status).toBe(201);
    expect(body.dryRun).toBe(true);
    expect(body.counts.uploaded).toBe(1);
    expect(body.uploaded[0]).toMatchObject({ dryRun: true, storagePath: null });
    expect(harness.savedFiles).toHaveLength(0);
    expect(harness.savedDocs).toHaveLength(0);
  });

  it("reports a PDF with no identifier as unmatched and writes nothing", async () => {
    const harness = mockModules({ pdfText: "Salary slip for the month" });

    const { response, body } = await postUpload(uploadForm([{ name: "payslip.pdf" }]));

    expect(response.status).toBe(200);
    expect(body.counts.uploaded).toBe(0);
    expect(body.unmatched).toHaveLength(1);
    expect(body.unmatched[0]).toMatchObject({ fileName: "payslip.pdf", reason: "no-identifier" });
    expect(harness.savedFiles).toHaveLength(0);
    expect(harness.savedDocs).toHaveLength(0);
  });

  it("refuses two employees with the same name and reports both ids", async () => {
    const harness = mockModules({
      pdfText: "Employee Name: Rahul Kumar",
      employees: [
        { id: "emp-1", employeeId: "CISS/TCS/2025-26/871", fullName: "Rahul Kumar" },
        { id: "emp-2", employeeId: "CISS/TCS/2025-26/872", fullName: "Rahul Kumar" },
      ],
    });

    const { response, body } = await postUpload(uploadForm([{ name: "payslip.pdf" }]));

    expect(response.status).toBe(200);
    expect(body.unmatched[0]).toMatchObject({ reason: "ambiguous" });
    expect(body.unmatched[0].detail).toContain("CISS/TCS/2025-26/871");
    expect(body.unmatched[0].detail).toContain("CISS/TCS/2025-26/872");
    expect(harness.savedFiles).toHaveLength(0);
    expect(harness.savedDocs).toHaveLength(0);
  });

  it("refuses a PDF that mixes a full employee id with another employee's name", async () => {
    const harness = mockModules({
      employees: [
        EMPLOYEE_A,
        { id: "emp-doc-2", employeeId: "CISS/TCS/2025-26/872", fullName: "Anita Sharma", clientName: "TCS" },
      ],
      pdfText: "Employee ID: CISS/TCS/2025-26/871\nEmployee Name: Anita Sharma",
    });

    const { body } = await postUpload(uploadForm([{ name: "mixed.pdf" }]));

    expect(body.unmatched[0]).toMatchObject({ reason: "multiple-employees" });
    expect(harness.savedFiles).toHaveLength(0);
  });

  it("refuses a filename id that conflicts with the PDF's employee name", async () => {
    const harness = mockModules({
      employees: [
        EMPLOYEE_A,
        { id: "emp-doc-2", employeeId: "CISS/TCS/2025-26/872", fullName: "Anita Sharma", clientName: "TCS" },
      ],
      pdfText: "Employee Name: Anita Sharma",
    });

    const { body } = await postUpload(uploadForm([{ name: "CISS_TCS_2025-26_871.pdf" }]));

    expect(body.unmatched[0]).toMatchObject({ reason: "multiple-employees" });
    expect(harness.savedFiles).toHaveLength(0);
  });

  it("refuses a PDF with too many identifiers instead of ignoring evidence", async () => {
    const harness = mockModules({
      employees: [EMPLOYEE_A],
      pdfText:
        Array.from({ length: 21 }, (_, index) => `Employee Name: Person ${String.fromCharCode(65 + index)}`).join("\n"),
    });

    const { body } = await postUpload(uploadForm([{ name: "many.pdf" }]));

    expect(body.unmatched[0]).toMatchObject({ reason: "evidence-limit" });
    expect(harness.savedFiles).toHaveLength(0);
  });

  it("refuses a PDF with two employees' names and resource ids but no CISS ids", async () => {
    const harness = mockModules({
      employees: [
        { ...EMPLOYEE_A, resourceIdNumber: "111111" },
        {
          id: "emp-doc-2",
          employeeId: "CISS/TCS/2025-26/872",
          fullName: "Anita Sharma",
          clientName: "TCS",
          resourceIdNumber: "222222",
        },
      ],
      pdfText:
        "Employee Name: Rahul Kumar\nResource ID: 111111\nEmployee Name: Anita Sharma\nResource ID: 222222",
    });

    const { body } = await postUpload(uploadForm([{ name: "two-people.pdf" }]));

    expect(body.unmatched[0]).toMatchObject({
      fileName: "two-people.pdf",
      reason: "multiple-employees",
    });
    expect(harness.savedFiles).toHaveLength(0);
    expect(harness.savedDocs).toHaveLength(0);
  });

  it("refuses a PDF that contains two employees' payslips", async () => {
    const harness = mockModules({
      employees: [
        EMPLOYEE_A,
        { id: "emp-doc-2", employeeId: "CISS/TCS/2025-26/872", fullName: "Anita Sharma", clientName: "TCS" },
      ],
      pdfText:
        "Employee ID: CISS/TCS/2025-26/871\nEmployee Name: Rahul Kumar\nEmployee ID: CISS/TCS/2025-26/872\nEmployee Name: Anita Sharma",
    });

    const { response, body } = await postUpload(uploadForm([{ name: "combined.pdf" }]));

    expect(response.status).toBe(200);
    expect(body.counts).toEqual({ uploaded: 0, unmatched: 1, errors: 0 });
    expect(body.unmatched[0]).toMatchObject({
      fileName: "combined.pdf",
      reason: "multiple-employees",
    });
    expect(harness.savedFiles).toHaveLength(0);
    expect(harness.savedDocs).toHaveLength(0);
  });

  it("matches a unique name when no id is printed", async () => {
    mockModules({ pdfText: "Employee Name: Rahul Kumar" });

    const { response, body } = await postUpload(uploadForm([{ name: "payslip.pdf" }]));

    expect(response.status).toBe(201);
    expect(body.uploaded[0]).toMatchObject({
      employeeDocId: "emp-doc-1",
      parseMethod: "name",
    });
  });

  it("refuses a PDF that could not be inspected completely", async () => {
    const harness = mockModules({ pdfText: "", extractionComplete: false });

    const { response, body } = await postUpload(uploadForm([{ name: "payslip-871.pdf" }]));

    expect(response.status).toBe(200);
    expect(body.unmatched[0]).toMatchObject({
      fileName: "payslip-871.pdf",
      reason: "incomplete-pdf",
    });
    expect(harness.savedFiles).toHaveLength(0);
    expect(harness.savedDocs).toHaveLength(0);
  });

  it("rejects a non-PDF file", async () => {
    mockModules({ pdfText: "" });

    const { response, body } = await postUpload(
      uploadForm([{ name: "notes.txt", pdf: Buffer.from("hello") }]),
    );

    expect(response.status).toBe(200);
    expect(body.errors[0]).toMatchObject({ fileName: "notes.txt" });
    expect(body.errors[0].message).toMatch(/not a PDF/i);
  });

  it("validates the period", async () => {
    mockModules();

    const { response, body } = await postUpload(
      uploadForm([{ name: "payslip.pdf" }], { period: "January 2026" }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/period/i);
  });

  it("requires at least one file", async () => {
    mockModules();

    const { response, body } = await postUpload(uploadForm([]));

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/At least one payslip PDF/i);
  });

  it("cleans up nothing and reports an error when storage fails", async () => {
    const harness = mockModules({ pdfText: "Employee ID: CISS/TCS/2025-26/871", saveFails: true });

    const { response, body } = await postUpload(uploadForm([{ name: "payslip.pdf" }]));

    expect(response.status).toBe(200);
    expect(body.errors[0].message).toMatch(/Could not store the PDF/);
    expect(harness.savedDocs).toHaveLength(0);
  });

  it("rejects an unauthenticated caller", async () => {
    const harness = mockModules({ unauthorized: true });

    const { response, body } = await postUpload(uploadForm([{ name: "payslip.pdf" }]));

    expect(response.status).toBe(401);
    expect(body.error).toMatch(/Missing bearer token/);
    expect(harness.savedFiles).toHaveLength(0);
  });
});
