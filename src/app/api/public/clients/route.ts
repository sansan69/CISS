import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { dedupeClientOptions } from "@/lib/client-options";
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
    // Fetch clients (name-ordered) and the active-guard count per client in parallel.
    // The client dropdown is ordered by "most guards enrolled" so the busiest client
    // is the first, easiest option when enrolling a guard.
    const [clientSnapshot, employeeSnapshot] = await Promise.all([
      db.collection("clients").orderBy("name", "asc").get(),
      db.collection("employees").where("status", "==", "Active").select("clientName").get(),
    ]);

    const guardCountByClient = new Map<string, number>();
    employeeSnapshot.forEach((doc) => {
      const clientName = doc.get("clientName");
      if (typeof clientName === "string" && clientName.trim()) {
        guardCountByClient.set(
          clientName,
          (guardCountByClient.get(clientName) ?? 0) + 1,
        );
      }
    });

    const clients = dedupeClientOptions(
      clientSnapshot.docs.map((doc) => mapClient(doc.id, doc.data() as Record<string, unknown>)),
    );

    clients.sort((a, b) => {
      const countDiff = (guardCountByClient.get(b.name) ?? 0) - (guardCountByClient.get(a.name) ?? 0);
      if (countDiff !== 0) return countDiff;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ clients });
  } catch (error) {
    console.error("[public/clients]", error);
    return NextResponse.json(
      { error: "Could not load clients." },
      { status: 500 },
    );
  }
}
