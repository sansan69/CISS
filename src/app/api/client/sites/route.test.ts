import { afterEach, describe, expect, it, vi } from "vitest";

function mockSites(sites: Record<string, Record<string, unknown> | null>) {
  const getAll = vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: sites[ref.id] !== null,
      data: () => sites[ref.id],
    })),
  );

  vi.doMock("@/lib/firebaseAdmin", () => ({
    db: { collection: () => ({ doc: (id: string) => ({ id }) }), getAll },
  }));
  vi.doMock("@/lib/server/auth", () => ({
    verifyRequestAuth: vi.fn(async () => ({
      uid: "client-uid",
      role: "client",
      clientId: "client-1",
      clientName: "Acme",
    })),
    hasClientAccess: vi.fn(() => true),
    unauthorizedResponse: vi.fn((message: string, status: number) =>
      new Response(JSON.stringify({ error: message }), { status }),
    ),
  }));
  vi.doMock("@/lib/server/client-access", () => ({
    resolveClientScope: vi.fn(async () => ({
      clientId: "client-1",
      clientName: "Acme",
      stateCode: "KL",
    })),
    matchesClientScope: vi.fn(
      (record: { clientName?: string; clientId?: string }) =>
        record.clientId === "client-1" || record.clientName === "Acme",
    ),
  }));

  return { getAll };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("@/lib/server/auth");
  vi.doUnmock("@/lib/server/client-access");
});

describe("client site lookup", () => {
  it("returns only sites that belong to the caller's client", async () => {
    mockSites({
      "site-own": { clientName: "Acme", district: "Ernakulam" },
      "site-other": { clientName: "Other Client", district: "Kollam" },
      "site-missing": null,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.test/api/client/sites?ids=site-own,site-other,site-missing"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sites).toEqual([{ id: "site-own", district: "Ernakulam" }]);
  });

  it("returns an empty list when no ids are supplied", async () => {
    mockSites({});
    const { GET } = await import("./route");
    const response = await GET(new Request("https://example.test/api/client/sites"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sites: [] });
  });
});
