import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { extractPdfText } from "./payslip-pdf";
import {
  EMPLOYEE_ID_IN_TEXT,
  buildPayslipStoragePath,
  comparePayslipDocsDesc,
  decidePayslipMatch,
  extractAllNamesFromText,
  extractAllStandaloneIdsFromText,
  extractEmployeeIdFromText,
  extractNameFromText,
  extractStandaloneIdFromText,
  isValidPayslipPeriod,
  looksLikePdf,
  normalizePayslipText,
  normalizePersonName,
  parseEmployeeIdFromFileName,
  parseNameFromFileName,
  sanitizeDownloadFileName,
  toIsoString,
} from "./payslips";
import type { PayslipEmployeeCandidate } from "./payslips";

const projectRoot = process.cwd();

function employee(
  overrides: Partial<PayslipEmployeeCandidate> = {},
): PayslipEmployeeCandidate {
  return {
    employeeDocId: "emp-doc-1",
    employeeId: "CISS/TCS/2025-26/871",
    employeeName: "Rahul Kumar",
    clientName: "TCS",
    ...overrides,
  };
}

/**
 * Build a minimal, structurally valid PDF with real text. Computed xref offsets
 * keep it parseable by pdfjs, so the extractor is tested against an actual PDF
 * rather than a mock.
 */
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

describe("extractPdfText", () => {
  it("reads the text of a real PDF", async () => {
    const pdf = buildMinimalPdf([
      "Employee ID: CISS/TCS/2025-26/871",
      "Employee Name: Rahul Kumar",
      "Period: 2026-01",
    ]);

    const text = await extractPdfText(pdf);

    expect(text).toContain("CISS/TCS/2025-26/871");
    expect(text).toContain("Rahul Kumar");
    expect(extractEmployeeIdFromText(text)).toBe("CISS/TCS/2025-26/871");
  });

  it("returns an empty string for a malformed PDF instead of throwing", async () => {
    await expect(extractPdfText(Buffer.from("%PDF-1.4\nnot really a pdf"))).resolves.toBe("");
  });

  it("returns an empty string for an empty buffer", async () => {
    await expect(extractPdfText(Buffer.alloc(0))).resolves.toBe("");
  });
});

