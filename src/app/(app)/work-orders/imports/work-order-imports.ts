import {
  collection,
  limit,
  orderBy,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
  where,
  type Firestore,
  type Query,
} from "firebase/firestore";

import { OPERATIONAL_CLIENT_NAME } from "../../../../lib/constants";
import { db as defaultDb } from "../../../../lib/firebase";

export type FirestoreTimestampLike =
  | { toDate: () => Date }
  | { seconds: number; nanoseconds?: number }
  | Date
  | null
  | undefined;

export type WorkOrderImportRecord = {
  id: string;
  clientName?: string;
  examName?: string;
  fileName?: string;
  status?: string;
  mode?: string;
  parserMode?: string;
  dateRange?: {
    from?: string;
    to?: string;
  };
  siteCount?: number;
  rowCount?: number;
  committedRows?: number;
  cancelledRows?: number;
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
};

type QueryFactories = {
  db?: Firestore;
  collectionFn?: typeof collection;
  whereFn?: typeof where;
  orderByFn?: typeof orderBy;
  limitFn?: typeof limit;
  queryFn?: typeof query;
};

type SnapshotLike = {
  docs: Array<{
    id: string;
    data: () => DocumentData;
  }>;
};

function getSnapshotData(doc: QueryDocumentSnapshot<DocumentData>): WorkOrderImportRecord {
  const data = doc.data();
  return {
    id: doc.id,
    clientName: typeof data.clientName === "string" ? data.clientName : undefined,
    examName: typeof data.examName === "string" ? data.examName : undefined,
    fileName: typeof data.fileName === "string" ? data.fileName : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    mode: typeof data.mode === "string" ? data.mode : undefined,
    parserMode: typeof data.parserMode === "string" ? data.parserMode : undefined,
    dateRange:
      data.dateRange && typeof data.dateRange === "object"
        ? {
            from: typeof data.dateRange.from === "string" ? data.dateRange.from : undefined,
            to: typeof data.dateRange.to === "string" ? data.dateRange.to : undefined,
          }
        : undefined,
    siteCount: typeof data.siteCount === "number" ? data.siteCount : undefined,
    rowCount: typeof data.rowCount === "number" ? data.rowCount : undefined,
    committedRows: typeof data.committedRows === "number" ? data.committedRows : undefined,
    cancelledRows: typeof data.cancelledRows === "number" ? data.cancelledRows : undefined,
    createdAt: data.createdAt as FirestoreTimestampLike,
    updatedAt: data.updatedAt as FirestoreTimestampLike,
  };
}

export function buildTcsWorkOrderImportsQuery({
  db = defaultDb,
  collectionFn = collection,
  whereFn = where,
  orderByFn = orderBy,
  limitFn = limit,
  queryFn = query,
}: QueryFactories = {}): Query<DocumentData> {
  return queryFn(
    collectionFn(db, "workOrderImports"),
    whereFn("clientName", "==", OPERATIONAL_CLIENT_NAME),
    orderByFn("createdAt", "desc"),
    limitFn(25),
  );
}

export function normalizeTcsWorkOrderImportRecords(snapshot: SnapshotLike): WorkOrderImportRecord[] {
  return snapshot.docs
    .map((doc) => getSnapshotData(doc as QueryDocumentSnapshot<DocumentData>))
    .filter((record) => (record.clientName ?? OPERATIONAL_CLIENT_NAME) === OPERATIONAL_CLIENT_NAME);
}
