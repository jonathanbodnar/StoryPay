/**
 * /api/venue/leadfinder
 *
 * GET  — everything the Settings → Integrations card needs to show a venue their
 *        LeadFinder™ address, whether it is working, and whether any source has
 *        started to drift.
 * PATCH — flip the email-mirror toggle, scoped to the authenticated venue.
 *
 * The address is built server-side because its signature is an HMAC over the
 * venue id using a secret that must never reach the browser — this endpoint is
 * the only way to obtain it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { buildLeadFinderAddress, leadFinderEnabledForSlug } from '@/lib/leadfinder/address';
import {
  loadSourceDrift,
  DRIFT_WINDOW_DAYS,
  DRIFT_BASELINE_DAYS,
  DRIFT_MIN_SAMPLE,
} from '@/lib/leadfinder/drift';
import { parseAddressHeader } from '@/lib/leadfinder/extract';
import { parseGmailForwardingConfirmation } from '@/lib/leadfinder/gmail-confirmation';
import { LEADFINDER_REASON_LABELS, leadFinderReasonLabel } from '@/lib/leadfinder/reasons';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('id, slug, name, notification_email, email, leadfinder_mirror_enabled')
    .eq('id', venueId)
    .maybeSingle();

  if (!venueRow) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  const venue = venueRow as {
    slug: string | null;
    notification_email: string | null;
    email: string | null;
    leadfinder_mirror_enabled: boolean | null;
  };

  const address = buildLeadFinderAddress(venueId);

  // Recent activity. Small, bounded queries: a venue's LeadFinder traffic is
  // low-volume by nature, and the card only needs the latest few facts.
  const [importsRes, leadsRes, recentRes, skippedRes, reviewRes, mirrorFailRes, sources] = await Promise.all([
    supabaseAdmin
      .from('leadfinder_imports')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('source', 'leadfinder'),
    supabaseAdmin
      .from('leadfinder_imports')
      .select('subject, sender_domain, detected_source, processing_status, failure_reason, received_at, lead_id')
      .eq('venue_id', venueId)
      .order('received_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('leadfinder_imports')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('processing_status', 'skipped')
      // A test the venue sent itself is not a missed inquiry.
      .or('failure_reason.is.null,failure_reason.neq.test_inquiry'),
    supabaseAdmin
      .from('leadfinder_imports')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('review_state', 'needs_review'),
    supabaseAdmin
      .from('leadfinder_imports')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .not('mirror_error', 'is', null),
    loadSourceDrift(venueId),
  ]);

  const recent = (recentRes.data ?? []) as Array<{
    subject: string | null;
    sender_domain: string | null;
    detected_source: string | null;
    processing_status: string;
    failure_reason: string | null;
    received_at: string | null;
    lead_id: string | null;
  }>;

  // Gmail's forwarding confirmation code, while it is still the thing the venue
  // is waiting on: shown only while the newest arrival IS that confirmation.
  // As soon as any real mail comes through, forwarding is working and it goes.
  let gmailConfirmation: {
    code: string | null;
    confirmUrl: string | null;
    requestedBy: string | null;
    receivedAt: string | null;
  } | null = null;
  // Directory couples who got the gated "Send me my guide" invite, and how many
  // tapped it (= opted in to texts). Tolerant: no table yet → no stat.
  const [invitesRes, tappedRes] = await Promise.all([
    supabaseAdmin.from('guide_invites').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
    supabaseAdmin.from('guide_invites').select('id', { count: 'exact', head: true }).eq('venue_id', venueId).not('tapped_at', 'is', null),
  ]);
  const textOptIns = invitesRes.error || tappedRes.error
    ? null
    : { invited: invitesRes.count ?? 0, optedIn: tappedRes.count ?? 0 };

  // Tests the venue sends themselves don't count as "real mail came through".
  const newestReal = recent.find((r) => r.failure_reason !== 'test_inquiry');
  if (newestReal?.failure_reason === 'gmail_forwarding_confirmation') {
    const { data: confRow } = await supabaseAdmin
      .from('leadfinder_imports')
      .select('sender, subject, raw_text, received_at')
      .eq('venue_id', venueId)
      .eq('failure_reason', 'gmail_forwarding_confirmation')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = confRow as { sender: string | null; subject: string | null; raw_text: string | null; received_at: string | null } | null;
    const parsed = row
      ? parseGmailForwardingConfirmation({
          senderEmail: parseAddressHeader(row.sender).email,
          subject: row.subject,
          text: row.raw_text,
        })
      : null;
    if (parsed) gmailConfirmation = { ...parsed, receivedAt: row?.received_at ?? null };
  }

  return NextResponse.json({
    // Off for this venue means the address will accept mail but do nothing with
    // it, so the card has to say so rather than pretending it is live.
    enabled: leadFinderEnabledForSlug(venue.slug),
    // False when the inbound domain/secret are not configured on this deploy.
    configured: address !== null,
    address,
    forwardedCopyTo: venue.notification_email || venue.email || null,
    // Tolerant reader: a missing/legacy null keeps mirroring on, matching the
    // database DEFAULT of true.
    mirrorEnabled: venue.leadfinder_mirror_enabled !== false,
    stats: {
      emailsSeen: importsRes.count ?? 0,
      leadsCreated: leadsRes.count ?? 0,
      skipped: skippedRes.count ?? 0,
      needsReview: reviewRes.count ?? 0,
      mirrorFailures: mirrorFailRes.count ?? 0,
      lastEmailAt: recent[0]?.received_at ?? null,
      lastLeadAt: recent.find((r) => r.lead_id)?.received_at ?? null,
    },
    // Per-source breakdown over the recent window, each compared against its own
    // earlier history. `judged: false` means there isn't enough history to say.
    drift: {
      windowDays: DRIFT_WINDOW_DAYS,
      baselineDays: DRIFT_BASELINE_DAYS,
      minSample: DRIFT_MIN_SAMPLE,
    },
    sources,
    gmailConfirmation,
    textOptIns,
    recent: recent.map((r) => ({
      subject: r.subject,
      senderDomain: r.sender_domain,
      detectedSource: r.detected_source,
      status: r.processing_status,
      // Known reason tokens only — a raw database error stays in the server log.
      reason: r.failure_reason && LEADFINDER_REASON_LABELS[r.failure_reason] ? r.failure_reason : r.failure_reason ? 'other' : null,
      reasonLabel: leadFinderReasonLabel(r.failure_reason),
      receivedAt: r.received_at,
    })),
  });
}

/**
 * PATCH — update the venue's LeadFinder settings. Currently just the email
 * mirror toggle. Scoped to the session venue; nothing about the venue id comes
 * from the request.
 */
export async function PATCH(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { mirrorEnabled?: unknown };
  try {
    body = (await request.json()) as { mirrorEnabled?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.mirrorEnabled !== 'boolean') {
    return NextResponse.json({ error: 'mirrorEnabled must be a boolean' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('venues')
    .update({ leadfinder_mirror_enabled: body.mirrorEnabled })
    .eq('id', venueId);

  if (error) {
    console.error('[leadfinder PATCH] mirror toggle failed:', error.message);
    return NextResponse.json({ error: 'Could not save this setting. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mirrorEnabled: body.mirrorEnabled });
}
