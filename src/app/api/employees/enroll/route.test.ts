import { NextRequest } from "next/server";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const addedEmployees: Array<Record<string, unknown>> = [];

  return {
    addedEmployees,
    generateEmployeeId: vi.fn(() => "CISS/TCS/2026-27/001"),
    generateQrCodeDataUrl: vi.fn(() => Promise.resolve("data:image/png;base64,qr")),
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
  encryptAadhaarNumber: vi.fn(async () => ({
    aadhaarNumberEncrypted: "encrypted",
    encryptionIv: "iv",
    encryptionTag: "tag",
    encryptedDataKey: "wrapped",
    encryptionKeyVersion: "kms-key",
  })),
  moveAadhaarSourceToRestrictedStorage: vi.fn(async () => ({
    documentStoragePath: "restrictedEmployeeAadhaar/employee-doc-1/aadhaar.pdf",
    originalFileName: "aadhaar.pdf",
    contentType: "application/pdf",
    sourcePath: "enrollments/draft-test-123/aadharCards/aadhaar.pdf",
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
    signatureUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2Fsignatures%2Fsignature.png?alt=media&token=test",
    bankPassbookStatementUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FbankDocuments%2Fbank.png?alt=media&token=test",
    fullAddress: "Standard House, Standard Road, Ernakulam, Kerala - 682001",
    emailAddress: "Standard.Guard@example.com",
    phoneNumber: "9012345690",
    termsAccepted: true,
    aadhaarConsentAccepted: true,
    aadhaarConsentVersion: "aadhaar-esic-epf-v1",
    ...overrides,
  };
}

describe("POST /api/employees/enroll", () => {
  beforeEach(() => {
    mocks.addedEmployees.length = 0;
    mocks.generateEmployeeId.mockClear();
    mocks.generateQrCodeDataUrl.mockClear();
    mocks.verifyIdToken.mockClear();
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
      status: "Active",
      publicProfile: {
        fullName: "STANDARD GUARD",
        employeeId: "CISS/TCS/2026-27/001",
        clientName: "TCS",
        profilePictureUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/enrollments%2Fdraft-test-123%2FprofilePictures%2Fprofile.png?alt=media&token=test",
        status: "Active",
      },
    });
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
});
