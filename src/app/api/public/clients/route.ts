import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { dedupeClientOptions } from "@/lib/client-options";

export const runtime = "nodejs";

function mapClient(id: string, data: Record<string, unknown>) {
  const name = (typeof data.name === "string" && data.name.trim()) ||
    (typeof data.clientName === "string" && data.clientName.trim()) ||
    "";

  return { id, name };
}

export async function GET() {
  try {
    const snapshot = await db.collection("clients").orderBy("name", "asc").get();

    const clients = dedupeClientOptions(
      snapshot.docs.map((doc) => mapClient(doc.id, doc.data() as Record<string, unknown>)),
    );

    return NextResponse.json({ clients });
  } catch (error) {
    console.error("[public/clients]", error);
    return NextResponse.json(
      { error: "Could not load clients." },
      { status: 500 },
    );
  }
}
