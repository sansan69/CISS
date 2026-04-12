export type GeocodeStatus =
  | "created"
  | "updated"
  | "kept"
  | "failed"
  | "noResult"
  | "no_result"
  | "skipped";

export type GeocodeReportItem = {
  clientName?: string;
  siteName?: string;
  status: GeocodeStatus;
  message: string;
};

export function normalizeGeocodeStatus(status: GeocodeStatus) {
  return status === "noResult" ? "no_result" : status;
}

export function getGeocodeStatusMarker(status: GeocodeStatus) {
  switch (normalizeGeocodeStatus(status)) {
    case "updated":
    case "created":
      return "✅";
    case "kept":
    case "skipped":
      return "ℹ️";
    case "no_result":
      return "⚠️";
    case "failed":
    default:
      return "❌";
  }
}

export function buildGeocodeReportLine(item: GeocodeReportItem) {
  const marker = getGeocodeStatusMarker(item.status);
  return `${marker} ${item.siteName || "Unknown site"} (${item.clientName || "Unknown client"}) – ${item.message}`;
}
