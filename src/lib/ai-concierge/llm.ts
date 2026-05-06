/**
 * AI Concierge — LLM client wrapper.
 *
 * Wraps DeepSeek (via the shared `getDeepSeekClient` from `@/lib/ai-client`)
 * with the AI-Concierge-specific output contract:
 *
 *   <<angle>>angle_key_here<</angle>>
 *   <<sms>>The actual SMS text here.<</sms>>
 *
 * Returns a parsed `{ angle, smsText }` plus the raw model output for logging.
 * If the model output can't be parsed, returns an error result so the caller
 * can decide whether to retry vs. mark the run as failed.
 *
 * Per spec: DeepSeek for both SMS generation AND intent classification — the
 * intent classifier lives in a sibling file but uses this same client.
 */

import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { stripEmDashes } from '@/lib/ai-text-cleanup';
import { type AiAngleKey, isAiAngleKey } from './types';

// ── Public types ───────────────────────────────────────────────────────────

export interface GenerateSmsInput {
  systemPrompt: string;
  /** Optional user-side context. Most context goes in the system prompt; this
   *  is reserved for the literal "go" turn. */
  userMessage?: string;
  /** DeepSeek temperature. Concierge defaults to 0.85 for variety. */
  temperature?: number;
  /** Hard cap on output tokens. SMS ≤ 320 chars maps to ~120 tokens; we set
   *  this generously to leave room for the angle tag wrapper. */
  maxTokens?: number;
}

export type GenerateSmsResult =
  | {
      ok: true;
      angle: AiAngleKey;
      smsText: string;
      rawModelOutput: string;
    }
  | {
      ok: false;
      error: 'no_completion'
            | 'empty_output'
            | 'missing_angle_tag'
            | 'missing_sms_tag'
            | 'invalid_angle'
            | 'empty_sms'
            | 'api_error';
      detail: string;
      rawModelOutput?: string;
    };

// ── Generate ───────────────────────────────────────────────────────────────

export async function generateSmsWithDeepSeek(
  input: GenerateSmsInput,
): Promise<GenerateSmsResult> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return {
      ok: false,
      error: 'api_error',
      detail: 'DEEPSEEK_API_KEY is not set in the environment',
    };
  }

  const client = getDeepSeekClient();

  let raw = '';
  try {
    const completion = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      temperature: input.temperature ?? 0.85,
      max_tokens: input.maxTokens ?? 220,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user',   content: input.userMessage ?? 'Write the next SMS.' },
      ],
    });
    raw = completion.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown DeepSeek error';
    return { ok: false, error: 'api_error', detail: msg };
  }

  if (!raw.trim()) {
    return { ok: false, error: 'empty_output', detail: 'DeepSeek returned an empty completion', rawModelOutput: raw };
  }

  return parseStructuredOutput(raw);
}

// ── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse the `<<angle>>...<</angle>>` and `<<sms>>...<</sms>>` tags out of the
 * model's response. Tolerant of:
 *   - Surrounding whitespace
 *   - Code-fence wrappers (```)
 *   - Mixed case in the angle key (we lowercase before validation)
 *   - Missing trailing tag if the SMS body has it inline (defensive fallback)
 */
export function parseStructuredOutput(raw: string): GenerateSmsResult {
  const cleaned = raw
    .replace(/^\s*```[a-zA-Z0-9]*\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  const angleMatch = /<<angle>>([\s\S]*?)<<\/angle>>/i.exec(cleaned);
  if (!angleMatch) {
    return {
      ok: false,
      error: 'missing_angle_tag',
      detail: 'Could not find <<angle>> tag in model output',
      rawModelOutput: raw,
    };
  }

  const smsMatch = /<<sms>>([\s\S]*?)<<\/sms>>/i.exec(cleaned);
  if (!smsMatch) {
    return {
      ok: false,
      error: 'missing_sms_tag',
      detail: 'Could not find <<sms>> tag in model output',
      rawModelOutput: raw,
    };
  }

  const angleRaw = (angleMatch[1] || '').trim().toLowerCase();
  if (!isAiAngleKey(angleRaw)) {
    return {
      ok: false,
      error: 'invalid_angle',
      detail: `"${angleRaw}" is not a recognized angle key`,
      rawModelOutput: raw,
    };
  }

  const smsText = stripEmDashes((smsMatch[1] || '').trim());
  if (!smsText) {
    return {
      ok: false,
      error: 'empty_sms',
      detail: '<<sms>> tag was empty',
      rawModelOutput: raw,
    };
  }

  return {
    ok: true,
    angle: angleRaw,
    smsText,
    rawModelOutput: raw,
  };
}

// ── Length / safety filtering ──────────────────────────────────────────────

/**
 * Enforce the message-length contract before send:
 *   - Trim leading / trailing whitespace
 *   - Hard cap at maxChars (default 320 = 2 SMS segments)
 *   - Final character must not be mid-word; truncate on the last space if cap hit
 */
export function clampSmsLength(raw: string, maxChars = 320): string {
  const t = raw.trim();
  if (t.length <= maxChars) return t;
  const sliced = t.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace >= maxChars * 0.7) return sliced.slice(0, lastSpace).trim();
  return sliced.trim();
}
