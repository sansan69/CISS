import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isWorkOrderAdminRole } from "../lib/work-orders";

const appLayoutSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/layout.tsx"),
  "utf8",
);
const navigationSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/navigation.ts"),
  "utf8",
);
const workOrdersPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/work-orders/page.tsx"),
  "utf8",
);
const workOrdersImportsPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/work-orders/imports/page.tsx"),
  "utf8",
);
const workOrdersRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/admin/work-orders/route.ts"),
  "utf8",
);
const workOrdersBulkDeleteRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/admin/work-orders/bulk-delete/route.ts"),
  "utf8",
);
const assignedGuardsExportPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/work-orders/assigned-guards-export/page.tsx"),
  "utf8",
);
const workOrderTypesSource = readFileSync(
  resolve(process.cwd(), "src/types/work-orders.ts"),
  "utf8",
);
const workOrdersSitePageSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/work-orders/[siteId]/page.tsx"),
  "utf8",
);
const fieldOfficerWorkOrdersPanelSource = readFileSync(
  resolve(process.cwd(), "src/components/field-officers/work-orders-panel.tsx"),
  "utf8",
);
const assignedGuardsExportPanelSource = readFileSync(
  resolve(process.cwd(), "src/components/work-orders/assigned-guards-export-panel.tsx"),
  "utf8",
);

