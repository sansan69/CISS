import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appLayoutSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/layout.tsx"),
  "utf8",
);
const settingsPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
  "utf8",
);
const appContextSource = readFileSync(
  resolve(process.cwd(), "docs/app-context.md"),
  "utf8",
);
const hrmTodoSource = readFileSync(
  resolve(process.cwd(), "docs/hrm-upgrade-todo.md"),
  "utf8",
);
const branchTypesSource = readFileSync(
  resolve(process.cwd(), "src/types/branch.ts"),
  "utf8",
);

const branchOpsPagePath = resolve(
  process.cwd(),
  "src/app/(app)/branch-ops/page.tsx",
);
const branchOpsDetailPagePath = resolve(
  process.cwd(),
  "src/app/(app)/branch-ops/[branchId]/page.tsx",
);
const expensesPagePath = resolve(
  process.cwd(),
  "src/app/(app)/expenses/page.tsx",
);
const expenseMonthPagePath = resolve(
  process.cwd(),
  "src/app/(app)/expenses/[branchId]/[month]/page.tsx",
);
const branchesRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/branches/route.ts",
);
const expensesRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/expenses/[branchId]/[month]/route.ts",
);
const expenseApproveRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/expenses/[branchId]/[month]/approve/route.ts",
);

describe("branch admin feature removal", () => {
  it("does not expose branch ops or expenses in admin navigation", () => {
    expect(appLayoutSource).not.toContain("label: 'Branch Admin'");
    expect(appLayoutSource).not.toContain("{ href: '/branch-ops'");
    expect(appLayoutSource).not.toContain("{ href: '/expenses'");
    expect(appLayoutSource).not.toContain("label: 'Branch Ops'");
    expect(appLayoutSource).not.toContain("label: 'Expenses'");
    expect(appLayoutSource).not.toContain("label: 'Branches'");
  });

  it("does not show a branch settings card", () => {
    expect(settingsPageSource).not.toContain('title: "Branches"');
    expect(settingsPageSource).not.toContain('href: "/branch-ops"');
    expect(settingsPageSource).not.toContain(
      "Manage field branches, visit reports, training sessions, and expenses.",
    );
  });

  it("does not ship branch ops or branch expense routes and apis", () => {
    expect(existsSync(branchOpsPagePath)).toBe(false);
    expect(existsSync(branchOpsDetailPagePath)).toBe(false);
    expect(existsSync(expensesPagePath)).toBe(false);
    expect(existsSync(expenseMonthPagePath)).toBe(false);
    expect(existsSync(branchesRoutePath)).toBe(false);
    expect(existsSync(expensesRoutePath)).toBe(false);
    expect(existsSync(expenseApproveRoutePath)).toBe(false);
  });

  it("does not keep branch ops or expenses in the live app docs", () => {
    expect(appContextSource).not.toContain("/branch-ops");
    expect(appContextSource).not.toContain("/expenses");
    expect(appContextSource).not.toContain("Branch ops");
    expect(appContextSource).not.toContain("expenses are part of the authenticated app");
    expect(hrmTodoSource).not.toContain("branchExpenses");
  });

  it("removes branch and expense-only types from the shared branch types file", () => {
    expect(branchTypesSource).not.toContain("export interface Branch");
    expect(branchTypesSource).not.toContain("export type ExpenseCategory");
    expect(branchTypesSource).not.toContain("export type ExpenseSheetStatus");
    expect(branchTypesSource).not.toContain("export interface ExpenseEntry");
    expect(branchTypesSource).not.toContain("export interface BranchExpense");
  });
});
