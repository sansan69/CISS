import { NextRequest } from "next/server";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const addedEmployees: Array<Record<string, unknown>> = [];

  return {
    addedEmployees,
    enrollmentEnabled: true,
    clientName: "TCS",
    generateEmployeeId: vi.fn(() => "CISS/TCS/2026-27/001"),
    generateQrCodeDataUrl: vi.fn(() => Promise.resolve("data:image/png;base64,qr")),
    encryptAadhaarNumber: vi.fn(async () => ({
      aadhaarNumberEncrypted: "encrypted",
      encryptionIv: "iv",
      encryptionTag: "tag",
      encryptedDataKey: "wrapped",
      encryptionKeyVersion: "kms-key",
    })),
    verifyIdToken: vi.fn(() => Promise.resolve({
      uid: "admin-user",
      role: "admin",
      email: "admin@cisskerala.app",
      email_verified: true,
    })),
  };
});

class FakeTimestamp {
  private constructor(readonly date: Date) {}

  static now() {
    return new FakeTimestamp(new Date("2026-05-23T08:30:00.000Z"));
  }

  static fromDate(date: Date) {
    return new FakeTimestamp(date);
  }

  static fromMillis(milliseconds: number) {
    return new FakeTimestamp(new Date(milliseconds));
  }

  toDate() {
    return this.date;
  }
}

class FakeCollection {
  constructor(private readonly name = "") {}

  where() {
    return this;
  }

  limit() {
    return this;
  }

  async get() {
    if (this.name === "clients") {
      return {
        empty: false,
        docs: [{
          id: "client-document",
          data: () => ({ name: mocks.clientName, portalEnabled: true, enrollmentEnabled: mocks.enrollmentEnabled }),
        }],
      };
    }
    return { empty: true, docs: [] };
  }

  doc(id?: string) {
    const ref = {
      id: id || `employee-doc-${mocks.addedEmployees.length + 1}`,
      path: `${this.name}/${id || `employee-doc-${mocks.addedEmployees.length + 1}`}`,
      async get() {
        if (ref.path === "enrollments/draft-test-123") {
          return {
            exists: true,
            data: () => ({
              status: "draft",
              phoneNumber: "9012345690",
              tokenHash: crypto.createHash("sha256").update("test-upload-token").digest("hex"),
              expiresAt: { toMillis: () => Date.now() + 60_000 },
            }),
          };
        }
        return { exists: false, data: () => undefined };
      },
      collection(name: string) {
        return new FakeCollection(`${ref.path}/${name}`);
      },
    };
    return ref;
  }
}

  vi.mock("@/lib/firebaseAdmin", () => ({
  auth: {
    verifyIdToken: mocks.verifyIdToken,
  },
    db: {
    collection: (name: string) => new FakeCollection(name),
    batch: () => {
      let employeePayload: Record<string, unknown> | null = null;
      return {
        create: vi.fn(),
        update: vi.fn(),
        set: vi.fn((ref: { path?: string }, payload: Record<string, unknown>) => {
          const hasUndefinedValue = (value: unknown): boolean => {
            if (value === undefined) return true;
            if (Array.isArray(value)) return value.some(hasUndefinedValue);
            if (value && typeof value === "object") {
              return Object.values(value).some(hasUndefinedValue);
            }
            return false;
          };
          if (hasUndefinedValue(payload)) {
            throw new Error("Cannot use undefined as a Firestore value");
          }
          if (/^employees\/[^/]+$/.test(ref?.path || "")) employeePayload = payload;
        }),
        commit: vi.fn(async () => {
          if (employeePayload) mocks.addedEmployees.push(employeePayload);
        }),
      };
      },
    },
    storage: {
      bucket: () => ({
        name: "test-bucket",
        file: () => ({ exists: vi.fn(async () => [true]) }),
      }),
    },
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: FakeTimestamp,
}));

vi.mock("@/lib/employee-id", () => ({
  generateEmployeeId: mocks.generateEmployeeId,
}));

vi.mock("@/lib/qr", () => ({
  generateQrCodeDataUrl: mocks.generateQrCodeDataUrl,
}));

vi.mock("@/lib/server/aadhaar", () => ({
  AADHAAR_CONSENT_TEXT_HASH: "consent-hash",
  assertAadhaarSourceOwnership: vi.fn(() => undefined),
  encryptAadhaarNumber: mocks.encryptAadhaarNumber,
  isAadhaarInfrastructureError: (error: unknown) =>
    error instanceof Error && /AADHAAR_KMS|Cloud KMS/.test(error.message),
  moveAadhaarSourceToRestrictedStorage: vi.fn(async ({ source }: { source: string }) => ({
    documentStoragePath: source.includes("aadhaar_back")
      ? "restrictedEmployeeAadhaar/employee-doc-1/aadhaar_back.pdf"
      : "restrictedEmployeeAadhaar/employee-doc-1/aadhaar.pdf",
    originalFileName: source.includes("aadhaar_back") ? "aadhaar_back.pdf" : "aadhaar.pdf",
    contentType: "application/pdf",
    sourcePath: source,
  })),
  deleteStorageObjectIfPresent: vi.fn(async () => undefined),
}));

