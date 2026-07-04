import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { DEFAULT_ENROLLMENT_FORM_CONFIG } from "@/lib/region-wizard";
import type { EnrollmentFormConfig } from "@/types/region";

function isEnrollmentFormConfig(value: unknown): value is EnrollmentFormConfig {
  if (!value || typeof value !== "object") return false;
  const sections = (value as { sections?: unknown }).sections;
  if (!sections || typeof sections !== "object") return false;

  return Object.values(sections as Record<string, unknown>).every((section) => {
    if (!section || typeof section !== "object") return false;
    const fields = (section as { fields?: unknown }).fields;
    return Array.isArray(fields) && fields.every((field) => {
      if (!field || typeof field !== "object") return false;
      const item = field as Record<string, unknown>;
      return (
        typeof item.key === "string" &&
        typeof item.label === "string" &&
        typeof item.enabled === "boolean" &&
        typeof item.required === "boolean" &&
        typeof item.order === "number"
      );
    });
  });
}

export async function GET(request: Request) {
  try {
    await requireAdminLike(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const configSnap = await adminDb.collection("enrollmentFormConfig").doc("global").get();
    if (configSnap.exists) {
      return NextResponse.json({ config: configSnap.data() });
    }
    return NextResponse.json({ config: DEFAULT_ENROLLMENT_FORM_CONFIG, source: "defaults" });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

async function saveEnrollmentConfig(request: Request) {
  try {
    await requireAdminLike(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = await request.json().catch(() => ({}));
    const config = body.config ?? DEFAULT_ENROLLMENT_FORM_CONFIG;

    if (!isEnrollmentFormConfig(config)) {
      return NextResponse.json(
        { error: "Invalid enrollment form configuration." },
        { status: 400 },
      );
    }

    await adminDb.collection("enrollmentFormConfig").doc("global").set(config, { merge: true });
    await adminDb.collection("regionSetupProgress").doc("default").set(
      { steps: { enrollmentConfig: true }, currentStep: 3 },
      { merge: true },
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function PUT(request: Request) {
  return saveEnrollmentConfig(request);
}

export async function POST(request: Request) {
  return saveEnrollmentConfig(request);
}