describe("work orders operations surface", () => {
  it("keeps work orders as the single sidebar entry for assignment and export flow", () => {
    expect(navigationSource).toContain('href: "/work-orders"');
    expect(navigationSource).toContain('label: "Work Orders"');
    expect(navigationSource).toContain('href: "/settings/work-order-imports"');
    expect(navigationSource).toContain('label: "Work Order Imports"');
    expect(appLayoutSource).toContain("getVisibleGroups(mainNavGroups");
    expect(appLayoutSource).toContain("getVisibleNavItems(bottomNavItems");
  });

  it("adds an admin-only work order imports entry to the app layout", () => {
    expect(navigationSource).toContain('href: "/settings/work-order-imports"');
    expect(navigationSource).toContain('adminOnly: true');
  });

  it("uses the work orders page as the combined workspace", () => {
    expect(workOrdersPageSource).toContain("searchParams.get('tab')");
    expect(workOrdersPageSource).toContain("value=\"assignments\"");
    expect(workOrdersPageSource).toContain("value=\"assigned-guards-export\"");
    expect(workOrdersPageSource).toContain("label: 'Export'");
    expect(workOrdersPageSource).toContain("/api/admin/work-orders/import/preview");
    expect(workOrdersPageSource).toContain("/api/admin/work-orders/import/commit");
    expect(workOrdersPageSource).toContain("Preview Import");
    expect(workOrdersPageSource).toContain("Confirm Import");
    expect(workOrdersPageSource).not.toContain("Upload & Process File");
  });

  it("keeps the assigned guards export tab admin only", () => {
    expect(workOrdersPageSource).toContain("isWorkOrderAdminRole(userRole)");
    expect(workOrdersPageSource).toContain("fieldOfficerLabel: 'Upcoming Duties'");
  });

  it("redirects the legacy export route into the work orders workspace", () => {
    expect(assignedGuardsExportPageSource).toContain("redirect('/work-orders?tab=assigned-guards-export')");
  });

  it("confirms imports through the batch commit route and still normalizes dates on the server", () => {
    expect(workOrdersPageSource).toContain("parserMode: importPreview.parserMode");
    expect(workOrdersPageSource).toContain("rows: rowsWithExam");
    expect(workOrdersPageSource).not.toContain("buildTcsExamDiff({");
    expect(workOrdersRouteSource).toContain("function normalizeWorkOrderDate");
    expect(workOrdersRouteSource).toContain('if ("date" in filtered)');
    expect(workOrdersImportsPageSource).toContain('collection(db, "workOrders")');
    expect(workOrdersImportsPageSource).toContain("onSnapshot");
    expect(workOrdersImportsPageSource).toContain("rowCount");
    expect(workOrdersImportsPageSource).toContain("recordStatus");
  });

  it("supports editable previews and deletes visible site rows from the database", () => {
    expect(workOrdersPageSource).toContain("updatePreviewRow");
    expect(workOrdersPageSource).toContain('onChange={(event) => updatePreviewRow(originalIndex, "siteName", event.target.value)}');
    expect(workOrdersPageSource).toContain('onChange={(event) => updatePreviewRow(originalIndex, "maleGuardsRequired", event.target.value)}');
    expect(workOrdersPageSource).toContain("handleDeleteOrders(row.orders)");
    expect(workOrdersPageSource).toContain("body: JSON.stringify({ workOrderIds: ids })");
    expect(workOrdersPageSource).toContain("duplicateResolution");
    expect(workOrdersPageSource).toContain("Replace matching work orders");
    expect(workOrdersPageSource).toContain("Omit matching work orders");
    expect(workOrdersBulkDeleteRouteSource).toContain("Array.isArray(body.workOrderIds)");
    expect(workOrdersBulkDeleteRouteSource).toContain("cleanupOrphanWorkOrderImports");
    expect(workOrdersBulkDeleteRouteSource).toContain("batch.delete(ref)");
  });

  it("work order shared types migration", () => {
    expect(workOrderTypesSource).toContain("examName?: string;");
    expect(workOrderTypesSource).toContain("examCode?: string;");
    expect(workOrderTypesSource).toContain("recordStatus?: string;");
    expect(workOrderTypesSource).toContain("importId?: string;");
    expect(workOrderTypesSource).toContain("sourceFileName?: string;");
    expect(isWorkOrderAdminRole("admin")).toBe(true);
    expect(isWorkOrderAdminRole("superAdmin")).toBe(true);
    expect(isWorkOrderAdminRole("fieldOfficer")).toBe(false);
    expect(workOrdersSitePageSource).toContain("isWorkOrderAdminRole(userRole)");
    expect(workOrdersSitePageSource).toContain("type WorkOrderExamFields = Pick<");
    expect(workOrdersSitePageSource).toContain("'examName' | 'examCode' | 'recordStatus' | 'importId' | 'sourceFileName'");
    expect(workOrdersSitePageSource).toContain("const activeOrders = useMemo");
    expect(workOrdersSitePageSource).toContain("recordStatus ?? 'active'");
    expect(workOrdersSitePageSource).toContain('order.examName || order.examCode || "General Duty"');
    expect(fieldOfficerWorkOrdersPanelSource).toContain("isWorkOrderAdminRole(userRole)");
    expect(fieldOfficerWorkOrdersPanelSource).toContain("const assignedGuards = Array.isArray(order.assignedGuards) ? order.assignedGuards : [];");
    expect(fieldOfficerWorkOrdersPanelSource).toContain("type WorkOrderExamFields = Pick<");
    expect(fieldOfficerWorkOrdersPanelSource).toContain("\"examName\" | \"examCode\" | \"recordStatus\" | \"importId\" | \"sourceFileName\"");
    expect(fieldOfficerWorkOrdersPanelSource).toContain("const activeWorkOrders = useMemo");
    expect(fieldOfficerWorkOrdersPanelSource).toContain("recordStatus ?? \"active\"");
    expect(fieldOfficerWorkOrdersPanelSource).toContain("assignedGuards.slice(0, 4).map");
    expect(fieldOfficerWorkOrdersPanelSource).toContain('order.examName || order.examCode || "General Duty"');
    expect(workOrdersPageSource).toContain("recordStatus ?? 'active'");
    expect(workOrdersPageSource).toContain("getWorkOrderExamLabel(order) || 'General Duty'");
    expect(assignedGuardsExportPanelSource).toContain("'Exam Name'");
    expect(assignedGuardsExportPanelSource).toContain('workOrder.examName || workOrder.examCode || "General Duty"');
  });
});
