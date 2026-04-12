import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settingsPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
  "utf8",
);
const appLayoutSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/layout.tsx"),
  "utf8",
);
const dashboardActionsSource = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/actions.tsx"),
  "utf8",
);
const payrollPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/payroll/page.tsx"),
  "utf8",
);
const payrollRunRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/admin/payroll/run/route.ts"),
  "utf8",
);
const complianceSettingsPagePath = resolve(
  process.cwd(),
  "src/app/(app)/settings/compliance-settings/page.tsx",
);
const adminToolsPagePath = resolve(
  process.cwd(),
  "src/app/(app)/settings/admin-tools/page.tsx",
);
const salaryGradesPagePath = resolve(
  process.cwd(),
  "src/app/(app)/settings/salary-grades/page.tsx",
);
const payrollSalariesPagePath = resolve(
  process.cwd(),
  "src/app/(app)/payroll/salaries/page.tsx",
);
const salaryStructuresRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/salary-structures/route.ts",
);
const salaryStructuresDetailRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/salary-structures/[id]/route.ts",
);
const employeeSalariesRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/employee-salaries/route.ts",
);
const employeeSalaryRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/employees/[id]/salary/route.ts",
);

describe("admin settings surface", () => {
  it("shows a single admin tools card on the settings landing page", () => {
    expect(settingsPageSource).toContain('title: "Admin Tools"');
    expect(settingsPageSource).toContain('href: "/settings/admin-tools"');
    expect(settingsPageSource).toContain(
      "Access bulk imports, QR maintenance, and full data exports from one utility hub.",
    );
  });

  it("does not show separate bulk import, qr management, or data export cards", () => {
    expect(settingsPageSource).not.toContain('title: "Bulk Employee Import"');
    expect(settingsPageSource).not.toContain('title: "QR Code Management"');
    expect(settingsPageSource).not.toContain('title: "Export All Data"');
    expect(settingsPageSource).not.toContain('href: "/settings/bulk-import"');
    expect(settingsPageSource).not.toContain('href: "/settings/qr-management"');
    expect(settingsPageSource).not.toContain('href: "/settings/data-export"');
  });

  it("shows a single combined clients and sites card on the settings landing page", () => {
    expect(settingsPageSource).toContain('title: "Clients & Sites"');
    expect(settingsPageSource).toContain('href: "/settings/clients"');
    expect(settingsPageSource).toContain(
      "Manage clients, office locations, and duty sites from one workspace.",
    );
  });

  it("does not show separate client management, client locations, or duty sites cards", () => {
    expect(settingsPageSource).not.toContain('title: "Client Management"');
    expect(settingsPageSource).not.toContain('title: "Client Locations"');
    expect(settingsPageSource).not.toContain('title: "Duty Sites"');
    expect(settingsPageSource).not.toContain('href: "/settings/client-management"');
    expect(settingsPageSource).not.toContain('href: "/settings/client-locations"');
    expect(settingsPageSource).not.toContain('href: "/settings/site-management"');
  });

  it("does not show a compliance settings card on the settings landing page", () => {
    expect(settingsPageSource).not.toContain('title: "Compliance Settings"');
    expect(settingsPageSource).not.toContain('href: "/settings/compliance-settings"');
  });

  it("does not duplicate assigned guards export on the settings landing page", () => {
    expect(settingsPageSource).not.toContain('title: "Assigned Guards Export"');
    expect(settingsPageSource).not.toContain('href: "/settings/assigned-guards-export"');
  });

  it("does not expose salary grades or salary assignments on the settings landing page", () => {
    expect(settingsPageSource).not.toContain('title: "Salary Grades"');
    expect(settingsPageSource).not.toContain('title: "Salary Assignments"');
    expect(settingsPageSource).not.toContain('href: "/settings/salary-grades"');
    expect(settingsPageSource).not.toContain('href: "/payroll/salaries"');
  });

  it("does not expose compliance settings in the settings sidebar", () => {
    expect(appLayoutSource).not.toContain("'/settings/compliance-settings'");
    expect(appLayoutSource).not.toContain("label: 'Compliance Settings'");
  });

  it("shows a single admin tools item in the settings sidebar", () => {
    expect(appLayoutSource).toContain("{ href: '/settings/admin-tools'");
    expect(appLayoutSource).toContain("label: 'Admin Tools'");
  });

  it("does not expose bulk import, qr codes, or data export as separate settings sidebar items", () => {
    expect(appLayoutSource).not.toContain("{ href: '/settings/bulk-import'");
    expect(appLayoutSource).not.toContain("{ href: '/settings/qr-management'");
    expect(appLayoutSource).not.toContain("{ href: '/settings/data-export'");
    expect(appLayoutSource).not.toContain("label: 'Bulk Import'");
    expect(appLayoutSource).not.toContain("label: 'QR Codes'");
    expect(appLayoutSource).not.toContain("label: 'Data Export'");
  });

  it("does not expose salary grade workflows in the settings sidebar", () => {
    expect(appLayoutSource).not.toContain("{ href: '/settings/salary-grades'");
    expect(appLayoutSource).not.toContain("{ href: '/payroll/salaries'");
    expect(appLayoutSource).not.toContain("label: 'Salary Grades'");
    expect(appLayoutSource).not.toContain("label: 'Salary Assignments'");
  });

  it("does not expose a compliance settings quick action", () => {
    expect(dashboardActionsSource).not.toContain('label: "Compliance Settings"');
    expect(dashboardActionsSource).not.toContain('href: "/settings/compliance-settings"');
  });

  it("does not expose salary assignment quick actions or payroll shortcuts", () => {
    expect(dashboardActionsSource).not.toContain('href: "/payroll/salaries"');
    expect(dashboardActionsSource).not.toContain('label: "View Salaries"');
    expect(payrollPageSource).not.toContain('router.push("/payroll/salaries")');
    expect(payrollPageSource).not.toContain("Salary Assignments");
  });

  it("does not ship the old compliance settings page route", () => {
    expect(existsSync(complianceSettingsPagePath)).toBe(false);
  });

  it("ships the admin tools hub route", () => {
    expect(existsSync(adminToolsPagePath)).toBe(true);
  });

  it("does not ship salary grade or salary assignment routes and apis", () => {
    expect(existsSync(salaryGradesPagePath)).toBe(false);
    expect(existsSync(payrollSalariesPagePath)).toBe(false);
    expect(existsSync(salaryStructuresRoutePath)).toBe(false);
    expect(existsSync(salaryStructuresDetailRoutePath)).toBe(false);
    expect(existsSync(employeeSalariesRoutePath)).toBe(false);
    expect(existsSync(employeeSalaryRoutePath)).toBe(false);
  });

  it("does not keep salary structure collections in the payroll run route", () => {
    expect(payrollRunRouteSource).not.toContain("employeeSalaries");
    expect(payrollRunRouteSource).not.toContain("salaryStructures");
    expect(payrollRunRouteSource).not.toContain("salaryStructureId");
    expect(payrollRunRouteSource).not.toContain("salaryStructureName");
  });
});
