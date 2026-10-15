import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import {
  guardLocationAmsFieldsSchema,
  normalizeText,
  persistGuardLocationSample,
  type GuardLocationSample,
} from "@/lib/guard-tracking-persist";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import {
  buildRateLimitKey,
  checkRateLimit,
} from "@/lib/server/rate-limit";
export const runtime = "nodejs";

const heartbeatSchema = z.object({
  siteId: z.string().trim().min(1).max(160),
  attendanceSessionId: z.string().trim().min(1).max(160).optional(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive().max(5_000),
  capturedAt: z.string().datetime().optional(),
  batteryLevel: z.number().finite().min(0).max(1).nullable().optional(),
  speed: z.number().finite().min(0).max(150).nullable().optional(),
  wifiConnected: z.boolean().nullable().optional(),
  networkType: z.string().trim().max(32).nullable().optional(),
  ...guardLocationAmsFieldsSchema,
});

const HEARTBEAT_RATE_LIMIT = {
  maxRequests: 30,
  windowMs: 10 * 60 * 1000,
  failClosed: true,
} as const;

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);
    const rateLimit = await checkRateLimit(
      buildRateLimitKey("guard-heartbeat", guard.uid),
      HEARTBEAT_RATE_LIMIT,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Location updates are arriving too quickly. Please wait." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.ceil(HEARTBEAT_RATE_LIMIT.windowMs / 1000),
            ),
          },
        },
      );
    }

    const parsed = heartbeatSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "A valid live location and GPS accuracy are required.",
        },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const sample: GuardLocationSample = {
      siteId: body.siteId,
      attendanceSessionId: body.attendanceSessionId,
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy,
      capturedAt: body.capturedAt,
      batteryLevel: body.batteryLevel ?? null,
      speed: body.speed ?? null,
      wifiConnected: body.wifiConnected ?? null,
      networkType: body.networkType ?? null,
      activity: normalizeText(body.activity) || null,
      isMock: body.isMock ?? null,
      isGPSOn: body.isGPSOn ?? null,
      altitude: body.altitude ?? null,
      bearing: body.bearing ?? null,
      locationAccuracy: body.locationAccuracy ?? null,
      batteryPercentage: body.batteryPercentage ?? null,
    };

    const now = Timestamp.now();
    const result = await persistGuardLocationSample({ guard, sample, now });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      siteId: result.siteId,
      distanceFromSite: Math.round(result.distanceFromSite),
      zoneStatus: result.zoneStatus,
      gpsReliable: result.gpsReliable,
      updatedAt: result.updatedAt.toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid live location payload." },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error
        ? error.message
        : "Could not update tracking heartbeat.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    console.error("[guard/tracking/heartbeat]", error);
    return NextResponse.json(
      { error: "Live location could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
