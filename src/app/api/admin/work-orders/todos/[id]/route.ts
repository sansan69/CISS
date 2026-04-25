import { NextRequest, NextResponse } from "next/server";
import { verifyRequestAuth, requireAdminOrFieldOfficer, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import type { WorkOrderTodoPriority, WorkOrderTodoStatus } from "@/types/work-orders";

export const runtime = "nodejs";

function validateStatus(value: unknown): WorkOrderTodoStatus | null {
  const valid: WorkOrderTodoStatus[] = ["pending", "in-progress", "completed", "cancelled"];
  return valid.includes(value as WorkOrderTodoStatus) ? (value as WorkOrderTodoStatus) : null;
}

function validatePriority(value: unknown): WorkOrderTodoPriority | null {
  const valid: WorkOrderTodoPriority[] = ["low", "medium", "high", "urgent"];
  return valid.includes(value as WorkOrderTodoPriority) ? (value as WorkOrderTodoPriority) : null;
}

// PATCH /api/admin/work-orders/todos/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { id } = await params;
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const todoRef = adminDb.collection("workOrderTodos").doc(id);
    const todoSnap = await todoRef.get();

    if (!todoSnap.exists) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    const updates: Record<string, any> = {
      ...buildServerUpdateAudit({ uid: user.uid, email: user.email ?? undefined }),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.status !== undefined) {
      const status = validateStatus(body.status);
      if (status) {
        updates.status = status;
        if (status === "completed") {
          updates.completedAt = FieldValue.serverTimestamp();
        } else {
          updates.completedAt = null;
        }
      }
    }
    if (body.priority !== undefined) {
      const priority = validatePriority(body.priority);
      if (priority) updates.priority = priority;
    }
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate || null;
    if (body.assignedTo !== undefined) updates.assignedTo = body.assignedTo || null;
    if (body.assignedToName !== undefined) updates.assignedToName = body.assignedToName || "";

    await todoRef.update(updates);

    return NextResponse.json({ id, updated: true });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Could not update todo" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/work-orders/todos/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    await adminDb.collection("workOrderTodos").doc(id).delete();

    return NextResponse.json({ id, deleted: true });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Could not delete todo" },
      { status: 500 }
    );
  }
}
