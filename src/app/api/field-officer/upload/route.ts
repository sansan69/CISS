import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Report evidence now uploads directly into a report-bound private Storage path.
// Keeping this route as an explicit response prevents older clients from silently
// creating permanent bearer-token download URLs.
export async function POST() {
  return NextResponse.json(
    {
      error: "This upload method has been retired. Refresh the app and upload the file again.",
      code: "REPORT_UPLOAD_METHOD_RETIRED",
    },
    { status: 410 },
  );
}
