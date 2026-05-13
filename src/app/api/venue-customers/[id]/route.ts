import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  fetchStageRow,
  resolveVenueCustomerPipelineContext,
  slugifyStageLabel,
  syncLeadFromVenueCustomerRow,
} from '@/lib/venue-customer-pipeline-sync';
import { broadcastStageChanged } from '@/lib/realtime/broadcast';
import {
  isMissingVenueCustomerPipelineColumns,
  VENUE_CUSTOMERS_PIPELINE_MIGRATION_HINT,
} from '@/lib/venue-customer-db-error';
import { applySmsDndForVenueCustomer, clearSmsDndForVenueCustomer } from '@/lib/sms-compliance';
import { schedulePushVenueCustomerToGhl } from '@/lib/ghl-push-contact';

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

  if ('sms_dnd' in body) {
    updates.sms_dnd = body.sms_dnd === true;
    if (!updates.sms_dnd) {
      updates.sms_dnd_at = null;
      updates.sms_dnd_source = null;
      updates.conversation_dnd_inbound_sms = false;
    }
  }

  for (const key of [
    'conversation_dnd_all',
    'conversation_dnd_email',
    'conversation_dnd_calls',
    'conversation_dnd_inbound_sms',
  ] as const) {
    if (key in body) {
      updates[key] = body[key] === true;
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

  if ('sms_dnd' in body) {
    if (body.sms_dnd === true) {
      await applySmsDndForVenueCustomer({
        venueId,
        venueCustomerId: id,
        source: 'manual',
      });
    } else {
      await clearSmsDndForVenueCustomer({ venueId, venueCustomerId: id });
    }
  }

  // SaaS is the system of record for contacts post-sync. Push any change to a
  // GHL-relevant field back to GoHighLevel so the next outbound SMS / email
  // finds the updated values there. Fire-and-forget — the local DB has
  // already been updated, so we don't block the response on a slow GHL API.
  const GHL_RELEVANT_FIELDS = ['first_name', 'last_name', 'phone', 'customer_email'] as const;
  const ghlRelevantChanged = GHL_RELEVANT_FIELDS.some((f) => f in updates);
  if (ghlRelevantChanged) {
    schedulePushVenueCustomerToGhl({
      venueId,
      venueCustomerId: id,
      reason: 'contact_patch',
    });
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

    // Broadcast stage change to admin support context sidebar in realtime.
    // We fan out to threads tied to ANY venue_customer with the same email
    // or phone (defensive: a thread can outlive a merged duplicate).
    if ((updates.stage_id || pid !== undefined) && rr.stage_id) {
      const stageId = rr.stage_id as string;
      const pipeId  = (rr.pipeline_id as string | null) ?? '';
      const email = String(rr.customer_email ?? '').trim().toLowerCase();
      const phone = String(rr.phone ?? '').trim();
      const { data: stageRow } = await supabaseAdmin
        .from('lead_pipeline_stages')
        .select('name, color')
        .eq('id', stageId)
        .maybeSingle();
      const sr = stageRow as { name?: string; color?: string | null } | null;

      const sisterVcIds = new Set<string>([id]);
      if (email) {
        const { data: vcByEmail } = await supabaseAdmin
          .from('venue_customers')
          .select('id')
          .eq('venue_id', venueId)
          .ilike('customer_email', email);
        for (const v of (vcByEmail ?? []) as Array<{ id: string }>) sisterVcIds.add(v.id);
      }
      if (phone) {
        const { data: vcByPhone } = await supabaseAdmin
          .from('venue_customers')
          .select('id')
          .eq('venue_id', venueId)
          .eq('phone', phone);
        for (const v of (vcByPhone ?? []) as Array<{ id: string }>) sisterVcIds.add(v.id);
      }
      const { data: vcThreads } = await supabaseAdmin
        .from('conversation_threads')
        .select('id, venue_customer_id')
        .eq('venue_id', venueId)
        .in('venue_customer_id', Array.from(sisterVcIds))
        .limit(50);
      for (const tt of (vcThreads ?? []) as Array<{ id: string; venue_customer_id: string }>) {
        void broadcastStageChanged({
          threadId:   tt.id,
          venueId:    venueId,
          vcId:       tt.venue_customer_id,
          stageId,
          stageName:  sr?.name ?? '',
          stageColor: sr?.color ?? null,
          pipelineId: pipeId,
          source:     'venue',
        });
      }
    }

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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Fetch the customer's email + protected flag before deletion.
  const { data: vc, error: fetchErr } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, is_protected')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!vc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Block deletion of protected demo contacts.
  if ((vc as { is_protected?: boolean }).is_protected) {
    return NextResponse.json(
      { error: 'This is a protected demo contact and cannot be deleted.' },
      { status: 403 },
    );
  }

  const { error: delErr } = await supabaseAdmin
    .from('venue_customers')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (delErr) {
    console.error('[DELETE /api/venue-customers/[id]]', delErr);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Also remove any matching lead rows (same venue + same email).
  const email = (vc as { customer_email?: string | null }).customer_email;
  if (email) {
    await supabaseAdmin
      .from('leads')
      .delete()
      .eq('venue_id', venueId)
      .eq('email', email);
  }

  return NextResponse.json({ ok: true });
}
