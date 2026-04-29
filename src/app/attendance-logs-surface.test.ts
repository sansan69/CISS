import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const attendanceLogsPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/attendance-logs/page.tsx"),
  "utf8",
);

describe("attendance logs detail sheet", () => {
  it("keeps the detail sheet compact and photo-first", () => {
    expect(attendanceLogsPageSource).toContain("sm:max-w-2xl");
    expect(attendanceLogsPageSource).toContain("object-contain");
    expect(attendanceLogsPageSource).toContain("aspect-[4/3]");
    expect(attendanceLogsPageSource).toContain("Reported at");
    expect(attendanceLogsPageSource).toContain("Server recorded");
    expect(attendanceLogsPageSource).toContain("Attendance date");
    expect(attendanceLogsPageSource).not.toContain("GPS & Location");
    expect(attendanceLogsPageSource).not.toContain("Uniform / Photo Compliance");
    expect(attendanceLogsPageSource).not.toContain("object-cover");
  });
});
