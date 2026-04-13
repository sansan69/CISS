import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period");
    const clientId = searchParams.get("clientId") || null;

    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: "Invalid period. Use YYYY-MM format." }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Check for existing cycle
    const existingCycles = await adminDb.collection("payrollCycles").where("period", "==", period).get();
    const existingCycle = existingCycles.docs.find((doc) => {
      const data = doc.data() as { clientId?: string | null };
      return (data.clientId || null) === (clientId || null);
    });

    // Query employees
    let employeeQuery: FirebaseFirestore.Query = adminDb
      .collection("employees")
      .where("status", "==", "Active");
    if (clientId) {
      employeeQuery = employeeQuery.where("clientId", "==", clientId);
    }
    const employeeSnap = await employeeQuery.get();

    // Collect unique client IDs
    const clientIds = new Set<string>();
    employeeSnap.docs.forEach((doc) => {
      const data = doc.data() as { clientId?: string };
      if (data.clientId) clientIds.add(data.clientId);
    });

    // Check which clients have wage config
    const wageConfigResults = await Promise.all(
      Array.from(clientIds).map(async (cid) => {
        const doc = await adminDb.collection("clientWageConfig").doc(cid).get();
        return { clientId: cid, hasConfig: doc.exists && ((doc.data()?.components ?? []) as unknown[]).length > 0 };
      })
    );
    const clientsWithConfig = new Set(
      wageConfigResults.filter((r) => r.hasConfig).map((r) => r.clientId)
    );

    // Categorize employees
    const ready: Array<{ id: string; name: string; clientId: string }> = [];
    const skipped: Array<{ id: string; name: string; clientId: string | null; reason: string }> = [];

    employeeSnap.docs.forEach((doc) => {
      const data = doc.data() as {
        name?: string;
        firstName?: string;
        lastName?: string;
        clientId?: string;
      };
      const name =
        data.name ||
        [data.firstName, data.lastName].filter(Boolean).join(" ") ||
        "Unnamed";
      const empClientId = data.clientId ?? null;

      if (!empClientId) {
        skipped.push({ id: doc.id, name, clientId: null, reason: "No client assigned" });
      } else if (!clientsWithConfig.has(empClientId)) {
        skipped.push({ id: doc.id, name, clientId: empClientId, reason: "Client has no wage config" });
      } else {
        ready.push({ id: doc.id, name, clientId: empClientId });
      }
    });

    return NextResponse.json({
      period,
      clientId,
      totalEmployees: employeeSnap.size,
      readyCount: ready.length,
      skippedCount: skipped.length,
      skipped,
      existingCycle: existingCycle
        ? { id: existingCycle.id, status: existingCycle.data().status }
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Validation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
