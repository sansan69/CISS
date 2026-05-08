import { afterEach, describe, expect, it, vi } from "vitest";

const serverTimestampSentinel = { __op: "serverTimestamp" } as const;

class FakeDocRef {
  constructor(
    private readonly store: Map<string, Record<string, unknown>>,
    private readonly id: string,
  ) {}

  async set(value: Record<string, unknown>, options?: { merge?: boolean }) {
    const existing = options?.merge ? this.store.get(this.id) ?? {} : {};
    this.store.set(this.id, {
      ...existing,
      ...Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          item === serverTimestampSentinel ? "2026-05-08T00:00:00.000Z" : item,
        ]),
      ),
    });
  }
}

class FakeCollectionRef {
  constructor(private readonly store: Map<string, Record<string, unknown>>) {}

  doc(id: string) {
    return new FakeDocRef(this.store, id);
  }
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("@/lib/server/auth");
  vi.doUnmock("firebase-admin/firestore");
});

describe("mobile token route", () => {
  it("stores the signed-in user's mobile token", async () => {
    const docs = new Map<string, Record<string, unknown>>();

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: {
        collection: vi.fn(() => new FakeCollectionRef(docs)),
      },
    }));

    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn(async () => ({
        uid: "guard-123",
      })),
      unauthorizedResponse: vi.fn((message: string, status: number) =>
        Response.json({ error: message }, { status }),
      ),
    }));

    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
      },
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.com/api/mobile/token", {
        method: "POST",
        body: JSON.stringify({ fcmToken: "abc123" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(docs.get("guard-123_mobile")).toEqual({
      uid: "guard-123",
      token: "abc123",
      platform: "mobile",
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
  });

  it("rejects blank tokens", async () => {
    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: {
        collection: vi.fn(),
      },
    }));

    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn(async () => ({
        uid: "guard-123",
      })),
      unauthorizedResponse: vi.fn((message: string, status: number) =>
        Response.json({ error: message }, { status }),
      ),
    }));

    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        serverTimestamp: () => serverTimestampSentinel,
      },
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.com/api/mobile/token", {
        method: "POST",
        body: JSON.stringify({ fcmToken: "   " }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "FCM token is required." });
  });
});