describe("text helpers", () => {
  it("normalises whitespace line by line", () => {
    expect(normalizePayslipText("  Employee   ID:\tCISS/TCS \r\n\r\n  Name: X  ")).toBe(
      "Employee ID: CISS/TCS\nName: X",
    );
  });

  it("extracts the full employee id from text", () => {
    expect(extractEmployeeIdFromText("Ref CISS/TCS/2025-26/871 dated")).toBe("CISS/TCS/2025-26/871");
    expect(extractEmployeeIdFromText("CISS/TCS/2026-27/4E69FF")).toBe("CISS/TCS/2026-27/4E69FF");
    expect(extractEmployeeIdFromText("ciss/lng-petronet/2026-27/0042")).toBe("CISS/LNG-PETRONET/2026-27/0042");
    expect(extractEmployeeIdFromText("no identifier here")).toBeNull();
  });

  it("extracts a bare 6-12 digit serial, ignoring the serial inside a full id", () => {
    expect(extractStandaloneIdFromText("Serial No: 871234")).toBe("871234");
    // The 871 inside a full id must not be mistaken for a standalone serial.
    expect(extractStandaloneIdFromText("Employee ID: CISS/TCS/2025-26/871")).toBeNull();
  });

  it("extracts a labelled name", () => {
    expect(extractNameFromText("Employee Name: Rahul Kumar")).toBe("Rahul Kumar");
    expect(extractNameFromText("Name - Anita Sharma")).toBe("Anita Sharma");
    expect(extractNameFromText("Period: 2026-01")).toBeNull();
  });

  it("parses an employee id out of a filename in both forms", () => {
    expect(parseEmployeeIdFromFileName("CISS/TCS/2025-26/871.pdf")).toBe("CISS/TCS/2025-26/871");
    expect(parseEmployeeIdFromFileName("CISS_TCS_2025-26_871.pdf")).toBe("CISS/TCS/2025-26/871");
    expect(parseEmployeeIdFromFileName("CISS_TCS_2025-26_A871.pdf")).toBe("CISS/TCS/2025-26/A871");
    expect(parseEmployeeIdFromFileName("CISS_TCS_2025-26_871A.pdf")).toBe("CISS/TCS/2025-26/871A");
    expect(parseEmployeeIdFromFileName("payslip-871.pdf")).toBeNull();
  });

  it("parses a name out of a filename but not out of a bare period", () => {
    expect(parseNameFromFileName("Payslip-Rahul Kumar-2026-01.pdf")).toBe("Rahul Kumar");
    expect(parseNameFromFileName("payslip-2026-01.pdf")).toBeNull();
    expect(parseNameFromFileName("2026-01.pdf")).toBeNull();
  });

  it("normalises names case- and space-insensitively", () => {
    expect(normalizePersonName("  RAHUL   kumar ")).toBe("rahul kumar");
    expect(normalizePersonName("Rahul. Kumar")).toBe("rahul kumar");
  });

  it("validates the pay period", () => {
    expect(isValidPayslipPeriod("2026-01")).toBe(true);
    expect(isValidPayslipPeriod(" 2026-12 ")).toBe(true);
    expect(isValidPayslipPeriod("2026-13")).toBe(false);
    expect(isValidPayslipPeriod("2026-00")).toBe(false);
    expect(isValidPayslipPeriod("2026-1")).toBe(false);
    expect(isValidPayslipPeriod("January 2026")).toBe(false);
  });

  it("detects the PDF magic number", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.7\n..."))).toBe(true);
    expect(looksLikePdf(Buffer.from("PK\u0003\u0004zip"))).toBe(false);
    expect(looksLikePdf(Buffer.from("ab"))).toBe(false);
  });

  it("keeps the employee-id pattern aligned with the documented format", () => {
    expect(EMPLOYEE_ID_IN_TEXT.test("CISS/TCS/2025-26/871")).toBe(true);
  });
});

describe("decidePayslipMatch", () => {
  it("matches on the employee id printed in the PDF", () => {
    const outcome = decidePayslipMatch({ fromPdfId: [employee()] });
    expect(outcome).toMatchObject({ status: "matched", parseMethod: "employeeId" });
  });

  it("falls back to the filename id", () => {
    const outcome = decidePayslipMatch({ fromFileId: [employee()] });
    expect(outcome).toMatchObject({ status: "matched", parseMethod: "filename" });
  });

  it("matches on a bare serial when no full id is present", () => {
    const outcome = decidePayslipMatch({ fromStandaloneId: [employee()] });
    expect(outcome).toMatchObject({ status: "matched", parseMethod: "employeeId" });
  });

  it("matches on a unique name", () => {
    const outcome = decidePayslipMatch({ fromName: [employee()] });
    expect(outcome).toMatchObject({ status: "matched", parseMethod: "name" });
  });

  it("prefers the printed id over a name that happens to be ambiguous", () => {
    const outcome = decidePayslipMatch({
      fromPdfId: [employee()],
      fromName: [employee({ employeeDocId: "a" }), employee({ employeeDocId: "b" })],
    });
    expect(outcome).toMatchObject({ status: "matched", parseMethod: "employeeId" });
  });

  it("refuses two employees with the same name", () => {
    const outcome = decidePayslipMatch({
      fromName: [
        employee({ employeeDocId: "emp-1", employeeId: "CISS/TCS/2025-26/871" }),
        employee({ employeeDocId: "emp-2", employeeId: "CISS/TCS/2025-26/872" }),
      ],
    });

    expect(outcome.status).toBe("unmatched");
    if (outcome.status !== "unmatched") throw new Error("expected unmatched");
    expect(outcome.reason).toBe("ambiguous");
    expect(outcome.detail).toContain("2 employees match");
    expect(outcome.detail).toContain("CISS/TCS/2025-26/871");
    expect(outcome.detail).toContain("CISS/TCS/2025-26/872");
  });

  it("requires the printed name to corroborate a bare serial", () => {
    // Serial resolves to Rahul Kumar, but the payslip is for someone else.
    const mismatch = decidePayslipMatch({
      fromStandaloneId: [employee()],
      candidateName: "Anita Sharma",
    });
    expect(mismatch).toMatchObject({ status: "unmatched", reason: "no-match" });
    if (mismatch.status !== "unmatched") throw new Error("expected unmatched");
    expect(mismatch.detail).toContain("CISS/TCS/2025-26/871");

    // Same person, with an extra initial and different case/spacing.
    expect(
      decidePayslipMatch({
        fromStandaloneId: [employee()],
        candidateName: "  rahul   KUMAR s ",
      }),
    ).toMatchObject({ status: "matched", parseMethod: "employeeId" });

    // No name printed: the serial stands on its own.
    expect(decidePayslipMatch({ fromStandaloneId: [employee()] })).toMatchObject({
      status: "matched",
      parseMethod: "employeeId",
    });
  });

  it("does not need the name to corroborate a printed/filename employee id", () => {
    expect(
      decidePayslipMatch({ fromPdfId: [employee()], candidateName: "Different Person" }),
    ).toMatchObject({ status: "matched", parseMethod: "employeeId" });
  });

  it("dedupes the same employee returned twice", () => {
    const outcome = decidePayslipMatch({
      fromPdfId: [employee(), employee()],
    });
    expect(outcome).toMatchObject({ status: "matched", parseMethod: "employeeId" });
  });

  it("reports a missing identifier", () => {
    const outcome = decidePayslipMatch({});
    expect(outcome).toMatchObject({ status: "unmatched", reason: "no-identifier" });
  });
});

