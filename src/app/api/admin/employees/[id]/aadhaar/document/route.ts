import { NextResponse } from "next/server";
import { requireAadhaarAdministrator } from "@/lib/server/auth";
import {
  findEmployeeById,
  requireRecentAuthentication,
} from "@/lib/server/employee-document-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = requireRecentAuthentication(await requireAadhaarAdministrator(request));
    const { id } = await params;
    const { db, storage } = await import("@/lib/firebaseAdmin");
    const employee = await findEmployeeById(db, id);
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const privateSnap = await db.collection("employeeAadhaarPrivate").doc(employee.id).get();
    const data = privateSnap.data() as { documentStoragePath?: unknown; contentType?: unknown } | undefined;
    if (!privateSnap.exists || typeof data?.documentStoragePath !== "string") {
      return NextResponse.json({ error: "Aadhaar copy is not on file." }, { status: 404 });
    }
    if (!data.documentStoragePath.startsWith(`restrictedEmployeeAadhaar/${employee.id}/`)) {
      throw new Error("Invalid restricted document path.");
    }
    const [buffer] = await storage.bucket().file(data.documentStoragePath).download();
    await db.collection("sensitiveDocumentAuditLogs").add({
      action: "aadhaar_document_viewed",
      employeeDocId: employee.id,
      category: "aadhaar",
      purpose: "esic_epf_registration",
      actorUid: admin.uid,
      actorType: "admin",
      at: new Date(),
    });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": typeof data.contentType === "string" ? data.contentType : "application/octet-stream",
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, private, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aadhaar document request failed.";
    const status = message.includes("access required") ? 403 : message.includes("Recent authentication") ? 401 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
