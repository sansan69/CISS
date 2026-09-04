import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
  "utf8",
);
const statsSource = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/stats.tsx"),
  "utf8",
);
const actionsSource = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/actions.tsx"),
  "utf8",
);
const attentionSource = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/attention-panel.tsx"),
  "utf8",
);
const chartsSource = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/charts.tsx"),
  "utf8",
);
const spotlightSource = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/role-spotlight.tsx"),
  "utf8",
);
const clientDashboardSource = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/client-operations-dashboard.tsx"),
  "utf8",
);

describe("dashboard operations overview", () => {
  it("uses a single compact hierarchy instead of duplicated headline metrics", () => {
    expect(dashboardSource).toContain("Operations overview");
    expect(dashboardSource).not.toContain("active guards");
    expect(dashboardSource).not.toContain("👋");
    expect(dashboardSource).toContain("attendanceSnapshot.checkedInUnique");
  });

  it("presents the live metrics as one responsive summary", () => {
    expect(statsSource).toContain('aria-label="Live workforce summary"');
    expect(statsSource).toContain("Checked in today");
    expect(statsSource).toContain("Live data updates automatically");
    expect(statsSource).toContain("% on duty");
    expect(statsSource).toContain("vs yesterday");
    expect(statsSource).toContain("Live data · updated");
    expect(statsSource).not.toContain("bezel");
    expect(statsSource).not.toContain("bg-blue-50");
  });

  it("keeps quick actions compact, descriptive, and keyboard accessible", () => {
    expect(actionsSource).toContain('aria-label="Quick access"');
    expect(actionsSource).toContain("Common operational tasks");
    expect(actionsSource).toContain('label: "Attendance", description: "Review daily records", href: "/attendance-logs"');
    expect(actionsSource).not.toContain('label: "Attendance", description: "Review daily records", href: "/attendance"');
    expect(actionsSource).toContain("focus-visible:ring-2");
    expect(actionsSource).toContain("min-h-[112px]");
    expect(actionsSource).toContain("grid-cols-1 gap-3");
    expect(actionsSource).not.toContain("overflow-hidden rounded-2xl border border-border/70 bg-card");
  });

  it("surfaces actionable issues instead of raw numbers only", () => {
    expect(attentionSource).toContain("Needs attention");
    expect(attentionSource).toContain("Issues that need a decision right now");
    expect(attentionSource).toContain("mock-location alert");
    expect(attentionSource).toContain("coveragePct < 70");
    expect(attentionSource).not.toContain("👋");
  });

  it("keeps workforce insights charted with an export escape hatch", () => {
    expect(chartsSource).toContain("Workforce insights");
    expect(chartsSource).toContain("Export CSV");
    expect(chartsSource).toContain("downloadCsv");
    expect(chartsSource).toContain("New Hires");
    expect(chartsSource).toContain("Guard Distribution");
  });

  it("puts each operational role inside its actual next task", () => {
    expect(spotlightSource).toContain("Your field brief");
    expect(spotlightSource).toContain("Operations pulse");
    expect(spotlightSource).toContain("Next duty");
    expect(spotlightSource).toContain("Open attendance review");
    expect(clientDashboardSource).toContain("Sites covered");
    expect(clientDashboardSource).toContain("xl:grid-cols-5");
    expect(clientDashboardSource).not.toContain("bg-brand-blue-darker");
  });
});
