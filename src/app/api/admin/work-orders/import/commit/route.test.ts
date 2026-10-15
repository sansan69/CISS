import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestStore } from "@/lib/server/duties/test-store";
import { buildTcsExamContentHash } from "@/lib/work-orders/tcs-exam-hash";

// Whole-order importer cancellation must not erase the manual-removal history
// accumulated on the work order, otherwise a removed guard's own cancelled
// exam duty silently disappears from the duty feed before the duty date.
// These tests drive the real manual roster route, the real import commit route
// and the real guard feed against one shared in-memory Firestore fixture.

const adminToken = { uid: "admin-1", email: "admin@example.com", role: "admin" };
const guardAToken = { uid: "auth-a", role: "guard" };
const authState = { token: adminToken as Record<string, unknown> };

const GUARD_A = {
  employeeId: "CISS/A",
  fullName: "Guard A",
  gender: "Male",
  district: "Ernakulam",
  clientName: "TCS",
  tcsCategory: "adhoc",
  status: "Active",
  guardAuthUid: "auth-a",
};

const GUARD_B = {
  ...GUARD_A,
  employeeId: "CISS/B",
  fullName: "Guard B",
  guardAuthUid: "auth-b",
};

const EXAM_CODE = "tcs-exam";
const EXAM_DATE = "2026-04-22";

// Revision upload keeps only a different centre, so the existing TCS row for
// EXAM_DATE is cancelled by the importer while its manual history is retained.
const REVISION_ROW = {
  siteId: "site-new",
  siteName: "New Centre",
  district: "Ernakulam",
  date: EXAM_DATE,
  examName: "TCS Exam",
  examCode: EXAM_CODE,
  maleGuardsRequired: 5,
  femaleGuardsRequired: 1,
  sourceSheetName: "Sheet1",
  sourceRowNumber: 4,
};

// Mirrors the commit route's canonical row projection so the payload hash check passes.
function contentHashFor(rows: readonly typeof REVISION_ROW[]) {
  return buildTcsExamContentHash(
    EXAM_CODE,
    rows.map((row) => ({
      siteId: row.siteId,
      siteName: row.siteName,
      district: row.district,
      date: row.date,
      examCode: EXAM_CODE,
      maleGuardsRequired: row.maleGuardsRequired,
      femaleGuardsRequired: row.femaleGuardsRequired,
    })),
  );
}

let store: TestStore;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-04-21T06:00:00.000Z") });
  authState.token = adminToken;
  store = new TestStore();
  store.seed("employees", "guard-a", { ...GUARD_A });
  store.seed("employees", "guard-b", { ...GUARD_B });
  store.seed("sites", "site-old", {
    siteName: "Old Centre",
    clientName: "TCS",
    district: "Ernakulam",
    status: "active",
  });
  store.seed("workOrders", "existing-row", {
    siteId: "site-old",
    siteName: "Old Centre",
    clientName: "TCS",
    district: "Ernakulam",
    date: new Date("2026-04-22T00:00:00.000Z"),
    examName: "TCS Exam",
    examCode: EXAM_CODE,
    maleGuardsRequired: 2,
    femaleGuardsRequired: 1,
    totalManpower: 3,
    recordStatus: "active",
    assignmentVersion: 1,
    assignedGuards: [
      { uid: "guard-a", name: "Guard A", employeeId: "CISS/A", gender: "Male" },
      { uid: "guard-b", name: "Guard B", employeeId: "CISS/B", gender: "Male" },
    ],
    cancelledAssignedGuards: [],
    importId: "import-old",
    sourceFileName: "older.xlsx",
  });

  vi.doMock("@/lib/firebaseAdmin", () => ({
    db: store,
    messaging: { sendEachForMulticast: vi.fn(async () => ({ failureCount: 0 })) },
  }));
  vi.doMock("@/lib/server/auth", () => ({
    verifyRequestAuth: vi.fn(async () => authState.token),
    requireAdmin: vi.fn(async () => authState.token),
    requireAdminOrFieldOfficer: (token: unknown) => token,
    hasAdminAccess: (token: any) =>
      token?.role === "admin" || token?.role === "superAdmin" || token?.admin === true,
    hasFieldOfficerAccess: (token: any) => token?.role === "fieldOfficer",
    unauthorizedResponse: (message: string, status = 401) =>
      Response.json({ error: message }, { status }),
  }));
  vi.doMock("@/lib/server/location-geocode", () => ({
    lookupLocationGeocode: vi.fn(async () => null),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("@/lib/server/auth");
  vi.doUnmock("@/lib/server/location-geocode");
});

async function patchRoster(assignedGuards: Array<{ uid: string }>) {
  const { PATCH } = await import("../../[id]/route");
  return PATCH(
    new Request("http://local/api/admin/work-orders/existing-row", {
      method: "PATCH",
      headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ assignedGuards }),
    }),
    { params: Promise.resolve({ id: "existing-row" }) },
  );
}

