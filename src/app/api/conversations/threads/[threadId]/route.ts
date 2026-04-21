import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { slugifyStageLabel } from '@/lib/pipeline-stage-slug';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
      'id, first_name, last_name, customer_email, phone, sms_dnd, conversation_dnd_all, conversation_dnd_email, conversation_dnd_calls, conversation_dnd_inbound_sms, stage_id, pipeline_id, pipeline_stage',
    )
    .eq('id', thread.venue_customer_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  function humanizePipelineSlug(slug: string): string {
    return slug
      .split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  let contact_stage: { name: string; color: string | null } | null = null;
  const c = contact as {
    stage_id?: string | null;
    pipeline_id?: string | null;
    pipeline_stage?: string | null;
  } | null;

  if (c?.stage_id) {
    const { data: st } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('name, color')
      .eq('id', c.stage_id)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (st) {
      contact_stage = {
        name: String((st as { name?: string }).name || 'Stage'),
        color: ((st as { color?: string | null }).color ?? null) as string | null,
      };
    }
  }

  const pipelineSlug = (c?.pipeline_stage ?? '').trim();
  if (!contact_stage && c?.pipeline_id && pipelineSlug) {
    const { data: stages } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('name, color')
      .eq('pipeline_id', c.pipeline_id)
      .eq('venue_id', venueId);
    const match = (stages ?? []).find((s) => slugifyStageLabel(String(s.name)) === pipelineSlug);
    if (match) {
      contact_stage = {
        name: String(match.name),
        color: ((match as { color?: string | null }).color ?? null) as string | null,
      };
    }
  }

  if (!contact_stage && pipelineSlug) {
    contact_stage = { name: humanizePipelineSlug(pipelineSlug), color: null };
  }

  return NextResponse.json({
    ...thread,
    venue_customers: contact ?? null,
    contact_stage,
  });
}
