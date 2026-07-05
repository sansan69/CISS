import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Health-check endpoint for deployment verification.
 * Exercises Firebase Admin init + a minimal Firestore read.
 * Returns 200 if all is well, 500 with details if not.
 */
export async function GET() {
  const checks: Record<string, unknown> = {};

  try {
    const { db } = await import("@/lib/firebaseAdmin");
    checks.firebaseAdminInit = "ok";

    // Minimal read to verify Firestore is reachable
    const result = await db
      .collection("systemConfig")
      .doc("_health")
      .get()
      .then(() => "ok")
      .catch((e: unknown) => `firestore_read_error: ${e instanceof Error ? e.message : String(e)}`);
    checks.firestoreRead = result;

    const allOk = checks.firebaseAdminInit === "ok" &&
      typeof checks.firestoreRead === "string" &&
      checks.firestoreRead === "ok";

    return NextResponse.json(
      { status: allOk ? "healthy" : "degraded", checks },
      { status: allOk ? 200 : 503 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { status: "unhealthy", checks, error: message },
      { status: 500 },
    );
  }
}
