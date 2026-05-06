/**
 * Draft an outbound reply to a bride using DeepSeek, with venue voice matching
 * and full conversation context.
 *
 * Used by:
 *   - /api/admin/support/draft-bride-reply  (support agent replying as venue)
 *   - /api/dashboard/conversations/draft-reply (venue replying directly)
 *
 * Inputs come from the same data sources the support inbox already loads:
 *   - The thread's recent messages (chronological context)
 *   - Recent outbound messages from the same venue across other threads
 *     (voice / tone reference)
 *   - Venue + bride profile fields (names, persona, plan-level cues)
 *
 * Output is plain text — no angle tags. We deliberately keep the prompt
 * conservative: the model NEVER quotes pricing or commits to specific dates
 * the venue hasn't already mentioned. It nudges toward a tour/call.
 */

import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { supabaseAdmin } from '@/lib/supabase';

// ── Public types ──────────────────────────────────────────────────────────

export interface DraftReplyInput {
  venueId:       string;
  threadId:      string;
  /** 'sms' caps the body at ~280 chars; 'email' lets it run 1–2 short paragraphs. */
  channel:       'sms' | 'email';
  /** Optional steer — if set, the model treats this as the agent's loose
   *  intent and shapes the reply toward it. */
  intent?:       string;
  /** Whose voice to mimic. 'venue' = use the venue's recent outbound style.
   *  'support' is reserved for future use (StoryVenue tone). */
  voice?:        'venue' | 'support';
}

export type DraftReplyResult =
  | { ok: true;  text: string; reasoning?: string }
  | { ok: false; error: string };

// ── Implementation ───────────────────────────────────────────────────────

const DEFAULT_TEMP    = 0.65;
const SMS_MAX_CHARS   = 280;
const EMAIL_MAX_TOKENS = 350;
const SMS_MAX_TOKENS   = 180;
const HISTORY_LIMIT   = 10;
const VOICE_SAMPLE_LIMIT = 8;

