import { redirect } from 'next/navigation';

// The couple signup flow now lives on the unified /signup page.
export default async function CoupleSignupRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const params = new URLSearchParams({ as: 'couple' });
  if (next) params.set('next', next);
  redirect(`/signup?${params.toString()}`);
}
