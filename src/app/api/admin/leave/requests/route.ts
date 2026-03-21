import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  requireAdminOrFieldOfficer,
  verifyRequestAuth,
} from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const employeeId = searchParams.get("employeeId");
    const managedBy = searchParams.get("managedBy");
    const period = searchParams.get("period");

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const isAdmin = hasAdminAccess(decoded);

    // Keep this query index-light for now so the leave dashboard works in fresh regions
    // before every composite index is deployed.
    let query = adminDb.collection("leaveRequests").limit(500) as FirebaseFirestore.Query;

    if (!isAdmin) {
      query = query.where("managedBy", "==", decoded.uid);
    } else if (managedBy) {
      query = query.where("managedBy", "==", managedBy);
    }

    const snapshot = await query.get();
    let requests = snapshot.docs.map(
      (d) =>
        ({
          id: d.id,
          ...d.data(),
        }) as {
          id: string;
          status?: string;
          employeeId?: string;
          fromDate?: { seconds?: number } | string;
          createdAt?: { seconds?: number };
        },
    );

    if (status) {
      requests = requests.filter((item) => item.status === status);
    }

    if (employeeId) {
      requests = requests.filter((item) => item.employeeId === employeeId);
    }

    if (period) {
      const [year, month] = period.split("-").map(Number);
      const start = new Date(year, month - 1, 1).getTime();
      const end = new Date(year, month, 0, 23, 59, 59).getTime();

      requests = requests.filter((item) => {
        const raw = item.fromDate as { seconds?: number } | string | undefined;
        const ts =
          typeof raw === "string"
            ? new Date(raw).getTime()
            : raw?.seconds
              ? raw.seconds * 1000
              : NaN;
        return Number.isFinite(ts) && ts >= start && ts <= end;
      });
    }

    requests = requests
      .sort((a, b) => {
        const aSeconds = (a.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        const bSeconds = (b.createdAt as { seconds?: number } | undefined)?.seconds ?? 0;
        return bSeconds - aSeconds;
      })
      .slice(0, 200);

    return NextResponse.json({ requests });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: message === "Admin access required." ? 403 : 401 });
  }
}

export async function POST(request: Request) {
  try {
    const decoded = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
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

    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return NextResponse.json({ error: "Field officer or admin access required." }, { status: 403 });
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
