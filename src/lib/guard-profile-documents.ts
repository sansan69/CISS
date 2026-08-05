import type { EmployeeDocumentFields } from "@/lib/employee-document-fields";

export function guardRequiresQualificationCertificate(clientName: unknown) {
  return String(clientName || "").trim().toUpperCase() === "TCS";
}

export function guardQualificationDocumentStatus(
  clientName: unknown,
  documents: Pick<EmployeeDocumentFields, "qualificationCertificateUrl">,
) {
  const required = guardRequiresQualificationCertificate(clientName);
  const status = documents.qualificationCertificateUrl ? "complete" : "missing";
  return { required, status } as const;
}
