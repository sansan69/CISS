import { redirect } from 'next/navigation';

export default function VisitReportsPage() {
  redirect('/field-officers?tab=visit-reports');
}
