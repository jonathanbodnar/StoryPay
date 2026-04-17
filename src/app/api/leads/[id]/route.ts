import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Status values enforced by the DB CHECK constraint on `public.leads.status`.
 * We keep updating this alongside stage_id for backwards compatibility with
 * older inboxes that still use the enum.
 */
const ALLOWED_STATUSES = new Set([
  'new',
  'contacted',
  'tour_booked',
  'proposal_sent',
  'booked_wedding',
  'not_interested',
]);

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  let body: {
    status?: string;
    notes?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    venueName?: string;
    venueWebsiteUrl?: string;
    opportunityValue?: number | string | null;
    weddingDate?: string | null;
    guestCount?: number | null;
    bookingTimeline?: string | null;
    message?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
    position?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(', ')}` },
        { status: 400 },
      );
    }
    updates.status = body.status;
  }
  if (typeof body.notes === 'string')              updates.notes = body.notes;
  if (typeof body.firstName === 'string')          updates.first_name = body.firstName.trim() || null;
  if (typeof body.lastName === 'string')           updates.last_name  = body.lastName.trim()  || null;
  if (typeof body.name === 'string')               updates.name = body.name.trim();
  if (typeof body.email === 'string')              updates.email = body.email.trim();
  if (typeof body.phone === 'string')              updates.phone = body.phone.trim();
  if (typeof body.venueName === 'string')          updates.venue_name = body.venueName.trim() || null;
  if (typeof body.venueWebsiteUrl === 'string')    updates.venue_website_url = body.venueWebsiteUrl.trim() || null;
  if (typeof body.bookingTimeline === 'string' || body.bookingTimeline === null) updates.booking_timeline = body.bookingTimeline || null;
  if (typeof body.message === 'string' || body.message === null) updates.message = body.message;
  if (body.weddingDate === null || typeof body.weddingDate === 'string') updates.wedding_date = body.weddingDate || null;
  if (body.guestCount === null || typeof body.guestCount === 'number') updates.guest_count = body.guestCount;
  if (body.opportunityValue === null || body.opportunityValue === '' || body.opportunityValue === undefined) {
    if (body.opportunityValue !== undefined) updates.opportunity_value = null;
  } else if (typeof body.opportunityValue === 'number' || typeof body.opportunityValue === 'string') {
    const n = Number(body.opportunityValue);
    if (!Number.isNaN(n)) updates.opportunity_value = n;
  }
  if (body.pipelineId === null || typeof body.pipelineId === 'string') updates.pipeline_id = body.pipelineId || null;
  if (body.stageId === null || typeof body.stageId === 'string')       updates.stage_id    = body.stageId    || null;
  if (typeof body.position === 'number')           updates.position = body.position;

  // If the caller built a new first/last but didn't also send a full name,
  // keep the legacy `name` column in sync so old UIs still render correctly.
  if ((updates.first_name !== undefined || updates.last_name !== undefined) && updates.name === undefined) {
    const first = typeof updates.first_name === 'string' ? updates.first_name : body.firstName;
    const last  = typeof updates.last_name  === 'string' ? updates.last_name  : body.lastName;
    const rebuilt = `${first ?? ''} ${last ?? ''}`.trim();
    if (rebuilt) updates.name = rebuilt;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[PATCH /api/leads/[id]] failed:', error);
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json({ lead: data });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  const { data, error } = await supabaseAdmin
    .from('leads')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[DELETE /api/leads/[id]] failed:', error);
    return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
