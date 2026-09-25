/**
 * StoryVenue LeadFinder™ — the AI extraction fallback.
 *
 * The deterministic parser in `./extract` is the primary reader: it knows the
 * labelled shapes the marketplaces actually send and it is exact and free. This
 * module only exists for the messages that come back THIN — an unfamiliar
 * format where the parser could not read a name or any of the real inquiry
 * fields. Asking a model to read the same body can recover the couple's details
 * instead of us creating a lead that is nothing but the sender's address.
 *
 * Three rules shape everything here:
 *
 *   1. It only ever FILLS GAPS. The merge in `ingest.ts` gives the deterministic
 *      result precedence, so the AI can never overwrite something we know.
 *   2. It never throws. A missing key, an API error or unparseable output all
 *      return `null`, exactly like the AI Concierge intent classifier — the
 *      pipeline simply continues with what the deterministic pass found.
 *   3. The model is untrusted. Its output is validated, coerced and bounded in
 *      code, and confidence is COMPUTED from the fields that survived that
 *      validation, never taken from the model's own say-so.
 */

import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import {
  normalizeDate,
  normalizePhone,
  type ExtractedLead,
} from '@/lib/leadfinder/extract';

// ── Types ────────────────────────────────────────────────────────────────────

/** The optional fields an AI pass can attempt to fill. Never includes email. */
export interface AiExtractedFields {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  weddingDate: string | null;
  guestCount: number | null;
  venueMatters: string | null;
  timeline: string | null;
  message: string | null;
}

export interface AiExtractInput {
  subject: string | null;
  text: string;
  /** From the envelope, never from the model. Used as context only. */
  senderEmail: string | null;
  /** Display name from the From header, if the sender provided one. */
  senderDisplayName: string | null;
}

export interface AiExtractResult {
  fields: AiExtractedFields;
  /** 0–1. Computed in code from the validated fields, not self-reported. */
  overallConfidence: number;
  /** Per-field confidence (0–1) keyed by field name, for the review UI. */
  fieldConfidence: Record<string, number>;
  model: string;
}

/** Anything we can score: a deterministic result, an AI result, or a merge. */
export interface ScorableFields {
  email?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  weddingDate?: string | null;
  guestCount?: number | null;
  venueMatters?: string | null;
  timeline?: string | null;
  message?: string | null;
}

// ── Thinness heuristic ───────────────────────────────────────────────────────

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');
}

/**
 * Is the deterministic result too thin to trust on its own?
 *
 * Thin means BOTH:
 *   - no usable name, AND
 *   - fewer than two of the real inquiry signals (phone, guest count, wedding
 *     date, venue matters, timeline).
 *
 * A message with a name and a date is a real inquiry we can act on; a message
 * whose only content is the sender's address is exactly the case where the AI
 * pass earns its keep.
 */
export function needsAiFallback(extracted: ExtractedLead): boolean {
  if (isFilled(extracted.name)) return false;
  const signals = [
    extracted.phone,
    extracted.guestCount,
    extracted.weddingDate,
    extracted.venueMatters,
    extracted.timeline,
  ].filter(isFilled).length;
  return signals < 2;
}

// ── Confidence scoring ───────────────────────────────────────────────────────

/**
 * How much a single field contributes to the overall extraction confidence.
 * Deliberately weighted so an inquiry needs an identity (email) plus a name
 * plus at least one hard detail (phone, date or guest count) to reach 0.75,
 * the routing threshold. Email + name alone (0.60), or email alone (0.40),
 * are exactly the "we only have the sender's address" cases that belong in
 * the review queue rather than in an automatic follow-up.
 */
const FIELD_WEIGHT: Record<string, number> = {
  email: 0.40,
  name: 0.20,
  phone: 0.15,
  weddingDate: 0.15,
  guestCount: 0.15,
  venueMatters: 0.05,
  timeline: 0.05,
  message: 0.05,
};

/**
 * Score a set of extracted fields. Returns an overall 0–1 confidence and a
 * per-field map. `venueMatters` and `timeline` share one weight bucket so a
 * couple who answered both is not double-counted.
 *
 * `emailConfidence` (default 1) scales the email's contribution: an address
 * read from a labelled field or the original sender is certain, one spotted in
 * free text is probable, and a marketplace relay only reaches them indirectly.
 */
