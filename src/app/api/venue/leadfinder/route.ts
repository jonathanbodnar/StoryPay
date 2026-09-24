/**
 * GET /api/venue/leadfinder
 *
 * Everything the Settings → Integrations card needs to show a venue their
 * LeadFinder™ address and whether it is working.
 *
 * The address is built server-side because its signature is an HMAC over the
 * venue id using a secret that must never reach the browser — this endpoint is
 * the only way to obtain it.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { buildLeadFinderAddress, leadFinderEnabledForSlug } from '@/lib/leadfinder/address';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('id, slug, name, notification_email, email')
    .eq('id', venueId)
    .maybeSingle();

  if (!venueRow) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  const venue = venueRow as { slug: string | null; notification_email: string | null; email: string | null };

  const address = buildLeadFinderAddress(venueId);

  // Recent activity. Small, bounded queries: a venue's LeadFinder traffic is
  // low-volume by nature, and the card only needs the latest few facts.
  const [importsRes, leadsRes, recentRes, skippedRes] = await Promise.all([
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
      .eq('processing_status', 'skipped'),
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

  return NextResponse.json({
    // Off for this venue means the address will accept mail but do nothing with
    // it, so the card has to say so rather than pretending it is live.
    enabled: leadFinderEnabledForSlug(venue.slug),
    // False when the inbound domain/secret are not configured on this deploy.
    configured: address !== null,
    address,
    forwardedCopyTo: venue.notification_email || venue.email || null,
    stats: {
      emailsSeen: importsRes.count ?? 0,
      leadsCreated: leadsRes.count ?? 0,
      skipped: skippedRes.count ?? 0,
      lastEmailAt: recent[0]?.received_at ?? null,
      lastLeadAt: recent.find((r) => r.lead_id)?.received_at ?? null,
    },
    recent: recent.map((r) => ({
      subject: r.subject,
      senderDomain: r.sender_domain,
      detectedSource: r.detected_source,
      status: r.processing_status,
      reason: r.failure_reason,
      receivedAt: r.received_at,
    })),
  });
}
