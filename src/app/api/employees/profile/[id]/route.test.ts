import { beforeEach, describe, expect, it, vi } from "vitest";

type RecordData = Record<string, unknown>;

class FakeDoc {
  constructor(
    public readonly id: string,
    private readonly value: RecordData | undefined,
  ) {}

  get exists() {
    return Boolean(this.value);
  }

  data() {
    return this.value;
  }
}

class FakeQuery {
  constructor(
    private readonly db: FakeDb,
    private readonly collectionName: string,
    private readonly filters: Array<{ field: string; value: unknown }> = [],
    private readonly max?: number,
  ) {}

  where(field: string, _operator: "==" | "in", value: unknown) {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, value }], this.max);
  }

  limit(value: number) {
    return new FakeQuery(this.db, this.collectionName, this.filters, value);
  }

  async get() {
    const rows = this.db.rows(this.collectionName).filter(({ value }) =>
      this.filters.every(({ field, value: expected }) => value[field] === expected),
    );
    const docs = (typeof this.max === "number" ? rows.slice(0, this.max) : rows)
      .map(({ id, value }) => new FakeDoc(id, value));
    return { empty: docs.length === 0, docs };
  }

  doc(id: string) {
    const row = this.db.rows(this.collectionName).find((entry) => entry.id === id);
    return {
      async get() {
        return new FakeDoc(id, row?.value);
      },
    };
  }
}

class FakeDb {
  private readonly collections = new Map<string, Map<string, RecordData>>();

  seed(collectionName: string, id: string, value: RecordData) {
    if (!this.collections.has(collectionName)) this.collections.set(collectionName, new Map());
    this.collections.get(collectionName)!.set(id, value);
  }

  collection(name: string) {
    return new FakeQuery(this, name);
  }

  rows(collectionName: string) {
    return Array.from(this.collections.get(collectionName)?.entries() ?? [])
      .map(([id, value]) => ({ id, value }));
  }
}

const verifyRequestAuthMock = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  hasAdminAccess: (token: { role?: string; admin?: boolean }) =>
    token.admin === true || token.role === "admin" || token.role === "superAdmin",
  hasFieldOfficerAccess: (token: { role?: string }) => token.role === "fieldOfficer",
  hasClientAccess: (token: { role?: string }) => token.role === "client",
  unauthorizedResponse: (message: string, status = 401) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  verifyRequestAuth: verifyRequestAuthMock,
}));

describe("GET /api/employees/profile/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns a client-scoped safe profile without private payroll or Aadhaar fields", async () => {
    const db = new FakeDb();
    db.seed("clientUsersByUid", "client-user", {
      clientId: "client-1",
      clientName: "Acme Security",
    });
    db.seed("employees", "guard-1", {
      employeeId: "G-001",
      fullName: "Guard One",
      firstName: "Guard",
      lastName: "One",
      clientName: "Acme Security",
      district: "Ernakulam",
      status: "Active",
      dateOfBirth: "1990-01-01T00:00:00.000Z",
      joiningDate: "2025-01-01T00:00:00.000Z",
      phoneNumber: "9999999999",
      fullAddress: "Guard House, Ernakulam",
      identityProofType: "PAN Card",
      identityProofNumber: "ABCDE1234F",
      idProofFrontUrl: "https://example.com/id-front.png",
      addressProofType: "Voter ID",
      addressProofNumber: "VOTER-001",
      addressProofFrontUrl: "https://example.com/address-front.png",
      aadharNumber: "123456789012",
      aadharCardDocumentUrl: "https://example.com/aadhaar.pdf",
      bankAccountNumber: "1234567890",
      signature: "https://example.com/signature.png",
      documentCompletion: { identity: "complete", address: "complete" },
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "client-user", role: "client" });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/employees/profile/guard-1"), {
      params: Promise.resolve({ id: "guard-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profile).toMatchObject({
      employeeId: "G-001",
      fullName: "Guard One",
      identityProofType: "PAN Card",
      addressProofType: "Voter ID",
    });
    expect(body.profile).not.toHaveProperty("aadharNumber");
    expect(body.profile).not.toHaveProperty("aadharCardDocumentUrl");
    expect(body.profile).not.toHaveProperty("bankAccountNumber");
    expect(body.profile).not.toHaveProperty("signatureUrl");
    expect(body.profile).not.toHaveProperty("identityProofUrlFront");
    expect(body.profile).not.toHaveProperty("addressProofUrlFront");
    expect(body.profile.documentAvailability).toEqual({
      identityFront: true,
      identityBack: false,
      addressFront: true,
      addressBack: false,
    });
  });

  it("denies a client profile outside its client scope", async () => {
    const db = new FakeDb();
    db.seed("clientUsersByUid", "client-user", { clientId: "client-1", clientName: "Acme Security" });
    db.seed("employees", "guard-2", { employeeId: "G-002", clientName: "Other Client", district: "Ernakulam" });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "client-user", role: "client" });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/employees/profile/guard-2"), {
      params: Promise.resolve({ id: "guard-2" }),
    });

    expect(response.status).toBe(403);
  });

  it("denies a field officer profile outside assigned districts", async () => {
    const db = new FakeDb();
    db.seed("fieldOfficers", "fo-1", { uid: "fo-1", assignedDistricts: ["Ernakulam"] });
    db.seed("employees", "guard-3", { employeeId: "G-003", clientName: "Acme Security", district: "Kollam" });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "fo-1", role: "fieldOfficer", assignedDistricts: ["Ernakulam"] });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/employees/profile/guard-3"), {
      params: Promise.resolve({ id: "guard-3" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns operational details and document availability for an assigned field officer", async () => {
    const db = new FakeDb();
    db.seed("fieldOfficers", "fo-record", { uid: "fo-1", assignedDistricts: ["Ernakulam"] });
    db.seed("employees", "guard-4", {
      employeeId: "G-004",
      fullName: "Guard Four",
      clientName: "LNG Petronet",
      district: "Ernakulam",
      panNumber: "ABCDE1234F",
      epfUanNumber: "100200300400",
      bankName: "Federal Bank",
      bankAccountNumber: "1234567890",
      ifscCode: "FDRL0000001",
      branchName: "Kochi",
      serviceBookNumber: "SB-004",
      signatureUrl: "employees/guard-4/signatures/signature.png",
      bankPassbookStatementUrl: "employees/guard-4/bankDocuments/passbook.pdf",
      serviceBookDocumentUrl: "employees/guard-4/serviceBooks/service-book.pdf",
      profilePictureUrl: "employees/guard-4/profilePictures/profile.png",
      aadharNumber: "123456789012",
      aadharCardDocumentUrl: "employees/guard-4/aadharCards/aadhaar.pdf",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "fo-1", role: "fieldOfficer" });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/employees/profile/guard-4"), {
      params: Promise.resolve({ id: "guard-4" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profile).toMatchObject({
      panNumber: "ABCDE1234F",
      epfUanNumber: "100200300400",
      bankName: "Federal Bank",
      bankAccountNumber: "1234567890",
      branchName: "Kochi",
      serviceBookNumber: "SB-004",
      documentAvailability: {
        profilePicture: true,
        signature: true,
        bank: true,
        serviceBook: true,
      },
    });
    expect(body.profile).not.toHaveProperty("aadharNumber");
    expect(body.profile).not.toHaveProperty("aadharCardDocumentUrl");
    expect(body.profile).not.toHaveProperty("signatureUrl");
    expect(body.profile).not.toHaveProperty("bankPassbookStatementUrl");
  });
});
