import { redirect } from 'next/navigation';

export default function LegacyMediaRedirect() {
  redirect('/dashboard/media');
}
