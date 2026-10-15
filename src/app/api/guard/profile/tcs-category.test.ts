import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ employee: {} as Record<string, unknown> }));
vi.mock("@/lib/server/guard-auth", () => ({ requireGuard: async () => ({ employeeDocId: "guard-1", employeeId: "CISS/TCS/1" }) }));
vi.mock("@/lib/server/aadhaar", () => ({ documentCompletionFromEmployee: () => ({ aadhaar: "missing", identity: "missing", address: "missing" }) }));
vi.mock("@/lib/firebaseAdmin", () => ({ db: { doc: () => ({ get: async () => ({ exists: true, data: () => state.employee }) }), collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } }));
it.each([["TCS", "adhoc", "adhoc"], ["TCS", undefined, null], ["Other", "permanent", null]])("guard profile exposes effective category for %s", async (clientName, category, expected) => {
  state.employee = { clientName, tcsCategory: category };
  const { GET } = await import("./route");
  const response = await GET(new Request("http://localhost/api/guard/profile"));
  expect(response.status).toBe(200);
  expect((await response.json()).tcsCategory).toBe(expected);
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});
