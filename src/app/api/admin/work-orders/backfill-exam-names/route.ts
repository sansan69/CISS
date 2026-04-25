import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export const runtime = "nodejs";

interface ImportDoc {
  id: string;
  examName?: string;
  examCode?: string;
  fileName?: string;
}

function cleanExamNameFromFilename(fileName: string): string {
  let name = fileName.replace(/\.[^/.]+$/, "");
  name = name.replace(/^(exam[_\s-]?duty[_\s-]?)/i, "");
  name = name.replace(/^(tcs[_\s-]?exam[_\s-]?duty[_\s-]?)/i, "");
  name = name.replace(/^(tcs[_\s-]?)/i, "");
  name = name.replace(/^(duty[_\s-]?)/i, "");
  name = name.replace(/\s*[\(\[].*?[\)\]]\s*$/, "");
  name = name.replace(/[_-]+/g, " ");
  name = name.trim();
  if (!name) return "";
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// POST /api/admin/work-orders/backfill-exam-names
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // 1. Fetch all imports
    const importsSnapshot = await adminDb.collection("workOrderImports").get();
    const imports = new Map<string, ImportDoc>();
    importsSnapshot.forEach((doc) => {
      const data = doc.data();
      imports.set(doc.id, {
        id: doc.id,
        examName: data.examName || "",
        examCode: data.examCode || "",
        fileName: data.fileName || "",
      });
    });

    // 2. Iterate workOrders and backfill
    let totalUpdated = 0;
    let totalScanned = 0;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let hasMore = true;
    const updated: { id: string; siteName: string; oldExam: string; newExam: string; source: string }[] = [];

    while (hasMore) {
      let q: FirebaseFirestore.Query = adminDb.collection("workOrders").limit(500);
      if (lastDoc) {
        q = q.startAfter(lastDoc);
      }

      const snapshot = await q.get();
      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      const batch = adminDb.batch();
      let batchCount = 0;

      snapshot.docs.forEach((doc) => {
        totalScanned++;
        const data = doc.data();
        const existingExam = data.examName || "";

        if (existingExam && existingExam.trim().length > 0) {
          return;
        }

        let newExamName = "";
        let source = "";

        const importId = data.importId;
        if (importId && imports.has(importId)) {
          const imp = imports.get(importId)!;
          newExamName = imp.examName || imp.examCode || "";
          source = `import:${imp.fileName || importId}`;
        }

        if (!newExamName && data.sourceFileName) {
          newExamName = cleanExamNameFromFilename(data.sourceFileName as string);
          source = `filename:${data.sourceFileName}`;
        }

        if (newExamName) {
          batch.update(doc.ref, { examName: newExamName });
          batchCount++;
          updated.push({
            id: doc.id,
            siteName: data.siteName || "",
            oldExam: existingExam || "(empty)",
            newExam: newExamName,
            source,
          });
        }
      });

      if (batchCount > 0) {
        await batch.commit();
        totalUpdated += batchCount;
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < 500) {
        hasMore = false;
      }
    }

    return NextResponse.json({
      success: true,
      scanned: totalScanned,
      updated: totalUpdated,
      details: updated.slice(0, 100), // Limit response size
    });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Backfill failed" },
      { status: 500 }
    );
  }
}
