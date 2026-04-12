import { NextResponse } from "next/server";

import {
  SYSTEM_METRIC_NAMES,
  incrementSystemMetric,
} from "@/lib/server/monitoring";

type GeocodeRequestBody = {
  name?: string;
  address?: string;
  district?: string;
  state?: string;
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
};

const INDIA_FORWARD_BOUNDS = "68,6,98,37";

function sanitizeApiKey() {
  return process.env.OPENCAGE_API_KEY?.trim().replace(/^['"]|['"]$/g, "");
}

function normalizeText(value?: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() || "";
}

function extractIndianPostcode(text?: string | null) {
  const match = text?.match(/\b\d{6}\b/);
  return match?.[0];
}

function buildForwardQuery(body: GeocodeRequestBody) {
  const parts: string[] = [];
  const address = body.address?.trim();
  const district = body.district?.trim();
  const state = body.state?.trim();

  if (address) {
    parts.push(address);
  }

  const addressText = normalizeText(address);
  if (district && !addressText.includes(normalizeText(district))) {
    parts.push(district);
  }
  if (state && !addressText.includes(normalizeText(state))) {
    parts.push(state);
  }
  if (!addressText.includes("india")) {
    parts.push("India");
  }

  return parts.join(", ");
}

function buildForwardQueries(body: GeocodeRequestBody) {
  const address = body.address?.trim();
  const district = body.district?.trim();
  const state = body.state?.trim();
  const postcode = extractIndianPostcode(address);
  const queries = [
    buildForwardQuery(body),
    body.name?.trim() ? [body.name.trim(), district, state, "India"].filter(Boolean).join(", ") : "",
    postcode ? [postcode, district, state, "India"].filter(Boolean).join(", ") : "",
    district ? [district, state, "India"].filter(Boolean).join(", ") : "",
  ].filter(Boolean);

  return Array.from(new Set(queries));
}

function isAcceptableForwardResult(result: any) {
  const lat = result?.geometry?.lat;
  const lng = result?.geometry?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return false;

  const countryCode = String(result?.components?.country_code || "").toLowerCase();
  if (countryCode && countryCode !== "in") return false;

  const type = String(result?.components?._type || "").toLowerCase();
  if (type === "state" || type === "country" || type === "continent") return false;

  return true;
}

function extractPlaceAccuracy(result: any) {
  const confidence = result?.confidence;
  if (typeof confidence === "number") {
    return `OpenCage confidence ${confidence}/10`;
  }
  if (Array.isArray(result?.annotations?.what3words?.words)) {
    return `OpenCage reverse geocode`;
  }
  return undefined;
}

function buildError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function lookupLocationGeocode(body: GeocodeRequestBody | null) {
  const apiKey = sanitizeApiKey();
  if (!apiKey) {
    throw new Error(
      "Geocoding API key is not configured. Please set OPENCAGE_API_KEY in your environment.",
    );
  }

  const url = new URL("https://api.opencagedata.com/geocode/v1/json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("limit", "1");
  url.searchParams.set("no_annotations", "0");

  if (body?.reverse) {
    const lat = body.coordinates?.lat;
    const lng = body.coordinates?.lng;
    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      typeof lng !== "number" ||
      !Number.isFinite(lng)
    ) {
      const error = new Error("Valid coordinates are required for reverse geocoding.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    url.searchParams.set("q", `${lat},${lng}`);
  } else {
    const address = body?.address?.trim();
    if (!address) {
      const error = new Error("Missing address");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const forwardBody: GeocodeRequestBody = { ...body, address };
    url.searchParams.set("countrycode", "in");
    url.searchParams.set("bounds", INDIA_FORWARD_BOUNDS);
    let first: any | undefined;

    for (const query of buildForwardQueries(forwardBody)) {
      url.searchParams.set("q", query);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        let providerMessage = text || res.statusText;
        try {
          const parsed = JSON.parse(text) as { status?: { message?: string } };
          providerMessage = parsed?.status?.message || providerMessage;
        } catch {
          // Keep raw response.
        }
        const error = new Error(`Geocoding provider error (${res.status}): ${providerMessage}`);
        (error as Error & { status?: number }).status = 502;
        throw error;
      }

      const data = (await res.json()) as any;
      first = data?.results?.find(isAcceptableForwardResult);
      if (first) break;
    }

    const lat = first?.geometry?.lat;
    const lng = first?.geometry?.lng;

    if (typeof lat !== "number" || typeof lng !== "number") {
      const error = new Error("No coordinates found for the given location.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }

      return {
      lat,
      lng,
      formattedAddress: first?.formatted,
      placeAccuracy: extractPlaceAccuracy(first),
      provider: "opencage",
      entityType: forwardBody.entityType ?? "site",
    };
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    let providerMessage = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { status?: { message?: string } };
      providerMessage = parsed?.status?.message || providerMessage;
    } catch {
      // Keep raw response.
    }
    const error = new Error(`Geocoding provider error (${res.status}): ${providerMessage}`);
    (error as Error & { status?: number }).status = 502;
    throw error;
  }

  const data = (await res.json()) as any;
  const first = data?.results?.[0];
  const lat = first?.geometry?.lat;
  const lng = first?.geometry?.lng;

  if (typeof lat !== "number" || typeof lng !== "number") {
    const error = new Error("No coordinates found for the given location.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  return {
    lat,
    lng,
    formattedAddress: first?.formatted,
    placeAccuracy: extractPlaceAccuracy(first),
    provider: "opencage",
    entityType: body?.entityType ?? "site",
  };
}

export async function handleLocationGeocode(body: GeocodeRequestBody | null) {
  try {
    const result = await lookupLocationGeocode(body);
    await incrementSystemMetric(SYSTEM_METRIC_NAMES.geocodeSuccess);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Location geocode API error", error);
    await incrementSystemMetric(SYSTEM_METRIC_NAMES.geocodeFailure);
    return buildError(
      error?.message || "Unexpected server error while geocoding.",
      error?.status || 500,
    );
  }
}
