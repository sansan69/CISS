import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function serializeDate(value: unknown) {
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
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
          reportedAt: serializeDate(data.reportedAt) || serializeDate(data.createdAt),
          description: normalizeText(data.description || data.summary),
        };
      })
      .sort((left, right) => new Date(right.reportedAt).getTime() - new Date(left.reportedAt).getTime());

    return NextResponse.json({ incidents });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load incidents.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
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
    };

    if (!body.category || !body.severity || !body.description) {
      return NextResponse.json(
        { error: "category, severity, and description are required." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const empDoc = await adminDb.collection("employees").doc(guard.employeeDocId).get();
    const employeeData = empDoc.data() ?? {};

    const ref = await adminDb.collection("incidents").add({
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
    });

    return NextResponse.json({ id: ref.id, success: true }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not create incident.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
