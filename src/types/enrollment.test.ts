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
    addressProofType: "Aadhar Card",
    addressProofNumber: "123456789012",
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
    legacyUniqueId: "DUMMY-LNG-CODEX-REGRESSION",
    termsAccepted: true,
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
    addressProofType: "Aadhar Card",
    addressProofNumber: "123456789012",
    addressProofUrlFront: "https://example.com/address-front.png",
    addressProofUrlBack: "https://example.com/address-back.png",
    signatureUrl: "https://example.com/signature.png",
    fullAddress: "Standard House, Standard Road, Ernakulam, Kerala - 682001",
    phoneNumber: "9012345690",
    termsAccepted: true,
    ...overrides,
  };
}

describe("enrollmentSubmissionSchema", () => {
  it("accepts standard client submissions without an employee email address", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildStandardPayload({
        emailAddress: undefined,
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts the LNG payload shape proven by the live browser enrollment flow", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(buildLngPayload());

    expect(parsed.success).toBe(true);
  });

  it("accepts LNG client aliases without requiring a real email address", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({
        clientName: "Petronet LNG",
        emailAddress: "",
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it.each(["Petronet LNG Ltd", "LNG Petronet Ltd."])(
    "accepts LNG Ltd alias %s without requiring a real email address",
    (clientName) => {
      const parsed = enrollmentSubmissionSchema.safeParse(
        buildLngPayload({
          clientName,
          emailAddress: "",
        }),
      );

      expect(parsed.success).toBe(true);
    },
  );

  it("still accepts LNG submissions when optional banking and email fields are omitted", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({
        emailAddress: undefined,
        bankAccountNumber: undefined,
        ifscCode: undefined,
        bankName: undefined,
        branchName: undefined,
        legacyUniqueId: undefined,
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("requires dedicated Aadhar and PAN copies for LNG Petronet enrollment", () => {
    const parsed = enrollmentSubmissionSchema.safeParse(
      buildLngPayload({
        aadharCardDocumentUrl: undefined,
        panCardDocumentUrl: undefined,
      }),
    );

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.aadharCardDocumentUrl).toContain(
        "Aadhar card copy is required for LNG Petronet enrollment.",
      );
      expect(parsed.error.flatten().fieldErrors.panCardDocumentUrl).toContain(
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
