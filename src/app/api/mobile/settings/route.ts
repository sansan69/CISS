import { NextResponse } from "next/server";

import { db } from "@/lib/firebaseAdmin";
import { unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { resolveMobileSession } from "@/lib/server/mobile-session";
import { getAndroidRelease } from "@/lib/android-release";
export const runtime = "nodejs";

/**
 * Server-driven module flags. Must mirror the mobile client's
 * `ModuleFlags.defaults()` (shipped modules ON, AMS-only modules OFF) so a
 * first-run guard sees exactly the same UI whether or not the server has
 * published an override document.
 */
const MODULE_DEFAULTS: Record<string, boolean> = {
  attendance: true,
  qrAttendance: true,
  offlineTracking: true,
  biometricVerification: true,
  leave: true,
  documents: true,
  payslips: true,
  patrol: true,
  incidents: true,
  evaluations: true,
  training: true,
  workOrders: true,
  reports: true,
  break: true,
  geoFence: true,
  loan: false,
  expense: false,
  documentRequest: false,
  dynamicForm: false,
  task: false,
  product: false,
  paymentCollection: false,
  notice: false,
  clientVisit: false,
  chat: false,
  aiChat: false,
  dynamicQr: false,
  ipAttendance: false,
  uidLogin: false,
};

type AppSettings = {
  minSupportedVersion: string;
  forceUpdate: boolean;
  maintenance: boolean;
  currencySymbol: string;
  distanceUnit: string;
};

const APP_DEFAULTS: AppSettings = {
  minSupportedVersion: "",
  forceUpdate: false,
  maintenance: false,
  currencySymbol: "₹",
  distanceUnit: "km",
};

function pickString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}

function mergeAppConfig(target: AppSettings, source: unknown) {
  if (!source || typeof source !== "object") return;
  const data = source as Record<string, unknown>;
  if (data.minSupportedVersion !== undefined) {
    target.minSupportedVersion = pickString(
      data.minSupportedVersion,
      target.minSupportedVersion,
    );
  }
  if (typeof data.forceUpdate === "boolean") {
    target.forceUpdate = data.forceUpdate;
  }
  if (typeof data.maintenance === "boolean") {
    target.maintenance = data.maintenance;
  }
  if (data.currencySymbol !== undefined) {
    target.currencySymbol = pickString(
      data.currencySymbol,
      target.currencySymbol,
    );
  }
  if (data.distanceUnit !== undefined) {
    target.distanceUnit = pickString(data.distanceUnit, target.distanceUnit);
  }
}

function mergeModuleFlags(target: Record<string, boolean>, source: unknown) {
  if (!source || typeof source !== "object") return;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "boolean") {
      target[key] = value;
    }
  }
}

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate();
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    }
    const seconds = candidate.seconds ?? candidate._seconds;
    if (typeof seconds === "number") return seconds * 1000;
  }
  return null;
}

function resolveVersion(data: Record<string, unknown>) {
  if (typeof data.version === "number" && Number.isFinite(data.version)) {
    return Math.trunc(data.version);
  }
  const updatedAtMs = toMillis(data.updatedAt);
  if (updatedAtMs !== null) return Math.trunc(updatedAtMs);
  return null;
}

export async function GET(request: Request) {
  let decoded: Awaited<ReturnType<typeof verifyRequestAuth>>;
  try {
    decoded = await verifyRequestAuth(request);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unauthorized.";
    return unauthorizedResponse(message, 401);
  }

  try {
    const session = await resolveMobileSession(decoded);

    if (!session) {
      return unauthorizedResponse(
        "This Firebase account is not linked to a mobile profile.",
        403,
      );
    }

    const app: AppSettings = { ...APP_DEFAULTS };
    const modules: Record<string, boolean> = { ...MODULE_DEFAULTS };
    let version = 1;

    const refs = [db.collection("appConfig").doc("mobile")];
    const stateCode = (session.stateCode ?? "").trim().toUpperCase();
    if (stateCode) {
      refs.push(db.collection("regions").doc(stateCode));
    }

    const snapshots = await Promise.all(
      refs.map((ref) =>
        ref
          .get()
          .catch((error: unknown) => {
            console.warn("[mobile/settings] config read failed", error);
            return null;
          }),
      ),
    );

    for (const snapshot of snapshots) {
      if (!snapshot?.exists) continue;
      const data = snapshot.data() as Record<string, unknown>;
      mergeAppConfig(app, data.app);
      mergeModuleFlags(modules, data.modules);
      const docVersion = resolveVersion(data);
      if (docVersion !== null) version = docVersion;
    }

    // Best-effort: a mandatory app release forces an update prompt. Never let a
    // missing/unreadable release manifest break the settings response.
    try {
      const release = await getAndroidRelease();
      if (release.mandatory) {
        app.forceUpdate = true;
      }
    } catch (error) {
      console.warn("[mobile/settings] release manifest unavailable", error);
    }

    return NextResponse.json({
      data: {
        version,
        app: {
          minSupportedVersion: app.minSupportedVersion,
          forceUpdate: app.forceUpdate,
          maintenance: app.maintenance,
          currencySymbol: app.currencySymbol,
          distanceUnit: app.distanceUnit,
        },
        modules,
      },
    });
  } catch (error: unknown) {
    console.error("[mobile/settings]", error);
    return NextResponse.json(
      { error: "Could not load mobile settings." },
      { status: 500 },
    );
  }
}
