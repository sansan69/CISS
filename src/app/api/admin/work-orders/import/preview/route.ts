import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { parseTcsExamWorkbook } from "@/lib/work-orders/tcs-exam-parser";
import {
  buildBinaryFileHash,
  buildTcsExamContentHash,
} from "@/lib/work-orders/tcs-exam-hash";
import { buildTcsExamDiff } from "@/lib/work-orders/tcs-exam-diff";
import type {
  TcsExamExistingWorkOrder,
  TcsExamImportPreviewPayload,
  TcsExamSourceRow,
  WorkOrderImportDuplicateState,
  WorkOrderImportMode,
} from "@/types/work-orders";

export const runtime = "nodejs";

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

type FirestoreTimestampLike = {
  toDate?: () => Date;
};

function normalizeMode(value: FormDataEntryValue | null): WorkOrderImportMode {
  return value === "revision" ? "revision" : "new";
}

function normalizeRecordStatus(value: unknown): string {
  return String(value ?? "active").trim().toLowerCase();
}

function isActiveRecordStatus(value: unknown): boolean {
  return normalizeRecordStatus(value) === "active";
}

function normalizeSegment(value: string | number | undefined | null): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasConcreteSiteId(row: {
  siteId?: string;
}) {
  return normalizeSegment(row.siteId) !== "";
}

function getIdentityKey(row: {
  siteId?: string;
  siteName: string;
  district: string;
  date: string;
  examCode?: string;
}) {
  const siteKey = hasConcreteSiteId(row)
    ? `site-id:${normalizeSegment(row.siteId)}`
    : `site-fallback:${normalizeSegment(row.siteName)}|district:${normalizeSegment(row.district)}`;

  return `${siteKey}|date:${row.date.trim().toLowerCase()}|exam:${String(
    row.examCode ?? "",
  )
    .trim()
    .toLowerCase()}`;
}

function getFallbackIdentityKey(row: {
  siteName: string;
  district: string;
  date: string;
  examCode?: string;
}) {
  return `site-fallback:${normalizeSegment(row.siteName)}|district:${normalizeSegment(
    row.district,
  )}|date:${normalizeSegment(row.date)}|exam:${normalizeSegment(row.examCode)}`;
}

