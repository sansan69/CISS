import { redirect } from 'next/navigation';

export default function AssignedGuardsExportPage() {
  redirect('/work-orders?tab=assigned-guards-export');
}
