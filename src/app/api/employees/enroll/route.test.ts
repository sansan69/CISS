import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const addedEmployees: Array<Record<string, unknown>> = [];

  return {
    addedEmployees,
    generateEmployeeId: vi.fn(() => "CISS/TCS/2026-27/001"),
    generateQrCodeDataUrl: vi.fn(() => Promise.resolve("data:image/png;base64,qr")),
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
    return {
      id: id || `employee-doc-${mocks.addedEmployees.length + 1}`,
      path: `${this.name}/${id || `employee-doc-${mocks.addedEmployees.length + 1}`}`,
      async get() {
        return { exists: false };
      },
    };
  }
}

vi.mock("@/lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => new FakeCollection(name),
    batch: () => {
      let employeePayload: Record<string, unknown> | null = null;
      return {
        create: vi.fn(),
        set: vi.fn((_ref: unknown, payload: Record<string, unknown>) => {
          employeePayload = payload;
        }),
        commit: vi.fn(async () => {
          if (employeePayload) mocks.addedEmployees.push(employeePayload);
        }),
      };
    },
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

function buildStandardPayload(overrides: Record<string, unknown> = {}) {
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

describe("POST /api/employees/enroll", () => {
  beforeEach(() => {
    mocks.addedEmployees.length = 0;
    mocks.generateEmployeeId.mockClear();
    mocks.generateQrCodeDataUrl.mockClear();
  });

  it("stores standard client enrollments without requiring email and returns the created employee", async () => {
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
      emailAddress: "",
      phoneNumber: "9012345690",
      district: "Ernakulam",
      status: "Active",
      publicProfile: {
        fullName: "STANDARD GUARD",
        employeeId: "CISS/TCS/2026-27/001",
        clientName: "TCS",
        profilePictureUrl: "https://example.com/profile.png",
        status: "Active",
      },
    });
  });
});
