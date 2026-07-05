import { describe, expect, it, vi } from "vitest";

const docsByCollection = vi.hoisted(() => new Map<string, Array<{ id: string; data: Record<string, unknown> }>>());

class FakeCollection {
  constructor(private readonly name: string) {}

  async get() {
    return {
      docs: (docsByCollection.get(this.name) ?? []).map((doc) => ({
        id: doc.id,
        data: () => doc.data,
      })),
    };
  }
}

vi.mock("@/lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => new FakeCollection(name),
  },
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: new Date(), totalAttempts: 1 }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  buildRateLimitKey: vi.fn().mockReturnValue("test-key"),
}));

describe("GET /api/public/attendance", () => {
  it("returns attendance centers from sites and client locations", async () => {
    docsByCollection.set("sites", [
      {
        id: "site-geodis-floor-9",
        data: {
          siteName: "Floor 9",
          clientName: "Geodis India Ltd., Kochi",
          district: "Ernakulam",
          latString: "9.98",
          lngString: "76.28",
          strictGeofence: true,
        },
      },
    ]);
    docsByCollection.set("clientLocations", [
      {
        id: "location-client-only",
        data: {
          locationName: "Client Location",
          clientName: "Client With Legacy Location",
          district: "Ernakulam",
          latString: "9.99",
          lngString: "76.29",
          strictGeofence: false,
        },
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost:3000/api/public/attendance"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "site-geodis-floor-9",
          siteName: "Floor 9",
          clientName: "Geodis India Ltd., Kochi",
          sourceCollection: "sites",
          strictGeofence: true,
        }),
        expect.objectContaining({
          id: "location-client-only",
          siteName: "Client Location",
          clientName: "Client With Legacy Location",
          sourceCollection: "clientLocations",
          strictGeofence: false,
        }),
      ]),
    );
  });
});
