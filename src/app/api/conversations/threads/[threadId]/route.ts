import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { resolveVenueCustomerPipelineContext } from '@/lib/venue-customer-pipeline-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type StagePill = { name: string; color: string | null };

function humanizePipelineSlug(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function stageById(venueId: string, stageId: string): Promise<StagePill | null> {
  const { data: st } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('name, color')
    .eq('id', stageId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!st) return null;
  return {
    name: String((st as { name?: string }).name || 'Stage'),
    color: ((st as { color?: string | null }).color ?? null) as string | null,
  };
}


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  const { data: thread, error } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, subject, last_message_at, venue_customer_id, external_reply_channel')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: contact } = await supabaseAdmin
    .from('venue_customers')
    .select(
      'id, first_name, last_name, customer_email, phone, sms_dnd, conversation_dnd_all, conversation_dnd_email, conversation_dnd_calls, conversation_dnd_inbound_sms, stage_id, pipeline_id, pipeline_stage, conversation_dnd_inbound_sms',
    )
    .eq('id', thread.venue_customer_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  const c = contact as {
    stage_id?: string | null;
    pipeline_id?: string | null;
    pipeline_stage?: string | null;
    customer_email?: string | null;
  } | null;

  const email = (c?.customer_email ?? '').trim();
  // Legacy slug fallback for very old contacts that never got stage_id.
  const pipelineKey = (c?.pipeline_stage ?? '').trim().toLowerCase().replace(/\s+/g, '_');

  // Use the shared pipeline-resolution utility which safely handles multiple
  // leads per email (uses .limit(1) + array access, not .maybeSingle()).
  let contact_stage: StagePill | null = null;
  let resolvedStageId: string | null = null;

  if (email || c?.stage_id || c?.pipeline_id) {
    const ctx = await resolveVenueCustomerPipelineContext(venueId, {
      customer_email: email,
      pipeline_id: (c?.pipeline_id as string | null) ?? null,
      stage_id: (c?.stage_id as string | null) ?? null,
    });

    if (ctx?.stageId) {
      resolvedStageId = ctx.stageId;
      contact_stage = await stageById(venueId, ctx.stageId);
    }
  }

  // Slug-only fallback for very old contacts with no stage/pipeline IDs.
  if (!contact_stage && pipelineKey) {
    contact_stage = { name: humanizePipelineSlug(pipelineKey), color: null };
  }

  return NextResponse.json({
    ...thread,
    venue_customers: contact ?? null,
    contact_stage,
    contact_stage_id: resolvedStageId,
  });
}

/** DELETE — permanently removes the conversation thread and all its messages. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  // Verify ownership before deletion.
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Messages + read receipts cascade via FK in the DB; delete thread row.
  const { error } = await supabaseAdmin
    .from('conversation_threads')
    .delete()
    .eq('id', threadId)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[DELETE conversation thread]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
