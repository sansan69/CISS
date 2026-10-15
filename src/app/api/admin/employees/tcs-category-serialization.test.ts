import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ employee: {} as Record<string, unknown> }));
vi.mock("@/lib/firebaseAdmin", () => ({
  auth: { verifyIdToken: async () => ({ uid: "admin-1", role: "admin" }) },
  db: { collection: () => ({ limit() { return this; }, where() { return this; }, get: async () => ({ docs: [{ id: "guard-1", data: () => state.employee }] }), doc: () => ({ get: async () => ({ id: "guard-1", exists: true, data: () => state.employee }) }) }) },
}));
beforeEach(() => { state.employee = { fullName: "GUARD", clientName: "TCS", tcsCategory: "permanent" }; });
it.each([["TCS", "permanent", "permanent"], ["TCS", undefined, null], ["Other", "adhoc", null]])("serializes effective category in admin list/detail for %s", async (clientName, category, expected) => {
  state.employee = { ...state.employee, clientName, tcsCategory: category };
  const request = new Request("http://localhost/api/admin/employees", { headers: { authorization: "Bearer local" } });
  const { GET: list } = await import("./route");
  expect((await (await list(request)).json()).employees[0].tcsCategory).toBe(expected);
  const { GET: detail } = await import("./[id]/route");
  const response = await detail(request as never, { params: Promise.resolve({ id: "guard-1" }) });
  expect((await response.json()).tcsCategory).toBe(expected);
});