export function scoreExtractedFields(
  fields: ScorableFields,
  opts?: { emailConfidence?: number },
): {
  overallConfidence: number;
  fieldConfidence: Record<string, number>;
} {
  const fieldConfidence: Record<string, number> = {};
  let total = 0;

  if (isFilled(fields.email)) {
    const c = Math.max(0, Math.min(1, opts?.emailConfidence ?? 1));
    total += FIELD_WEIGHT.email * c;
    fieldConfidence.email = c;
  }
  if (isFilled(fields.name)) {
    total += FIELD_WEIGHT.name;
    fieldConfidence.name = isFilled(fields.firstName) && isFilled(fields.lastName) ? 0.9 : 0.8;
  }
  if (isFilled(fields.phone)) {
    total += FIELD_WEIGHT.phone;
    fieldConfidence.phone = 0.9;
  }
  if (isFilled(fields.weddingDate)) {
    total += FIELD_WEIGHT.weddingDate;
    fieldConfidence.weddingDate = 0.9;
  }
  if (isFilled(fields.guestCount)) {
    total += FIELD_WEIGHT.guestCount;
    fieldConfidence.guestCount = 0.9;
  }
  if (isFilled(fields.venueMatters) || isFilled(fields.timeline)) {
    total += FIELD_WEIGHT.venueMatters;
    if (isFilled(fields.venueMatters)) fieldConfidence.venueMatters = 0.6;
    if (isFilled(fields.timeline)) fieldConfidence.timeline = 0.6;
  }
  if (isFilled(fields.message)) {
    total += FIELD_WEIGHT.message;
    fieldConfidence.message = 0.6;
  }

  const overallConfidence = Math.round(Math.min(1, total) * 100) / 100;
  return { overallConfidence, fieldConfidence };
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'You extract wedding-inquiry details from ONE inbound email. You reply with a single JSON object and nothing else.',
  '',
  'The JSON must have EXACTLY these keys:',
  '{"name": null, "firstName": null, "lastName": null, "phone": null, "weddingDate": null, "guestCount": null, "venueMatters": null, "timeline": null, "message": null}',
  '',
  'Rules (absolute):',
  '- Never invent, infer, guess or complete a value that is not literally present in the message. If something is not stated, use null. null is ALWAYS the correct answer for anything absent.',
  '- Never output an email address. It is supplied by the email envelope and is not your job. There is no email key.',
  '- No prose, no markdown, no explanation, no code fences. A single JSON object only.',
  '- Read only the message body. IGNORE the sender\'s signature block, quoted replies, forwarded header blocks and unsubscribe footers — never treat a signature as the couple\'s details.',
  '',
  'Field notes:',
  '- name: the contact\'s name as written. firstName/lastName: split a full name, otherwise null.',
  '- phone: a phone number the inquiry itself states. Copy it as written.',
  '- weddingDate: a wedding or event date the inquiry itself states.',
  '- guestCount: an estimated guest count, as a number, if stated.',
  '- venueMatters: what they said matters most in a venue, if stated.',
  '- timeline: their booking or planning timeline, if stated.',
  '- message: any other message text they actually wrote, if present.',
].join('\n');

function buildUserPrompt(input: AiExtractInput): string {
  const from = [input.senderDisplayName, input.senderEmail].filter(Boolean).join(' ') || 'unknown';
  return [
    `Subject: ${input.subject ?? '(none)'}`,
    `From (envelope, do NOT output as a field): ${from}`,
    '',
    'Message body:',
    '"""',
    input.text.slice(0, 6000),
    '"""',
  ].join('\n');
}

// ── Validation (the model is untrusted) ───────────────────────────────────────

/** The exact key set we accept; anything else is dropped. */
const ALLOWED_KEYS = [
  'name',
  'firstName',
  'lastName',
  'phone',
  'weddingDate',
  'guestCount',
  'venueMatters',
  'timeline',
  'message',
] as const;

