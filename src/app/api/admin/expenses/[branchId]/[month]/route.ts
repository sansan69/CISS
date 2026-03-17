import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";
import type { ExpenseEntry } from "@/types/branch";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ branchId: string; month: string }> }
) {
  try {
    await requireAdmin(request);
    const { branchId, month } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb
      .collection("branchExpenses")
      .where("branchId", "==", branchId)
      .where("month", "==", month)
      .limit(1)
      .get();

    if (snapshot.empty) {
      // Return empty sheet structure
      return NextResponse.json({
        expense: {
          branchId,
          month,
          entries: [],
          totalAmount: 0,
          status: "draft",
        },
      });
    }

    const doc = snapshot.docs[0];
    return NextResponse.json({ expense: { id: doc.id, ...doc.data() } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ branchId: string; month: string }> }
) {
  try {
    const decoded = await requireAdmin(request);
    const { branchId, month } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const body = (await request.json()) as {
      entries?: ExpenseEntry[];
      status?: string;
    };

    const entries: ExpenseEntry[] = body.entries ?? [];
    const totalAmount = entries.reduce((sum, e) => sum + (e.amount ?? 0), 0);

    // Look up branch for stateCode
    const branchDoc = await adminDb.collection("branches").doc(branchId).get();
    const stateCode = branchDoc.exists ? (branchDoc.data()?.stateCode ?? "KL") : "KL";

    const snapshot = await adminDb
      .collection("branchExpenses")
      .where("branchId", "==", branchId)
      .where("month", "==", month)
      .limit(1)
      .get();

    if (snapshot.empty) {
      const docRef = await adminDb.collection("branchExpenses").add({
        branchId,
        stateCode,
        month,
        enteredBy: decoded.uid,
        entries,
        totalAmount,
        status: body.status ?? "draft",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ id: docRef.id, totalAmount }, { status: 201 });
    } else {
      const doc = snapshot.docs[0];
      await doc.ref.update({
        entries,
        totalAmount,
        status: body.status ?? doc.data().status,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ id: doc.id, totalAmount });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
