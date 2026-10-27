import { NextResponse } from "next/server";

import { buildServerAuditEvent } from "@/lib/server/audit";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { generateQrCodeDataUrl } from "@/lib/qr";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Regenerate signed QR badges for every active employee.
 *
 * QR signing uses a server-only secret, so this work cannot run in the admin
 * browser bundle. The route keeps the existing `qrCodeUrl` field shape and
 * updates documents in bounded batches.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snap = await adminDb
      .collection("employees")
      .where("status", "==", "Active")
      .get();

    let updated = 0;
    let failed = 0;
    let batch = adminDb.batch();
    let pending = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const employeeId = String(data.employeeId ?? "").trim();
      const fullName = String(data.fullName ?? "").trim();
      const phoneNumber = String(
        data.phoneNumber ?? data.phone ?? data.mobile ?? "",
      ).trim();
      if (!employeeId || !phoneNumber) {
        failed += 1;
        continue;
      }

      try {
        const qrCodeUrl = await generateQrCodeDataUrl(
          employeeId,
          fullName,
          phoneNumber,
        );
        batch.update(docSnap.ref, {
          qrCodeUrl,
          qrCodeGeneratedAt: new Date(),
        });
        updated += 1;
        pending += 1;
        if (pending >= 400) {
          await batch.commit();
          batch = adminDb.batch();
          pending = 0;
        }
      } catch (error) {
        console.error("[admin/qr/regenerate] failed", docSnap.id, error);
        failed += 1;
      }
    }

    if (pending > 0) await batch.commit();

    await adminDb.collection("adminRoleAudit").add({
      scanned: snap.size,
      updated,
      failed,
      ...buildServerAuditEvent("qr_badges_regenerated", {
        uid: actor.uid,
        email: actor.email,
      }),
    });

    return NextResponse.json({
      scanned: snap.size,
      updated,
      failed,
    });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Could not regenerate QR badges.",
      error?.message === "Admin access required." ? 403 : 500,
    );
  }
}