describe("storage path and download name", () => {
  it("scopes the object to the employee and period", () => {
    const path = buildPayslipStoragePath("emp-doc-1", "2026-01");
    expect(path).toMatch(/^employees\/emp-doc-1\/payslips\/2026-01\/[0-9a-f-]{36}\.pdf$/);
  });

  it("builds a safe attachment filename", () => {
    expect(sanitizeDownloadFileName("2026-01")).toBe("payslip-2026-01.pdf");
    expect(sanitizeDownloadFileName('2026-01"; rm -rf /')).toBe("payslip-2026-01.pdf");
    expect(sanitizeDownloadFileName("")).toBe("payslip-period.pdf");
  });
});

describe("reading documents", () => {
  it("sorts newest period first, then newest upload", () => {
    const rows = [
      { id: "a", period: "2025-12", createdAt: { seconds: 100 } },
      { id: "b", period: "2026-01", createdAt: { seconds: 50 } },
      { id: "c", period: "2026-01", createdAt: { seconds: 200 } },
    ];
    expect(rows.sort(comparePayslipDocsDesc).map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("converts Firestore timestamps and Dates to ISO strings", () => {
    expect(toIsoString({ seconds: 1_700_000_000 })).toBe("2023-11-14T22:13:20.000Z");
    expect(toIsoString(new Date("2026-01-31T00:00:00.000Z"))).toBe("2026-01-31T00:00:00.000Z");
    expect(toIsoString(null)).toBeNull();
  });
});

describe("rules keep payslips server-only", () => {
  it("denies all client access to payslipDocuments", () => {
    const rules = readFileSync(join(projectRoot, "firestore.rules"), "utf8");
    const block = rules.match(/match \/payslipDocuments\/\{[^}]+\}\s*\{([\s\S]*?)\}/);
    expect(block, "payslipDocuments rule is missing").not.toBeNull();
    expect(block![1]).toMatch(/allow read, write: if false;/);
  });

  it("denies client access to stored payslip PDFs", () => {
    const rules = readFileSync(join(projectRoot, "storage.rules"), "utf8");
    const block = rules.match(/match \/employees\/\{employeeKey\}\/payslips\/\{period\}\/\{fileName\}\s*\{([\s\S]*?)\}/);
    expect(block, "payslip storage rule is missing").not.toBeNull();
    expect(block![1]).toMatch(/allow read, write: if false;/);
  });
});
