import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

type LeaveType = "casual" | "sick" | "earned" | "unpaid";

const LEAVE_TYPES = new Set<LeaveType>(["casual", "sick", "earned", "unpaid"]);
const DEFAULT_BALANCE = {
  casual: { entitled: 0, taken: 0, balance: 0 },
  sick: { entitled: 0, taken: 0, balance: 0 },
  earned: { entitled: 0, taken: 0, balance: 0 },
};

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function serializeDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString().slice(0, 10)
      : "";
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  return "";
}

function parseLeaveDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inclusiveDays(fromDate: Date, toDate: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / dayMs) + 1);
}

function isActiveEmployee(employee: Record<string, unknown>) {
  return normalizeText(employee.status || "Active").toLowerCase() === "active";
}

async function loadLeaveBalance(
  adminDb: FirebaseFirestore.Firestore,
  employeeDocId: string,
  employeeId: string,
  year: number,
) {
  const refs = Array.from(new Set([employeeDocId, employeeId].filter(Boolean)))
    .map((id) => adminDb.collection("leaveBalances").doc(`${id}_${year}`));
  const docs = refs.length ? await adminDb.getAll(...refs) : [];
  return docs.find((doc) => doc.exists)?.data() ?? null;
}

async function loadGuardEmployee(request: Request) {
  const guard = await requireGuard(request);
  const { db: adminDb } = await import("@/lib/firebaseAdmin");
  const employeeSnap = await adminDb.collection("employees").doc(guard.employeeDocId).get();
  if (!employeeSnap.exists) {
    return { error: NextResponse.json({ error: "Employee not found." }, { status: 404 }) };
  }

  const employee = employeeSnap.data() as Record<string, unknown>;
  if (!isActiveEmployee(employee)) {
    return { error: NextResponse.json({ error: "Only active guards can use leave requests." }, { status: 403 }) };
  }

  return { adminDb, guard, employee };
}

export async function GET(request: Request) {
  try {
    const context = await loadGuardEmployee(request);
    if ("error" in context) return context.error;

    const { adminDb, guard } = context;
    const year = new Date().getFullYear();
    const balance = await loadLeaveBalance(adminDb, guard.employeeDocId, guard.employeeId, year);
    const requestsSnap = await adminDb
      .collection("leaveRequests")
      .where("employeeId", "==", guard.employeeDocId)
      .limit(100)
      .get();

    const requests = requestsSnap.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          type: normalizeText(data.type) || "casual",
          fromDate: serializeDate(data.fromDate),
          toDate: serializeDate(data.toDate),
          days: Number(data.days ?? 0),
          reason: normalizeText(data.reason),
          status: normalizeText(data.status || "pending"),
        };
      })
      .sort((left, right) => right.fromDate.localeCompare(left.fromDate));

    return NextResponse.json({
      balance: balance ? { ...DEFAULT_BALANCE, ...balance } : DEFAULT_BALANCE,
      requests,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load leave records.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: "Could not load leave records." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await loadGuardEmployee(request);
    if ("error" in context) return context.error;

    const { adminDb, guard, employee } = context;
    const body = (await request.json()) as {
      type?: string;
      fromDate?: string;
      toDate?: string;
      reason?: string;
    };
    const type = normalizeText(body.type) as LeaveType;
    const fromDate = parseLeaveDate(body.fromDate);
    const toDate = parseLeaveDate(body.toDate);
    const reason = normalizeText(body.reason);

    if (!LEAVE_TYPES.has(type) || !fromDate || !toDate || !reason) {
      return NextResponse.json(
        { error: "type, fromDate, toDate, and reason are required." },
        { status: 400 },
      );
    }
    if (toDate < fromDate) {
      return NextResponse.json({ error: "toDate must be on or after fromDate." }, { status: 400 });
    }

    const { FieldValue } = await import("firebase-admin/firestore");
    const ref = adminDb.collection("leaveRequests").doc();
	    await ref.set({
	      employeeDocId: guard.employeeDocId,
	      employeeId: guard.employeeDocId,
	      employeeCode: guard.employeeId,
      employeeName: normalizeText(employee.fullName || employee.name || guard.employeeId),
      clientId: normalizeText(employee.clientId),
      clientName: normalizeText(employee.clientName),
      district: normalizeText(employee.district),
      type,
      fromDate,
      toDate,
      days: inclusiveDays(fromDate, toDate),
      reason,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id, success: true }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not create leave request.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: "Could not create leave request." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await loadGuardEmployee(request);
    if ("error" in context) return context.error;

    const { adminDb, guard } = context;
    const body = (await request.json()) as { requestId?: string };
    const requestId = normalizeText(body.requestId);
    if (!requestId) {
      return NextResponse.json({ error: "requestId is required." }, { status: 400 });
    }

    const ref = adminDb.collection("leaveRequests").doc(requestId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Leave request not found." }, { status: 404 });
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.employeeId !== guard.employeeDocId && data.employeeCode !== guard.employeeId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (normalizeText(data.status || "pending") !== "pending") {
      return NextResponse.json({ error: "Only pending leave requests can be cancelled." }, { status: 400 });
    }

    const { FieldValue } = await import("firebase-admin/firestore");
    await ref.update({
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: requestId, success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not update leave request.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: "Could not update leave request." }, { status: 500 });
  }
}
