import { describe, expect, it } from "vitest";
import {
  createGuardSubmission,
  findGuardSubmission,
} from "./guard-submission-idempotency";

function memoryDb() {
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const collection = (name: string) => ({
    doc: (id?: string) => {
      const docId = id ?? `new-${++nextId}`;
      const path = `${name}/${docId}`;
      return {
        path,
        id: docId,
        get: async () => ({
          exists: rows.has(path),
          data: () => rows.get(path),
        }),
      };
    },
  });
  return {
    rows,
    db: {
      collection,
      runTransaction: async <T>(fn: (tx: any) => Promise<T>) =>
        fn({
          get: async (ref: { path: string }) => ({
            exists: rows.has(ref.path),
            data: () => rows.get(ref.path),
          }),
          create: (ref: { path: string }, data: Record<string, unknown>) => {
            if (rows.has(ref.path)) throw new Error("already exists");
            rows.set(ref.path, data);
          },
        }),
    },
  };
}

describe("guard submission idempotency", () => {
  it("replays a lost acknowledgement without creating a second record", async () => {
    const { db, rows } = memoryDb();
    const input = {
      db,
      collectionName: "incidents",
      ownerId: "uid-1:employee-1",
      idempotencyKey: "request-1",
      data: {
        description: "Gate damaged",
        reporterEmployeeDocId: "employee-1",
      },
    };

    const first = await createGuardSubmission(input);
    const replay = await createGuardSubmission(input);

    expect(first.created).toBe(true);
    expect(replay).toEqual({ created: false, conflict: false, id: first.id });
    expect(
      [...rows.keys()].filter((key) => key.startsWith("incidents/")).length,
    ).toBe(1);
  });

  it("rejects reuse of a key for different content", async () => {
    const { db } = memoryDb();
    const base = {
      db,
      collectionName: "guardPatrolActivities",
      ownerId: "employee-1",
      idempotencyKey: "request-2",
      data: { notes: "North gate" },
    };

    await createGuardSubmission(base);
    const conflict = await createGuardSubmission({
      ...base,
      data: { notes: "South gate" },
    });

    expect(conflict).toMatchObject({ created: false, conflict: true });
  });

  it("scopes receipts to the authenticated owner", async () => {
    const { db, rows } = memoryDb();
    const first = await createGuardSubmission({
      db,
      collectionName: "incidents",
      ownerId: "employee-1",
      idempotencyKey: "shared-request",
      data: { description: "Same key" },
    });
    const second = await createGuardSubmission({
      db,
      collectionName: "incidents",
      ownerId: "uid-2:employee-1",
      idempotencyKey: "shared-request",
      data: { description: "Same key" },
    });

    expect(second.id).not.toBe(first.id);
    expect(
      [...rows.keys()].filter((key) => key.startsWith("incidents/")).length,
    ).toBe(2);

    const otherCollection = await createGuardSubmission({
      db,
      collectionName: "guardPatrolActivities",
      ownerId: "uid-1:employee-1",
      idempotencyKey: "shared-request",
      data: { description: "Same key" },
    });
    expect(otherCollection.id).not.toBe(first.id);
  });

  it("finds an accepted patrol receipt before mutable time-window checks", async () => {
    const { db } = memoryDb();
    const input = {
      db,
      collectionName: "guardPatrolActivities",
      ownerId: "uid-1:employee-1",
      idempotencyKey: "request-3",
      data: { activityAt: "2026-10-19T04:00:00.000Z", notes: "North gate" },
      fingerprintData: {
        activityAt: "2026-10-19T04:00:00.000Z",
        notes: "North gate",
      },
    };
    const created = await createGuardSubmission(input);
    const receipt = await findGuardSubmission(input);

    expect(receipt).toEqual({ id: created.id, conflict: false });
  });
});
