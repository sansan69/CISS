import { NextRequest } from "next/server";

import { handleLocationGeocode } from "@/lib/server/location-geocode";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = (await req.json().catch(() => null)) as
      | {
          address?: string;
          district?: string;
          entityType?: "site" | "clientLocation";
          reverse?: boolean;
          coordinates?: {
            lat?: number;
            lng?: number;
          };
          existingCoordinates?: {
            lat?: number;
            lng?: number;
          };
        }
      | null;

    return handleLocationGeocode(body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message.includes("access required") ? 403 : 401;
    return unauthorizedResponse(message, status);
  }
}
