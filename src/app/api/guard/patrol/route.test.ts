import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  guard: vi.fn(),
  rows: new Map<string, Record<string, unknown>>(),
  next: 0,
}));

vi.mock("@/lib/server/guard-auth", () => ({ requireGuard: mock.guard }));
vi.mock("@/lib/firebaseAdmin", () => ({
  db: {
    collection: (name: string) => ({
      doc: (id?: string) => {
        const documentId = id ?? `created-${++mock.next}`;
        const path = `${name}/${documentId}`;
        const seeded: Record<string, Record<string, unknown>> = {
          "employees/employee-1": {
            status: "Active",
            clientId: "client-1",
            clientName: "Client",
            name: "Guard One",
          },
          "clients/client-1": {
            patrolSettings: { enabled: true, photoRequiredForPatrol: false },
          },
          "sites/site-1": {
            clientId: "client-1",
            clientName: "Client",
            siteName: "Site One",
            district: "North",
          },
        };
        return {
          id: documentId,
          get: async () => ({
            exists: mock.rows.has(path) || Object.hasOwn(seeded, path),
            data: () => mock.rows.get(path) ?? seeded[path],
          }),
          path,
        };
      },
    }),
    runTransaction: async (work: (transaction: any) => Promise<unknown>) =>
      work({
        get: async (ref: { path: string }) => ({
          exists: mock.rows.has(ref.path),
          data: () => mock.rows.get(ref.path),
        }),
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          if (mock.rows.has(ref.path)) throw new Error("already exists");
          mock.rows.set(ref.path, data);
        },
      }),
  },
}));

import { POST } from "./route";

const request = (body: object) =>
  new NextRequest("http://localhost/api/guard/patrol", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("guard patrol lost-ack replay", () => {
  beforeEach(() => {
    mock.rows.clear();
    mock.next = 0;
    mock.guard.mockResolvedValue({
      uid: "uid-1",
      employeeDocId: "employee-1",
      employeeId: "E-1",
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T04:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("replays a committed patrol after the 15-minute window without another write", async () => {
    const body = {
      type: "patrol",
      siteId: "site-1",
      activityAt: "2026-10-19T04:00:00.000Z",
      clientRequestId: "10000000-1000-4000-8000-000000000001",
    };

    const first = await POST(request(body));
    vi.setSystemTime(new Date("2026-10-19T04:16:00.000Z"));
    const replay = await POST(request(body));
    if (!first || !replay)
      throw new Error("Patrol route did not return a response.");

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(
      [...mock.rows.keys()].filter((key) =>
        key.startsWith("guardPatrolActivities/"),
      ).length,
    ).toBe(1);
  });
});