export async function draftBrideReply(input: DraftReplyInput): Promise<DraftReplyResult> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { ok: false, error: 'DEEPSEEK_API_KEY not set' };
  }

  // 1. Thread + venue + bride context
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id, subject, external_reply_channel')
    .eq('id', input.threadId)
    .eq('venue_id', input.venueId)
    .maybeSingle();

  if (!thread) return { ok: false, error: 'Thread not found' };

  const [{ data: venue }, { data: bride }] = await Promise.all([
    supabaseAdmin.from('venues')
      .select('name, ai_assistant_persona_name, timezone, owner_first_name, owner_last_name')
      .eq('id', input.venueId).maybeSingle(),
    supabaseAdmin.from('venue_customers')
      .select('first_name, last_name, customer_email, phone, sms_dnd')
      .eq('id', (thread as { venue_customer_id: string }).venue_customer_id).maybeSingle(),
  ]);

  if (!venue) return { ok: false, error: 'Venue not found' };

  // 2. Recent thread messages (chronological)
  const { data: msgs } = await supabaseAdmin
    .from('conversation_messages')
    .select('sender_kind, channel, body, created_at, sent_on_behalf_of_venue')
    .eq('thread_id', input.threadId)
    .eq('visibility', 'external')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  const history = (msgs ?? []).slice().reverse() as Array<{
    sender_kind: string;
    channel: string;
    body: string;
    created_at: string;
    sent_on_behalf_of_venue: boolean | null;
  }>;

  if (history.length === 0) {
    return { ok: false, error: 'No bride messages to reply to' };
  }

  const lastInbound = [...history].reverse().find(m => m.sender_kind === 'contact');
  if (!lastInbound) {
    return { ok: false, error: 'No inbound bride message to reply to' };
  }

  // 3. Voice samples — recent owner/team outbound messages from THIS venue
  //    across all threads, so the model can mirror the authentic voice.
  //    Two-step: get this venue's recent thread ids, then their messages.
  const { data: venueThreads } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_id', input.venueId)
    .order('last_message_at', { ascending: false })
    .limit(50);

  const venueThreadIds = (venueThreads ?? []).map(t => (t as { id: string }).id);
  let voiceTexts: string[] = [];
  if (venueThreadIds.length > 0) {
    const { data: voiceSamples } = await supabaseAdmin
      .from('conversation_messages')
      .select('body, sender_kind, created_at')
      .in('thread_id', venueThreadIds)
      .in('sender_kind', ['owner', 'team'])
      .eq('visibility', 'external')
      .order('created_at', { ascending: false })
      .limit(VOICE_SAMPLE_LIMIT);
    voiceTexts = (voiceSamples ?? [])
      .map(m => (m as { body: string }).body)
      .filter(Boolean)
      .slice(0, VOICE_SAMPLE_LIMIT);
  }

  // 4. Build the prompt
  const persona = (venue as { ai_assistant_persona_name: string | null }).ai_assistant_persona_name?.trim() || 'the venue team';
  const venueName = (venue as { name: string }).name;
  const brideFirst = (bride as { first_name: string | null } | null)?.first_name?.trim() || 'there';

  const channelGuide = input.channel === 'sms'
    ? `SMS: 1–3 short sentences, max ${SMS_MAX_CHARS} characters. No greetings like "Hi {{name}}," — go straight in. No signature.`
    : `Email: 1–2 short paragraphs. Open with a warm greeting. Sign off as "${persona}, ${venueName}" on the last line.`;

  const intentHint = input.intent?.trim()
    ? `\n\nThe agent wants the reply to: ${input.intent.trim()}.`
    : '';

  const voiceBlock = voiceTexts.length > 0
    ? `\n\nVOICE REFERENCE — recent outbound messages from ${venueName}. Match this warmth, sentence length, and word choice. Do NOT copy phrases verbatim — adapt the *style*:\n${voiceTexts.map((t, i) => `[${i + 1}] ${t.replace(/\n+/g, ' ').trim()}`).join('\n')}`
    : '';

  const transcript = history.map(m => {
    const who = m.sender_kind === 'contact' ? `BRIDE (${brideFirst})`
              : m.sender_kind === 'concierge' || m.sent_on_behalf_of_venue ? 'SUPPORT-AS-VENUE'
              : m.sender_kind === 'ai' ? 'AI'
              : `VENUE (${venueName})`;
    return `${who}: ${m.body.replace(/\s+/g, ' ').trim()}`;
  }).join('\n');

  const systemPrompt = [
    `You are drafting a reply on behalf of ${venueName} (a wedding venue) to a prospective bride named ${brideFirst}.`,
    `You are NOT an AI assistant — you are writing as if you are part of ${venueName}'s team. Never mention being AI.`,
    '',
    'STRICT RULES:',
    '- Never quote specific prices, dates, or availability the venue has not already mentioned in the transcript.',
    '- If the bride asks for pricing/availability and the venue has not given specifics, redirect to scheduling a quick call or tour.',
    '- Warm, conversational, professional. No corporate jargon, no exclamation overload.',
    '- Match the voice samples below (tone, sentence length).',
    '- Address the bride\'s last question/message directly. Don\'t restate it — just answer.',
    '- End with a soft forward-motion question (tour, call, next step) when natural.',
    `- ${channelGuide}`,
    '- Output ONLY the reply text. No prefixes, no quotes, no JSON.',
    voiceBlock,
    intentHint,
    '',
    'CONVERSATION SO FAR (oldest → newest):',
    transcript,
    '',
    `THE BRIDE'S MOST RECENT MESSAGE WAS:`,
    `"${lastInbound.body.replace(/\s+/g, ' ').trim()}"`,
  ].join('\n');

  // 5. Call DeepSeek
  let raw = '';
  try {
    const client = getDeepSeekClient();
    const completion = await client.chat.completions.create({
      model: DEEPSEEK_MODEL,
      temperature: DEFAULT_TEMP,
      max_tokens: input.channel === 'email' ? EMAIL_MAX_TOKENS : SMS_MAX_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: 'Draft the reply now.' },
      ],
    });
    raw = completion.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'DeepSeek error' };
  }

  const cleaned = raw
    .replace(/^[\s`'"]+/, '')
    .replace(/[\s`'"]+$/, '')
    .replace(/^"|"$/g, '')
    .trim();

  if (!cleaned) return { ok: false, error: 'Empty draft' };

  // SMS hard cap
  if (input.channel === 'sms' && cleaned.length > SMS_MAX_CHARS) {
    const trimmed = cleaned.slice(0, SMS_MAX_CHARS);
    const lastSpace = trimmed.lastIndexOf(' ');
    return {
      ok: true,
      text: lastSpace > SMS_MAX_CHARS * 0.7 ? trimmed.slice(0, lastSpace).trim() : trimmed.trim(),
    };
  }

  return { ok: true, text: cleaned };
}
