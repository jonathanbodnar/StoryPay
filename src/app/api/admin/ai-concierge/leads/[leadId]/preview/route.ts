/**
 * POST /api/admin/ai-concierge/leads/[leadId]/preview
 *
 * Super-admin dry run: build the system prompt for a specific lead using
 * real venue + lead context, then call DeepSeek to generate the draft SMS
 * — without persisting anything or counting toward attempt metrics.
 *
 * Returns the draft SMS, the angle chosen, and a truncated system prompt
 * so the operator can see exactly what the AI knows about this bride.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { buildAiConciergeSystemPrompt } from '@/lib/ai-concierge/prompt-builder';
import { generateSmsWithDeepSeek, clampSmsLength } from '@/lib/ai-concierge/llm';

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  if (!leadId?.trim()) {
    return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });
  }

  // Fetch the lead's current AI state
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, venue_id, ai_attempt_count, ai_angles_used, ai_state')
    .eq('id', leadId)
    .single();

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  // Build the real prompt with real lead context (no synthetic data)
  const prompt = await buildAiConciergeSystemPrompt({
    venueId:       lead.venue_id,
    leadId:        lead.id,
    attemptNumber: (lead.ai_attempt_count ?? 0) + 1,
    anglesUsed:    (lead.ai_angles_used ?? []) as Parameters<typeof buildAiConciergeSystemPrompt>[0]['anglesUsed'],
  });

  if (!('ok' in prompt) || !prompt.ok) {
    return NextResponse.json({
      error: 'error' in prompt ? prompt.error : 'Failed to build prompt',
    }, { status: 500 });
  }

  // Call DeepSeek — dry run, nothing is persisted or logged
  const gen = await generateSmsWithDeepSeek({ systemPrompt: prompt.systemPrompt });

  if (!gen.ok) {
    return NextResponse.json({
      error: `DeepSeek error: ${gen.detail}`,
      systemPromptSnippet: prompt.systemPrompt.slice(0, 800),
    }, { status: 500 });
  }

  const constraints = prompt.config.message_constraints as { max_chars?: number } | null;
  const maxChars  = (constraints?.max_chars && typeof constraints.max_chars === 'number')
    ? constraints.max_chars : 320;
  const finalText = clampSmsLength(gen.smsText, maxChars);

  return NextResponse.json({
    ok:                  true,
    draftSms:            finalText,
    angle:               gen.angle,
    rawOutput:           gen.rawModelOutput,
    // First 800 chars of the system prompt so the operator can see context
    systemPromptSnippet: prompt.systemPrompt.slice(0, 800),
    leadState:           lead.ai_state,
    attemptNumber:       (lead.ai_attempt_count ?? 0) + 1,
  });
}
