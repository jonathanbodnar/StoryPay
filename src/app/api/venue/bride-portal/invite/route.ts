import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');
const INVITE_TTL_DAYS = 30;

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * POST /api/venue/bride-portal/invite
 * Body: { email: string, name?: string }
 * Invites a booked couple to the bride portal. Finds (or creates) the matching
 * venue_customer, mints a claim token, and emails the couple a claim link.
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { email?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim();
  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, brand_email')
    .eq('id', venueId)
    .maybeSingle();
  const venueName = (venue as { name?: string } | null)?.name || 'your venue';
  const brandEmail = (venue as { brand_email?: string | null } | null)?.brand_email?.trim() || undefined;

  // Find or create the booked-customer record for this email.
  let venueCustomerId: string;
  const { data: existingVc } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .ilike('customer_email', email)
    .maybeSingle();
  if (existingVc) {
    venueCustomerId = (existingVc as { id: string }).id;
  } else {
    const [fn, ...rest] = name.split(/\s+/);
    const { data: createdVc, error: vcErr } = await supabaseAdmin
      .from('venue_customers')
      .insert({
        venue_id: venueId,
        customer_email: email,
        first_name: fn || null,
        last_name: rest.join(' ') || null,
      })
      .select('id')
      .single();
    if (vcErr || !createdVc) {
      console.error('[bride-portal/invite] create vc', vcErr);
      return NextResponse.json({ error: 'Could not create the contact record.' }, { status: 500 });
    }
    venueCustomerId = (createdVc as { id: string }).id;
  }

  // Already linked?
  const { data: linked } = await supabaseAdmin
    .from('couple_weddings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', venueCustomerId)
    .eq('status', 'linked')
    .maybeSingle();
  if (linked) {
    return NextResponse.json({ ok: true, already: 'linked' });
  }

  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Reuse an outstanding venue invite for this customer if one exists.
  const { data: existingInvite } = await supabaseAdmin
    .from('couple_weddings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', venueCustomerId)
    .eq('status', 'pending')
    .eq('initiated_by', 'venue')
    .maybeSingle();

  if (existingInvite) {
    const { error: updErr } = await supabaseAdmin
      .from('couple_weddings')
      .update({ claim_token: token, claim_token_expires_at: expiresAt, invited_email: email, invited_name: name || null })
      .eq('id', (existingInvite as { id: string }).id);
    if (updErr) {
      console.error('[bride-portal/invite] refresh token', updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  } else {
    const { error: insErr } = await supabaseAdmin.from('couple_weddings').insert({
      venue_id: venueId,
      venue_customer_id: venueCustomerId,
      status: 'pending',
      initiated_by: 'venue',
      invited_email: email,
      invited_name: name || null,
      claim_token: token,
      claim_token_expires_at: expiresAt,
    });
    if (insErr) {
      console.error('[bride-portal/invite] insert', insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const claimUrl = `${APP_URL}/couple/claim/${token}`;
  const sendResult = await sendEmail({
    to: email,
    from: { name: venueName, email: brandEmail },
    subject: `${venueName} invited you to your wedding portal`,
    html: `
<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
  <p>Hi${name ? ` ${name.split(/\s+/)[0]}` : ''},</p>
  <p><strong>${venueName}</strong> invited you to connect on StoryVenue — one place to see your wedding details and message the venue directly.</p>
  <p style="margin:22px 0">
    <a href="${claimUrl}" style="background:#1b1b1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:600;display:inline-block">Connect with ${venueName}</a>
  </p>
  <p style="font-size:13px;color:#6b7280">Or paste this link into your browser:<br><a href="${claimUrl}" style="color:#1b1b1b">${claimUrl}</a></p>
  <p style="font-size:12px;color:#9ca3af">This invite expires in ${INVITE_TTL_DAYS} days.</p>
</div>`,
  });

  if (!sendResult.success) {
    return NextResponse.json(
      { error: `Invite created but the email failed to send: ${sendResult.error || 'unknown error'}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
