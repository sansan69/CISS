import { redirect } from 'next/navigation';
export default function ClientLocationsRedirect() {
  redirect('/settings/clients');
}
