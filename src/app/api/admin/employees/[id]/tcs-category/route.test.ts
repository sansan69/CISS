import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "admin", employee: { clientName: "TCS", fullName: "GUARD", status: "Active", stateCode: "KL" } as Record<string, unknown> | null, writes: [] as Record<string, unknown>[], uid: "admin-1", stateCode: "KL", authError: null as unknown, transactionError: null as unknown }));
vi.mock("@/lib/firebaseAdmin", () => ({
  auth: { verifyIdToken: async () => { if (state.authError) throw state.authError; return { uid: state.uid, role: state.role, stateCode: state.stateCode }; } },
  db: {
    collection: () => ({ doc: () => ({}) }),
    runTransaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      if (state.transactionError) throw state.transactionError;
      return operation({
      get: async () => ({ exists: state.employee !== null, data: () => state.employee }),
      update: (_ref: unknown, payload: Record<string, unknown>) => { state.writes.push(payload); state.employee = { ...state.employee, ...payload }; },
    });
    },
  },
}));
async function patch(body: unknown, id = "guard-doc-1", authorization = "Bearer local-test") {
  const { PATCH } = await import("./route");
  return PATCH(new Request("http://localhost/api/admin/employees/guard-doc-1/tcs-category", { method: "PATCH", headers: { authorization }, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
describe("admin TCS category curation", () => {
  beforeEach(() => { state.role = "admin"; state.stateCode = "KL"; state.employee = { clientName: "TCS", fullName: "GUARD", status: "Active", stateCode: "KL" }; state.writes.length = 0; state.authError = null; state.transactionError = null; vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());
  it.each(["admin", "superAdmin"])("allows %s to curate with server audit fields", async (role) => {
    state.role = role;
    const response = await patch({ tcsCategory: "permanent" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, tcsCategory: "permanent" });
    expect(state.employee).toMatchObject({ fullName: "GUARD", status: "Active", tcsCategory: "permanent", tcsCategoryUpdatedBy: "admin-1" });
    expect(state.employee?.tcsCategoryUpdatedAt).toBeInstanceOf(Date);
    expect(state.writes).toHaveLength(1);
  });
  it.each(["guard", "fieldOfficer", "hr"])("denies %s curation", async (role) => {
    state.role = role;
    const response = await patch({ tcsCategory: "adhoc" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "wrong_role" });
    expect(state.writes).toEqual([]);
  });
  it.each([{ tcsCategory: "invalid" }, { tcsCategory: null }, {}, { tcsCategory: "permanent", updatedBy: "forged" }, "{invalid"])("rejects malformed category bodies %s", async (body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "invalid_body" });
    expect(state.writes).toEqual([]);
  });
  it("rejects a non-TCS employee", async () => {
    state.employee = { clientName: "LNG Petronet" };
    const response = await patch({ tcsCategory: "adhoc" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "not_tcs" });
    expect(state.writes).toEqual([]);
  });
  it("returns 404 for a missing employee", async () => {
    state.employee = null;
    const response = await patch({ tcsCategory: "adhoc" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "employee_not_found" });
    expect(state.writes).toEqual([]);
  });
  it("rejects a human employee code as a document path", async () => {
    const response = await patch({ tcsCategory: "adhoc" }, "CISS/TCS/2026/1");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "invalid_body" });
    expect(state.writes).toEqual([]);
  });
  it("denies curation across the administrator's state", async () => {
    state.employee = { clientName: "TCS", stateCode: "TN" };
    const response = await patch({ tcsCategory: "adhoc" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "wrong_scope" });
    expect(state.writes).toEqual([]);
  });
  it("returns invalid_session for a missing bearer token", async () => {
    const response = await patch({ tcsCategory: "adhoc" }, "guard-doc-1", "");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required.", code: "invalid_session" });
    expect(state.writes).toEqual([]);
  });
  it.each(["auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found"])("returns invalid_session for %s", async (code) => {
    state.authError = Object.assign(new Error("private verification details"), { code });
    const response = await patch({ tcsCategory: "adhoc" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required.", code: "invalid_session" });
    expect(state.writes).toEqual([]);
  });
  it.each([
    new Error("Admin initialization failed: private details"),
    Object.assign(new Error("certificate fetch failed: private details"), { code: "auth/internal-error" }),
    Object.assign(new Error("Admin credential failed: private details"), { code: "auth/invalid-credential" }),
    Object.assign(new Error("network offline: private details"), { code: "ECONNRESET" }),
  ])("keeps unexpected authentication infrastructure errors retryable", async (error) => {
    state.authError = error;
    const response = await patch({ tcsCategory: "adhoc" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not update TCS category.", code: "internal_error" });
    expect(state.writes).toEqual([]);
  });
  it("returns a sanitized internal_error when the category transaction fails", async () => {
    state.transactionError = new Error("Firestore unavailable: private details");
    const response = await patch({ tcsCategory: "permanent" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not update TCS category.", code: "internal_error" });
    expect(state.writes).toEqual([]);
  });

});
