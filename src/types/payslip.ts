/** How a payslip PDF was attributed to an employee. */
export type PayslipParseMethod = "employeeId" | "filename" | "name";

/**
 * `payslipDocuments/{id}` — server-only payroll metadata.
 *
 * Guards never read this collection directly; the guard API enforces
 * `employeeDocId` ownership and the rules deny client access entirely.
 */
export interface PayslipDocument {
  employeeDocId: string;
  employeeId: string;
  employeeName: string;
  clientName?: string | null;
  /** Pay period, always `YYYY-MM`. */
  period: string;
  fileName: string;
  storagePath: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedByEmail?: string | null;
  parseMethod: PayslipParseMethod;
  createdAt?: unknown;
}

/** One file that was stored (or, in a dry run, would have been). */
export interface PayslipUploadedFile {
  id: string;
  employeeDocId: string;
  employeeId: string;
  employeeName: string;
  period: string;
  fileName: string;
  storagePath: string | null;
  sizeBytes: number;
  parseMethod: PayslipParseMethod;
  dryRun: boolean;
}

export type PayslipUnmatchedReason =
  | "no-identifier"
  | "no-match"
  | "ambiguous"
  | "multiple-employees"
  | "incomplete-pdf"
  | "evidence-limit";

/** One file that could not be attributed to exactly one employee. */
export interface PayslipUnmatchedFile {
  fileName: string;
  reason: PayslipUnmatchedReason;
  detail: string;
  extractedEmployeeId?: string | null;
  extractedName?: string | null;
}

/** One file that failed before or during storage. */
export interface PayslipFileError {
  fileName: string;
  message: string;
}

export interface PayslipUploadResponse {
  period: string;
  dryRun: boolean;
  counts: {
    uploaded: number;
    unmatched: number;
    errors: number;
  };
  uploaded: PayslipUploadedFile[];
  unmatched: PayslipUnmatchedFile[];
  errors: PayslipFileError[];
}

/** Guard-facing list item. Deliberately free of pay amounts. */
export interface GuardPayslipListItem {
  id: string;
  period: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string | null;
  employeeId: string;
}

export interface AdminPayslipListItem extends GuardPayslipListItem {
  employeeDocId: string;
  employeeName: string;
  clientName: string | null;
  parseMethod: PayslipParseMethod;
  uploadedBy: string;
}
