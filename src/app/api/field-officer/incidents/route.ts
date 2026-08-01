import { NextResponse } from "next/server";
import { hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";

export const runtime = "nodejs";
const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const date = (value: unknown) => value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function" ? (value as { toDate: () => Date }).toDate().toISOString() : typeof value === "string" ? value : "";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasFieldOfficerAccess(decoded)) return unauthorizedResponse("Field officer access required.", 403);
    const { db } = await import("@/lib/firebaseAdmin");
    const officer = await db.collection("fieldOfficers").where("uid", "==", decoded.uid).limit(1).get();
    const rawDistricts = officer.empty ? decoded.assignedDistricts ?? [] : officer.docs[0].data().assignedDistricts ?? [];
    const districts = canonicalizeDistrictList(Array.isArray(rawDistricts) ? rawDistricts.filter((item): item is string => typeof item === "string") : []);
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
