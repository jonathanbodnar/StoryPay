import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_RECIPIENTS = 500;

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
 * to the couple's own inbox. Bride-only; connected wedding required.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

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
      .eq('id', user.id)
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
      from: { name: coupleName },
      replyTo: user.email ?? undefined,
      subject,
      html,
    });
    if (result.success) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({ ok: true, sent, failed, skippedNoEmail });
}