async function commitRevision(rows: readonly typeof REVISION_ROW[]) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://local/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({
        mode: "revision",
        fileName: "tcs-exam.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: EXAM_CODE,
        binaryFileHash: "binary-hash-1",
        contentHash: contentHashFor(rows),
        rows,
      }),
    }),
  );
}

function cancelledUids() {
  const history = store.row("workOrders", "existing-row")?.cancelledAssignedGuards;
  return (Array.isArray(history) ? history : []).map((guard: any) => String(guard?.uid ?? "")).sort();
}

function notificationRecipients() {
  return store.list("notifications").map((row) => String(row.data().recipientUid));
}

describe("TCS exam import cancellation history", () => {
  it("keeps a manually removed guard's cancellation history through whole-order importer cancellation", async () => {
    const patched = await patchRoster([{ uid: "guard-b" }]);
    expect(patched.status).toBe(200);
    expect(cancelledUids()).toEqual(["guard-a"]);
    expect(notificationRecipients()).toEqual(["auth-a"]);

    const committed = await commitRevision([REVISION_ROW]);
    expect(committed.status).toBe(200);

    const record = store.row("workOrders", "existing-row")!;
    expect(record.recordStatus).toBe("cancelled");
    expect(record.assignedGuards).toEqual([]);
    // Prior manual removal survives; the roster removed by the import is added.
    expect(cancelledUids()).toEqual(["guard-a", "guard-b"]);
    // No duplicate cancellation push for the already removed guard.
    expect(notificationRecipients().sort()).toEqual(["auth-a", "auth-b"]);
    expect(notificationRecipients().filter((uid) => uid === "auth-a")).toHaveLength(1);

    authState.token = guardAToken;
    const { getGuardDuties } = await import("@/lib/server/duties/guard-feed");
    const feed = await getGuardDuties(
      new Request("http://local/api/guard/duties", { headers: { authorization: "Bearer guard" } }),
    );
    expect(feed.filter((row) => row.workOrderId === "existing-row")).toMatchObject([
      {
        id: "exam:existing-row",
        kind: "assigned",
        status: "cancelled",
        siteName: "Old Centre",
        canRespond: false,
      },
    ]);
  });

  it("records each removed roster guard once when the importer cancels without prior history", async () => {
    const committed = await commitRevision([REVISION_ROW]);
    expect(committed.status).toBe(200);
    expect(cancelledUids()).toEqual(["guard-a", "guard-b"]);
    expect(notificationRecipients().sort()).toEqual(["auth-a", "auth-b"]);
  });

  it("preserves accumulated cancellation history when a revision keeps the same roster", async () => {
    expect((await patchRoster([{ uid: "guard-b" }])).status).toBe(200);
    expect(cancelledUids()).toEqual(["guard-a"]);

    const committed = await commitRevision([
      {
        ...REVISION_ROW,
        siteId: "site-old",
        siteName: "Old Centre",
        maleGuardsRequired: 2,
        femaleGuardsRequired: 1,
      },
    ]);
    expect(committed.status).toBe(200);
    expect(store.row("workOrders", "existing-row")?.recordStatus).toBe("active");
    expect(cancelledUids()).toEqual(["guard-a"]);
    expect(notificationRecipients()).toEqual(["auth-a"]);
  });
});
