import { redirect } from 'next/navigation';
export default function ClientManagementRedirect() {
  redirect('/settings/clients');
}
