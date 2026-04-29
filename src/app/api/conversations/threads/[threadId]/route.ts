import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { slugifyStageLabel } from '@/lib/pipeline-stage-slug';

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

async function stageFromPipelineSlug(
  venueId: string,
  pipelineId: string,
  pipelineKey: string,
): Promise<StagePill | null> {
  if (!pipelineKey) return null;
  const { data: stages } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('name, color')
    .eq('pipeline_id', pipelineId)
    .eq('venue_id', venueId);
  const match = (stages ?? []).find((s) => slugifyStageLabel(String(s.name)) === pipelineKey);
  if (!match) return null;
  return {
    name: String(match.name),
    color: ((match as { color?: string | null }).color ?? null) as string | null,
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
  const pipelineSlugRaw = (c?.pipeline_stage ?? '').trim();
  const pipelineKey = pipelineSlugRaw ? slugifyStageLabel(pipelineSlugRaw) : '';

  let contact_stage: StagePill | null = null;

  if (c?.stage_id) {
    contact_stage = await stageById(venueId, c.stage_id);
  }

  if (!contact_stage && c?.pipeline_id && pipelineKey) {
    contact_stage = await stageFromPipelineSlug(venueId, c.pipeline_id, pipelineKey);
  }

  if (email) {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('stage_id, pipeline_id, status')
      .eq('venue_id', venueId)
      .ilike('email', email)
      .maybeSingle();
    const lr = lead as {
      stage_id?: string | null;
      pipeline_id?: string | null;
      status?: string | null;
    } | null;

    if (!contact_stage && lr?.stage_id) {
      contact_stage = await stageById(venueId, lr.stage_id as string);
    }

    if (!contact_stage && lr?.pipeline_id && pipelineKey) {
      contact_stage = await stageFromPipelineSlug(venueId, lr.pipeline_id as string, pipelineKey);
    }

    if (!contact_stage) {
      const status = (lr?.status ?? '').trim();
      if (status) {
        contact_stage = { name: humanizePipelineSlug(slugifyStageLabel(status)), color: null };
      }
    }
  }

  if (!contact_stage && pipelineKey) {
    contact_stage = { name: humanizePipelineSlug(pipelineKey), color: null };
  }

  // Resolve the authoritative stage_id: prefer venue_customers.stage_id,
  // then fall back to the matched stage from leads/slug so the client always
  // has an ID to highlight the correct pill without fragile name matching.
  const resolvedStageId: string | null =
    (c?.stage_id as string | null) ??
    (contact_stage
      ? await (async () => {
          // Try to find the stage ID by name+pipelineId if we only have name
          const pid = (c?.pipeline_id as string | null) ?? null;
          if (!pid) return null;
          const { data: st } = await supabaseAdmin
            .from('lead_pipeline_stages')
            .select('id')
            .eq('venue_id', venueId)
            .eq('pipeline_id', pid)
            .ilike('name', contact_stage!.name)
            .maybeSingle();
          return (st as { id?: string } | null)?.id ?? null;
        })()
      : null);

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
