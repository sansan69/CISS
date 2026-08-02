import { describe, expect, it } from "vitest";
import {
  enrollmentSubmissionSchema,
  type EnrollmentSubmission,
} from "./enrollment";

function buildLngPayload(
  overrides: Partial<EnrollmentSubmission> = {},
): EnrollmentSubmission {
  return {
    joiningDate: "2026-04-30T18:30:00.000Z",
    clientName: "LNG Petronet",
    profilePictureUrl: "https://example.com/profile.png",
    fullNameInput: "Dummy Browser Guard",
    firstName: "Dummy",
    lastName: "Browser Guard",
    fatherName: "Dummy Father",
    motherName: "Dummy Mother",
    dateOfBirth: "1995-01-09T18:30:00.000Z",
    gender: "Male",
    maritalStatus: "Unmarried",
    educationalQualification: "Graduation",
    district: "Ernakulam",
    panNumber: "AABCT1234C",
    aadharNumber: "123456789012",
    nationality: "Indian",
    identificationMark: "MOLE ON LEFT HAND",
    heightCm: 170,
    weightKg: 68,
    jobDesignation: "Lady Security Guard",
    lngJobDesignation: "Lady Security Guard",
    identityProofType: "PAN Card",
    identityProofNumber: "AABCT1234C",
    identityProofUrlFront: "https://example.com/id-front.png",
    identityProofUrlBack: "https://example.com/id-back.png",
    addressProofType: "Voter ID",
    addressProofNumber: "ABC1234567",
    addressProofUrlFront: "https://example.com/address-front.png",
    addressProofUrlBack: "https://example.com/address-back.png",
    aadharCardDocumentUrl: "https://example.com/aadhar.pdf",
    panCardDocumentUrl: "https://example.com/pan.pdf",
    signatureUrl: "https://example.com/signature.png",
    fullAddress: "Dummy House, Dummy Road, Ernakulam, Kerala - 682001",
    emailAddress: "dummy-browser-guard@lng-petronet.cisskerala.app",
    phoneNumber: "9012345689",
    bankAccountNumber: "123456789012",
    ifscCode: "SBIN0008622",
    bankName: "STATE BANK OF INDIA",
    branchName: "ERNAKULAM MAIN",
    bankPassbookStatementUrl: "https://example.com/bank-statement.png",
    legacyUniqueId: "DUMMY-LNG-CODEX-REGRESSION",
    termsAccepted: true,
    aadhaarConsentAccepted: true,
    aadhaarConsentVersion: "aadhaar-esic-epf-v1",
    ...overrides,
  };
}

function buildStandardPayload(
  overrides: Partial<EnrollmentSubmission> = {},
): EnrollmentSubmission {
  return {
    joiningDate: "2026-04-30T18:30:00.000Z",
    clientName: "TCS",
    resourceIdNumber: "TCS-RESOURCE-001",
    profilePictureUrl: "https://example.com/profile.png",
    firstName: "Standard",
    lastName: "Guard",
    fatherName: "Standard Father",
    motherName: "Standard Mother",
    dateOfBirth: "1994-02-14T18:30:00.000Z",
    gender: "Male",
    maritalStatus: "Unmarried",
    educationalQualification: "Graduation",
    district: "Ernakulam",
    identityProofType: "PAN Card",
    identityProofNumber: "AABCT1234C",
    identityProofUrlFront: "https://example.com/id-front.png",
    identityProofUrlBack: "https://example.com/id-back.png",
    addressProofType: "Voter ID",
    addressProofNumber: "ABC1234567",
    addressProofUrlFront: "https://example.com/address-front.png",
    addressProofUrlBack: "https://example.com/address-back.png",
    aadharNumber: "123456789012",
    aadharCardDocumentUrl: "https://example.com/aadhar.pdf",
    signatureUrl: "https://example.com/signature.png",
    bankPassbookStatementUrl: "https://example.com/bank-statement.png",
    fullAddress: "Standard House, Standard Road, Ernakulam, Kerala - 682001",
    emailAddress: "standard.guard@example.com",
    phoneNumber: "9012345690",
    termsAccepted: true,
    aadhaarConsentAccepted: true,
    aadhaarConsentVersion: "aadhaar-esic-epf-v1",
    ...overrides,
  };
}

describe("enrollmentSubmissionSchema", () => {
  it.each([undefined, "", "not-an-email"])(
    "rejects standard client submissions with invalid required email %s",
    (emailAddress) => {
      const parsed = enrollmentSubmissionSchema.safeParse(
        buildStandardPayload({
          emailAddress,
        }),
      );

      expect(parsed.success).toBe(false);
    },
  );

  it("accepts the LNG payload shape proven by the live browser enrollment flow", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(buildLngPayload());

    expect(parsed.success).toBe(true);
  });

  it("requires a valid email for LNG client aliases", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({
        clientName: "Petronet LNG",
        emailAddress: "",
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it.each(["Petronet LNG Ltd", "LNG Petronet Ltd."])(
    "requires email for LNG Ltd alias %s",
    (clientName) => {
      const parsed = enrollmentSubmissionSchema.safeParse(
        buildLngPayload({
          clientName,
          emailAddress: "",
        }),
      );

      expect(parsed.success).toBe(false);
    },
  );

  it("still accepts LNG submissions when optional banking details are omitted", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({
        bankAccountNumber: undefined,
        ifscCode: undefined,
        bankName: undefined,
        branchName: undefined,
        legacyUniqueId: undefined,
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("requires a bank passbook or statement for every enrollment", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildStandardPayload({ bankPassbookStatementUrl: undefined }),
    );

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.bankPassbookStatementUrl).toBeTruthy();
    }
  });

  it("requires an Aadhaar copy for every enrollment and a PAN copy for LNG", () => {
    const missingAadhaar = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({
        aadharCardDocumentUrl: undefined,
      }),
    );
    expect(missingAadhaar.success).toBe(false);
    if (!missingAadhaar.success) {
      expect(missingAadhaar.error.flatten().fieldErrors.aadharCardDocumentUrl).toBeTruthy();
    }

    const missingPan = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({ panCardDocumentUrl: undefined }),
    );
    expect(missingPan.success).toBe(false);
    if (!missingPan.success) {
      expect(missingPan.error.flatten().fieldErrors.panCardDocumentUrl).toContain(
        "PAN card copy is required for LNG Petronet enrollment.",
      );
    }
  });

  it("still requires service book details for applicable LNG designations", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({
        lngJobDesignation: "Ex Servicemen Security Guard - Military",
        jobDesignation: "Ex Servicemen Security Guard - Military",
        serviceBookNumber: undefined,
        serviceBookDocumentUrl: undefined,
      }),
    );

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.serviceBookNumber).toContain(
        "Service book number is required for this LNG designation.",
      );
      expect(parsed.error.flatten().fieldErrors.serviceBookDocumentUrl).toContain(
        "Service book document is required for this LNG designation.",
      );
    }
  });
});
