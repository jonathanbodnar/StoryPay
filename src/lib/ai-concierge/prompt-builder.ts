/**
 * AI Concierge — system prompt builder.
 *
 * Loads the active `ai_config` row, the venue + lead context, and the lead's
 * recent message history, and renders the `system_prompt_template` from the
 * DB by replacing `{{placeholders}}` with concrete values.
 *
 * Centralised here so the send cron, super-admin "preview prompt" tool, and
 * any future test-run script all produce IDENTICAL prompts.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { resolveVenueTimezone } from '@/lib/venue-timezone';
import { formatInTimeZone } from 'date-fns-tz';

import { fetchLeadConversationHistory } from './conversation-helpers';
import type { AiAngleKey } from './types';

// ── Public types ───────────────────────────────────────────────────────────

export interface AiConfigRow {
  id:                       string;
  version:                  number;
  is_active:                boolean;
  personality:              string;
  goals:                    string;
  guardrails:               string;
  prohibited_topics:        string;
  message_constraints:      Record<string, unknown>;
  system_prompt_template:   string;
}

export interface BuildPromptInput {
  venueId:           string;
  leadId:            string;
  attemptNumber:     number;
  /** Angles already used in prior messages — passed back to the model so it
   *  can pick a fresh one. */
  anglesUsed:        AiAngleKey[];
  /** Override the active config (super-admin "preview" feature). */
  configOverride?:   AiConfigRow;
}

export interface BuildPromptResult {
  ok: true;
  systemPrompt: string;
  config:       AiConfigRow;
  /** Snapshot of the input data we used — stored on `ai_runs.input_context`. */
  inputContext: PromptInputContext;
}

export interface PromptInputContextLeadEntry {
  bride_first_name:           string;
  bride_full_name:             string;
  initial_inquiry_iso:        string | null;
  time_since_initial_inquiry: string;
  wedding_date_or_unknown:    string;
  bride_notes_or_none:        string;
}

export interface PromptInputContextVenueEntry {
  venue_name:               string;
  venue_city:               string;
  venue_state:              string;
  venue_style_description:  string;
  assistant_persona_name:   string;
  timezone:                 string;
}

export interface PromptInputContext {
  attempt_number: number;
  angles_used:    AiAngleKey[];
  message_history_last_10: Array<{ sender_kind: string; body: string; created_at: string }>;
  lead:           PromptInputContextLeadEntry;
  venue:          PromptInputContextVenueEntry;
}

// ── Loader: active ai_config ───────────────────────────────────────────────

let _cachedConfig: { row: AiConfigRow; loadedAt: number } | null = null;
const CONFIG_CACHE_MS = 60_000; // 1 minute — admin edits propagate quickly

export async function loadActiveAiConfig(force = false): Promise<AiConfigRow | null> {
  if (!force && _cachedConfig && Date.now() - _cachedConfig.loadedAt < CONFIG_CACHE_MS) {
    return _cachedConfig.row;
  }
  const { data, error } = await supabaseAdmin
    .from('ai_config')
    .select('id, version, is_active, personality, goals, guardrails, prohibited_topics, message_constraints, system_prompt_template')
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as AiConfigRow;
  _cachedConfig = { row, loadedAt: Date.now() };
  return row;
}

/** Bust the cache when an admin saves a new config version. */
export function clearAiConfigCache(): void {
  _cachedConfig = null;
}

// ── Loader: venue + lead context ───────────────────────────────────────────

interface VenueContextRow {
  id:                          string;
  name:                        string | null;
  location_city:               string | null;
  location_state:              string | null;
  description:                 string | null;
  ai_assistant_persona_name:   string | null;
  timezone:                    string | null;
}

interface LeadContextRow {
  id:           string;
  email:        string | null;
  name:         string | null;
  first_name:   string | null;
  last_name:    string | null;
  wedding_date: string | null;
  guest_count:  number | null;
  message:      string | null;
  notes:        string | null;
  created_at:   string | null;
}

async function loadVenueContext(venueId: string): Promise<VenueContextRow | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, name, location_city, location_state, description, ai_assistant_persona_name, timezone')
    .eq('id', venueId)
    .maybeSingle();
  return (data as VenueContextRow | null) ?? null;
}

async function loadLeadContext(venueId: string, leadId: string): Promise<LeadContextRow | null> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('id, email, name, first_name, last_name, wedding_date, guest_count, message, notes, created_at')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return (data as LeadContextRow | null) ?? null;
}

// ── Public: build the prompt ───────────────────────────────────────────────

