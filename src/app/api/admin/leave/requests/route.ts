import { NextResponse } from "next/server";
import { verifyRequestAuth } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const employeeId = searchParams.get("employeeId");
    const managedBy = searchParams.get("managedBy");
    const period = searchParams.get("period");

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const isAdmin =
      decoded.admin === true ||
      decoded.role === "admin";

    let query = adminDb.collection("leaveRequests") as FirebaseFirestore.Query;

    // Field officers only see their managed leaves
    if (!isAdmin) {
      query = query.where("managedBy", "==", decoded.uid);
    } else if (managedBy) {
      query = query.where("managedBy", "==", managedBy);
    }

    if (status) query = query.where("status", "==", status);
    if (employeeId) query = query.where("employeeId", "==", employeeId);
    if (period) {
      // filter by month: fromDate within the period
      const [year, month] = period.split("-").map(Number);
      const { Timestamp } = await import("firebase-admin/firestore");
      const start = Timestamp.fromDate(new Date(year, month - 1, 1));
      const end = Timestamp.fromDate(new Date(year, month, 0, 23, 59, 59));
      query = query.where("fromDate", ">=", start).where("fromDate", "<=", end);
    }

    const snapshot = await query.orderBy("createdAt", "desc").limit(200).get();
    const requests = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ requests });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const body = await request.json();
    const {
      employeeId,
      employeeName,
      employeeCode,
      clientId,
      clientName,
      district,
      type,
      fromDate,
      toDate,
      days,
      reason,
    } = body;

    if (!employeeId || !type || !fromDate || !toDate || !days || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");

    const ref = await adminDb.collection("leaveRequests").add({
      employeeId,
      employeeName: employeeName ?? "",
      employeeCode: employeeCode ?? "",
      clientId: clientId ?? "",
      clientName: clientName ?? "",
      district: district ?? "",
      managedBy: decoded.uid,
      type,
      fromDate: Timestamp.fromDate(new Date(fromDate)),
      toDate: Timestamp.fromDate(new Date(toDate)),
      days,
      reason,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id, success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
