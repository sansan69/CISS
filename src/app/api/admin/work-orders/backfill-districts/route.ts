import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import {
  canonicalizeDistrictName,
  inferKeralaDistrictFromText,
  isCanonicalKeralaDistrict,
  normalizeOperationalZoneLabel,
} from "@/lib/districts";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
import { buildLocationIdentity } from "@/lib/location-utils";
import { buildServerUpdateAudit } from "@/lib/server/audit";

export const runtime = "nodejs";

function normalizeStoredDistrict(value: unknown): string {
  // Strip operational-zone wrapping (e.g. "South 2" → "Ernakulam") then
  // canonicalize known aliases (e.g. "Trivandrum" → "Thiruvananthapuram").
  const zoneNormalized = normalizeOperationalZoneLabel(value as string | null | undefined);
  if (!zoneNormalized) return "";
  if (isCanonicalKeralaDistrict(zoneNormalized)) {
    return canonicalizeDistrictName(zoneNormalized) || zoneNormalized;
  }
  return zoneNormalized;
}

interface SiteDoc {
  id: string;
  siteName: string;
  district: string;
  clientName: string;
  siteAddress?: string;
}

// POST /api/admin/work-orders/backfill-districts
// Repairs sites and work orders that have empty / non-canonical / "South 2"
// districts. Inference order:
//   1. canonicalize the existing district (handles aliases like Trivandrum)
//   2. scan siteName + siteAddress for a Kerala district keyword
//   3. leave untouched if no signal is available (logged in details)
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dryRun") === "true";

    const sitesSnapshot = await adminDb.collection("sites").get();

    let sitesScanned = 0;
    let sitesUpdated = 0;
    let workOrdersUpdated = 0;
    const sitesNeedingManual: { id: string; siteName: string; district: string }[] = [];
    const updates: {
      siteId: string;
      siteName: string;
      oldDistrict: string;
      newDistrict: string;
      source: string;
    }[] = [];

    const siteDistrictById = new Map<string, string>();
    const tcsSiteIds: string[] = [];

    for (const doc of sitesSnapshot.docs) {
      sitesScanned++;
      const data = doc.data();
      const clientName = typeof data.clientName === "string" ? data.clientName : "";
      if (!isOperationalWorkOrderClientName(clientName)) {
        continue;
      }
      tcsSiteIds.push(doc.id);
      const site: SiteDoc = {
        id: doc.id,
        siteName: String(data.siteName ?? ""),
        district: normalizeStoredDistrict(data.district),
        clientName,
        siteAddress: typeof data.siteAddress === "string" ? data.siteAddress : "",
      };

      const isCanonical = isCanonicalKeralaDistrict(site.district);
      let newDistrict = "";
      let source = "";

      if (site.district && isCanonical) {
        const canonical = canonicalizeDistrictName(site.district);
        if (canonical && canonical !== site.district) {
          newDistrict = canonical;
          source = "canonicalize";
        }
      } else {
        const haystack = [site.district, site.siteName, site.siteAddress]
          .filter(Boolean)
          .join(" ");
        const inferred = inferKeralaDistrictFromText(haystack);
        if (inferred) {
          newDistrict = inferred;
          source = "keyword";
        } else if (site.district) {
          // Could not infer — keep as-is but flag for manual review
          sitesNeedingManual.push({
            id: site.id,
            siteName: site.siteName,
            district: site.district,
          });
        } else {
          sitesNeedingManual.push({
            id: site.id,
            siteName: site.siteName,
            district: "(empty)",
          });
        }
      }

      const finalDistrict = newDistrict || site.district;
      siteDistrictById.set(site.id, finalDistrict);

      if (newDistrict && newDistrict !== site.district) {
        updates.push({
          siteId: site.id,
          siteName: site.siteName,
          oldDistrict: site.district || "(empty)",
          newDistrict,
          source,
        });

        if (!dryRun) {
          await adminDb.collection("sites").doc(site.id).update({
            district: newDistrict,
            locationKey: buildLocationIdentity([
              OPERATIONAL_CLIENT_NAME,
              site.siteName,
              newDistrict,
            ]),
            ...buildServerUpdateAudit({
              uid: "system",
              email: "backfill-districts@system",
            }),
          });
        }
        sitesUpdated++;
      }
    }

    // Pass 2: align workOrders.district to the resolved site district
    if (!dryRun && tcsSiteIds.length > 0) {
      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let hasMore = true;
      while (hasMore) {
        let q: FirebaseFirestore.Query = adminDb.collection("workOrders").limit(500);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snapshot = await q.get();
        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batch = adminDb.batch();
        let batchCount = 0;

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          const clientName = typeof data.clientName === "string" ? data.clientName : "";
          if (!isOperationalWorkOrderClientName(clientName)) return;
          const siteId = typeof data.siteId === "string" ? data.siteId : "";
          if (!siteId) return;
          const expectedDistrict = siteDistrictById.get(siteId);
          if (!expectedDistrict) return;
          const currentDistrict = normalizeStoredDistrict(data.district);
          if (currentDistrict === expectedDistrict) return;
          if (!isCanonicalKeralaDistrict(expectedDistrict)) return;
          batch.update(doc.ref, {
            district: expectedDistrict,
            ...buildServerUpdateAudit({
              uid: "system",
              email: "backfill-districts@system",
            }),
          });
          batchCount++;
        });

        if (batchCount > 0) {
          await batch.commit();
          workOrdersUpdated += batchCount;
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < 500) hasMore = false;
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      sitesScanned,
      sitesUpdated,
      workOrdersUpdated,
      sitesNeedingManual: sitesNeedingManual.slice(0, 200),
      sitesNeedingManualCount: sitesNeedingManual.length,
      updates: updates.slice(0, 200),
    });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json(
      { error: error?.message || "Backfill failed" },
      { status: 500 },
    );
  }
}
