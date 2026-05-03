import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

// ─────────────────────────────────────────────────────────────────────────────
// GET — fetch leave requests + balance
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const currentYear = new Date().getFullYear();

    // Fetch leave requests for this employee
    let requestsSnap = await adminDb
      .collection("leaveRequests")
      .where("employeeDocId", "==", guard.employeeDocId)
      .limit(100)
      .get();

    if (requestsSnap.empty) {
      requestsSnap = await adminDb
        .collection("leaveRequests")
        .where("employeeId", "==", guard.employeeId)
        .limit(100)
        .get();
    }

    const requests = requestsSnap.docs.map((d) => {
      const data = d.data() as {
        type?: string;
        fromDate?: string;
        toDate?: string;
        days?: number;
        reason?: string;
        status?: string;
        createdAt?: FirebaseFirestore.Timestamp;
        respondedAt?: FirebaseFirestore.Timestamp;
        notes?: string;
      };
      return {
        id: d.id,
        type: data.type ?? "casual",
        fromDate: data.fromDate ?? "",
        toDate: data.toDate ?? "",
        days: data.days ?? 0,
        reason: data.reason ?? "",
        status: data.status ?? "pending",
        createdAt: data.createdAt?.toDate().toISOString() ?? "",
        respondedAt: data.respondedAt?.toDate().toISOString() ?? undefined,
        notes: data.notes ?? undefined,
      };
    }).sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    // Fetch leave balance doc (may not exist)
    let balance = null;
    try {
      const safeId = guard.employeeDocId.replace(/\//g, "_");
      const balanceDocId = `${safeId}_${currentYear}`;
      const balanceDoc = await adminDb
        .collection("leaveBalances")
        .doc(balanceDocId)
        .get();

      if (balanceDoc.exists) {
        const b = balanceDoc.data() as {
          casual?: { entitled: number; taken: number; balance: number };
          sick?: { entitled: number; taken: number; balance: number };
          earned?: { entitled: number; taken: number; balance: number };
        };
        balance = {
          casual: b.casual ?? { entitled: 0, taken: 0, balance: 0 },
          sick: b.sick ?? { entitled: 0, taken: 0, balance: 0 },
          earned: b.earned ?? { entitled: 0, taken: 0, balance: 0 },
        };
      }
    } catch {
      // leaveBalances lookup may fail if employeeDocId contains slashes
    }

    return NextResponse.json({ requests, balance });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/leave GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — submit new leave request
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);

    const body = (await request.json()) as {
      type?: string;
      fromDate?: string;
      toDate?: string;
      reason?: string;
    };

    const { type, fromDate, toDate, reason } = body;

    // Validate required fields
    if (!type || !fromDate || !toDate || !reason) {
      return NextResponse.json(
        { error: "type, fromDate, toDate, and reason are required." },
        { status: 400 }
      );
    }

    const validTypes = ["casual", "sick", "earned", "unpaid"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid leave type." }, { status: 400 });
    }

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      return NextResponse.json(
        { error: "Dates must be in YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const from = new Date(`${fromDate}T00:00:00`);
    const to = new Date(`${toDate}T00:00:00`);

    if (from < today) {
      return NextResponse.json(
        { error: "fromDate must be today or in the future." },
        { status: 400 }
      );
    }

    if (to < from) {
      return NextResponse.json(
        { error: "toDate must be on or after fromDate." },
        { status: 400 }
      );
    }

    // Calculate days (inclusive, no exclusions)
    const days =
      Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const docRef = await adminDb.collection("leaveRequests").add({
      employeeDocId: guard.employeeDocId,
      employeeId: guard.employeeId,
      type,
      fromDate,
      toDate,
      days,
      reason,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/leave POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — cancel a pending leave request
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request) {
  try {
    const guard = await requireGuard(request);

    const body = (await request.json()) as { requestId?: string };
    const { requestId } = body;

    if (!requestId) {
      return NextResponse.json(
        { error: "requestId is required." },
        { status: 400 }
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const docRef = adminDb.collection("leaveRequests").doc(requestId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { error: "Leave request not found." },
        { status: 404 }
      );
    }

    const data = docSnap.data() as {
      employeeDocId?: string;
      status?: string;
    };

    if (data.employeeDocId !== guard.employeeDocId) {
      return NextResponse.json(
        { error: "Not authorised to cancel this request." },
        { status: 403 }
      );
    }

    if (data.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending requests can be cancelled." },
        { status: 400 }
      );
    }

    await docRef.update({ status: "cancelled" });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/leave PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
