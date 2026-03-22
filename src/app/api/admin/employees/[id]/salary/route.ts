import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id: employeeId } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const doc = await adminDb.collection("employeeSalaries").doc(employeeId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ id: doc.id, ...doc.data() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await requireAdmin(request);
    const { id: employeeId } = await params;
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

    const now = new Date().toISOString();
    const existing = await adminDb.collection("employeeSalaries").doc(employeeId).get();
    const prevHistory = existing.exists ? (existing.data()?.history ?? []) : [];

    const historyEntry = {
      date: now,
      by: decoded.uid,
      changes: `Updated salary: grossMonthly=${body.grossMonthly ?? "unchanged"}`,
    };

    await adminDb.collection("employeeSalaries").doc(employeeId).set(
      {
        ...body,
        employeeId,
        effectiveFrom: body.effectiveFrom
          ? Timestamp.fromDate(new Date(body.effectiveFrom))
          : existing.data()?.effectiveFrom ?? FieldValue.serverTimestamp(),
        updatedBy: decoded.uid,
        updatedAt: FieldValue.serverTimestamp(),
        history: [...prevHistory, historyEntry].slice(-25),
        createdAt: existing.exists
          ? existing.data()?.createdAt
          : FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
