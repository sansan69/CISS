import { NextResponse } from "next/server";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export const runtime = "nodejs";

function toIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb
      .collection("workOrderImports")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const imports = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        const fallbackFileName =
          typeof data.fileName === "string" && data.fileName.trim()
            ? data.fileName.trim()
            : "Imported workbook";
        return {
          id: doc.id,
          clientName: String(data.clientName ?? ""),
          packageId: String(data.packageId ?? data.examCode ?? ""),
          examName: String(data.examName ?? data.examCode ?? "Exam duty"),
          examCode: String(data.examCode ?? ""),
          revisionNumber: Math.max(1, Number(data.revisionNumber ?? 1)),
          supersedesImportId:
            typeof data.supersedesImportId === "string" ? data.supersedesImportId : null,
          mode: data.mode === "revision" ? "revision" : "new",
          status: String(data.status ?? "committed"),
          fileNames:
            Array.isArray(data.fileNames) && data.fileNames.length > 0
              ? data.fileNames.filter((name): name is string => typeof name === "string")
              : [fallbackFileName],
          parserMode: String(data.parserMode ?? ""),
          dateRange:
            data.dateRange && typeof data.dateRange === "object"
              ? {
                  from: String((data.dateRange as { from?: unknown }).from ?? ""),
                  to: String((data.dateRange as { to?: unknown }).to ?? ""),
                }
              : { from: "", to: "" },
          siteCount: Number(data.siteCount ?? 0),
          rowCount: Number(data.rowCount ?? 0),
          totalMale: Number(data.totalMale ?? 0),
          totalFemale: Number(data.totalFemale ?? 0),
          committedRows: Number(data.committedRows ?? 0),
          cancelledRows: Number(data.cancelledRows ?? 0),
          warnings: Array.isArray(data.warnings) ? data.warnings.length : 0,
          createdAt: toIso(data.createdAt),
          createdByEmail: String(data.createdByEmail ?? data.createdBy?.email ?? ""),
        };
      })
      .filter((record) => record.clientName === OPERATIONAL_CLIENT_NAME);

    return NextResponse.json({ imports });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load import history.";
    if (message.includes("access required")) {
      return unauthorizedResponse(message, 403);
    }
    if (message.includes("Missing bearer") || message.includes("token")) {
      return unauthorizedResponse(message, 401);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
