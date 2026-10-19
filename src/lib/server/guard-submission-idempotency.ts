import { createHash } from "node:crypto";

type DocumentRef = { id: string };
type Transaction = {
  get(
    ref: DocumentRef,
  ): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  create(ref: DocumentRef, data: Record<string, unknown>): void;
};
type FirestoreLike = {
  collection(name: string): {
    doc(id?: string): DocumentRef & {
      get?(): Promise<{
        exists: boolean;
        data(): Record<string, unknown> | undefined;
      }>;
    };
  };
  runTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "createdAt" && key !== "updatedAt")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function findGuardSubmission({
  db,
  collectionName,
  ownerId,
  idempotencyKey,
  fingerprintData,
}: {
  db: FirestoreLike;
  collectionName: string;
  ownerId: string;
  idempotencyKey?: string | null;
  fingerprintData: Record<string, unknown>;
}): Promise<{ id: string; conflict: boolean } | null> {
  if (!idempotencyKey) return null;
  const receiptId = digest(
    `${collectionName}\u0000${ownerId}\u0000${idempotencyKey}`,
  );
  const receiptRef = db.collection("guardSubmissionReceipts").doc(receiptId);
  if (!receiptRef.get) return null;
  const receipt = await receiptRef.get();
  if (!receipt.exists) return null;
  const saved = receipt.data() ?? {};
  if (saved.collectionName !== collectionName || saved.ownerId !== ownerId)
    return null;
  const fingerprint = digest(JSON.stringify(stableValue(fingerprintData)));
  return {
    id: String(saved.recordId ?? ""),
    conflict: saved.fingerprint !== fingerprint,
  };
}

export async function createGuardSubmission({
  db,
  collectionName,
  ownerId,
  idempotencyKey,
  data,
  fingerprintData = data,
}: {
  db: FirestoreLike;
  collectionName: string;
  ownerId: string;
  idempotencyKey?: string | null;
  data: Record<string, unknown>;
  fingerprintData?: Record<string, unknown>;
}): Promise<{ id: string; created: boolean; conflict: boolean }> {
  const recordRef = db.collection(collectionName).doc();
  if (!idempotencyKey) {
    await db.runTransaction(async (transaction) => {
      transaction.create(recordRef, data);
    });
    return { id: recordRef.id, created: true, conflict: false };
  }

  const receiptId = digest(
    `${collectionName}\u0000${ownerId}\u0000${idempotencyKey}`,
  );
  const fingerprint = digest(JSON.stringify(stableValue(fingerprintData)));
  const receiptRef = db.collection("guardSubmissionReceipts").doc(receiptId);
  return db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      const saved = receipt.data() ?? {};
      return {
        id: String(saved.recordId ?? ""),
        created: false,
        conflict: saved.fingerprint !== fingerprint,
      };
    }
    transaction.create(recordRef, data);
    transaction.create(receiptRef, {
      ownerId,
      recordId: recordRef.id,
      collectionName,
      fingerprint,
    });
    return { id: recordRef.id, created: true, conflict: false };
  });
}
