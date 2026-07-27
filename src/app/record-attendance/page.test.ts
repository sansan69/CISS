import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/record-attendance/page.tsx"),
  "utf8",
);

describe("legacy record-attendance entry point", () => {
  it("redirects to the canonical attendance flow", () => {
    expect(source).toContain('redirect("/attendance")');
    expect(source).not.toContain("/api/attendance/submit");
    expect(source).not.toContain("/api/public/attendance/upload");
  });
});
