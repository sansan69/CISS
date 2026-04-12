import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appLayoutSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/layout.tsx"),
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
  it("keeps a single field officers entry in the sidebar", () => {
    expect(appLayoutSource).toContain("{ href: '/field-officers'");
    expect(appLayoutSource).toContain("label: 'Field Officers'");
  });

  it("removes standalone visit and training report links from the sidebar", () => {
    expect(appLayoutSource).not.toContain("{ href: '/visit-reports'");
    expect(appLayoutSource).not.toContain("{ href: '/training-reports'");
    expect(appLayoutSource).not.toContain("label: 'Visit Reports'");
    expect(appLayoutSource).not.toContain("label: 'Training Reports'");
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

  it("redirects legacy visit reports route into the field officers workspace", () => {
    expect(visitReportsPageSource).toContain("redirect('/field-officers?tab=visit-reports')");
  });

  it("redirects legacy training reports route into the field officers workspace", () => {
    expect(trainingReportsPageSource).toContain("redirect('/field-officers?tab=training-reports')");
  });
});