function findMatchingExistingRow(
  parsedRow: TcsExamSourceRow,
  existingRows: readonly TcsExamExistingWorkOrder[],
) {
  if (hasConcreteSiteId(parsedRow)) {
    const exactMatch = existingRows.find(
      (row) => hasConcreteSiteId(row) && getIdentityKey(row) === getIdentityKey(parsedRow),
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  const fallbackKey = getFallbackIdentityKey(parsedRow);
  return existingRows.find((row) => {
    if (hasConcreteSiteId(parsedRow) && hasConcreteSiteId(row)) {
      return false;
    }
    return getFallbackIdentityKey(row) === fallbackKey;
  });
}

function hasIdentityOverlap(
  parsedRows: readonly TcsExamSourceRow[],
  existingRows: readonly TcsExamExistingWorkOrder[],
) {
  return parsedRows.some((row) => Boolean(findMatchingExistingRow(row, existingRows)));
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (value && typeof (value as FirestoreTimestampLike).toDate === "function") {
    const converted = (value as FirestoreTimestampLike).toDate?.();
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
      return converted;
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function toIsoDate(value: unknown): string {
  const parsed = toDateValue(value);
  if (!parsed) {
    return "";
  }

  return IST_DATE_FORMATTER.format(parsed);
}

async function fetchExistingRows(
  adminDb: {
    collection: (name: string) => {
      get: () => Promise<{
        docs: Array<{ id: string; data: () => Record<string, unknown> }>;
      }>;
    };
  },
  parsedRows: readonly TcsExamSourceRow[],
): Promise<TcsExamExistingWorkOrder[]> {
  if (parsedRows.length === 0) {
    return [];
  }

  const workOrdersSnapshot = await adminDb.collection("workOrders").get();

  const relevantExamCodes = new Set(parsedRows.map((row) => row.examCode ?? "").filter(Boolean));

  return workOrdersSnapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        siteId: typeof data.siteId === "string" ? data.siteId : undefined,
        siteName: String(data.siteName ?? ""),
        district: String(data.district ?? ""),
        date: toIsoDate(data.date),
        examName: typeof data.examName === "string" ? data.examName : undefined,
        examCode: String(data.examCode ?? ""),
        maleGuardsRequired: Number(data.maleGuardsRequired ?? 0),
        femaleGuardsRequired: Number(data.femaleGuardsRequired ?? 0),
        totalManpower: Number(data.totalManpower ?? 0),
        recordStatus: normalizeRecordStatus(data.recordStatus),
      } satisfies TcsExamExistingWorkOrder;
    })
    .filter((row) => row.date !== "")
    .filter((row) =>
      relevantExamCodes.size === 0 ? true : relevantExamCodes.has(row.examCode),
    );
}

async function detectDuplicateState(
  adminDb: {
    collection: (name: string) => {
      where: (field: string, op: "==", value: unknown) => any;
      limit: (count: number) => any;
      get: () => Promise<{ empty: boolean }>;
    };
  },
  binaryFileHash: string,
  contentHash: string,
  parsedRows: readonly TcsExamSourceRow[],
  existingRows: readonly TcsExamExistingWorkOrder[],
): Promise<{
  duplicateState: WorkOrderImportDuplicateState;
  duplicateMessage?: string;
}> {
  const binaryDuplicateSnap = await adminDb
    .collection("workOrderImports")
    .where("binaryFileHash", "==", binaryFileHash)
    .limit(1)
    .get();
  if (!binaryDuplicateSnap.empty) {
    return {
      duplicateState: "binary-duplicate",
      duplicateMessage: "This exact workbook file has already been imported.",
    };
  }

  const contentDuplicateSnap = await adminDb
    .collection("workOrderImports")
    .where("contentHash", "==", contentHash)
    .limit(1)
    .get();
  if (!contentDuplicateSnap.empty) {
    return {
      duplicateState: "content-duplicate",
      duplicateMessage: "A prior import already contains the same normalized TCS exam rows.",
    };
  }

  const hasOverlap = hasIdentityOverlap(
    parsedRows,
    existingRows.filter((row) => isActiveRecordStatus(row.recordStatus)),
  );
  if (hasOverlap) {
    return {
      duplicateState: "overlap",
      duplicateMessage:
        "Active TCS exam work orders already exist for this exam/date range. Use revision mode if you intend to cancel missing rows.",
    };
  }

  return { duplicateState: "none" };
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A workbook file is required." },
        { status: 400 },
      );
    }

    const mode = normalizeMode(formData.get("mode"));
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(fileBuffer, {
      type: "buffer",
      cellDates: true,
    });
    const parseResult = parseTcsExamWorkbook(workbook, file.name);
    const binaryFileHash = buildBinaryFileHash(fileBuffer);
    const contentHash = buildTcsExamContentHash(
      parseResult.suggestedExamCode,
      parseResult.rows.map((row) => ({
        siteId: row.siteId,
        siteName: row.siteName,
        district: row.district,
        date: row.date,
        examCode: row.examCode ?? parseResult.suggestedExamCode,
        maleGuardsRequired: row.maleGuardsRequired,
        femaleGuardsRequired: row.femaleGuardsRequired,
      })),
    );

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const existingRows = await fetchExistingRows(adminDb, parseResult.rows);
    const activeExistingRows = existingRows.filter((row) =>
      isActiveRecordStatus(row.recordStatus),
    );
    const diffRows = buildTcsExamDiff({
      parsedRows: parseResult.rows,
      existingRows: activeExistingRows,
      mode,
    });
    const duplicate = await detectDuplicateState(
      adminDb,
      binaryFileHash,
      contentHash,
      parseResult.rows,
      existingRows,
    );

    const payload: TcsExamImportPreviewPayload = {
      ...parseResult,
      mode,
      binaryFileHash,
      contentHash,
      duplicateState: duplicate.duplicateState,
      duplicateMessage: duplicate.duplicateMessage,
      diffRows,
    };

    return NextResponse.json(payload);
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    if (
      error?.message?.includes("Missing bearer") ||
      error?.message?.includes("token")
    ) {
      return unauthorizedResponse(error.message, 401);
    }
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
