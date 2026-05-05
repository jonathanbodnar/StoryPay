/**
 * Canned reply rendering.
 *
 * Templates use the same dot-notation merge variables as the rest of the
 * platform (bride.first_name, venue.name, etc.) plus a few short aliases for
 * convenience. Unknown tokens are preserved verbatim so authors can debug.
 *
 * Rendering happens server-side when the picker resolves a template — that
 * way the client never has to know how to substitute, and we have one source
 * of truth for variable names.
 */

import { supabaseAdmin } from '@/lib/supabase';

// ── Public types ──────────────────────────────────────────────────────────

export interface CannedReplyContext {
  /** Optional thread we're replying to. Used to load bride + venue data. */
  threadId?: string;
  /** Falls back here when threadId can't resolve a venue. */
  venueId?:  string;
  /** Display name of the person doing the replying. */
  agentName?: string;
}

export interface RenderedCannedReply {
  body:    string;
  unknown: string[]; // tokens that didn't resolve, for debugging
}

// ── Variable resolution ───────────────────────────────────────────────────

interface ResolvedVars {
  bride_first_name: string;
  bride_last_name:  string;
  bride_full_name:  string;
  bride_email:      string;
  venue_name:       string;
  venue_persona:    string;
  agent_name:       string;
  current_date:     string;
}

async function resolveVars(ctx: CannedReplyContext): Promise<ResolvedVars> {
  let venueId = ctx.venueId ?? '';
  let venueCustomerId = '';

  if (ctx.threadId) {
    const { data: t } = await supabaseAdmin
      .from('conversation_threads')
      .select('venue_id, venue_customer_id')
      .eq('id', ctx.threadId)
      .maybeSingle();
    if (t) {
      venueId = (t as { venue_id: string }).venue_id || venueId;
      venueCustomerId = (t as { venue_customer_id: string }).venue_customer_id || '';
    }
  }

  const [{ data: venue }, { data: customer }] = await Promise.all([
    venueId
      ? supabaseAdmin.from('venues')
          .select('name, ai_assistant_persona_name')
          .eq('id', venueId).maybeSingle()
      : Promise.resolve({ data: null }),
    venueCustomerId
      ? supabaseAdmin.from('venue_customers')
          .select('first_name, last_name, customer_email')
          .eq('id', venueCustomerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const v = venue as { name?: string; ai_assistant_persona_name?: string | null } | null;
  const c = customer as { first_name?: string | null; last_name?: string | null; customer_email?: string | null } | null;

  const first = (c?.first_name ?? '').trim();
  const last  = (c?.last_name ?? '').trim();

  return {
    bride_first_name: first || 'there',
    bride_last_name:  last,
    bride_full_name:  [first, last].filter(Boolean).join(' ') || 'there',
    bride_email:      (c?.customer_email ?? '').trim(),
    venue_name:       (v?.name ?? '').trim() || 'our venue',
    venue_persona:    (v?.ai_assistant_persona_name ?? '').trim() || (v?.name ?? '').trim() || 'the team',
    agent_name:       (ctx.agentName ?? '').trim(),
    current_date:     new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

// ── Token replacement ────────────────────────────────────────────────────

/**
 * Replace {{token}} with the matching value. Supports both bare names
 * (bride_first_name) and dot-notation (bride.first_name) — the dot form is
 * normalized to underscore for lookup. Unknown tokens are preserved so the
 * author can see what didn't resolve.
 */
function substituteTokens(body: string, vars: ResolvedVars): RenderedCannedReply {
  const unknown: string[] = [];
  const known = vars as unknown as Record<string, string>;

  const out = body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, raw: string) => {
    const key = raw.replace(/\./g, '_').toLowerCase();
    if (key in known) return known[key] ?? '';
    if (!unknown.includes(raw)) unknown.push(raw);
    return match;
  });

  return { body: out, unknown };
}

// ── Public API ────────────────────────────────────────────────────────────

export async function renderCannedReply(
  templateBody: string,
  ctx: CannedReplyContext,
): Promise<RenderedCannedReply> {
  const vars = await resolveVars(ctx);
  return substituteTokens(templateBody, vars);
}

/** Lightweight client-side preview — used by the management UI. Doesn't hit
 *  the DB; substitutes a placeholder set so authors can see the shape. */
export function previewCannedReply(templateBody: string): RenderedCannedReply {
  const placeholder: ResolvedVars = {
    bride_first_name: 'Sarah',
    bride_last_name:  'Johnson',
    bride_full_name:  'Sarah Johnson',
    bride_email:      'sarah@example.com',
    venue_name:       'The Grand Hall',
    venue_persona:    'Alison',
    agent_name:       'Casey',
    current_date:     new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
  return substituteTokens(templateBody, placeholder);
}

/** The canonical list of variables the picker UI advertises to authors. */
export const CANNED_REPLY_VARIABLES: { token: string; description: string; sample: string }[] = [
  { token: '{{bride_first_name}}', description: "Bride's first name (falls back to 'there')", sample: 'Sarah' },
  { token: '{{bride_last_name}}',  description: "Bride's last name", sample: 'Johnson' },
  { token: '{{bride_full_name}}',  description: "Bride's full name", sample: 'Sarah Johnson' },
  { token: '{{bride_email}}',      description: "Bride's email", sample: 'sarah@example.com' },
  { token: '{{venue_name}}',       description: 'Venue display name', sample: 'The Grand Hall' },
  { token: '{{venue_persona}}',    description: "Venue's persona name (e.g. AI assistant name)", sample: 'Alison' },
  { token: '{{agent_name}}',       description: 'Person sending the reply (you)', sample: 'Casey' },
  { token: '{{current_date}}',     description: "Today's date", sample: 'May 5, 2026' },
];
