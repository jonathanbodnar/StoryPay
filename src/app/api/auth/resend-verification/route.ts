import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { issueAndSendVerificationEmail } from '@/lib/email-verification';
import { rateLimitAny, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/resend-verification
 *
 * Re-sends the email-verification link to the signed-in venue's address.
 * Always returns ok:true so this endpoint does not leak whether the user
 * is signed in or already verified.
 */
export async function POST(request: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ ok: true });

  const ip = getClientIp(request);
  const rl = rateLimitAny([
    { key: `resend-verify:ip:${ip}`,        limit: 5, windowMs: 60 * 60_000 },
    { key: `resend-verify:venue:${venueId}`, limit: 3, windowMs: 60 * 60_000 },
  ]);
  if (!rl.allowed) return NextResponse.json({ ok: true });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, email, name, owner_first_name, email_verified_at')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue || !venue.email) return NextResponse.json({ ok: true });
  if (venue.email_verified_at) {
    // Already verified — pretend we sent it.
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  await issueAndSendVerificationEmail({
    venueId:   venue.id as string,
    email:     venue.email as string,
    firstName: (venue.owner_first_name as string | null) ?? null,
    venueName: (venue.name as string | null) ?? null,
  });

  return NextResponse.json({ ok: true });
}
