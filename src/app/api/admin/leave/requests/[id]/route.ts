import { NextResponse } from "next/server";
import { requireAdminOrFieldOfficer, verifyRequestAuth } from "@/lib/server/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { id } = await params;
    const body = await request.json();
    const { status, notes } = body as { status: "approved" | "rejected"; notes?: string };

    if (!status || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const leaveDoc = await adminDb.collection("leaveRequests").doc(id).get();
    if (!leaveDoc.exists) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }
    const leaveData = leaveDoc.data() as {
      employeeId?: string;
      fromDate?: { toDate?: () => Date };
      type?: "casual" | "sick" | "earned" | "unpaid";
      days?: number;
      status?: "pending" | "approved" | "rejected";
    };

    // Get approver display name
    const approverName = decoded.name ?? decoded.email ?? decoded.uid;

    await adminDb.collection("leaveRequests").doc(id).update({
      status,
      approvedBy: decoded.uid,
      approvedByName: approverName,
      respondedAt: FieldValue.serverTimestamp(),
      ...(notes ? { notes } : {}),
    });

    if (
      leaveData.employeeId &&
      leaveData.type &&
      leaveData.type !== "unpaid" &&
      leaveData.days &&
      leaveData.days > 0 &&
      leaveData.status !== status
    ) {
      const year = leaveData.fromDate?.toDate?.().getFullYear() ?? new Date().getFullYear();
      const balanceId = `${leaveData.employeeId}_${year}`;
      const balanceRef = adminDb.collection("leaveBalances").doc(balanceId);
      const balanceDoc = await balanceRef.get();
      const { FieldValue } = await import("firebase-admin/firestore");

      const defaults = {
        employeeId: leaveData.employeeId,
        year,
        casual: { entitled: 12, taken: 0, balance: 12 },
        sick: { entitled: 12, taken: 0, balance: 12 },
        earned: { entitled: 12, taken: 0, carried: 0 },
      };
      const current = balanceDoc.exists ? { ...defaults, ...balanceDoc.data() } : defaults;
      const leaveType = leaveData.type;
      const delta = leaveData.days;

      if (status === "approved") {
        if (leaveType === "earned") {
          current.earned.taken = Math.max(0, current.earned.taken + delta);
          current.earned.entitled = current.earned.entitled ?? 12;
          current.earned.carried = current.earned.carried ?? 0;
        } else if (leaveType === "casual" || leaveType === "sick") {
          current[leaveType].taken = Math.max(0, current[leaveType].taken + delta);
          current[leaveType].balance = Math.max(
            0,
            current[leaveType].entitled - current[leaveType].taken,
          );
        }
      } else if (leaveData.status === "approved" && status === "rejected") {
        if (leaveType === "earned") {
          current.earned.taken = Math.max(0, current.earned.taken - delta);
        } else if (leaveType === "casual" || leaveType === "sick") {
          current[leaveType].taken = Math.max(0, current[leaveType].taken - delta);
          current[leaveType].balance = Math.max(
            0,
            current[leaveType].entitled - current[leaveType].taken,
          );
        }
      }

      await balanceRef.set(
        {
          ...current,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
