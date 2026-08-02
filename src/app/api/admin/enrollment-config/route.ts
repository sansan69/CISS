import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { ADDRESS_PROOF_TYPES, IDENTITY_PROOF_TYPES } from "@/lib/constants";
export const runtime = "nodejs";

function sanitizeProofTypes(value: unknown, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return Array.from(new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && allowedSet.has(item))
      : allowed,
  ));
}

function enrollmentProofDefaults() {
  return {
    allowedIdTypes: [...IDENTITY_PROOF_TYPES],
    allowedAddressProofTypes: [...ADDRESS_PROOF_TYPES],
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Fetch or create a singleton enrollment config document
    const configRef = adminDb.collection("config").doc("enrollment");
    const configSnap = await configRef.get();

    if (!configSnap.exists) {
      // Return sensible defaults
      return NextResponse.json({
        enabled: true,
        ...enrollmentProofDefaults(),
        requireBankDetails: true,
        requireSignature: true,
        maxFileSizeMb: 5,
        allowedFileTypes: ["jpg", "jpeg", "png", "pdf"],
      });
    }

    const configData = configSnap.data() as Record<string, unknown>;
    const defaults = enrollmentProofDefaults();
    const allowedIdTypes = sanitizeProofTypes(configData.allowedIdTypes, IDENTITY_PROOF_TYPES);
    const allowedAddressProofTypes = sanitizeProofTypes(configData.allowedAddressProofTypes, ADDRESS_PROOF_TYPES);
    return NextResponse.json({
      enabled: configData.enabled ?? true,
      allowedIdTypes: allowedIdTypes.length ? allowedIdTypes : defaults.allowedIdTypes,
      allowedAddressProofTypes: allowedAddressProofTypes.length ? allowedAddressProofTypes : defaults.allowedAddressProofTypes,
      requireBankDetails: configData.requireBankDetails ?? true,
      requireSignature: configData.requireSignature ?? true,
      maxFileSizeMb: (configData.maxFileSizeMb as number) ?? 5,
      allowedFileTypes: Array.isArray(configData.allowedFileTypes)
        ? configData.allowedFileTypes
        : ["jpg", "jpeg", "png", "pdf"],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/enrollment-config GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const configRef = adminDb.collection("config").doc("enrollment");
    const existing = (await configRef.get()).data() as Record<string, unknown> | undefined;
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (body.enabled !== undefined) update.enabled = Boolean(body.enabled);
    if (body.allowedIdTypes !== undefined || body.allowedAddressProofTypes !== undefined) {
      const selectedIdentityTypes = sanitizeProofTypes(
        body.allowedIdTypes ?? existing?.allowedIdTypes,
        IDENTITY_PROOF_TYPES,
      );
      const selectedAddressTypes = sanitizeProofTypes(
        body.allowedAddressProofTypes ?? existing?.allowedAddressProofTypes,
        ADDRESS_PROOF_TYPES,
      );
      update.allowedIdTypes = selectedIdentityTypes;
      update.allowedAddressProofTypes = selectedAddressTypes;
    }
    if (body.requireBankDetails !== undefined) update.requireBankDetails = Boolean(body.requireBankDetails);
    if (body.requireSignature !== undefined) update.requireSignature = Boolean(body.requireSignature);
    if (body.maxFileSizeMb !== undefined) update.maxFileSizeMb = Number(body.maxFileSizeMb);
    if (body.allowedFileTypes !== undefined) {
      update.allowedFileTypes = Array.isArray(body.allowedFileTypes)
        ? body.allowedFileTypes.filter((t: unknown): t is string => typeof t === "string")
        : [];
    }

    await configRef.set(update, { merge: true });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/enrollment-config PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
