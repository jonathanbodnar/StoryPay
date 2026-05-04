/**
 * AI Concierge — inbound SMS intent classifier.
 *
 * Second-pass classification used by the inbound handler when keyword rules
 * don't produce a hit. Asks DeepSeek to bucket the bride's reply into one of
 * the intent keys defined in `handoff_rules` (typically `booked_elsewhere`
 * and `not_interested`) plus a `neutral_reply` sentinel meaning "she replied
 * but doesn't fit any negative-intent bucket — humans should take over
 * normally."
 *
 * Output contract (similar to the SMS generator):
 *
 *   <<intent>>booked_elsewhere<</intent>>
 *
 * Tolerant of code fences / surrounding whitespace.
 *
 * Best-effort: if DeepSeek is unreachable or returns garbage we return
 * `neutral_reply` so the inbound flow always has a sensible fallback (the
 * bride replied; humans take over) rather than blocking on the classifier.
 */

import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';

// ── Public types ───────────────────────────────────────────────────────────

export type ClassifiedIntent = 'booked_elsewhere' | 'not_interested' | 'neutral_reply' | string;

export interface ClassifyIntentInput {
  /** Bride's inbound SMS body. */
  messageBody: string;
  /** Allowed intent keys (from handoff_rules, plus `neutral_reply`). */
  allowedIntents: string[];
  /** Optional context about the conversation to help disambiguation. */
  conversationSnippet?: string;
  /** DeepSeek temperature. Classifier defaults to 0.2 for stability. */
  temperature?: number;
}

export interface ClassifyIntentResult {
  intent:         ClassifiedIntent;
  confidence:     'high' | 'medium' | 'low';
  rawModelOutput: string;
  /** Set when the LLM call failed and we returned the safe default. */
  fallback?:      boolean;
}

// ── Public entry ───────────────────────────────────────────────────────────

export async function classifyInboundIntent(
  input: ClassifyIntentInput,
): Promise<ClassifyIntentResult> {
  const allowed = input.allowedIntents.map((s) => s.toLowerCase()).filter(Boolean);
  // Always include neutral_reply as a fallback option
  if (!allowed.includes('neutral_reply')) allowed.push('neutral_reply');

  if (!process.env.DEEPSEEK_API_KEY) {
    return {
      intent: 'neutral_reply',
      confidence: 'low',
      rawModelOutput: '',
      fallback: true,
    };
  }

  const systemPrompt = buildSystemPrompt(allowed, input.conversationSnippet);
  const client = getDeepSeekClient();

  let raw = '';
  try {
    const completion = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      temperature: input.temperature ?? 0.2,
      max_tokens: 80,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Bride's reply:\n"""${input.messageBody.slice(0, 800)}"""` },
      ],
    });
    raw = completion.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    console.error('[ai-concierge] classifyInboundIntent DeepSeek error:', e);
    return {
      intent: 'neutral_reply',
      confidence: 'low',
      rawModelOutput: '',
      fallback: true,
    };
  }

  const parsed = parseIntentOutput(raw, allowed);
  return {
    intent:         parsed.intent,
    confidence:     parsed.confidence,
    rawModelOutput: raw,
    fallback:       false,
  };
}

// ── Prompt + parser ────────────────────────────────────────────────────────

function buildSystemPrompt(allowedIntents: string[], conversationSnippet?: string): string {
  const intentList = allowedIntents.map((k) => `- ${k}`).join('\n');
  const ctx = conversationSnippet?.trim()
    ? `\nConversation so far (most recent last):\n${conversationSnippet.trim().slice(0, 1500)}\n`
    : '';

  return [
    'You classify a single inbound SMS reply from a bride to a wedding venue.',
    '',
    'You output exactly ONE intent label from the allowed list:',
    intentList,
    '',
    'Definitions:',
    '- booked_elsewhere → she explicitly says she chose another venue, signed a contract, or is locked in elsewhere',
    '- not_interested   → she explicitly says she is no longer interested, has changed plans, called off the wedding, or is firmly declining',
    '- neutral_reply    → anything else: questions, scheduling, casual replies, mixed signals, or anything you are not certain falls into the negative buckets above',
    '',
    'Important:',
    '- Default to neutral_reply when in doubt. False positives on the negative buckets are worse than false negatives.',
    '- Do NOT treat a polite "thanks" or a single emoji as not_interested.',
    '- A reply containing pricing or scheduling questions is neutral_reply (humans handle those).',
    '- Sarcasm, hedging, or "maybe later" is neutral_reply (not not_interested).',
    ctx,
    'Output your response in this exact format and nothing else:',
    '<<intent>>intent_key_here<</intent>>',
    '<<confidence>>high|medium|low<</confidence>>',
  ].join('\n');
}

interface ParsedIntent {
  intent:     string;
  confidence: 'high' | 'medium' | 'low';
}

export function parseIntentOutput(raw: string, allowedIntents: string[]): ParsedIntent {
  const cleaned = raw
    .replace(/^\s*```[a-zA-Z0-9]*\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  const intentMatch = /<<intent>>([\s\S]*?)<<\/intent>>/i.exec(cleaned);
  const candidate = intentMatch?.[1]?.trim().toLowerCase() ?? '';

  const allowed = new Set(allowedIntents.map((s) => s.toLowerCase()));
  const intent = allowed.has(candidate) ? candidate : 'neutral_reply';

  const confMatch = /<<confidence>>([\s\S]*?)<<\/confidence>>/i.exec(cleaned);
  const confRaw = (confMatch?.[1] || '').trim().toLowerCase();
  const confidence: 'high' | 'medium' | 'low' =
    confRaw === 'high' || confRaw === 'medium' || confRaw === 'low' ? confRaw : 'medium';

  return { intent, confidence };
}
