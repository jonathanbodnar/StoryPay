import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /verify-email/<token>
 *
 * Public landing for the link inside the verification email. Hands off
 * to /api/auth/verify-email/<token>, which redeems the token, sets the
 * session cookie, kicks off LunarPay merchant provisioning, and
 * redirects to /verify-email/success or /verify-email/invalid.
 */
export default async function VerifyEmailRedirect({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/api/auth/verify-email/${encodeURIComponent(token)}`);
}
