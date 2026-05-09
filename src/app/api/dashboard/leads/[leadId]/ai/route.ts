/**
 * Per-lead AI Concierge controls.
 *
 *   GET  → snapshot of the lead's current AI state, plus the booleans the
 *          contact-page UI needs to know whether to render the buttons (and
 *          what to call them):
 *            - canPause      (state = ai_active)
 *            - canReEnable   (state in {paused, handoff, opted_out, exhausted}
 *                             AND not TCPA-locked AND within the 60-day cap
 *                             AND venue is eligible + AI globally on)
 *
 *   POST { action: 're_enable' | 'pause' } → run the action atomically.
 *
 * Re-enable semantics (per spec):
 *   - Resets state to 'dormant'
 *   - Stamps ai_re_enabled_at = NOW()
 *   - Increments ai_re_enable_count
 *   - Sets ai_next_send_at = NOW() + 24h (mandatory cooldown). The activation
 *     cron picks the lead up after the cooldown elapses.
 *   - PRESERVES ai_first_activated_at + ai_expires_at — the 60-day cap is
 *     global per spec ("Hard 60-day cap from FIRST activation, no resets").
 *   - Disabled when sms_dnd_source starts with 'tcpa' / 'inbound_stop' (legal
 *     hard opt-outs) or when NOW() > ai_first_activated_at + 60d (cap blown).
 *
 * Pause semantics:
 *   - State 'ai_active' → 'paused'
 *   - Clears ai_next_send_at
 *   - Removes ai_active tag, applies ai_replied tag (mirrors the inbound
 *     "neutral reply" path so the inbox UI shows the same "humans took over"
 *     visual state)
 *   - Pipeline left alone (no false signal that the bride replied)
 *
 * Both actions log to ai_state_transitions. Eligibility checks happen
 * server-side every time — never trust the UI's button state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';

import { applyAiTag, removeAiTag } from '@/lib/ai-concierge/pipeline-tag-service';
import { ensureVenueAiResources } from '@/lib/ai-concierge/venue-resources';
import { recordAiStateTransition } from '@/lib/ai-concierge/state-transitions';
import type { AiState } from '@/lib/ai-concierge/types';

export const dynamic = 'force-dynamic';

// ── DB row shapes ──────────────────────────────────────────────────────────

interface LeadRow {
  id:                       string;
  venue_id:                 string;
  email:                    string | null;
  ai_state:                 AiState;
  ai_first_activated_at:    string | null;
  ai_expires_at:            string | null;
  ai_next_send_at:          string | null;
  ai_attempt_count:         number | null;
  ai_re_enabled_at:         string | null;
  ai_re_enable_count:       number | null;
  ai_angles_used:           string[] | null;
  last_inbound_at:          string | null;
  last_outbound_at:         string | null;
  sms_dnd:                  boolean | null;
  sms_dnd_source:           string | null;
  sms_dnd_at:               string | null;
}

interface VenueAiRow {
  id:                          string;
  ai_concierge_enabled:        boolean | null;
  a2p_verified:                boolean | null;
  directory_addon_concierge:   boolean | null;
}

// ── Snapshot shape ─────────────────────────────────────────────────────────

interface AiContactSnapshot {
  leadId:                string;
  state:                 AiState;
  firstActivatedAt:      string | null;
  expiresAt:             string | null;
  nextSendAt:            string | null;
  reEnabledAt:           string | null;
  reEnableCount:         number;
  attemptCount:          number;
  smsDnd:                boolean;
  smsDndSource:          string | null;
  smsDndAt:              string | null;

  /** What the UI is allowed to do, derived server-side. */
  canReEnable:           boolean;
  canPause:              boolean;
  isTcpaLocked:          boolean;
  isExpired60d:          boolean;
  hoursUntilCooldownEnd: number | null;
  /** Human-readable reasons re-enable is blocked. */
  reEnableBlockers:      string[];

  /** Venue-level eligibility (mirrors the settings page). */
  venueEligible:         boolean;
  venueAiEnabled:        boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function loadLead(leadId: string, venueId: string): Promise<LeadRow | null> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select(
      'id, venue_id, email, ai_state, ai_first_activated_at, ai_expires_at, ai_next_send_at, ai_attempt_count, ai_re_enabled_at, ai_re_enable_count, ai_angles_used, last_inbound_at, last_outbound_at, sms_dnd, sms_dnd_source, sms_dnd_at',
    )
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return (data as LeadRow | null) ?? null;
}

