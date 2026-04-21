import { redirect } from 'next/navigation';

export default function LegacyAutomationsListRedirect() {
  redirect('/dashboard/marketing/workflows');
}
