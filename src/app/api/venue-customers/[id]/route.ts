import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  fetchStageRow,
  resolveVenueCustomerPipelineContext,
  slugifyStageLabel,
  syncLeadFromVenueCustomerRow,
} from '@/lib/venue-customer-pipeline-sync';
import {
  isMissingVenueCustomerPipelineColumns,
  VENUE_CUSTOMERS_PIPELINE_MIGRATION_HINT,
} from '@/lib/venue-customer-db-error';

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
    const r = row as Record<string, unknown>;
    const ctx = await resolveVenueCustomerPipelineContext(venueId, {
      customer_email: String(r.customer_email ?? ''),
      pipeline_id: (r.pipeline_id as string | null) ?? null,
      stage_id: (r.stage_id as string | null) ?? null,
    });
    return NextResponse.json(ctx ? { ...row, pipeline_context: ctx } : row);
  } catch (err) {
    console.error('[venue-customers GET by id]', err);
    const msg = err instanceof Error ? err.message : String(err);
    if (isMissingVenueCustomerPipelineColumns(msg)) {
      return NextResponse.json({ error: VENUE_CUSTOMERS_PIPELINE_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
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
  'pipeline_id',
  'stage_id',
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = (await request.json()) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of UPDATABLE) {
    if (key in body) {
      const v = body[key];
      updates[key] = v === '' ? null : v ?? null;
    }
  }

  // Canonical pipeline + stage (camelCase from client)
  const pid = typeof body.pipelineId === 'string' ? body.pipelineId : undefined;
  const sid = typeof body.stageId === 'string' ? body.stageId : undefined;
  if (pid !== undefined && sid !== undefined) {
    const { data: pipe } = await supabaseAdmin
      .from('lead_pipelines')
      .select('id')
      .eq('id', pid)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!pipe) {
      return NextResponse.json({ error: 'Invalid pipeline' }, { status: 400 });
    }
    const st = await fetchStageRow(venueId, sid);
    if (!st || st.pipeline_id !== pid) {
      return NextResponse.json({ error: 'Stage does not belong to that pipeline' }, { status: 400 });
    }
    updates.pipeline_id = pid;
    updates.stage_id = sid;
    updates.pipeline_stage = slugifyStageLabel(st.name);
  }

  // pipeline_stage must never be null; default to 'inquiry' when explicitly cleared (legacy-only updates).
  if ('pipeline_stage' in body && !updates.pipeline_stage && !pid) {
    updates.pipeline_stage = 'inquiry';
  }

  if (Object.keys(updates).length === 0) {
    const row = await fetchById(venueId, id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = row as Record<string, unknown>;
    const ctx = await resolveVenueCustomerPipelineContext(venueId, {
      customer_email: String(r.customer_email ?? ''),
      pipeline_id: (r.pipeline_id as string | null) ?? null,
      stage_id: (r.stage_id as string | null) ?? null,
    });
    return NextResponse.json(ctx ? { ...row, pipeline_context: ctx } : row);
  }

  updates.updated_at = new Date().toISOString();

  const { error: updErr } = await supabaseAdmin
    .from('venue_customers')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId);

  if (updErr) {
    console.error('[venue-customers PATCH]', updErr);
    if (isMissingVenueCustomerPipelineColumns(updErr.message)) {
      return NextResponse.json({ error: VENUE_CUSTOMERS_PIPELINE_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  try {
    const row = await fetchById(venueId, id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const r = row as Record<string, unknown>;
    if (updates.pipeline_id || updates.stage_id || pid !== undefined) {
      await syncLeadFromVenueCustomerRow(venueId, {
        customer_email: String(r.customer_email ?? ''),
        pipeline_id: (r.pipeline_id as string | null) ?? null,
        stage_id: (r.stage_id as string | null) ?? null,
      });
    }
    const refreshed = await fetchById(venueId, id);
    if (!refreshed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const rr = refreshed as Record<string, unknown>;
    const ctx = await resolveVenueCustomerPipelineContext(venueId, {
      customer_email: String(rr.customer_email ?? ''),
      pipeline_id: (rr.pipeline_id as string | null) ?? null,
      stage_id: (rr.stage_id as string | null) ?? null,
    });
    return NextResponse.json(ctx ? { ...refreshed, pipeline_context: ctx } : refreshed);
  } catch (err) {
    console.error('[venue-customers PATCH refetch]', err);
    const msg = err instanceof Error ? err.message : String(err);
    if (isMissingVenueCustomerPipelineColumns(msg)) {
      return NextResponse.json({ error: VENUE_CUSTOMERS_PIPELINE_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
