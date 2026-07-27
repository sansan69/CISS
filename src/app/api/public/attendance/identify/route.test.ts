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

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("public attendance identification", () => {
  it("identifies an active guard by employee ID and issues a signed proof", async () => {
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
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/rate-limit", () => ({
      getClientIp: vi.fn(() => "127.0.0.1"),
      buildRateLimitKey: vi.fn(() => "key"),
      checkRateLimit: vi.fn(async () => ({ allowed: true })),
    }));
    vi.doMock("@/lib/server/guard-auth", () => ({
      requireGuard: vi.fn(),
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.test/api/public/attendance/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "employeeId",
          value: "CISS/TEST/001",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.employee).toMatchObject({
      id: "employee-doc-1",
      employeeCode: "CISS/TEST/001",
      fullName: "Test Guard",
    });
    expect(body.verificationToken).toEqual(expect.any(String));
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

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.test/api/public/attendance/identify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer guard-token",
        },
        body: JSON.stringify({ method: "authenticated" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.verificationToken).toBeNull();
    expect(body.employee.id).toBe("employee-doc-1");
  });
});
