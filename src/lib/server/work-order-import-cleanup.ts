type FirestoreLike = {
  batch: () => {
    delete: (ref: any) => unknown;
    commit: () => Promise<unknown>;
  };
  collection: (name: string) => {
    doc: (id: string) => {
      get: () => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
        ref?: unknown;
      }>;
    };
    where: (field: string, op: "==", value: unknown) => {
      get: () => Promise<{
        docs: Array<{
          id: string;
          ref?: unknown;
          data: () => Record<string, unknown>;
        }>;
      }>;
    };
  };
};

type WorkOrderImportCandidate = {
  id: string;
  ref: unknown;
  data: Record<string, unknown>;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isActiveRecordStatus(value: unknown): boolean {
  return String(value ?? "active").trim().toLowerCase() === "active";
}

function hasActiveDocs(
  docs: Array<{ data: () => Record<string, unknown> }>,
): boolean {
  return docs.some((doc) => isActiveRecordStatus(doc.data().recordStatus));
}

async function queryActiveWorkOrders(
  adminDb: FirestoreLike,
  field: "importId" | "binaryFileHash" | "contentHash",
  value: string,
): Promise<boolean> {
  if (!value) return false;
  const snapshot = await adminDb
    .collection("workOrders")
    .where(field, "==", value)
    .get();
  return hasActiveDocs(snapshot.docs);
}

async function addImportById(
  adminDb: FirestoreLike,
  imports: Map<string, WorkOrderImportCandidate>,
  importId: string,
) {
  if (!importId || imports.has(importId)) return;
  const ref = adminDb.collection("workOrderImports").doc(importId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  imports.set(importId, {
    id: importId,
    ref: snapshot.ref ?? ref,
    data: snapshot.data() ?? {},
  });
}

async function addImportsByHash(
  adminDb: FirestoreLike,
  imports: Map<string, WorkOrderImportCandidate>,
  field: "binaryFileHash" | "contentHash",
  hash: string,
) {
  if (!hash) return;
  const snapshot = await adminDb
    .collection("workOrderImports")
    .where(field, "==", hash)
    .get();
  for (const doc of snapshot.docs) {
    imports.set(doc.id, {
      id: doc.id,
      ref: doc.ref ?? adminDb.collection("workOrderImports").doc(doc.id),
      data: doc.data(),
    });
  }
}

export async function cleanupOrphanWorkOrderImports(
  adminDb: FirestoreLike,
  deletedWorkOrders: Array<Record<string, unknown>>,
): Promise<number> {
  const importIds = new Set<string>();
  const binaryHashes = new Set<string>();
  const contentHashes = new Set<string>();

  for (const row of deletedWorkOrders) {
    const importId = stringValue(row.importId);
    const binaryFileHash = stringValue(row.binaryFileHash);
    const contentHash = stringValue(row.contentHash);
    if (importId) importIds.add(importId);
    if (binaryFileHash) binaryHashes.add(binaryFileHash);
    if (contentHash) contentHashes.add(contentHash);
  }

  const imports = new Map<string, WorkOrderImportCandidate>();
  for (const importId of importIds) {
    await addImportById(adminDb, imports, importId);
  }
  for (const hash of binaryHashes) {
    await addImportsByHash(adminDb, imports, "binaryFileHash", hash);
  }
  for (const hash of contentHashes) {
    await addImportsByHash(adminDb, imports, "contentHash", hash);
  }

  let batch = adminDb.batch();
  let operationCount = 0;
  let deleted = 0;

  for (const importRecord of imports.values()) {
    const importId = importRecord.id;
    const binaryFileHash = stringValue(importRecord.data.binaryFileHash);
    const contentHash = stringValue(importRecord.data.contentHash);

    const hasActiveRows =
      (await queryActiveWorkOrders(adminDb, "importId", importId)) ||
      (await queryActiveWorkOrders(adminDb, "binaryFileHash", binaryFileHash)) ||
      (await queryActiveWorkOrders(adminDb, "contentHash", contentHash));

    if (hasActiveRows) continue;

    batch.delete(importRecord.ref);
    operationCount += 1;
    deleted += 1;

    if (operationCount >= 450) {
      await batch.commit();
      batch = adminDb.batch();
      operationCount = 0;
    }
  }

  if (operationCount > 0) {
    await batch.commit();
  }

  return deleted;
}