async function loadVenueAi(venueId: string): Promise<VenueAiRow | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, ai_concierge_enabled, a2p_verified, directory_addon_concierge')
    .eq('id', venueId)
    .maybeSingle();
  return (data as VenueAiRow | null) ?? null;
}

function isTcpaSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return s.startsWith('tcpa') || s.startsWith('inbound_stop');
}

function buildSnapshot(lead: LeadRow, venue: VenueAiRow | null): AiContactSnapshot {
  const venueEligible =
    venue !== null
    && venue.directory_addon_concierge === true
    && venue.a2p_verified === true;
  const venueAiEnabled = venue?.ai_concierge_enabled === true;

  const tcpa = lead.sms_dnd === true && isTcpaSource(lead.sms_dnd_source);
  const expired60d =
    lead.ai_first_activated_at !== null
    && new Date(lead.ai_first_activated_at).getTime() + 60 * 24 * 60 * 60 * 1000 <= Date.now();

  // Re-enable rules: state must be a "stopped" one + not TCPA + cap intact +
  // venue eligible + venue toggle on. We allow re-enabling 'opted_out' for
  // non-TCPA cases (the bride said "not interested" but the venue knows
  // something the AI doesn't — give them the override).
  const reEnableBlockers: string[] = [];
  const stateAllows = ['paused', 'handoff', 'opted_out', 'exhausted'].includes(lead.ai_state);
  if (!stateAllows) reEnableBlockers.push(`Lead state is "${lead.ai_state}" — re-enable only applies after AI has stopped`);
  if (tcpa)         reEnableBlockers.push('Lead opted out via SMS STOP — legally cannot reactivate');
  if (expired60d)   reEnableBlockers.push('60-day follow-up window has elapsed (hard cap, no resets)');
  if (!venueEligible)   reEnableBlockers.push('Venue is not eligible (Concierge add-on / A2P)');
  if (!venueAiEnabled)  reEnableBlockers.push('AI Concierge is turned off for this venue');

  // 24-hour cooldown countdown — only meaningful when we're already in a
  // post-re-enable state and waiting for the activation cron to pick up.
  let hoursUntilCooldownEnd: number | null = null;
  if (lead.ai_state === 'dormant' && lead.ai_re_enabled_at && lead.ai_next_send_at) {
    const ms = new Date(lead.ai_next_send_at).getTime() - Date.now();
    if (ms > 0) hoursUntilCooldownEnd = Math.ceil(ms / 3_600_000);
  }

  return {
    leadId:                lead.id,
    state:                 lead.ai_state,
    firstActivatedAt:      lead.ai_first_activated_at,
    expiresAt:             lead.ai_expires_at,
    nextSendAt:            lead.ai_next_send_at,
    reEnabledAt:           lead.ai_re_enabled_at,
    reEnableCount:         lead.ai_re_enable_count ?? 0,
    attemptCount:          lead.ai_attempt_count ?? 0,
    smsDnd:                lead.sms_dnd === true,
    smsDndSource:          lead.sms_dnd_source ?? null,
    smsDndAt:              lead.sms_dnd_at ?? null,
    canReEnable:           reEnableBlockers.length === 0,
    canPause:              lead.ai_state === 'ai_active',
    isTcpaLocked:          tcpa,
    isExpired60d:          expired60d,
    hoursUntilCooldownEnd,
    reEnableBlockers,
    venueEligible,
    venueAiEnabled,
  };
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await ctx.params;
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });

  const [lead, venue] = await Promise.all([
    loadLead(leadId, user.venueId),
    loadVenueAi(user.venueId),
  ]);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json(buildSnapshot(lead, venue));
}

// ── POST ───────────────────────────────────────────────────────────────────

interface ActionBody { action?: 're_enable' | 'pause' | 'clear_tcpa_lock' }

