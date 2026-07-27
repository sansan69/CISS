import { afterEach, describe, expect, it, vi } from "vitest";

function createDb() {
  const refs = new Map<string, Record<string, unknown>>();
  const ref = (collection: string, id: string) => ({
    id,
    path: `${collection}/${id}`,
  });
  return {
    refs,
    collection(name: string) {
      return {
        doc(id = `${name}-generated`) {
          const documentRef = ref(name, id);
          return {
            ...documentRef,
            set: vi.fn(async (data: Record<string, unknown>) => {
              refs.set(documentRef.path, data);
            }),
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

describe("auto-checkout cron", () => {
  it("rejects requests without auth", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const db = createDb();
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/self-queue", () => ({
      buildSelfUrl: vi.fn(() => "https://example.test/auto-checkout"),
      runChunked: vi.fn(),
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.test/api/attendance/auto-checkout", {
        method: "POST",
      }) as never,
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ["query", "https://example.test/api/attendance/auto-checkout?key=test-cron-secret", {}],
    [
      "bearer",
      "https://example.test/api/attendance/auto-checkout",
      { Authorization: "Bearer test-cron-secret" },
    ],
  ])("accepts the configured %s credential", async (_label, url, headers) => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const db = createDb();
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/self-queue", () => ({
      buildSelfUrl: vi.fn(() => "https://example.test/auto-checkout"),
      runChunked: vi.fn(async () => ({
        done: true,
        processed: 0,
        status: "complete",
      })),
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request(url, { method: "POST", headers }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, closedCount: 0 });
  });

  it("supports the GET method used by Vercel Cron", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const db = createDb();
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/self-queue", () => ({
      buildSelfUrl: vi.fn(() => "https://example.test/auto-checkout"),
      runChunked: vi.fn(async () => ({
        done: true,
        processed: 0,
        status: "complete",
      })),
    }));

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/attendance/auto-checkout", {
        headers: { Authorization: "Bearer test-cron-secret" },
      }) as never,
    );

    expect(response.status).toBe(200);
  });

  it("uses scheduled shift end and updates log, session, state, and live status", async () => {
    const db = createDb();
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: { delete: vi.fn(() => ({ delete: true })) },
    }));

    const { processStaleSession } = await import(
      "@/lib/attendance/auto-checkout"
    );
    const shiftEnd = new Date("2026-07-28T00:30:00.000Z");
    const stateRef = { id: "employee-doc-1", path: "attendanceState/employee-doc-1" };
    const result = processStaleSession(
      {
        id: "employee-doc-1",
        ref: stateRef,
      } as never,
      {
        lastStatus: "In",
        lastAttendanceDate: "2026-07-27",
        employeeId: "CISS/TEST/001",
        employeeName: "Test Guard",
        lastSiteId: "site-1",
        lastSiteName: "Test Site",
        lastDutyPointId: "main-gate",
        lastDutyPointName: "Main Gate",
        lastShiftCode: "night",
        lastShiftLabel: "Night Shift",
        openSessionId: "session-1",
        autoCheckoutAt: {
          toDate: () => new Date("2026-07-28T02:30:00.000Z"),
        },
      },
      {
        employeeDocId: "employee-doc-1",
        status: "open",
        shiftEndsAt: { toDate: () => shiftEnd },
      },
      new Date("2026-07-28T02:40:00.000Z"),
    );

    expect(result).not.toBeNull();
    expect(result?.writes).toHaveLength(4);
    const logWrite = result?.writes.find((write) =>
      String((write.ref as { path?: string }).path).startsWith("attendanceLogs/"),
    );
    expect(logWrite?.data).toMatchObject({
      status: "Out",
      autoClosed: true,
      closeReason: "missed_checkout",
      reportedAt: shiftEnd,
      requiresAdminReview: true,
    });
    expect(
      result?.writes.some(
        (write) =>
          (write.ref as { path?: string }).path ===
          "guardLocations/employee-doc-1",
      ),
    ).toBe(true);
  });
});
