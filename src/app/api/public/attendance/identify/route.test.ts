import { afterEach, describe, expect, it, vi } from "vitest";

type EmployeeRecord = {
  id: string;
  data: Record<string, unknown>;
};

function createFirestore(records: EmployeeRecord[]) {
  const employeeDocs = records.map((record) => ({
    id: record.id,
    exists: true,
    data: () => record.data,
  }));

  return {
    collection(name: string) {
      if (name === "attendanceVerificationProofs") {
        return {
          doc: () => ({ set: vi.fn(async () => undefined) }),
        };
      }

      if (name === "attendanceState") {
        return {
          doc() {
            return {
              get: vi.fn(async () => ({
                exists: false,
                data: () => undefined,
              })),
            };
          },
        };
      }

      if (name !== "employees") throw new Error(`Unexpected collection ${name}`);
      return {
        doc(id: string) {
          const match = employeeDocs.find((doc) => doc.id === id);
          return {
            get: vi.fn(async () => match ?? { exists: false }),
          };
        },
        where(field: string, operator: string, value: unknown) {
          let matches = employeeDocs.filter((doc) => {
            const fieldValue = doc.data()[field];
            if (operator === "array-contains") {
              return Array.isArray(fieldValue) && fieldValue.includes(value);
            }
            return fieldValue === value;
          });
          return {
            limit(count: number) {
              matches = matches.slice(0, count);
              return {
                get: vi.fn(async () => ({
                  empty: matches.length === 0,
                  docs: matches,
                })),
              };
            },
          };
        },
      };
    },
  };
}

function mockInfrastructure(db: ReturnType<typeof createFirestore>) {
  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/rate-limit", () => ({
    getClientIp: vi.fn(() => "127.0.0.1"),
    buildRateLimitKey: vi.fn(() => "key"),
    checkRateLimit: vi.fn(async () => ({ allowed: true })),
  }));
  vi.doMock("@/lib/server/guard-auth", () => ({
    requireGuard: vi.fn(async () => ({
      uid: "guard-uid",
      employeeId: "CISS/TEST/001",
      employeeDocId: "employee-doc-1",
    })),
  }));
  vi.doMock("@/lib/server/auth", () => ({
    verifyRequestAuth: vi.fn(async () => ({
      uid: "actor-uid",
      role: "guard",
      employeeDocId: "actor-doc",
    })),
  }));
}

function identifyRequest(
  body: Record<string, unknown>,
  authenticated: boolean,
) {
  return new Request("https://example.test/api/public/attendance/identify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { Authorization: "Bearer actor-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("public attendance identification", () => {
  it("lets a signed-in guard identify a colleague by employee ID", async () => {
    vi.stubEnv("ATTENDANCE_VERIFICATION_SECRET", "test-secret");
    const db = createFirestore([
      {
        id: "employee-doc-1",
        data: {
          employeeId: "CISS/TEST/001",
          fullName: "Test Guard",
          status: "Active",
        },
      },
    ]);
    mockInfrastructure(db);

    const { POST } = await import("./route");
    const response = await POST(
      identifyRequest({ method: "employeeId", value: "CISS/TEST/001" }, true),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assisted).toBe(true);
    expect(body.employee).toMatchObject({
      id: "employee-doc-1",
      employeeCode: "CISS/TEST/001",
      fullName: "Test Guard",
    });
    expect(body.verificationToken).toEqual(expect.any(String));
  });

  it("refuses employee-ID identification without a signed-in guard", async () => {
    vi.stubEnv("ATTENDANCE_VERIFICATION_SECRET", "test-secret");
    const db = createFirestore([
      {
        id: "employee-doc-1",
        data: {
          employeeId: "CISS/TEST/001",
          fullName: "Test Guard",
          status: "Active",
        },
      },
    ]);
    mockInfrastructure(db);

    const { POST } = await import("./route");
    const response = await POST(
      identifyRequest({ method: "employeeId", value: "CISS/TEST/001" }, false),
    );

    expect(response.status).toBe(401);
  });

  it("identifies the logged-in guard without issuing a public proof", async () => {
    const db = createFirestore([
      {
        id: "employee-doc-1",
        data: {
          employeeId: "CISS/TEST/001",
          fullName: "Test Guard",
          status: "Active",
        },
      },
    ]);
    mockInfrastructure(db);

    const { POST } = await import("./route");
    const response = await POST(
      identifyRequest({ method: "authenticated" }, true),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.verificationToken).toBeNull();
  });

  it("allows resource-ID identification for a TCS guard", async () => {
    vi.stubEnv("ATTENDANCE_VERIFICATION_SECRET", "test-secret");
    const db = createFirestore([
      {
        id: "employee-doc-2",
        data: {
          employeeId: "CISS/TEST/002",
          resourceIdNumber: "RES-002",
          clientName: "TCS",
          fullName: "Resource Guard",
          status: "Active",
        },
      },
    ]);
    mockInfrastructure(db);

    const { POST } = await import("./route");
    const response = await POST(
      identifyRequest({ method: "resourceId", value: "RES-002" }, true),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.employee.id).toBe("employee-doc-2");
    expect(body.verificationToken).toEqual(expect.any(String));
  });

  it("rejects a resource ID for a non-TCS guard", async () => {
    vi.stubEnv("ATTENDANCE_VERIFICATION_SECRET", "test-secret");
    const db = createFirestore([
      {
        id: "employee-doc-4",
        data: {
          employeeId: "CISS/TEST/004",
          resourceIdNumber: "RES-004",
          clientName: "LNG Petronet",
          fullName: "Non TCS Guard",
          status: "Active",
        },
      },
    ]);
    mockInfrastructure(db);

    const { POST } = await import("./route");
    const response = await POST(
      identifyRequest({ method: "resourceId", value: "RES-004" }, true),
    );

    expect(response.status).toBe(403);
  });

  it("accepts a valid signed QR badge without a session (kiosk)", async () => {
    vi.stubEnv("ATTENDANCE_VERIFICATION_SECRET", "test-secret");
    const db = createFirestore([
      {
        id: "employee-doc-5",
        data: {
          employeeId: "CISS/TEST/005",
          phoneNumber: "9999999995",
          fullName: "Kiosk Guard",
          status: "Active",
        },
      },
    ]);
    mockInfrastructure(db);

    const { buildQrContent } = await import("@/lib/qr/qr-token");
    const qrValue = await buildQrContent(
      "CISS/TEST/005",
      "KIOSK GUARD",
      "9999999995",
    );

    const { POST } = await import("./route");
    const response = await POST(
      identifyRequest({ method: "qr", value: qrValue }, false),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assisted).toBe(false);
    expect(body.verificationToken).toEqual(expect.any(String));
  });

  it("rejects a QR code that carries no signed token", async () => {
    vi.stubEnv("ATTENDANCE_VERIFICATION_SECRET", "test-secret");
    const db = createFirestore([
      {
        id: "employee-doc-3",
        data: {
          employeeId: "CISS/TEST/003",
          phoneNumber: "9999999999",
          fullName: "Tokenless Guard",
          status: "Active",
        },
      },
    ]);
    mockInfrastructure(db);

    const { POST } = await import("./route");
    const response = await POST(
      identifyRequest(
        {
          method: "qr",
          value:
            "CISS-ATTENDANCE\nEmployee ID: CISS/TEST/003\nName: TOKENLESS GUARD\nPhone: 9999999999",
        },
        false,
      ),
    );

    expect(response.status).toBe(401);
  });
});
