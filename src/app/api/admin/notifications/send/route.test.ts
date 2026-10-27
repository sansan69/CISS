import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("firebase-admin/firestore");
  vi.doUnmock("@/lib/server/auth");
  vi.clearAllMocks();
});

function mockNotifications(employees: Record<string, unknown>[]) {
  const added: Record<string, unknown>[] = [];
  const add = vi.fn(async (doc: Record<string, unknown>) => {
    // Mirror Firestore's behaviour: a field explicitly set to undefined fails
    // the whole write.
    for (const [key, value] of Object.entries(doc)) {
      if (value === undefined) {
        throw new Error(`Cannot use "undefined" as a Firestore value (${key})`);
      }
    }
    added.push(doc);
    return { id: String(added.length) };
  });

  const db = {
    collection: (name: string) => {
      if (name === "employees") {
        return {
          get: async () => ({
            docs: employees.map((data) => ({ data: () => data })),
          }),
        };
      }
      if (name === "fieldOfficers") {
        return { get: async () => ({ docs: [] }) };
      }
      return { add };
    },
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({
    db,
    messaging: { send: vi.fn(async () => "message-id") },
  }));
  vi.doMock("firebase-admin/firestore", () => ({
    FieldValue: { serverTimestamp: () => new Date("2026-10-26T00:00:00Z") },
  }));
  vi.doMock("@/lib/server/auth", () => ({
    requireAdmin: vi.fn(async () => ({ uid: "admin-1", role: "admin" })),
    unauthorizedResponse: (message: string, status: number) =>
      new Response(JSON.stringify({ error: message }), { status }),
  }));

  return added;
}

function sendRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/notifications/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("broadcast notifications", () => {
  it("accepts a broadcast without optional data or a recipient district", async () => {
    const added = mockNotifications([
      { guardAuthUid: "guard-1", district: "Ernakulam", clientName: "TCS" },
      { guardAuthUid: "guard-2", clientName: "TCS" },
    ]);

    const { POST } = await import("./route");
    const response = await POST(
      sendRequest({ title: "Shift change", body: "Report at 8", role: "guard" }),
    );

    expect(response.status).toBe(200);
    expect(added).toHaveLength(2);
    for (const doc of added) {
      expect(Object.prototype.hasOwnProperty.call(doc, "data")).toBe(false);
      for (const value of Object.values(doc)) {
        expect(value).not.toBeUndefined();
      }
    }
  });

  it("keeps the provided payload when data is sent", async () => {
    const added = mockNotifications([
      { guardAuthUid: "guard-3", district: "Kollam", clientName: "TCS" },
    ]);

    const { POST } = await import("./route");
    const response = await POST(
      sendRequest({
        title: "Training",
        body: "New module",
        role: "guard",
        data: { screen: "training", trainingId: "t-1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(added[0].data).toEqual({ screen: "training", trainingId: "t-1" });
  });
});
