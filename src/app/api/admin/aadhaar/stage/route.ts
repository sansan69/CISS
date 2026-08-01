import { NextResponse } from "next/server";
import { requireAadhaarAdministrator } from "@/lib/server/auth";
import { isAadhaarInfrastructureError, saveAadhaarStagingBuffer } from "@/lib/server/aadhaar";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const admin = await requireAadhaarAdministrator(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Aadhaar copy is required." }, { status: 400 });
    }
    const storagePath = await saveAadhaarStagingBuffer({
      uploaderUid: admin.uid,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(
      { storagePath },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    const internal = isAadhaarInfrastructureError(error);
    const message = internal ? "Aadhaar could not be securely staged." : error instanceof Error ? error.message : "Aadhaar upload failed.";
    const status = internal ? 500 : message.includes("access required") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
