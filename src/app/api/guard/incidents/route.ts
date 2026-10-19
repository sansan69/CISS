import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
export const runtime = "nodejs";

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isActiveEmployee(employee: Record<string, unknown>) {
  return normalizeText(employee.status || "Active").toLowerCase() === "active";
}

function serializeDate(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    let snapshot = await adminDb
      .collection("incidents")
      .where("reporterEmployeeDocId", "==", guard.employeeDocId)
      .limit(100)
      .get();

    if (snapshot.empty) {
      snapshot = await adminDb
        .collection("incidents")
        .where("reporterEmployeeId", "==", guard.employeeId)
        .limit(100)
        .get();
    }

    const incidents = snapshot.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          category: normalizeText(data.category),
          severity: normalizeText(data.severity),
          status: normalizeText(data.status || "open"),
          siteName: normalizeText(data.siteName),
          reportedAt:
            serializeDate(data.reportedAt) || serializeDate(data.createdAt),
          description: normalizeText(data.description || data.summary),
        };
      })
      .sort(
        (left, right) =>
          new Date(right.reportedAt).getTime() -
          new Date(left.reportedAt).getTime(),
      );

    return NextResponse.json({ incidents });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not load incidents.";
    if (
      message.includes("Missing bearer token") ||
      message.includes("Guard access required")
    ) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);
    const body = (await request.json()) as {
      category?: string;
      severity?: string;
      siteId?: string;
      siteName?: string;
      district?: string;
      description?: string;
      locationText?: string;
      photoUrls?: string[];
      clientRequestId?: string;
    };

    if (!body.category || !body.severity || !body.description) {
      return NextResponse.json(
        { error: "category, severity, and description are required." },
        { status: 400 },
      );
    }
    if (
      body.clientRequestId !== undefined &&
      (typeof body.clientRequestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.clientRequestId,
        ))
    ) {
      return NextResponse.json(
        { error: "clientRequestId must be a UUID." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const empDoc = await adminDb
      .collection("employees")
      .doc(guard.employeeDocId)
      .get();
    const employeeData = empDoc.data() ?? {};
    if (!empDoc.exists) {
      return NextResponse.json(
        { error: "Employee not found." },
        { status: 404 },
      );
    }
    if (!isActiveEmployee(employeeData)) {
      return NextResponse.json(
        { error: "Only active guards can create incidents." },
        { status: 403 },
      );
    }

    const { createGuardSubmission } =
      await import("@/lib/server/guard-submission-idempotency");
    const result = await createGuardSubmission({
      db: adminDb,
      collectionName: "incidents",
      ownerId: `${guard.uid}:${guard.employeeDocId}`,
      idempotencyKey:
        typeof body.clientRequestId === "string" ? body.clientRequestId : null,
      fingerprintData: {
        category: body.category,
        severity: body.severity,
        siteId: body.siteId || "mobile-unspecified",
        siteName: body.siteName ?? "Unspecified site",
        district: body.district ?? "",
        description: body.description,
        locationText: body.locationText ?? "",
        photoUrls: Array.isArray(body.photoUrls) ? body.photoUrls : [],
      },
      data: {
        reporterEmployeeDocId: guard.employeeDocId,
        reporterEmployeeId: guard.employeeId,
        reporterName: employeeData.name ?? employeeData.fullName ?? "",
        clientName: employeeData.clientName ?? "",
        category: body.category,
        severity: body.severity,
        status: "open",
        siteId: body.siteId || "mobile-unspecified",
        siteName: body.siteName ?? employeeData.siteName ?? "Unspecified site",
        district: body.district ?? employeeData.district ?? "",
        description: body.description,
        locationText: body.locationText ?? "",
        photoUrls: Array.isArray(body.photoUrls) ? body.photoUrls : [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    });

    if (result.conflict) {
      return NextResponse.json(
        {
          error: "This request ID was already used for a different incident.",
          code: "idempotency_conflict",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        id: result.id,
        success: true,
        ...(result.created ? {} : { duplicate: true }),
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not create incident.";
    if (
      message.includes("Missing bearer token") ||
      message.includes("Guard access required")
    ) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