const MAX_LEN: Record<string, number> = {
  name: 120,
  firstName: 80,
  lastName: 80,
  phone: 40,
  weddingDate: 60,
  venueMatters: 2000,
  timeline: 200,
  message: 4000,
};

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function cleanString(v: unknown, key: string): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // A "name" that is really an email, or any absurdly long value, is junk.
  if (key === 'name' || key === 'firstName' || key === 'lastName') {
    if (EMAIL_RE.test(trimmed)) return null;
  }
  return trimmed.slice(0, MAX_LEN[key] ?? 200);
}

function cleanGuestCount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.trunc(v);
    return n >= 1 && n <= 100_000 ? n : null;
  }
  if (typeof v === 'string') {
    const m = /\d{1,6}/.exec(v.replace(/,/g, ''));
    if (!m) return null;
    const n = Number(m[0]);
    return n >= 1 && n <= 100_000 ? n : null;
  }
  return null;
}

function splitName(full: string): { first: string | null; last: string | null } {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Turn the model's raw text into the fixed, bounded shape we accept. Unknown
 * keys are dropped, every string is trimmed and capped, the guest count is an
 * integer in a sane range, and a date is kept only if it parses to a real one.
 */
export function validateAiOutput(raw: string): AiExtractedFields {
  const empty: AiExtractedFields = {
    name: null,
    firstName: null,
    lastName: null,
    phone: null,
    weddingDate: null,
    guestCount: null,
    venueMatters: null,
    timeline: null,
    message: null,
  };

  const parsed = parseJsonObject(raw);
  if (!parsed) return empty;

  const out: AiExtractedFields = { ...empty };
  for (const key of ALLOWED_KEYS) {
    if (!(key in parsed)) continue;
    const value = (parsed as Record<string, unknown>)[key];
    if (key === 'guestCount') {
      out.guestCount = cleanGuestCount(value);
    } else if (key === 'phone') {
      out.phone = normalizePhone(cleanString(value, key));
    } else if (key === 'weddingDate') {
      out.weddingDate = normalizeDate(cleanString(value, key));
    } else {
      out[key] = cleanString(value, key);
    }
  }

  // Keep name / firstName / lastName coherent whichever subset the model gave.
  const combined = [out.firstName, out.lastName].filter(Boolean).join(' ');
  const full = out.name ?? (combined || null);
  if (full) {
    out.name = full;
    if (!out.firstName && !out.lastName) {
      const split = splitName(full);
      out.firstName = split.first;
      out.lastName = split.last;
    }
  }

  return out;
}

/** Parse a JSON object out of model text, tolerating code fences and prose. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\s*```[a-zA-Z0-9]*\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  const candidate = first !== -1 && last > first ? cleaned.slice(first, last + 1) : cleaned;

  try {
    const value = JSON.parse(candidate);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return null;
}

// ── Public entry ─────────────────────────────────────────────────────────────

/** Upper bound on the model call, which sits inside the webhook request. */
const AI_TIMEOUT_MS = 12_000;

/**
 * Best-effort AI fallback extraction. Returns `null` — never throws — when the
 * API key is missing, the call fails, or the output cannot be parsed, so the
 * caller simply keeps the deterministic result.
 */
export async function extractWithAi(input: AiExtractInput): Promise<AiExtractResult | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;

  let raw = '';
  try {
    const client = getDeepSeekClient();
    const completion = await client.chat.completions.create(
      {
        model: DEEPSEEK_MODEL,
        temperature: 0,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input) },
        ],
      },
      // This runs inside the inbound-email webhook. The client default (30s,
      // with automatic retries) could hold the request past the provider's
      // timeout; a slow model is simply skipped — the deterministic result
      // stands and the arrival goes to review if it is thin.
      { timeout: AI_TIMEOUT_MS, maxRetries: 0 },
    );
    raw = completion.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    console.error('[leadfinder] extractWithAi DeepSeek error:', e);
    return null;
  }

  const parsed = parseJsonObject(raw);
  if (!parsed) return null;

  const fields = validateAiOutput(raw);
  const { overallConfidence, fieldConfidence } = scoreExtractedFields(fields);
  return { fields, overallConfidence, fieldConfidence, model: DEEPSEEK_MODEL };
}
