import { describe, expect, it } from "vitest";
import {
  guardQualificationDocumentStatus,
  guardRequiresQualificationCertificate,
} from "@/lib/guard-profile-documents";

describe("guard profile qualification documents", () => {
  it("requires the certificate for TCS guards regardless of casing or spaces", () => {
    expect(guardRequiresQualificationCertificate(" TCS ")).toBe(true);
    expect(guardRequiresQualificationCertificate("tcs")).toBe(true);
    expect(guardRequiresQualificationCertificate("LNG Petronet")).toBe(false);
  });

  it("reports missing and complete qualification certificates without changing non-TCS requirements", () => {
    expect(guardQualificationDocumentStatus("TCS", {})).toEqual({ required: true, status: "missing" });
    expect(guardQualificationDocumentStatus("TCS", { qualificationCertificateUrl: "employees/1/qualificationCertificates/cert.pdf" })).toEqual({ required: true, status: "complete" });
    expect(guardQualificationDocumentStatus("Other", {})).toEqual({ required: false, status: "missing" });
  });
});