export async function POST(request: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden — admins only' }, { status: 403 });

  const { leadId } = await ctx.params;
  if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });

  let body: ActionBody;
  try {
    body = await request.json() as ActionBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const action = body.action;
  if (action !== 're_enable' && action !== 'pause' && action !== 'clear_tcpa_lock') {
    return NextResponse.json({ error: 'action must be "re_enable", "pause", or "clear_tcpa_lock"' }, { status: 400 });
  }

  const [lead, venue] = await Promise.all([
    loadLead(leadId, user.venueId),
    loadVenueAi(user.venueId),
  ]);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const snap = buildSnapshot(lead, venue);

  // Manual TCPA override — for genuine mistakes (e.g. bride replied STOP by accident).
  // This clears the opt-out flag on the linked venue_customer and re-enables AI.
  if (action === 'clear_tcpa_lock') {
    if (!snap.isTcpaLocked) {
      return NextResponse.json({ error: 'Lead is not TCPA-locked' }, { status: 422 });
    }
    return await runClearTcpaLock({ lead, user, venue });
  }

  if (action === 're_enable') {
    if (!snap.canReEnable) {
      return NextResponse.json({
        error:    'Cannot re-enable AI for this lead',
        blockers: snap.reEnableBlockers,
      }, { status: 422 });
    }
    return await runReEnable({ lead, user });
  }

  // pause
  if (!snap.canPause) {
    return NextResponse.json({
      error: `Cannot pause AI — lead is in state "${lead.ai_state}", not "ai_active"`,
    }, { status: 422 });
  }
  return await runPause({ lead, user });
}

// ── Action: clear TCPA lock (manual override for mistakes) ────────────────

async function runClearTcpaLock(args: {
  lead:  LeadRow;
  user:  { venueId: string; memberId: string | null };
  venue: VenueAiRow | null;
}) {
  const { lead, user } = args;

  // 1. Clear sms_dnd on the linked venue_customer (look up by email)
  const email = lead.email ?? null;
  if (email) {
    await supabaseAdmin
      .from('venue_customers')
      .update({
        sms_dnd:        false,
        sms_dnd_at:     null,
        sms_dnd_source: 'tcpa_override_manual',
        updated_at:     new Date().toISOString(),
      })
      .eq('venue_id', user.venueId)
      .ilike('customer_email', email);
  }

  // 2. Clear sms_dnd on the lead itself
  await supabaseAdmin
    .from('leads')
    .update({
      sms_dnd:        false,
      sms_dnd_at:     null,
      sms_dnd_source: 'tcpa_override_manual',
      updated_at:     new Date().toISOString(),
    })
    .eq('id', lead.id);

  // 3. Re-enable AI — start immediately, no cooldown
  const now = new Date();
  const { data: updated, error } = await supabaseAdmin
    .from('leads')
    .update({
      ai_state:           'ai_active',
      ai_re_enabled_at:   now.toISOString(),
      ai_re_enable_count: (lead.ai_re_enable_count ?? 0) + 1,
      ai_next_send_at:    now.toISOString(),
      updated_at:         now.toISOString(),
    })
    .eq('id', lead.id)
    .select('id')
    .maybeSingle();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 409 });
  }

  await recordAiStateTransition({
    leadId:      lead.id,
    venueId:     user.venueId,
    fromState:   lead.ai_state,
    toState:     'ai_active',
    reason:      'tcpa_override_manual',
    triggeredBy: user.memberId ? `user:${user.memberId}` : 'human',
    metadata:    { note: 'TCPA opt-out cleared manually — staff confirmed re-consent, AI starts immediately' },
  });

  // Return the fresh snapshot with TCPA unlocked
  const [freshLead, freshVenue] = await Promise.all([
    loadLead(lead.id, user.venueId),
    loadVenueAi(user.venueId),
  ]);
  return NextResponse.json(buildSnapshot(freshLead!, freshVenue));
}

// ── Action: re-enable ──────────────────────────────────────────────────────

