/**
 * /api/venue/leadfinder/test — "Send a test inquiry" for the LeadFinder™ card.
 *
 * POST sends a realistic sample inquiry — a real email, through the real
 * inbound path — to the venue's own LeadFinder address, so the venue can see
 * for themselves that mail sent there arrives and is read correctly.
 *
 * It is a DRY RUN end to end. The email carries a signed test token (see
 * buildLeadFinderTestToken), and ingest recognises it: the arrival is read and
 * reported back, but no lead is created — so nothing lands in the venue's
 * stats, nothing is pushed to Zapier / Tripleseat / Event Temple, and nobody is
 * emailed as the "couple". The only side effect is the usual inbox copy, with a
 * banner saying it was a test.
 *
 * GET ?ref=… reports whether that test has arrived yet and what was read from
 * it, for the card to poll.
 *
 * Venue-scoped from the session cookie; the address itself never comes from
 * the request.
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sendEmail } from '@/lib/email';
import { buildLeadFinderAddress, buildLeadFinderTestToken } from '@/lib/leadfinder/address';
import { extractLeadFromEmail, parseAddressHeader } from '@/lib/leadfinder/extract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A handful of tests an hour is plenty; this stops a stuck button from spamming. */
const MAX_TESTS_PER_HOUR = 5;
const REF_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function newRef(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

/** A plausible wedding date: a Saturday about nine months out. */
function sampleWeddingDate(): string {
  const d = new Date(Date.now() + 280 * 24 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const address = buildLeadFinderAddress(venueId);
  if (!address) {
    return NextResponse.json({ error: 'LeadFinder is not set up on this server yet.' }, { status: 503 });
  }

  const { count } = await supabaseAdmin
    .from('leadfinder_imports')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('failure_reason', 'test_inquiry')
    .gte('received_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if ((count ?? 0) >= MAX_TESTS_PER_HOUR) {
    return NextResponse.json(
      { error: 'You have sent several tests in the last hour. Please try again a little later.' },
      { status: 429 },
    );
  }

  const ref = newRef();
  const token = buildLeadFinderTestToken(venueId, ref);
  if (!token) {
    return NextResponse.json({ error: 'LeadFinder is not set up on this server yet.' }, { status: 503 });
  }

  const fields: Array<[string, string]> = [
    ['Name', 'Taylor Morgan'],
    ['Email', 'taylor.morgan@example.com'],
    ['Phone', '(555) 010-4477'],
    ['Wedding Date', sampleWeddingDate()],
    ['Guest Count', '120'],
    ['Message', 'Hi! We love your venue and would like to know about availability and pricing.'],
  ];
  const intro =
    'This is a test inquiry from the "Send a test inquiry" button on your LeadFinder card in StoryVenue ' +
    '(Settings → Integrations). It checks that mail sent to your LeadFinder address arrives and is read ' +
    'correctly. It will not create a lead.';

  const text = [intro, '', ...fields.map(([k, v]) => `${k}: ${v}`), '', `Test reference: ${token}`].join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1b1b;max-width:560px">
  <p style="color:#555">${escapeHtml(intro)}</p>
  <table style="border-collapse:collapse;font-size:14px">${fields
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#888">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`)
    .join('')}</table>
  <p style="color:#aaa;font-size:12px">Test reference: ${escapeHtml(token)}</p>
</div>`;

  const result = await sendEmail({
    to: address,
    subject: `LeadFinder test inquiry (${ref})`,
    html,
    text,
    from: {
      email: process.env.NOTIFICATION_FROM_EMAIL?.trim() || 'notifications@send.storyvenue.com',
      name: 'StoryVenue LeadFinder test',
    },
  });
  if (!result.success) {
    console.error('[leadfinder test] send failed:', result.error);
    return NextResponse.json({ error: 'We could not send the test email. Please try again.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ref, sentAt: new Date().toISOString() });
}

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ref = request.nextUrl.searchParams.get('ref') ?? '';
  if (!/^[A-Z2-7]{8}$/.test(ref)) return NextResponse.json({ error: 'Invalid ref' }, { status: 400 });

  const { data } = await supabaseAdmin
    .from('leadfinder_imports')
    .select('received_at, processing_status, failure_reason, raw_text, subject, sender, reply_to, mirrored_at, mirror_error')
    .eq('venue_id', venueId)
    .ilike('subject', `%(${ref})%`)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ arrived: false });

  const row = data as {
    received_at: string | null;
    processing_status: string;
    failure_reason: string | null;
    raw_text: string | null;
    subject: string | null;
    sender: string | null;
    reply_to: string | null;
    mirrored_at: string | null;
    mirror_error: string | null;
  };

  // Still being processed — let the card keep polling.
  if (row.processing_status === 'pending') return NextResponse.json({ arrived: false });

  // Re-read the stored message so the card shows exactly what was extracted.
  const from = parseAddressHeader(row.sender);
  const read = extractLeadFromEmail({
    subject: row.subject,
    text: row.raw_text ?? '',
    senderName: from.name,
    senderEmail: from.email,
    replyTo: row.reply_to,
  });

  return NextResponse.json({
    arrived: true,
    receivedAt: row.received_at,
    recognizedAsTest: row.failure_reason === 'test_inquiry',
    read: {
      name: read.name,
      email: read.email,
      phone: read.phone,
      weddingDate: read.weddingDate,
      guestCount: read.guestCount,
    },
    copySent: !!row.mirrored_at && !row.mirror_error,
  });
}
