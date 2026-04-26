import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export const runtime = "nodejs";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const currentExamName = typeof body.examName === "string" ? body.examName.trim() : "";
    const currentExamCode = typeof body.examCode === "string" ? body.examCode.trim() : "";
    const nextExamName = typeof body.newExamName === "string" ? body.newExamName.trim().replace(/\s+/g, " ") : "";
    const nextExamCode = slugify(nextExamName);

    if (!currentExamName && !currentExamCode) {
      return NextResponse.json({ error: "Current exam name or code is required." }, { status: 400 });
    }
    if (!nextExamName || !nextExamCode) {
      return NextResponse.json({ error: "New exam name is required." }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const workOrderRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    const importRefs = new Map<string, FirebaseFirestore.DocumentReference>();

    if (currentExamCode) {
      const workOrdersByCode = await adminDb
        .collection("workOrders")
        .where("examCode", "==", currentExamCode)
        .get();
      workOrdersByCode.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        workOrderRefs.set(doc.id, doc.ref);
      });

      const importsByCode = await adminDb
        .collection("workOrderImports")
        .where("examCode", "==", currentExamCode)
        .get();
      importsByCode.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        importRefs.set(doc.id, doc.ref);
      });
    }

    if (currentExamName) {
      const workOrdersByName = await adminDb
        .collection("workOrders")
        .where("examName", "==", currentExamName)
        .get();
      workOrdersByName.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        workOrderRefs.set(doc.id, doc.ref);
      });

      const importsByName = await adminDb
        .collection("workOrderImports")
        .where("examName", "==", currentExamName)
        .get();
      importsByName.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        importRefs.set(doc.id, doc.ref);
      });
    }

    if (workOrderRefs.size === 0 && importRefs.size === 0) {
      return NextResponse.json({ error: "No work orders found for this exam." }, { status: 404 });
    }

    let batch = adminDb.batch();
    let operationCount = 0;
    const commitIfNeeded = async () => {
      if (operationCount >= 450) {
        await batch.commit();
        batch = adminDb.batch();
        operationCount = 0;
      }
    };

    for (const ref of workOrderRefs.values()) {
      batch.update(ref, {
        examName: nextExamName,
        examCode: nextExamCode,
      });
      operationCount += 1;
      await commitIfNeeded();
    }

    for (const ref of importRefs.values()) {
      batch.update(ref, {
        examName: nextExamName,
        examCode: nextExamCode,
      });
      operationCount += 1;
      await commitIfNeeded();
    }

    if (operationCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      examName: nextExamName,
      examCode: nextExamCode,
      updated: workOrderRefs.size,
      importsUpdated: importRefs.size,
      message: `Renamed ${workOrderRefs.size} work order(s) and ${importRefs.size} import record(s) to ${nextExamName}.`,
    });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Exam rename failed" },
      { status: 500 },
    );
  }
}
