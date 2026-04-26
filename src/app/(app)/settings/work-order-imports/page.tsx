"use client";

import { WorkOrderImportsPanel } from "@/components/work-orders/imports-panel";
import { PageHeader } from "@/components/layout/page-header";

export default function WorkOrderImportsSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Order Imports"
        description="View all uploaded work orders and their details"
      />
      <WorkOrderImportsPanel />
    </div>
  );
}
