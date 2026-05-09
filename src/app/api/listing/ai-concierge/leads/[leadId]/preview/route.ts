/**
 * POST /api/listing/ai-concierge/leads/[leadId]/preview
 *
 * Venue-side dry run: generate the next AI draft SMS for one of the
 * venue's own leads — without sending, persisting, or counting toward
 * attempt metrics. Identical to the admin preview but scoped to the
 * venue session cookie.
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildAiConciergeSystemPrompt } from '@/lib/ai-concierge/prompt-builder';
import { generateSmsWithDeepSeek, clampSmsLength } from '@/lib/ai-concierge/llm';
import type { AiAngleKey } from '@/lib/ai-concierge/types';

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, venue_id, ai_attempt_count, ai_angles_used, ai_state')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const prompt = await buildAiConciergeSystemPrompt({
    venueId:       lead.venue_id,
    leadId:        lead.id,
    attemptNumber: (lead.ai_attempt_count ?? 0) + 1,
    anglesUsed:    (lead.ai_angles_used ?? []) as AiAngleKey[],
  });

  if (!('ok' in prompt) || !prompt.ok) {
    return NextResponse.json({
      error: 'error' in prompt ? prompt.error : 'Failed to build prompt',
    }, { status: 500 });
  }

  const gen = await generateSmsWithDeepSeek({ systemPrompt: prompt.systemPrompt });

  if (!gen.ok) {
    return NextResponse.json({ error: `AI error: ${gen.detail}` }, { status: 500 });
  }

  const constraints = prompt.config.message_constraints as { max_chars?: number } | null;
  const maxChars    = typeof constraints?.max_chars === 'number' ? constraints.max_chars : 320;
  const finalText   = clampSmsLength(gen.smsText, maxChars);

  return NextResponse.json({
    ok:            true,
    draftSms:      finalText,
    angle:         gen.angle,
    attemptNumber: (lead.ai_attempt_count ?? 0) + 1,
  });
}
