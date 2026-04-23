/**
 * Preview the weekly digest email for the current venue.
 * GET /api/analytics-digest-preview  — returns HTML (for browser preview)
 * POST /api/analytics-digest-preview — sends a test digest to the venue email
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { buildDigestMetrics, buildDigestHtml, sendAnalyticsDigest } from '@/lib/analytics-digest';

export const dynamic = 'force-dynamic';

async function getVenueId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const metrics = await buildDigestMetrics(venueId);
  if (!metrics) return NextResponse.json({ error: 'No metrics or email' }, { status: 404 });

  const html = buildDigestHtml(metrics);
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { email?: string };

  if (body.email) {
    // Send preview to a custom address (not the venue email)
    const metrics = await buildDigestMetrics(venueId);
    if (!metrics) return NextResponse.json({ error: 'No metrics' }, { status: 404 });
    const { sendEmail } = await import('@/lib/email');
    const html = buildDigestHtml(metrics);
    const res = await sendEmail({ to: body.email, subject: `[Preview] ${metrics.venueName} weekly analytics digest`, html, from: { name: 'StoryVenue Analytics' } });
    return NextResponse.json(res);
  }

  const result = await sendAnalyticsDigest(venueId);
  return NextResponse.json(result);
}
