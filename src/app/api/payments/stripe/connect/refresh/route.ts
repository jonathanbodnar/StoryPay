/**
 * GET /api/payments/stripe/connect/refresh
 *
 * Stripe sends the venue here when its signup link expired or was already
 * used; open a fresh one.
 */
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { createOnboardingLink } from '@/lib/stripe/connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${APP_URL}/login?next=/dashboard/payments/settings`);
  try {
    return NextResponse.redirect(await createOnboardingLink(user.venueId));
  } catch (e) {
    console.error('[payments/stripe/connect/refresh]', e instanceof Error ? e.message : e);
    return NextResponse.redirect(`${APP_URL}/dashboard/payments/settings?stripe=error`);
  }
}