function buildStandardPayload(overrides: Record<string, unknown> = {}) {
  return {
    enrollmentDraftId: "draft-test-123",
    enrollmentUploadToken: "test-upload-token",
    joiningDate: "2026-04-30T18:30:00.000Z",
    clientName: "TCS",
    resourceIdNumber: "TCS-RESOURCE-001",
    profilePictureUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FprofilePictures%2Fprofile.png?alt=media&token=test",
    firstName: "Standard",
    lastName: "Guard",
    fatherName: "Standard Father",
    motherName: "Standard Mother",
    dateOfBirth: "1994-02-14T18:30:00.000Z",
    gender: "Male",
    maritalStatus: "Unmarried",
    educationalQualification: "Graduation",
    qualificationName: "Bachelor of Commerce",
    qualificationCertificateUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FqualificationCertificates%2Fqualification.pdf?alt=media&token=test",
    district: "Ernakulam",
    identityProofType: "PAN Card",
    identityProofNumber: "AABCT1234C",
    identityProofUrlFront: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FidProofs%2Fid-front.png?alt=media&token=test",
    identityProofUrlBack: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FidProofs%2Fid-back.png?alt=media&token=test",
    addressProofType: "Voter ID",
    addressProofNumber: "ABC1234567",
    addressProofUrlFront: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FaddressProofs%2Faddress-front.png?alt=media&token=test",
    addressProofUrlBack: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FaddressProofs%2Faddress-back.png?alt=media&token=test",
    aadharNumber: "123456789012",
    aadharCardDocumentUrl: "enrollments/draft-test-123/aadharCards/aadhaar.pdf",
    aadharCardDocumentBackUrl: "enrollments/draft-test-123/aadharCards/aadhaar_back.pdf",
    signatureUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2Fsignatures%2Fsignature.png?alt=media&token=test",
    bankPassbookStatementUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FbankDocuments%2Fbank.png?alt=media&token=test",
    fullAddress: "Standard House, Standard Road, Ernakulam, Kerala - 682001",
    emailAddress: "Standard.Guard@example.com",
    phoneNumber: "9012345690",
    termsAccepted: true,
    aadhaarConsentAccepted: true,
    aadhaarConsentVersion: "aadhaar-esic-epf-v1",
    guardUndertakingAccepted: true,
    guardUndertakingVersion: "guard-undertaking-v1",
    ...overrides,
  };
}

