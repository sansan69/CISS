import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { db } from "@/lib/firebaseAdmin";

describe("auto-checkout cron", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
  });

  it("rejects requests without auth", async () => {
    const req = new Request("https://example.com/api/attendance/auto-checkout", {
      method: "POST",
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("allows requests with correct query param key", async () => {
    const req = new Request(
      "https://example.com/api/attendance/auto-checkout?key=test-cron-secret",
      { method: "POST" },
    );

    // Mock Firestore snapshot
    const docs: any[] = [];
    vi.spyOn(db, "collection").mockReturnValue({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs, size: 0 }),
    } as any);

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.closedCount).toBe(0);
  });

  it("auto-closes a stale session using shift end time", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const attendanceDate = twoDaysAgo.toISOString().slice(0, 10);

    const stateDoc = {
      id: "emp-123",
      data: () => ({
        lastStatus: "In",
        lastAttendanceDate: attendanceDate,
        employeeId: "CISS/TEST/001",
        employeeName: "Test Guard",
        lastSiteId: "site-1",
        lastSiteName: "Test Site",
        lastDutyPointId: "dp-1",
        lastDutyPointName: "Main Gate",
        lastSiteClientName: "Test Client",
        employeeClientName: "Test Client",
        openSessionId: "session-1",
      }),
      ref: { path: "attendanceState/emp-123" },
    };

    const sessionDoc = {
      id: "session-1",
      data: () => ({
        shiftStartTime: "09:00",
        shiftEndTime: "17:00",
      }),
    };

    const mockBatch = {
      set: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    };

    const stateSnapshot = {
      docs: [stateDoc],
      size: 1,
    };

    const sessionSnapshot = {
      docs: [sessionDoc],
      size: 1,
    };

    vi.spyOn(db, "batch").mockReturnValue(mockBatch as any);
    vi.spyOn(db, "collection").mockImplementation((name: string) => {
      if (name === "attendanceState") {
        return {
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue(stateSnapshot),
        } as any;
      }
      if (name === "attendanceSessions") {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue(sessionSnapshot),
          doc: vi.fn().mockReturnValue({ id: "session-1", path: "attendanceSessions/session-1" }),
        } as any;
      }
      if (name === "attendanceLogs") {
        return {
          doc: vi.fn().mockReturnValue({ id: "log-1", path: "attendanceLogs/log-1" }),
        } as any;
      }
      return {} as any;
    });

    const req = new Request(
      "https://example.com/api/attendance/auto-checkout?key=test-cron-secret",
      { method: "POST" },
    );

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.closedCount).toBe(1);
    expect(body.closedSessions[0].employeeDocId).toBe("emp-123");

    // Verify batch.set was called for attendanceLogs, attendanceSessions, and attendanceState
    expect(mockBatch.set).toHaveBeenCalledTimes(3);
    expect(mockBatch.commit).toHaveBeenCalled();
  });
});
