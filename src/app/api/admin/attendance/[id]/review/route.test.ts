import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("attendance review route", () => {
  it("requires a meaningful review note", async () => {
    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn(async () => ({
        uid: "admin-1",
        role: "admin",
      })),
      hasAdminAccess: vi.fn(() => true),
      hasFieldOfficerAccess: vi.fn(() => false),
    }));

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("https://example.test/api/admin/attendance/log-1/review", {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", note: "" }),
      }),
      { params: Promise.resolve({ id: "log-1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("corrects an OUT record and its paired session atomically", async () => {
    const writes: Array<{
      path: string;
      data: Record<string, unknown>;
    }> = [];
    const db = {
      collection(name: string) {
        return {
          doc(id: string) {
            return { path: `${name}/${id}` };
          },
        };
      },
      async runTransaction(
        callback: (transaction: {
          get(ref: { path: string }): Promise<unknown>;
          set(
            ref: { path: string },
            data: Record<string, unknown>,
          ): void;
        }) => Promise<void>,
      ) {
        await callback({
          get: async () => ({
            exists: true,
            data: () => ({
              status: "Out",
              district: "Ernakulam",
              attendanceSessionId: "session-1",
              reportedAt: { previous: true },
            }),
          }),
          set: (ref, data) => writes.push({ path: ref.path, data }),
        });
      },
    };

    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn(async () => ({
        uid: "admin-1",
        role: "admin",
      })),
      hasAdminAccess: vi.fn(() => true),
      hasFieldOfficerAccess: vi.fn(() => false),
    }));
    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("https://example.test/api/admin/attendance/log-1/review", {
        method: "PATCH",
        body: JSON.stringify({
          action: "correct",
          note: "Guard confirmed checkout with field officer.",
          correctedOutAt: "2026-07-27T18:30:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: "log-1" }) },
    );

    expect(response.status).toBe(200);
    expect(writes.map((write) => write.path)).toEqual([
      "attendanceSessions/session-1",
      "attendanceLogs/log-1",
    ]);
    expect(writes[1].data).toMatchObject({
      reviewStatus: "corrected",
      requiresAdminReview: false,
      reviewedByUid: "admin-1",
    });
  });
});
