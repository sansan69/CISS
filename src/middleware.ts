import { NextResponse, type NextRequest } from "next/server";

import { isHostAllowed } from "@/lib/server/domain-lock";

const ALLOWED_HOSTS = (process.env.REGION_ALLOWED_DOMAINS ?? "")
  .split(",")
  .map((domain) => domain.trim())
  .filter(Boolean);

function createContentSecurityPolicy(nonce: string) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob: https:",
    "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://view.officeapps.live.com https://www.openstreetmap.org",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}

export function middleware(request: NextRequest) {
  // A regional deployment is locked to the domains enrolled for its state.
  // An empty allowlist means "not locked" (existing deployments keep working).
  const host = request.headers.get("host") ?? "";
  if (
    !isHostAllowed(host, ALLOWED_HOSTS, {
      isDev: process.env.NODE_ENV !== "production",
    })
  ) {
    const isApi = request.nextUrl.pathname.startsWith("/api/");
    return new NextResponse(
      isApi
        ? JSON.stringify({
            error: "This domain is not authorized for this deployment.",
          })
        : "Forbidden: this domain is not authorized for this deployment.",
      {
        status: 403,
        headers: isApi
          ? { "content-type": "application/json", "cache-control": "no-store" }
          : { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const contentSecurityPolicy = createContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    // API routes are matched explicitly so a path ending in an image
    // extension (e.g. /api/documents/photo.png) cannot slip past the host
    // lock through the static-asset exclusion below.
    "/api/:path*",
    {
      // Prefetch requests must run through the host lock too: excluding them
      // here let a prefetch header bypass the per-region domain lock.
      // Only framework asset routes are excluded. Application paths that end
      // in an image extension still run the host lock (they may be dynamic
      // document/photo routes).
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
    },
  ],
};
