import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appLayoutSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/layout.tsx"),
  "utf8",
);
const workOrdersPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/work-orders/page.tsx"),
  "utf8",
);
const assignedGuardsExportPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/work-orders/assigned-guards-export/page.tsx"),
  "utf8",
);

describe("work orders operations surface", () => {
  it("keeps work orders as the single sidebar entry for assignment and export flow", () => {
    expect(appLayoutSource).toContain("{ href: '/work-orders'");
    expect(appLayoutSource).toContain("label: 'Work Orders'");
    expect(appLayoutSource).not.toContain("{ href: '/work-orders/assigned-guards-export'");
    expect(appLayoutSource).not.toContain("label: 'Assigned Guards Export'");
  });

  it("uses the work orders page as the combined workspace", () => {
    expect(workOrdersPageSource).toContain("searchParams.get('tab')");
    expect(workOrdersPageSource).toContain("value=\"assignments\"");
    expect(workOrdersPageSource).toContain("value=\"assigned-guards-export\"");
    expect(workOrdersPageSource).toContain("label: 'Assigned Guards Export'");
  });

  it("keeps the assigned guards export tab admin only", () => {
    expect(workOrdersPageSource).toContain("userRole === 'admin' ? ADMIN_TABS : FIELD_OFFICER_TABS");
    expect(workOrdersPageSource).toContain("fieldOfficerLabel: 'Upcoming Duties'");
  });

  it("redirects the legacy export route into the work orders workspace", () => {
    expect(assignedGuardsExportPageSource).toContain("redirect('/work-orders?tab=assigned-guards-export')");
  });
});
