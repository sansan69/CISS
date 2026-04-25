import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

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

    const clients = snapshot.docs
      .map((doc) => mapClient(doc.id, doc.data() as Record<string, unknown>))
      .filter((client) => client.name.length > 0);

    return NextResponse.json({ clients });
  } catch (error) {
    console.error("[public/clients]", error);
    return NextResponse.json(
      { error: "Could not load clients." },
      { status: 500 },
    );
  }
}
