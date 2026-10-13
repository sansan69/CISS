import { NextResponse } from "next/server";
import { unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";
import { requireActiveFieldOfficerProfile } from "@/lib/server/linked-profiles";

export const runtime = "nodejs";
const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const date = (value: unknown) => value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function" ? (value as { toDate: () => Date }).toDate().toISOString() : typeof value === "string" ? value : "";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { db } = await import("@/lib/firebaseAdmin");
    const officer = await requireActiveFieldOfficerProfile(db, decoded);
    const districts = canonicalizeDistrictList(officer.assignedDistricts);
    if (!districts.length) return NextResponse.json({ incidents: [] });
    const snapshot = await db.collection("incidents").limit(500).get();
    const incidents = snapshot.docs.map((doc) => {
      const data = doc.data();
      return { id: doc.id, category: text(data.category), severity: text(data.severity), status: text(data.status || "open"), siteName: text(data.siteName), district: text(data.district), reportedAt: date(data.reportedAt) || date(data.createdAt), description: text(data.description || data.summary) };
    }).filter((incident) => districts.some((district) => districtMatches(district, incident.district))).sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
    return NextResponse.json({ incidents });
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : "Could not load incidents.");
  }
}