describe("POST /api/employees/enroll", () => {
  beforeEach(() => {
    mocks.addedEmployees.length = 0;
    mocks.enrollmentEnabled = true;
    mocks.clientName = "TCS";
    mocks.generateEmployeeId.mockClear();
    mocks.generateQrCodeDataUrl.mockClear();
    mocks.verifyIdToken.mockClear();
    mocks.encryptAadhaarNumber.mockReset();
    mocks.encryptAadhaarNumber.mockResolvedValue({
      aadhaarNumberEncrypted: "encrypted",
      encryptionIv: "iv",
      encryptionTag: "tag",
      encryptedDataKey: "wrapped",
      encryptionKeyVersion: "kms-key",
    });
  });

  it("stores the required email in normalized form and returns the created employee", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(buildStandardPayload()),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "employee-doc-1",
      employeeId: "CISS/TCS/2026-27/001",
    });
    expect(mocks.addedEmployees).toHaveLength(1);
    expect(mocks.addedEmployees[0]).toMatchObject({
      employeeId: "CISS/TCS/2026-27/001",
      clientName: "TCS",
      fullName: "STANDARD GUARD",
      emailAddress: "standard.guard@example.com",
      phoneNumber: "9012345690",
      district: "Ernakulam",
      status: "PendingReview",
      publicProfile: {
        fullName: "STANDARD GUARD",
        employeeId: "CISS/TCS/2026-27/001",
        clientName: "TCS",
        profilePictureUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FprofilePictures%2Fprofile.png?alt=media&token=test",
        status: "PendingReview",
      },
    });
  });

  it("saves an LNG enrollment without writing undefined optional fields", async () => {
    mocks.clientName = "LNG Petronet";
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(
          buildStandardPayload({
            clientName: "LNG Petronet",
            firstName: "LNG",
            lastName: "Guard",
            fullNameInput: "LNG Guard",
            resourceIdNumber: undefined,
            qualificationName: undefined,
            qualificationCertificateUrl: undefined,
            lngJobDesignation: "Lady Security Guard",
            jobDesignation: "Lady Security Guard",
            identificationMark: "Small scar on right forearm",
            nationality: "Indian",
            heightCm: 172,
            weightKg: 68,
            branchName: "Kochi",
            panNumber: "AABCT1234C",
            panCardDocumentUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FpanCards%2Fpan.png?alt=media&token=test",
            legacyUniqueId: "LNG-2026-001",
          }),
        ),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "employee-doc-1",
      employeeId: "LNG-2026-001",
    });
    expect(mocks.addedEmployees[0]).toMatchObject({
      clientName: "LNG Petronet",
      lngJobDesignation: "Lady Security Guard",
      legacyUniqueId: "LNG-2026-001",
    });
    expect(mocks.addedEmployees[0]).not.toHaveProperty("qualificationName");
  });

  it.each([undefined, "", "not-an-email"])(
    "rejects enrollment when required email is invalid: %s",
    async (emailAddress) => {
      const { POST } = await import("./route");

      const response = await POST(
        new NextRequest("https://example.com/api/employees/enroll", {
          method: "POST",
          body: JSON.stringify(buildStandardPayload({ emailAddress })),
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(response.status).toBe(400);
      expect(mocks.addedEmployees).toHaveLength(0);
      const body = await response.json();
      expect(body.error).toBe("Invalid enrollment data.");
      expect(body.details.fieldErrors.emailAddress).toBeTruthy();
    },
  );

  it("allows an authenticated admin submission without a public upload session", async () => {
    const { POST } = await import("./route");
    const {
      enrollmentDraftId: _draftId,
      enrollmentUploadToken: _uploadToken,
      ...payload
    } = buildStandardPayload();
    for (const [key, path] of Object.entries({
      profilePictureUrl: "profilePictures/profile.png",
      identityProofUrlFront: "idProofs/id-front.png",
      identityProofUrlBack: "idProofs/id-back.png",
      addressProofUrlFront: "addressProofs/address-front.png",
      addressProofUrlBack: "addressProofs/address-back.png",
      signatureUrl: "signatures/signature.png",
      bankPassbookStatementUrl: "bankDocuments/bank.png",
      qualificationCertificateUrl: "qualificationCertificates/qualification.pdf",
    })) {
      (payload as Record<string, unknown>)[key] = `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/${encodeURIComponent(`employees/9012345690/${path}`)}?alt=media&token=test`;
    }

    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          Authorization: "Bearer valid-admin-token",
          "Content-Type": "application/json",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyIdToken).toHaveBeenCalledWith("valid-admin-token", true);
    expect(mocks.addedEmployees).toHaveLength(1);
    expect(mocks.addedEmployees[0]).toMatchObject({ status: "Active" });
  });

  it("rejects an authenticated user who is not the designated Aadhaar administrator", async () => {
    mocks.verifyIdToken.mockResolvedValueOnce({
      uid: "hr-user",
      role: "hr",
      email: "hr@cisskerala.app",
      email_verified: true,
    });
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(buildStandardPayload()),
        headers: {
          Authorization: "Bearer hr-token",
          "Content-Type": "application/json",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "The designated Aadhaar administrator account is required.",
    });
    expect(mocks.addedEmployees).toHaveLength(0);
  });

  it("rejects registration for a client that has paused enrolment", async () => {
    mocks.enrollmentEnabled = false;
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(buildStandardPayload()),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "This client is not accepting guard registrations. Please ask CISS HR to confirm the correct client.",
    });
    expect(mocks.addedEmployees).toHaveLength(0);
  });

  it("still requires an upload session for an unauthenticated public submission", async () => {
    const { POST } = await import("./route");
    const {
      enrollmentDraftId: _draftId,
      enrollmentUploadToken: _uploadToken,
      ...payload
    } = buildStandardPayload();

    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Enrollment upload session is required.",
    });
    expect(mocks.addedEmployees).toHaveLength(0);
  });

  it("returns a retryable service error when Aadhaar encryption is unavailable", async () => {
    mocks.encryptAadhaarNumber.mockRejectedValueOnce(
      new Error("AADHAAR_KMS_KEY_NAME is not configured correctly."),
    );
    const { POST } = await import("./route");

    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(buildStandardPayload()),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Enrollment security service is temporarily unavailable. Your documents are preserved; please retry shortly.",
      retryable: true,
    });
    expect(mocks.addedEmployees).toHaveLength(0);
  });

  it("surfaces a document-reference problem instead of masking it as a generic 500", async () => {
    const { POST } = await import("./route");
    // The signature points to an external host, so the reference cannot be
    // resolved to this enrollment session and the reference validation fails.
    const response = await POST(
      new NextRequest("https://example.com/api/employees/enroll", {
        method: "POST",
        body: JSON.stringify(
          buildStandardPayload({ signatureUrl: "https://example.com/signature.png" }),
        ),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Signature must be uploaded through the enrollment form.",
    });
    expect(mocks.addedEmployees).toHaveLength(0);
  });
});
