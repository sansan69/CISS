import { NextRequest } from "next/server";

import { handleLocationGeocode } from "@/lib/server/location-geocode";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { address?: string; district?: string }
    | null;
  return handleLocationGeocode({
    address: body?.address,
    district: body?.district,
    entityType: "site",
  });
}
