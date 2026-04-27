import { NextResponse } from "next/server";

import {
  buildClientPortalUrl,
  getClientPortalContext,
  slugifyPortalSubdomain,
} from "@/lib/client-portal";

export async function GET(request: Request) {
  const host = request.headers.get("host");
  const context = getClientPortalContext(host);

  if (!context.isClientPortal || !context.subdomain) {
    return NextResponse.json({
      ...context,
      client: null,
    });
  }

  const { db: adminDb } = await import("@/lib/firebaseAdmin");
  const snapshot = await adminDb
    .collection("clients")
    .where("portalSubdomain", "==", slugifyPortalSubdomain(context.subdomain))
    .limit(1)
    .get();

  if (snapshot.empty) {
    return NextResponse.json({
      ...context,
      client: null,
    });
  }

  const doc = snapshot.docs[0];
  const data = doc.data() ?? {};
  return NextResponse.json({
    ...context,
    client: {
      id: doc.id,
      name:
        typeof data.name === "string" && data.name.trim()
          ? data.name
          : typeof data.clientName === "string"
            ? data.clientName
            : "",
      portalSubdomain: typeof data.portalSubdomain === "string" ? data.portalSubdomain : context.subdomain,
      portalEnabled: data.portalEnabled !== false,
      portalUrl: buildClientPortalUrl(
        typeof data.portalSubdomain === "string" ? data.portalSubdomain : context.subdomain,
      ),
    },
  });
}
