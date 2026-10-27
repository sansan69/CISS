import { afterEach, describe, expect, it, vi } from "vitest";

const proofs = new Map<string, Record<string, unknown>>();

function mockFirestore() {
  const db = {
    collection: () => ({
      doc: (id: string) => ({
        id,
        set: vi.fn(async (value: Record<string, unknown>) => {
          proofs.set(id, value);
        }),
      }),
    }),
    runTransaction: async (
      fn: (transaction: {
        get: (ref: { id: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        delete: (ref: { id: string }) => void;
      }) => Promise<boolean>,
    ) =>
      fn({
        get: async (ref) => ({
          exists: proofs.has(ref.id),
          data: () => proofs.get(ref.id),
        }),
        delete: (ref) => {
          proofs.delete(ref.id);
        },
      }),
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("firebase-admin/firestore", () => ({
    Timestamp: {
      now: () => ({ toMillis: () => Date.now() }),
      fromMillis: (millis: number) => ({ toMillis: () => millis }),
    },
  }));
}

afterEach(() => {
  proofs.clear();
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("firebase-admin/firestore");
});

describe("attendance proof store", () => {
  const payload = {
    employeeDocId: "employee-a",
    method: "employeeId" as const,
    actorUid: "actor-b",
    nonce: "nonce-1",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  it("accepts a proof exactly once and reports the second attempt as used", async () => {
    mockFirestore();
    const { registerAttendanceProof, consumeAttendanceProof } = await import(
      "./attendance-proofs"
    );

    expect(await registerAttendanceProof(payload)).toBe(true);

    expect(
      await consumeAttendanceProof({
        nonce: payload.nonce,
        employeeDocId: payload.employeeDocId,
        actorUid: payload.actorUid,
      }),
    ).toBe(true);

    expect(
      await consumeAttendanceProof({
        nonce: payload.nonce,
        employeeDocId: payload.employeeDocId,
        actorUid: payload.actorUid,
      }),
    ).toBe(false);
  });

  it("refuses a proof bound to a different actor", async () => {
    mockFirestore();
    const { registerAttendanceProof, consumeAttendanceProof } = await import(
      "./attendance-proofs"
    );
    await registerAttendanceProof(payload);

    expect(
      await consumeAttendanceProof({
        nonce: payload.nonce,
        employeeDocId: payload.employeeDocId,
        actorUid: "another-actor",
      }),
    ).toBe(false);
  });

  it("refuses a proof bound to a different subject", async () => {
    mockFirestore();
    const { registerAttendanceProof, consumeAttendanceProof } = await import(
      "./attendance-proofs"
    );
    await registerAttendanceProof(payload);

    expect(
      await consumeAttendanceProof({
        nonce: payload.nonce,
        employeeDocId: "employee-b",
        actorUid: payload.actorUid,
      }),
    ).toBe(false);
  });

  it("refuses an unknown nonce", async () => {
    mockFirestore();
    const { consumeAttendanceProof } = await import("./attendance-proofs");

    expect(
      await consumeAttendanceProof({
        nonce: "missing",
        employeeDocId: "employee-a",
        actorUid: null,
      }),
    ).toBe(false);
  });
});
