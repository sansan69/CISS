import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

const KERALA_DEFAULTS = {
  epf: {
    employeeRate: 0.12,
    employerEpsRate: 0.0833,
    employerEpfRate: 0.0367,
    wageCeiling: 15000,
    maxEmployerContribution: 1800,
  },
  esic: {
    employeeRate: 0.0075,
    employerRate: 0.0325,
    grossWageCeiling: 21000,
  },
  professionalTax: {
    state: "Kerala",
    slabs: [
      { upTo: 11999, monthly: 0 },
      { upTo: 17999, monthly: 120 },
      { upTo: 29999, monthly: 180 },
      { upTo: null, monthly: 200 },
    ],
  },
  tds: {
    regime: "new",
    standardDeduction: 75000,
    slabs: [
      { upTo: 300000, rate: 0 },
      { upTo: 700000, rate: 0.05 },
      { upTo: 1000000, rate: 0.10 },
      { upTo: 1200000, rate: 0.15 },
      { upTo: 1500000, rate: 0.20 },
      { upTo: null, rate: 0.30 },
    ],
  },
  bonus: { rate: 0.0833, minimumWageBase: 7000 },
  gratuity: { rate: 0.0481, minimumYearsForPayout: 5 },
};

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const doc = await adminDb.collection("complianceSettings").doc("global").get();
    if (!doc.exists) {
      return NextResponse.json(KERALA_DEFAULTS);
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
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    await adminDb.collection("complianceSettings").doc("global").set(
      {
        ...body,
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
