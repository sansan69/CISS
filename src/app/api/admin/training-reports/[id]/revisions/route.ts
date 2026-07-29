import { NextResponse } from "next/server";

import { hasFieldOfficerAccess, verifyRequestAuth } from "@/lib/server/auth";
import { createReportRevision } from "@/lib/reports/report-revision";
import { ReportApiError } from "@/lib/reports/report-server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasFieldOfficerAccess(decoded)) {
      return NextResponse.json({ error: "Field officer access required." }, { status: 403 });
    }
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const revision = await createReportRevision({
      adminDb,
      decoded,
      reportId: id,
      collectionName: "foTrainingReports",
      reportType: "training",
    });
    return NextResponse.json(revision, { status: 201 });
  } catch (error: unknown) {
    const status = error instanceof ReportApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not create revision.";
    return NextResponse.json({ error: message }, { status });
  }
}
