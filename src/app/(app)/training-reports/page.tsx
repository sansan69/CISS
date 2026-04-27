import { PageHeader } from "@/components/layout/page-header";
import { TrainingReportsPanel } from "@/components/field-officers/training-reports-panel";

export default function TrainingReportsPage() {
  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Reports"
        title="Training Reports"
        description="Track delivered trainings, acknowledgements, and site-wise participation."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Training Reports" },
        ]}
      />
      <TrainingReportsPanel />
    </div>
  );
}
