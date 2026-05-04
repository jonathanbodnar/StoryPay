/**
 * Render the AI Concierge system prompt against a real lead, using either
 * the active config or an arbitrary draft.
 *
 *   POST {
 *     venueId:        string,
 *     leadId:         string,
 *     attemptNumber?: number,
 *     anglesUsed?:    string[],
 *     // Optional override — if any of these are present we synthesize a
 *     // full AiConfigRow from them and pass it to the builder. Useful for
 *     // previewing UNSAVED edits in the editor.
 *     configOverride?: {
 *       personality?:            string;
 *       goals?:                  string;
 *       guardrails?:             string;
 *       prohibited_topics?:      string;
 *       message_constraints?:    Record<string, unknown>;
 *       system_prompt_template?: string;
 *     },
 *     // Or load a saved version by ID and use it as the override:
 *     configVersionId?: string,
 *   }
 *
 * Returns:
 *   { systemPrompt, inputContext, configVersion }
 *
 * No DB writes, no LLM calls, no SMS sends. Just the rendered prompt + the
 * snapshot of the input data we'd send. Cheap and safe to call on every
 * keystroke if the editor wants live preview (we throttle on the client).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buildAiConciergeSystemPrompt,
  type AiConfigRow,
} from '@/lib/ai-concierge/prompt-builder';
import type { AiAngleKey } from '@/lib/ai-concierge/types';

export const dynamic = 'force-dynamic';

interface PreviewBody {
  venueId:         string;
  leadId:          string;
  attemptNumber?:  number;
  anglesUsed?:     string[];
  configOverride?: Partial<Pick<AiConfigRow,
    'personality' | 'goals' | 'guardrails' | 'prohibited_topics' |
    'message_constraints' | 'system_prompt_template'
  >>;
  configVersionId?: string;
}

export async function POST(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: PreviewBody;
  try { body = await request.json() as PreviewBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.venueId || !body.leadId) {
    return NextResponse.json({ error: 'venueId and leadId are required' }, { status: 400 });
  }

  // Resolve the config: explicit configVersionId loads from DB; configOverride
  // gets merged onto the active row to fill in any missing fields. If
  // neither is supplied we pass undefined and the builder uses the active
  // row directly (same as the cron).
  let configOverride: AiConfigRow | undefined;

  if (body.configVersionId) {
    const { data, error } = await supabaseAdmin
      .from('ai_config')
      .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template')
      .eq('id', body.configVersionId)
      .maybeSingle();
    if (error)  return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)  return NextResponse.json({ error: 'configVersionId not found' }, { status: 404 });
    configOverride = data as AiConfigRow;
  }

  if (body.configOverride) {
    // If we don't already have a base from configVersionId, pull the active
    // config to fill in the gaps. This lets the editor preview a partial
    // edit (e.g. only the system_prompt_template field changed).
    if (!configOverride) {
      const { data } = await supabaseAdmin
        .from('ai_config')
        .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template')
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) configOverride = data as AiConfigRow;
    }
    if (configOverride) {
      configOverride = {
        ...configOverride,
        ...(body.configOverride.personality            !== undefined ? { personality:            body.configOverride.personality            } : {}),
        ...(body.configOverride.goals                  !== undefined ? { goals:                  body.configOverride.goals                  } : {}),
        ...(body.configOverride.guardrails             !== undefined ? { guardrails:             body.configOverride.guardrails             } : {}),
        ...(body.configOverride.prohibited_topics      !== undefined ? { prohibited_topics:      body.configOverride.prohibited_topics      } : {}),
        ...(body.configOverride.message_constraints    !== undefined ? { message_constraints:    body.configOverride.message_constraints    } : {}),
        ...(body.configOverride.system_prompt_template !== undefined ? { system_prompt_template: body.configOverride.system_prompt_template } : {}),
      };
    }
  }

  // Validate angles list — keep it loose; the prompt builder is forgiving.
  const angles = (Array.isArray(body.anglesUsed) ? body.anglesUsed : []) as AiAngleKey[];

  const result = await buildAiConciergeSystemPrompt({
    venueId:       body.venueId,
    leadId:        body.leadId,
    attemptNumber: typeof body.attemptNumber === 'number' ? body.attemptNumber : 1,
    anglesUsed:    angles,
    configOverride,
  });

  if (!result.ok) {
    // Builder failures are typically "lead not found" / "venue not found";
    // surface them to the operator at 422 so the editor can show a friendly
    // message rather than a generic 500.
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({
    systemPrompt:  result.systemPrompt,
    inputContext:  result.inputContext,
    configVersion: result.config.version,
    configId:      result.config.id,
    isFromActive:  configOverride === undefined,
  });
}
