import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

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
        allowedIdTypes: ["Aadhaar", "Voter ID", "PAN", "Driving License", "Passport"],
        allowedAddressProofTypes: ["Aadhaar", "Voter ID", "Utility Bill", "Rental Agreement", "Bank Statement"],
        requireBankDetails: true,
        requireSignature: true,
        maxFileSizeMb: 5,
        allowedFileTypes: ["jpg", "jpeg", "png", "pdf"],
      });
    }

    const configData = configSnap.data() as Record<string, unknown>;
    return NextResponse.json({
      enabled: configData.enabled ?? true,
      allowedIdTypes: Array.isArray(configData.allowedIdTypes)
        ? configData.allowedIdTypes
        : ["Aadhaar", "Voter ID", "PAN", "Driving License", "Passport"],
      allowedAddressProofTypes: Array.isArray(configData.allowedAddressProofTypes)
        ? configData.allowedAddressProofTypes
        : ["Aadhaar", "Voter ID", "Utility Bill", "Rental Agreement", "Bank Statement"],
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
    const { db: adminDb, FieldValue } = await import("@/lib/firebaseAdmin");

    const configRef = adminDb.collection("config").doc("enrollment");
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (body.enabled !== undefined) update.enabled = Boolean(body.enabled);
    if (body.allowedIdTypes !== undefined) {
      update.allowedIdTypes = Array.isArray(body.allowedIdTypes)
        ? body.allowedIdTypes.filter((t: unknown): t is string => typeof t === "string")
        : [];
    }
    if (body.allowedAddressProofTypes !== undefined) {
      update.allowedAddressProofTypes = Array.isArray(body.allowedAddressProofTypes)
        ? body.allowedAddressProofTypes.filter((t: unknown): t is string => typeof t === "string")
        : [];
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
