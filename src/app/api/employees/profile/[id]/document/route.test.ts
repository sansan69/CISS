import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyRequestAuthMock = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  hasAdminAccess: (token: { role?: string; admin?: boolean }) =>
    token.admin === true || token.role === "admin" || token.role === "superAdmin",
  hasFieldOfficerAccess: (token: { role?: string }) => token.role === "fieldOfficer",
  hasClientAccess: (token: { role?: string }) => token.role === "client",
  verifyRequestAuth: verifyRequestAuthMock,
}));

class FakeDb {
  private readonly employees = new Map<string, Record<string, unknown>>();
  private readonly clients = new Map<string, Record<string, unknown>>();
  private readonly fieldOfficers = new Map<string, Record<string, unknown>>();

  seedEmployee(id: string, value: Record<string, unknown>) {
    this.employees.set(id, value);
  }

  seedClient(id: string, value: Record<string, unknown>) {
    this.clients.set(id, value);
  }

  seedFieldOfficer(id: string, value: Record<string, unknown>) {
    this.fieldOfficers.set(id, value);
  }

  collection(name: string) {
    const values = name === "employees"
      ? this.employees
      : name === "fieldOfficers"
        ? this.fieldOfficers
        : this.clients;
    return {
      add: async () => undefined,
      doc: (id: string) => ({
        async get() {
          const data = values.get(id);
          return { exists: Boolean(data), id, data: () => data };
        },
      }),
      where: (field: string, _operator: string, expected: unknown) => ({
        limit: () => ({
          async get() {
            const docs = Array.from(values.entries())
              .filter(([, data]) => data[field] === expected)
              .map(([id, data]) => ({ id, exists: true, data: () => data }));
            return { empty: docs.length === 0, docs };
          },
        }),
      }),
    };
  }
}

describe("GET /api/employees/profile/[id]/document", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("streams an in-scope proof without exposing a permanent download URL", async () => {
    const db = new FakeDb();
    db.seedClient("client-user", { clientId: "client-1", clientName: "Acme Security" });
    db.seedEmployee("guard-1", {
      employeeId: "G-001",
      clientName: "Acme Security",
      district: "Ernakulam",
      idProofFrontUrl: "https://firebasestorage.googleapis.com/v0/b/test-bucket/o/employees%2F9999999999%2FidProofs%2Fid-front.png?alt=media",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db,
      storage: {
        bucket: () => ({
          name: "test-bucket",
          file: () => ({
            download: async () => [Buffer.from("proof")],
            getMetadata: async () => [{ contentType: "image/png" }],
          }),
        }),
      },
    }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "client-user", role: "client" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/employees/profile/guard-1?category=identity-front"),
      { params: Promise.resolve({ id: "guard-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("proof");
  });

  it("streams legacy document references saved as metadata objects", async () => {
    const db = new FakeDb();
    db.seedClient("client-user", { clientId: "client-1", clientName: "Acme Security" });
    db.seedEmployee("guard-legacy", {
      employeeId: "G-LEGACY",
      clientName: "Acme Security",
      district: "Ernakulam",
      idProofDocumentUrlFront: {
        storagePath: "employees/9999999999/idProofs/legacy-front.png",
      },
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db,
      storage: {
        bucket: () => ({
          name: "test-bucket",
          file: () => ({
            download: async () => [Buffer.from("legacy-proof")],
            getMetadata: async () => [{ contentType: "image/png" }],
          }),
        }),
      },
    }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "client-user", role: "client" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/employees/profile/guard-legacy?category=identity-front"),
      { params: Promise.resolve({ id: "guard-legacy" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("legacy-proof");
  });

  it("streams documents saved as a bucket URI", async () => {
    const db = new FakeDb();
    db.seedClient("client-user", { clientId: "client-1", clientName: "Acme Security" });
    db.seedEmployee("guard-storage-uri", {
      employeeId: "G-STORAGE",
      clientName: "Acme Security",
      district: "Ernakulam",
      idProofFrontUrl: "gs://test-bucket/employees/9999999999/idProofs/id-front.png",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db,
      storage: {
        bucket: () => ({
          name: "test-bucket",
          file: () => ({
            download: async () => [Buffer.from("storage-proof")],
            getMetadata: async () => [{ contentType: "image/png" }],
          }),
        }),
      },
    }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "client-user", role: "client" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/employees/profile/guard-storage-uri/document?category=identity-front"),
      { params: Promise.resolve({ id: "guard-storage-uri" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("storage-proof");
  });

  it("rejects an unsupported document category", async () => {
    const db = new FakeDb();
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "client-user", role: "client" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/employees/profile/guard-1?category=aadhaar"),
      { params: Promise.resolve({ id: "guard-1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("downloads an assigned guard service book for a field officer", async () => {
    const db = new FakeDb();
    db.seedFieldOfficer("fo-record", { uid: "fo-1", assignedDistricts: ["Ernakulam"] });
    db.seedEmployee("guard-lng", {
      employeeId: "G-LNG",
      clientName: "LNG Petronet",
      district: "Ernakulam",
      serviceBookDocumentUrl: "employees/guard-lng/serviceBooks/service-book.pdf",
    });
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db,
      storage: {
        bucket: () => ({
          name: "test-bucket",
          file: () => ({
            download: async () => [Buffer.from("service-book")],
            getMetadata: async () => [{ contentType: "application/pdf" }],
          }),
        }),
      },
    }));
    verifyRequestAuthMock.mockResolvedValue({ uid: "fo-1", role: "fieldOfficer" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/employees/profile/guard-lng/document?category=service-book&download=true"),
      { params: Promise.resolve({ id: "guard-lng" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="service-book.pdf"');
    expect(await response.text()).toBe("service-book");
  });

  it("does not expose bank documents to client accounts", async () => {
    const db = new FakeDb();
    verifyRequestAuthMock.mockResolvedValue({ uid: "client-user", role: "client" });
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/employees/profile/guard-1/document?category=bank"),
      { params: Promise.resolve({ id: "guard-1" }) },
    );

    expect(response.status).toBe(403);
  });
});
