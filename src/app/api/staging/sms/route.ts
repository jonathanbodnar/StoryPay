/**
 * GET    /api/staging/sms?phone=&since=  — texts the test copy sent and received (newest first)
 * POST   /api/staging/sms {from, body, reaction?} — a couple texts the venue back, or reacts to a text
 *                                          ("Liked …") (waits in the stand-in texting service, as in GHL,
 *                                          for the app's reply sync)
 * POST   /api/staging/sms {to, body, person? | workflow?} — the VENUE side texts a couple from
 *                                          outside StoryVenue: a named person in the CRM's app, or a CRM workflow
 * DELETE /api/staging/sms                — clear the stand-in
 * Test copy only (behind its password page); not found on the live site.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isStaging } from '@/lib/staging';
import { clearFakeGhl, readFakeTexts, receiveFakeText, sendFakeVenueText } from '@/lib/staging-ghl';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const sp = request.nextUrl.searchParams;
  return NextResponse.json({ texts: readFakeTexts({ phone: sp.get('phone') ?? undefined, since: sp.get('since') ?? undefined }) });
}

export async function POST(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const b = (await request.json().catch(() => ({}))) as { from?: string; to?: string; body?: string; person?: string; workflow?: boolean; reaction?: boolean };
  if (b.to && b.body) {
    const sent = sendFakeVenueText(b.to, b.body, { person: b.person, workflow: b.workflow === true });
    if (!sent) return NextResponse.json({ error: 'No contact with that number in the texting service yet' }, { status: 404 });
    return NextResponse.json({ ok: true, ...sent });
  }
  if (!b.from || !b.body) return NextResponse.json({ error: 'from and body are required' }, { status: 400 });
  const r = receiveFakeText(b.from, b.body, { reaction: b.reaction === true });
  if (!r) return NextResponse.json({ error: 'No contact with that number in the texting service yet' }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}

export async function DELETE() {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  clearFakeGhl();
  return NextResponse.json({ ok: true });
}
