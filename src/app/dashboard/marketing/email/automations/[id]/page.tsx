import { redirect } from 'next/navigation';

export default async function LegacyAutomationEditRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/marketing/workflows/${id}`);
}
