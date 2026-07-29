import { describe, expect, it } from "vitest";

import {
  isClientVisibleReport,
  trainingReportInputSchema,
  visitReportInputSchema,
} from "./report-schema";

describe("report schemas and visibility", () => {
  it("never exposes drafts to clients", () => {
    expect(isClientVisibleReport({ status: "draft" })).toBe(false);
    expect(
      isClientVisibleReport({ status: "submitted", visibility: "private_draft" }),
    ).toBe(false);
  });

  it("keeps submitted legacy and current reports client-visible", () => {
    expect(isClientVisibleReport({ status: "submitted" })).toBe(true);
    expect(isClientVisibleReport({ status: "reviewed" })).toBe(true);
    expect(
      isClientVisibleReport({ status: "submitted", visibility: "client_visible" }),
    ).toBe(true);
  });

  it("allows delayed visit submission without location", () => {
    const result = visitReportInputSchema.safeParse({
      clientId: "client-1",
      siteId: "site-1",
      visitDate: "2026-07-20",
      summary: "Visit recorded after leaving the site.",
      status: "submitted",
      photoUrls: ["https://example.com/visit.jpg"],
    });
    expect(result.success).toBe(true);
  });

  it("allows training submission from any location", () => {
    const result = trainingReportInputSchema.safeParse({
      clientId: "client-1",
      siteId: "site-1",
      trainingDate: "2026-07-20",
      topic: "Emergency response",
      status: "submitted",
      photoUrls: ["https://example.com/training.jpg"],
      clientReportUrl: "https://example.com/signed.pdf",
    });
    expect(result.success).toBe(true);
  });

  it("rejects arbitrary statuses and invalid coordinates", () => {
    expect(
      visitReportInputSchema.safeParse({
        clientId: "client-1",
        visitDate: "2026-07-20",
        summary: "Visit",
        status: "approved",
      }).success,
    ).toBe(false);
    expect(
      visitReportInputSchema.safeParse({
        clientId: "client-1",
        visitDate: "2026-07-20",
        summary: "Visit",
        visitLocation: { lat: 200, lng: 76 },
      }).success,
    ).toBe(false);
  });
});