async function runReEnable(args: { lead: LeadRow; user: { venueId: string; memberId: string | null } }) {
  const { lead, user } = args;
  const now = new Date();
  const fromState = lead.ai_state;

  // Go straight to ai_active with ai_next_send_at = NOW() so the next cron
  // run fires immediately. No cooldown — the venue team explicitly chose to
  // re-enable this contact and expects outreach to resume right away.
  const { data: updated, error } = await supabaseAdmin
    .from('leads')
    .update({
      ai_state:           'ai_active',
      ai_re_enabled_at:   now.toISOString(),
      ai_re_enable_count: (lead.ai_re_enable_count ?? 0) + 1,
      ai_next_send_at:    now.toISOString(),
      // ai_first_activated_at and ai_expires_at are LEFT INTACT — 60-day
      // cap is global, no resets per spec.
      // ai_attempt_count and ai_angles_used are LEFT INTACT — useful audit
      // history; the next prompt build will see "11 attempts already, here
      // are the angles already tried" so it doesn't repeat.
      updated_at:         now.toISOString(),
    })
    .eq('id', lead.id)
    .eq('venue_id', user.venueId)
    .in('ai_state', ['paused', 'handoff', 'opted_out', 'exhausted'])
    .select('id')
    .maybeSingle();

  if (error || !updated) {
    return NextResponse.json({
      error: error?.message ?? 'Lead state changed before update — refresh and retry',
    }, { status: 409 });
  }

  // Tag housekeeping (best-effort): remove "negative" / "stopped" tags so the
  // contact card reads as "AI is dormant again" rather than "not interested".
  await ensureVenueAiResources(user.venueId);
  await Promise.all([
    removeAiTag(user.venueId, lead.id, 'ai_not_interested'),
    removeAiTag(user.venueId, lead.id, 'ai_needs_human'),
    removeAiTag(user.venueId, lead.id, 'ai_exhausted'),
    removeAiTag(user.venueId, lead.id, 'ai_replied'),
  ]);

  await recordAiStateTransition({
    leadId:      lead.id,
    venueId:     user.venueId,
    fromState,
    toState:     'ai_active',
    reason:      'manually_re_enabled',
    triggeredBy: user.memberId ? `user:${user.memberId}` : 'user:owner',
    metadata: {
      re_enable_count_new:          (lead.ai_re_enable_count ?? 0) + 1,
      preserved_first_activated_at: lead.ai_first_activated_at,
      preserved_expires_at:         lead.ai_expires_at,
    },
  });

  // Audit trail in ai_runs
  void supabaseAdmin.from('ai_runs').insert({
    lead_id:        lead.id,
    venue_id:       user.venueId,
    attempt_number: lead.ai_attempt_count ?? 0,
    input_context: {
      kind:                'manual_re_enable',
      from_state:          fromState,
      next_send_at:        now.toISOString(),
      preserved_attempt_count: lead.ai_attempt_count ?? 0,
    },
    outcome:        'manual_re_enable',
  }).then(() => {}, () => { /* best-effort */ });

  // Return fresh snapshot
  const [next, venueRow] = await Promise.all([
    loadLead(lead.id, user.venueId),
    loadVenueAi(user.venueId),
  ]);
  if (!next) return NextResponse.json({ error: 'Lead missing after update' }, { status: 500 });
  return NextResponse.json(buildSnapshot(next, venueRow));
}

// ── Action: pause ──────────────────────────────────────────────────────────

async function runPause(args: { lead: LeadRow; user: { venueId: string; memberId: string | null } }) {
  const { lead, user } = args;
  const fromState = lead.ai_state;

  const { data: updated, error } = await supabaseAdmin
    .from('leads')
    .update({
      ai_state:        'paused',
      ai_next_send_at: null,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', lead.id)
    .eq('venue_id', user.venueId)
    .eq('ai_state', 'ai_active')
    .select('id')
    .maybeSingle();

  if (error || !updated) {
    return NextResponse.json({
      error: error?.message ?? 'Lead is no longer in ai_active state — refresh and retry',
    }, { status: 409 });
  }

  await ensureVenueAiResources(user.venueId);
  await Promise.all([
    removeAiTag(user.venueId, lead.id, 'ai_active'),
    applyAiTag(user.venueId, lead.id, 'ai_replied'),
  ]);

  await recordAiStateTransition({
    leadId:      lead.id,
    venueId:     user.venueId,
    fromState,
    toState:     'paused',
    reason:      'manually_paused',
    triggeredBy: user.memberId ? `user:${user.memberId}` : 'user:owner',
    metadata: {
      attempt_count: lead.ai_attempt_count ?? 0,
    },
  });

  const [next, venueRow] = await Promise.all([
    loadLead(lead.id, user.venueId),
    loadVenueAi(user.venueId),
  ]);
  if (!next) return NextResponse.json({ error: 'Lead missing after update' }, { status: 500 });
  return NextResponse.json(buildSnapshot(next, venueRow));
}
