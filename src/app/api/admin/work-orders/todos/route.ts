import { NextRequest, NextResponse } from "next/server";
import { verifyRequestAuth, requireAdminOrFieldOfficer, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit, buildServerUpdateAudit } from "@/lib/server/audit";
import type { WorkOrderTodoPriority, WorkOrderTodoStatus } from "@/types/work-orders";

export const runtime = "nodejs";

function validateStatus(value: unknown): WorkOrderTodoStatus {
  const valid: WorkOrderTodoStatus[] = ["pending", "in-progress", "completed", "cancelled"];
  return valid.includes(value as WorkOrderTodoStatus) ? (value as WorkOrderTodoStatus) : "pending";
}

function validatePriority(value: unknown): WorkOrderTodoPriority {
  const valid: WorkOrderTodoPriority[] = ["low", "medium", "high", "urgent"];
  return valid.includes(value as WorkOrderTodoPriority) ? (value as WorkOrderTodoPriority) : "medium";
}

// GET /api/admin/work-orders/todos
export async function GET(request: NextRequest) {
  try {
    const user = await requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const { searchParams } = new URL(request.url);
    const workOrderId = searchParams.get("workOrderId");
    const siteId = searchParams.get("siteId");
    const status = searchParams.get("status");

    let q = adminDb.collection("workOrderTodos") as any;

    if (workOrderId) {
      q = q.where("workOrderId", "==", workOrderId);
    }
    if (siteId) {
      q = q.where("siteId", "==", siteId);
    }
    if (status) {
      q = q.where("status", "==", status);
    }

    const snapshot = await q.orderBy("createdAt", "desc").limit(200).get();

    const todos = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ todos });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Could not fetch todos" },
      { status: 500 }
    );
  }
}

// POST /api/admin/work-orders/todos
export async function POST(request: NextRequest) {
  try {
    const user = await requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    if (!body.title || typeof body.title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const todoRef = adminDb.collection("workOrderTodos").doc();
    const todoData = {
      title: body.title.trim(),
      description: body.description?.trim() || "",
      status: validateStatus(body.status),
      priority: validatePriority(body.priority),
      workOrderId: body.workOrderId || null,
      siteId: body.siteId || null,
      siteName: body.siteName || "",
      examName: body.examName || "",
      district: body.district || "",
      dueDate: body.dueDate || null,
      assignedTo: body.assignedTo || null,
      assignedToName: body.assignedToName || "",
      completedAt: null,
      ...buildServerCreateAudit({ uid: user.uid, email: user.email ?? undefined }),
      createdByName: user.email || user.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await todoRef.set(todoData);

    return NextResponse.json({ id: todoRef.id, ...todoData });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Could not create todo" },
      { status: 500 }
    );
  }
}
