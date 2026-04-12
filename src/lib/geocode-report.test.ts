import { describe, expect, it } from "vitest";

import {
  buildGeocodeReportLine,
  getGeocodeStatusMarker,
  normalizeGeocodeStatus,
} from "./geocode-report";

describe("normalizeGeocodeStatus", () => {
  it("maps legacy noResult to no_result", () => {
    expect(normalizeGeocodeStatus("noResult")).toBe("no_result");
  });

  it("preserves current API statuses", () => {
    expect(normalizeGeocodeStatus("skipped")).toBe("skipped");
    expect(normalizeGeocodeStatus("updated")).toBe("updated");
  });
});

describe("getGeocodeStatusMarker", () => {
  it("treats no_result as a warning, not a hard failure", () => {
    expect(getGeocodeStatusMarker("no_result")).toBe("⚠️");
  });

  it("treats skipped as informational", () => {
    expect(getGeocodeStatusMarker("skipped")).toBe("ℹ️");
  });
});

describe("buildGeocodeReportLine", () => {
  it("builds a readable warning line for no_result responses", () => {
    expect(
      buildGeocodeReportLine({
        siteName: "Example Site",
        clientName: "Example Client",
        status: "no_result",
        message: "No coordinates found for the given location.",
      }),
    ).toBe(
      "⚠️ Example Site (Example Client) – No coordinates found for the given location.",
    );
  });
});
