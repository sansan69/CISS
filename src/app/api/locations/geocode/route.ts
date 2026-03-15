import { NextRequest } from "next/server";

import { handleLocationGeocode } from "@/lib/server/location-geocode";

export async function POST(req: NextRequest) {
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
}
