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

describe("dashboard operations overview", () => {
  it("uses a single compact hierarchy instead of duplicated headline metrics", () => {
    expect(dashboardSource).toContain("Operations overview");
    expect(dashboardSource).not.toContain("active guards");
    expect(dashboardSource).not.toContain("👋");
    expect(dashboardSource).toContain("roleSpecific={{ checkedIn: todayAttendanceDocs.length }}");
  });

  it("presents the live metrics as one responsive summary", () => {
    expect(statsSource).toContain('aria-label="Live workforce summary"');
    expect(statsSource).toContain("Attendance checks");
    expect(statsSource).toContain("Live data updates automatically");
    expect(statsSource).not.toContain("bezel");
    expect(statsSource).not.toContain("bg-blue-50");
  });

  it("keeps quick actions compact, descriptive, and keyboard accessible", () => {
    expect(actionsSource).toContain('aria-label="Quick access"');
    expect(actionsSource).toContain("Common operational tasks");
    expect(actionsSource).toContain("focus-visible:ring-2");
    expect(actionsSource).toContain("min-h-[76px]");
    expect(actionsSource).not.toContain("min-h-[116px]");
  });
});