export async function buildAiConciergeSystemPrompt(
  input: BuildPromptInput,
): Promise<BuildPromptResult | { ok: false; error: string }> {
  const config = input.configOverride ?? await loadActiveAiConfig();
  if (!config) {
    return { ok: false, error: 'No active ai_config row — seed migration 098 not applied?' };
  }

  const venue = await loadVenueContext(input.venueId);
  if (!venue) {
    return { ok: false, error: `Venue ${input.venueId} not found` };
  }

  const lead = await loadLeadContext(input.venueId, input.leadId);
  if (!lead) {
    return { ok: false, error: `Lead ${input.leadId} not found for venue ${input.venueId}` };
  }

  const tz = resolveVenueTimezone(venue.timezone);
  const history = await fetchLeadConversationHistory(input.venueId, input.leadId, 10);

  const leadCtx: PromptInputContextLeadEntry = {
    bride_first_name:            firstName(lead),
    bride_full_name:             fullName(lead),
    initial_inquiry_iso:         lead.created_at,
    time_since_initial_inquiry:  humanizeSinceIso(lead.created_at),
    wedding_date_or_unknown:     formatWeddingDate(lead.wedding_date),
    bride_notes_or_none:         joinNotes(lead),
  };

  const venueCtx: PromptInputContextVenueEntry = {
    venue_name:              venue.name?.trim() || 'our venue',
    venue_city:              venue.location_city?.trim() || '',
    venue_state:              venue.location_state?.trim() || '',
    venue_style_description:  venue.description?.trim().slice(0, 400) || '',
    assistant_persona_name:   venue.ai_assistant_persona_name?.trim() || 'Alison',
    timezone:                tz,
  };

  const renderTokens: Record<string, string> = {
    // Config sections (also embedded literally in the template)
    personality:        config.personality,
    goals:              config.goals,
    guardrails:         config.guardrails,
    prohibited_topics:  config.prohibited_topics,
    // Venue
    venue_name:               venueCtx.venue_name,
    venue_city:               venueCtx.venue_city,
    venue_state:              venueCtx.venue_state,
    venue_style_description:  venueCtx.venue_style_description,
    assistant_persona_name:   venueCtx.assistant_persona_name,
    // Lead
    bride_first_name:           leadCtx.bride_first_name,
    bride_full_name:             leadCtx.bride_full_name,
    initial_inquiry_date:       leadCtx.initial_inquiry_iso
      ? formatInTimeZone(new Date(leadCtx.initial_inquiry_iso), tz, 'MMMM d, yyyy')
      : 'unknown',
    time_since_initial_inquiry:  leadCtx.time_since_initial_inquiry,
    wedding_date_or_unknown:    leadCtx.wedding_date_or_unknown,
    bride_notes_or_none:        leadCtx.bride_notes_or_none,
    // Run-specific
    attempt_number:           String(input.attemptNumber),
    angles_used_list:         input.anglesUsed.length > 0
      ? input.anglesUsed.join(', ')
      : 'none yet',
    message_history_last_10:  formatMessageHistory(history),
  };

  const systemPrompt = renderTemplate(config.system_prompt_template, renderTokens);

  return {
    ok: true,
    systemPrompt,
    config,
    inputContext: {
      attempt_number: input.attemptNumber,
      angles_used:    input.anglesUsed,
      message_history_last_10: history.map((m) => ({
        sender_kind: m.sender_kind,
        body:        m.body.slice(0, 400),
        created_at:  m.created_at,
      })),
      lead:  leadCtx,
      venue: venueCtx,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Replace `{{key}}` with values, leave unknown tokens as-is for debug visibility. */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return vars[key] !== undefined ? vars[key] : `{{${key}}}`;
  });
}

function firstName(lead: LeadContextRow): string {
  const fn = (lead.first_name || '').trim();
  if (fn) return fn;
  const split = (lead.name || '').trim().split(/\s+/);
  return split[0] || 'there';
}

function fullName(lead: LeadContextRow): string {
  const composed = [lead.first_name, lead.last_name]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
  return composed || (lead.name || '').trim() || 'unknown';
}

function formatWeddingDate(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function joinNotes(lead: LeadContextRow): string {
  const parts: string[] = [];
  if (lead.message) parts.push(lead.message.trim());
  if (lead.notes)   parts.push(lead.notes.trim());
  if (lead.guest_count) parts.push(`Guest count mentioned: ${lead.guest_count}`);
  const merged = parts.filter(Boolean).join(' | ');
  return merged.length > 0 ? merged.slice(0, 500) : 'none';
}

function humanizeSinceIso(iso: string | null): string {
  if (!iso) return 'a while ago';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / 86_400_000);
  if (days < 1)  return 'today';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

function formatMessageHistory(
  history: Array<{ sender_kind: string; body: string; created_at: string }>,
): string {
  if (history.length === 0) return '(no prior messages)';
  return history
    .map((m) => {
      const who =
        m.sender_kind === 'contact' ? 'Bride' :
        m.sender_kind === 'ai'      ? 'You'   :
        m.sender_kind === 'owner' || m.sender_kind === 'team' ? 'Venue staff' :
        m.sender_kind === 'system'  ? 'System' :
        m.sender_kind;
      const body = m.body.replace(/\s+/g, ' ').trim().slice(0, 280);
      return `${who}: ${body}`;
    })
    .join('\n');
}
