import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { dedupeClientOptions, isClientEnrollmentEnabled } from "@/lib/client-options";
import { resolveClientEnrollmentProfile } from "@/lib/client-enrollment-profile";

export const runtime = "nodejs";

function mapClient(id: string, data: Record<string, unknown>) {
  const name =
    (typeof data.name === "string" && data.name.trim()) ||
    (typeof data.clientName === "string" && data.clientName.trim()) ||
    "";

  return {
    id,
    name,
    enrollmentProfile: resolveClientEnrollmentProfile(data.enrollmentProfile, name),
  };
}

export async function GET() {
  try {
    const clientSnapshot = await db.collection("clients").orderBy("name", "asc").get();
    const clients = dedupeClientOptions(
      clientSnapshot.docs
        .filter((doc) => isClientEnrollmentEnabled(doc.data()))
        .map((doc) => mapClient(doc.id, doc.data() as Record<string, unknown>)),
    );

    // Aggregation queries avoid downloading every active employee document just
    // to order a small dropdown. CDN caching then serves repeat visits directly.
    const counts = await Promise.all(
      clients.map(async (client) => {
        const snapshot = await db
          .collection("employees")
          .where("status", "==", "Active")
          .where("clientName", "==", client.name)
          .count()
          .get();
        return [client.name, snapshot.data().count] as const;
      }),
    );
    const guardCountByClient = new Map(counts);

    clients.sort((a, b) => {
      const countDiff = (guardCountByClient.get(b.name) ?? 0) - (guardCountByClient.get(a.name) ?? 0);
      if (countDiff !== 0) return countDiff;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(
      { clients },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    console.error("[public/clients]", error);
    return NextResponse.json(
      { error: "Could not load clients." },
      { status: 500 },
    );
  }
}
