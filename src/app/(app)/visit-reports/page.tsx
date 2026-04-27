import { PageHeader } from "@/components/layout/page-header";
import { VisitReportsPanel } from "@/components/field-officers/visit-reports-panel";

export default function VisitReportsPage() {
  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Reports"
        title="Visit Reports"
        description="Review field officer site visits, observations, and follow-up actions."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Visit Reports" },
        ]}
      />
      <VisitReportsPanel />
    </div>
  );
}
