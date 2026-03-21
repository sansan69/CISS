import { NextResponse } from "next/server";
import { verifyPin, hashPin, validatePinFormat } from "@/lib/guard/pin-utils";
import { requireGuard } from "@/lib/server/guard-auth";

export async function POST(request: Request) {
  try {
    const { employeeDocId } = await requireGuard(request);

    const body = await request.json();
    const { currentPin, newPin } = body as {
      currentPin?: string;
      newPin?: string;
    };

    if (!currentPin || !newPin) {
      return NextResponse.json(
        { error: "currentPin and newPin are required." },
        { status: 400 }
      );
    }

    if (!validatePinFormat(newPin)) {
      return NextResponse.json(
        { error: "New PIN must be 4 to 6 digits." },
        { status: 400 }
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const empRef = adminDb.doc(`employees/${employeeDocId}`);
    const empSnap = await empRef.get();

    if (!empSnap.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const empData = empSnap.data()!;

    if (!empData.guardPin) {
      return NextResponse.json(
        { error: "No PIN set. Please use setup instead." },
        { status: 400 }
      );
    }

    const currentValid = await verifyPin(currentPin, empData.guardPin as string);
    if (!currentValid) {
      return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
    }

    const newHash = await hashPin(newPin);
    const { FieldValue } = await import("firebase-admin/firestore");

    await empRef.update({
      guardPin: newHash,
      guardPinSetAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, message: "PIN changed successfully." });
  } catch (err: unknown) {
    console.error("[guard/change-pin]", err);
    if (err instanceof Error && err.message === "Guard access required.") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof Error && err.message === "Missing bearer token.") {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "Internal server error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
