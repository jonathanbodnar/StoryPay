import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function fetchById(venueId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .select('*, venue_spaces:wedding_space_id(id, name, color)')
    .eq('venue_id', venueId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    const { data: plain, error: plainErr } = await supabaseAdmin
      .from('venue_customers')
      .select('*')
      .eq('venue_id', venueId)
      .eq('id', id)
      .maybeSingle();
    if (plainErr) throw plainErr;
    return plain ?? null;
  }
  return data ?? null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const row = await fetchById(venueId, id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[venue-customers GET by id]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Whitelist of columns the client is allowed to patch on a venue_customers row.
// Kept explicit so partial updates don't blow away fields that weren't submitted.
const UPDATABLE = [
  'first_name',
  'last_name',
  'phone',
  'partner_first_name',
  'partner_last_name',
  'partner_email',
  'partner_phone',
  'wedding_date',
  'wedding_space_id',
  'ceremony_type',
  'guest_count',
  'rehearsal_date',
  'coordinator_name',
  'coordinator_phone',
  'catering_notes',
  'referral_source',
  'pipeline_stage',
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  for (const key of UPDATABLE) {
    if (key in body) {
      const v = body[key];
      updates[key] = v === '' ? null : v ?? null;
    }
  }

  // pipeline_stage must never be null; default to 'inquiry' when explicitly cleared.
  if ('pipeline_stage' in body && !updates.pipeline_stage) {
    updates.pipeline_stage = 'inquiry';
  }

  if (Object.keys(updates).length === 0) {
    const row = await fetchById(venueId, id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  }

  updates.updated_at = new Date().toISOString();

  const { error: updErr } = await supabaseAdmin
    .from('venue_customers')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId);

  if (updErr) {
    console.error('[venue-customers PATCH]', updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  try {
    const row = await fetchById(venueId, id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[venue-customers PATCH refetch]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
