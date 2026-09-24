/**
 * GET /api/venue/leadfinder/review
 *
 * The venue's LeadFinder™ arrivals that were created but NOT auto-contacted,
 * because the extraction confidence was below the routing threshold. Newest
 * first, so the queue reads like an inbox.
 *
 * Each item carries the original email (`rawExcerpt`) right next to the fields
 * we extracted and the per-field confidence, so a human can judge the record
 * without opening anything else.
 *
 * Venue scoping mirrors `/api/venue/leadfinder`: the venue id comes from the
 * session cookie, never the request.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RAW_EXCERPT_LIMIT = 4000;

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: importRows, error } = await supabaseAdmin
    .from('leadfinder_imports')
    .select('id, subject, sender, sender_domain, received_at, detected_source, classification_confidence, extraction_confidence, field_confidence, review_reason, raw_text, lead_id')
    .eq('venue_id', venueId)
    .eq('review_state', 'needs_review')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[leadfinder review GET] failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type ImportRow = {
    id: string;
    subject: string | null;
    sender: string | null;
    sender_domain: string | null;
    received_at: string | null;
    detected_source: string | null;
    classification_confidence: number | null;
    extraction_confidence: number | null;
    field_confidence: Record<string, number> | null;
    review_reason: string | null;
    raw_text: string | null;
    lead_id: string | null;
  };
  const rows = (importRows ?? []) as ImportRow[];

  // The extracted values live on the lead the import produced, so read them in
  // one batched query rather than one per row.
  const leadIds = rows.map((r) => r.lead_id).filter((id): id is string => !!id);
  const leadById = new Map<string, Record<string, unknown>>();
  if (leadIds.length > 0) {
    const { data: leadRows, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('id, name, first_name, last_name, email, phone, guest_count, wedding_date, venue_matters, booking_timeline, message')
      .eq('venue_id', venueId)
      .in('id', leadIds);
    if (leadErr) {
      console.error('[leadfinder review GET] leads failed:', leadErr.message);
    }
    for (const l of (leadRows ?? []) as Array<Record<string, unknown>>) {
      leadById.set(String(l.id), l);
    }
  }

  return NextResponse.json({
    imports: rows.map((r) => {
      const lead = r.lead_id ? leadById.get(r.lead_id) ?? null : null;
      return {
        id: r.id,
        subject: r.subject,
        sender: r.sender,
        senderDomain: r.sender_domain,
        receivedAt: r.received_at,
        detectedSource: r.detected_source,
        classificationConfidence: r.classification_confidence,
        extractionConfidence: r.extraction_confidence,
        fieldConfidence: r.field_confidence ?? {},
        reviewReason: r.review_reason,
        rawExcerpt: (r.raw_text ?? '').slice(0, RAW_EXCERPT_LIMIT),
        leadId: r.lead_id,
        extracted: lead
          ? {
              name: lead.name ?? null,
              firstName: lead.first_name ?? null,
              lastName: lead.last_name ?? null,
              email: lead.email ?? null,
              phone: lead.phone ?? null,
              guestCount: lead.guest_count ?? null,
              weddingDate: lead.wedding_date ?? null,
              venueMatters: lead.venue_matters ?? null,
              timeline: lead.booking_timeline ?? null,
              message: lead.message ?? null,
            }
          : null,
      };
    }),
  });
}
