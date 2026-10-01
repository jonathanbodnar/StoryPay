import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';
import { sendEmail } from '@/lib/email';
import { resolveCoupleInviteFrom } from '@/lib/couple-website-invite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_RECIPIENTS = 500;
/**
 * Guest emails share one rolling-24h allowance with website invites (the same
 * send log): a few sends and a few hundred guests a day is plenty for a real
 * couple and keeps the sending domain clean.
 */
const MAX_SENDS_PER_DAY = 3;
const MAX_RECIPIENTS_PER_DAY = 500;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface GuestLite {
  id: string;
  full_name: string;
  email: string | null;
  rsvp_status: string | null;
}

/**
 * POST /api/couple/guests/blast
 * Body: { subject, message, attendingOnly? }
 * Sends a custom email to the couple's guests (those with an email). Replies go
 * to the couple's own inbox. The couple only (not collaborators).
 */
export async function POST(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true });
  if (!gate.ok) return gate.res;
  const { user, wedding: link } = gate.ctx;

  let body: { subject?: unknown; message?: unknown; attendingOnly?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const subject = String(body.subject ?? '').trim().slice(0, 150);
  const message = String(body.message ?? '').trim().slice(0, 5000);
  const attendingOnly = body.attendingOnly === true;
  if (!subject) return NextResponse.json({ error: 'Add a subject line.' }, { status: 400 });
  if (message.length < 2) return NextResponse.json({ error: 'Write a message to send.' }, { status: 400 });

  const [{ data: guests }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from('wedding_guests')
      .select('id, full_name, email, rsvp_status')
      .eq('couple_wedding_id', link.id),
    supabaseAdmin
      .from('couple_profiles')
      .select('display_name, first_name, last_name, partner_first_name')
      .eq('id', link.couple_id)
      .maybeSingle(),
  ]);

  const p = profile as
    | { display_name?: string | null; first_name?: string | null; last_name?: string | null; partner_first_name?: string | null }
    | null;
  const coupleName =
    [p?.first_name, p?.partner_first_name].filter(Boolean).join(' & ').trim() ||
    p?.display_name?.trim() ||
    'The couple';

  const rows = (guests ?? []) as GuestLite[];
  const targets = rows
    .filter((g) => g.email && (!attendingOnly || g.rsvp_status === 'attending'))
    .slice(0, MAX_RECIPIENTS);

  const skippedNoEmail = rows.filter((g) => !g.email).length;
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, skippedNoEmail });
  }

  // Shared daily allowance with website invites.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentSends } = await supabaseAdmin
    .from('couple_website_invite_sends')
    .select('recipient_count')
    .eq('couple_wedding_id', link.id)
    .gte('created_at', since);
  const sendsToday = (recentSends ?? []).length;
  const recipientsToday = ((recentSends ?? []) as { recipient_count: number | null }[]).reduce((s, r) => s + (r.recipient_count ?? 0), 0);
  if (sendsToday >= MAX_SENDS_PER_DAY) {
    return NextResponse.json({ error: `You can send up to ${MAX_SENDS_PER_DAY} guest emails in 24 hours. Please try again tomorrow.` }, { status: 429 });
  }
  if (recipientsToday + targets.length > MAX_RECIPIENTS_PER_DAY) {
    const left = Math.max(0, MAX_RECIPIENTS_PER_DAY - recipientsToday);
    return NextResponse.json({
      error: left > 0
        ? `You can email up to ${MAX_RECIPIENTS_PER_DAY} guests in 24 hours, and ${left} are left today.`
        : `You've emailed ${MAX_RECIPIENTS_PER_DAY} guests in the last 24 hours. Please try again tomorrow.`,
    }, { status: 429 });
  }

  const bodyHtml = esc(message).replace(/\n/g, '<br>');

  let sent = 0;
  let failed = 0;

  for (const g of targets) {
    const firstName = (g.full_name || '').trim().split(/\s+/)[0] || 'there';
    const html = `
<div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:linear-gradient(135deg,#8b6f47 0%,#3f3a34 100%);padding:32px;border-radius:16px 16px 0 0;text-align:center">
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:400;font-family:Georgia,'Times New Roman',serif">${esc(coupleName)}</h1>
  </div>
  <div style="padding:32px;border:1px solid #ecebe8;border-top:none;border-radius:0 0 16px 16px">
    <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi ${esc(firstName)},</p>
    <div style="font-size:15px;line-height:1.7;color:#374151">${bodyHtml}</div>
    <p style="margin:24px 0 0;font-size:14px;color:#6b7280">With love,<br>${esc(coupleName)}</p>
  </div>
  <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#c4c1bb">Sent with StoryVenue</p>
</div>`;

    const result = await sendEmail({
      to: g.email as string,
      from: resolveCoupleInviteFrom(coupleName),
      replyTo: user.email ?? undefined,
      subject,
      html,
    });
    if (result.success) sent += 1;
    else failed += 1;
  }

  await supabaseAdmin.from('couple_website_invite_sends').insert({
    couple_wedding_id: link.id,
    sent_by: user.id,
    subject,
    recipient_count: targets.length,
    sent_count: sent,
    failed_count: failed,
  });

  return NextResponse.json({ ok: true, sent, failed, skippedNoEmail });
}
