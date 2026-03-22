import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { cloneComplianceSettings } from "@/lib/payroll/defaults";
import type { ComplianceSettings } from "@/types/payroll";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const doc = await adminDb.collection("complianceSettings").doc("global").get();
    if (!doc.exists) {
      return NextResponse.json(cloneComplianceSettings());
    }
    return NextResponse.json({ id: doc.id, ...doc.data() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(request: Request) {
  try {
    const decoded = await requireAdmin(request);
    const body = (await request.json()) as Partial<ComplianceSettings>;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const existingDoc = await adminDb.collection("complianceSettings").doc("global").get();
    const existing = existingDoc.exists ? (existingDoc.data() as ComplianceSettings) : cloneComplianceSettings();

    const nextSettings: ComplianceSettings = {
      ...existing,
      ...body,
      epf: { ...existing.epf, ...body.epf },
      esic: { ...existing.esic, ...body.esic },
      professionalTax: {
        ...existing.professionalTax,
        ...body.professionalTax,
        slabs: body.professionalTax?.slabs ?? existing.professionalTax.slabs,
      },
      tds: {
        ...existing.tds,
        ...body.tds,
        slabs: body.tds?.slabs ?? existing.tds.slabs,
      },
      bonus: { ...existing.bonus, ...body.bonus },
      gratuity: { ...existing.gratuity, ...body.gratuity },
      changeHistory: [
        ...(existing.changeHistory ?? []),
        {
          at: new Date().toISOString(),
          by: decoded.email ?? decoded.uid,
          summary: "Compliance settings updated",
        },
      ].slice(-25),
    };

    await adminDb.collection("complianceSettings").doc("global").set(
      {
        ...nextSettings,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: decoded.uid,
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
