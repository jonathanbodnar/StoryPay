import { redirect } from 'next/navigation';

// The couple login flow now lives on the unified /login page. Preserve the
// `?next=` query string so post-login redirects to wishlists/venue pages
// still land in the right place.
export default async function CoupleLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const params = new URLSearchParams({ as: 'couple' });
  if (next) params.set('next', next);
  redirect(`/login?${params.toString()}`);
}
