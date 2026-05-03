import { redirect } from 'next/navigation';

export default function EmailTemplatesRedirect() {
  redirect('/dashboard/settings/notifications');
}
