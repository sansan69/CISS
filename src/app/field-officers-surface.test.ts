import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const navigationSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/navigation.ts"),
  "utf8",
);
const fieldOfficersPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/field-officers/page.tsx"),
  "utf8",
);
const visitReportsPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/visit-reports/page.tsx"),
  "utf8",
);
const trainingReportsPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/training-reports/page.tsx"),
  "utf8",
);

describe("field officer operations surface", () => {
  it("keeps field officer routes in the navigation model", () => {
    expect(navigationSource).toContain("href: \"/field-officers\"");
    expect(navigationSource).toContain("href: \"/visit-reports\"");
    expect(navigationSource).toContain("href: \"/training-reports\"");
    expect(navigationSource).toContain("fieldOfficerVisible: true");
  });

  it("uses the field officers page as the combined workspace", () => {
    expect(fieldOfficersPageSource).toContain('title="Field Officers"');
    expect(fieldOfficersPageSource).toContain("label: 'Officers'");
    expect(fieldOfficersPageSource).toContain("label: 'Visit Reports'");
    expect(fieldOfficersPageSource).toContain("label: 'Training Reports'");
    expect(fieldOfficersPageSource).toContain("searchParams.get('tab')");
    expect(fieldOfficersPageSource).toContain("value=\"visit-reports\"");
    expect(fieldOfficersPageSource).toContain("value=\"training-reports\"");
  });

  it("keeps standalone visit reports as a wrapper page", () => {
    expect(visitReportsPageSource).toContain('title="Visit Reports"');
    expect(visitReportsPageSource).toContain("<VisitReportsPanel />");
  });

  it("keeps standalone training reports as a wrapper page", () => {
    expect(trainingReportsPageSource).toContain('title="Training Reports"');
    expect(trainingReportsPageSource).toContain("<TrainingReportsPanel />");
  });
});
