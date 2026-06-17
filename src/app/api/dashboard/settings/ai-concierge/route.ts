/**
 * Venue admin API for AI Concierge settings.
 *
 * GET   → load eligibility flags + saved settings
 * PATCH → update ai_concierge_enabled, persona name, concierge notify emails
 *
 * Eligibility constraint mirrors the DB CHECK in migration 098:
 *   ai_concierge_enabled requires (a2p_verified = TRUE AND directory_addon_concierge = TRUE)
 *
 * Toggling the AI ON for the first time triggers `ensureVenueAiResources()`
 * to resolve / cache the AI pipeline stages and marketing tags so the very
 * first activation cron run finds a populated `venues.ai_concierge_resources`.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { ensureVenueAiResources } from '@/lib/ai-concierge/venue-resources';

export const dynamic = 'force-dynamic';

interface VenueRow {
  id:                          string;
  name:                        string | null;
  ai_concierge_enabled:        boolean | null;
  a2p_verified:                boolean | null;
  directory_addon_concierge:   boolean | null;
  ai_assistant_persona_name:   string | null;
  ai_concierge_notify_emails:  string[] | null;
  ai_concierge_enabled_at:     string | null;
  ai_concierge_resources:      Record<string, unknown> | null;
  ghl_connected:               boolean | null;
  notification_email:          string | null;
  email:                       string | null;
  directory_plan_id:           string | null;
}

interface PlanRow {
  feature_flags: Record<string, unknown> | null;
  is_legacy:     boolean | null;
  name:          string | null;
  slug:          string | null;
}

interface AiConciergeSettingsPayload {
  enabled:               boolean;
  personaName:           string;
  conciergeNotifyEmails: string[];
  eligibility: {
    addonPurchased:      boolean;
    a2pVerified:         boolean;
    eligible:            boolean;
    /** Human-readable reasons the venue can't enable AI yet. */
    blockers:            string[];
  };
  ownerNotificationEmail: string | null;
  ghlConnected:           boolean;
  enabledAt:              string | null;
  resourcesReady:         boolean;
}

async function loadVenueRow(venueId: string): Promise<{ venue: VenueRow; plan: PlanRow | null } | null> {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, ai_concierge_enabled, a2p_verified, directory_addon_concierge, ai_assistant_persona_name, ai_concierge_notify_emails, ai_concierge_enabled_at, ai_concierge_resources, ghl_connected, notification_email, email, directory_plan_id',
    )
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return null;

  let plan: PlanRow | null = null;
  if ((venue as VenueRow).directory_plan_id) {
    const { data: planRow } = await supabaseAdmin
      .from('directory_plans')
      .select('feature_flags, is_legacy, name, slug')
      .eq('id', (venue as VenueRow).directory_plan_id as string)
      .maybeSingle();
    plan = (planRow as PlanRow | null) ?? null;
  }

  return { venue: venue as VenueRow, plan };
}

function shapePayload(v: VenueRow, plan: PlanRow | null): AiConciergeSettingsPayload {
  // Concierge is granted when:
  //  - the venue has the addon purchased (directory_addon_concierge)
  //  - OR the plan explicitly includes it (feature_flags.addon_concierge_included)
  //  - OR the plan is a legacy plan (legacy plans include all addons)
  const flags = plan?.feature_flags ?? {};
  const planIncludesConcierge = flags['addon_concierge_included'] === true;
  const isLegacyPlan = plan?.is_legacy === true
    || String(plan?.name ?? '').toLowerCase().includes('legacy')
    || String(plan?.slug ?? '').toLowerCase().includes('legacy');
  const addon  = v.directory_addon_concierge === true || planIncludesConcierge || isLegacyPlan;
  // GHL-connected venues have A2P compliance handled by GHL/their carrier
  // account, not by StoryVenue's direct registration flow. Treat ghl_connected
  // as satisfying the a2p requirement everywhere.
  const a2p    = v.a2p_verified === true || v.ghl_connected === true;
  const eligible = addon && a2p;

  const blockers: string[] = [];
  if (!addon) blockers.push('Venue Concierge add-on is not on this plan');
  if (!a2p)   blockers.push('A2P 10DLC compliance has not been verified by StoryVenue');

  const cached = v.ai_concierge_resources as { stages?: Record<string, string>; tags?: Record<string, string> } | null;
  const resourcesReady = !!(cached?.stages && Object.keys(cached.stages).length > 0
    && cached.tags && Object.keys(cached.tags).length > 0);

  return {
    enabled:               v.ai_concierge_enabled === true,
    personaName:           (v.ai_assistant_persona_name || 'Alison').trim() || 'Alison',
    conciergeNotifyEmails: (v.ai_concierge_notify_emails || []).filter(Boolean),
    eligibility: { addonPurchased: addon, a2pVerified: a2p, eligible, blockers },
    ownerNotificationEmail: v.notification_email || v.email || null,
    ghlConnected:           v.ghl_connected === true,
    enabledAt:              v.ai_concierge_enabled_at,
    resourcesReady,
  };
}

// ── GET ────────────────────────────────────────────────────────────────────

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await loadVenueRow(user.venueId);
  if (!result) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  return NextResponse.json(shapePayload(result.venue, result.plan));
}

// ── PATCH ──────────────────────────────────────────────────────────────────

interface PatchBody {
  enabled?:               boolean;
  personaName?:           string;
  conciergeNotifyEmails?: string[];
}

function sanitizeEmails(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const e = raw.trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= 25) break;
  }
  return out;
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: PatchBody;
  try {
    body = await request.json() as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const currentResult = await loadVenueRow(venueId);
  if (!currentResult) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  const current = currentResult.venue;

  const updates: Record<string, unknown> = {};

  // Persona name
  if (body.personaName !== undefined) {
    const name = (body.personaName || '').trim().slice(0, 60);
    updates.ai_assistant_persona_name = name || 'Alison';
  }

  // Concierge notify emails
  if (body.conciergeNotifyEmails !== undefined) {
    updates.ai_concierge_notify_emails = sanitizeEmails(body.conciergeNotifyEmails);
  }

  // Master enable flag — venues can toggle freely. The DB CHECK constraint
  // (migration 098) requires directory_addon_concierge = TRUE and a2p_verified
  // = TRUE. For legacy plans (or plans that include concierge), we sync the
  // venue's addon flag so the constraint passes. A2P remains a hard requirement
  // since it's a carrier-level compliance gate enforced outside our system.
  if (body.enabled !== undefined) {
    if (body.enabled === true) {
      const flags = currentResult.plan?.feature_flags ?? {};
      const planIncludesConcierge = flags['addon_concierge_included'] === true;
      const isLegacyPlan = currentResult.plan?.is_legacy === true
        || String(currentResult.plan?.name ?? '').toLowerCase().includes('legacy')
        || String(currentResult.plan?.slug ?? '').toLowerCase().includes('legacy');

      // Sync the addon flag if the plan grants concierge but the column says no
      if ((planIncludesConcierge || isLegacyPlan) && current.directory_addon_concierge !== true) {
        updates.directory_addon_concierge = true;
      }

      // GHL-connected venues have A2P handled by GHL. The DB CHECK constraint
      // (migration 098) requires a2p_verified = TRUE. Auto-stamp it so the
      // constraint passes without a manual support step.
      if (current.ghl_connected === true && current.a2p_verified !== true) {
        updates.a2p_verified = true;
      }

      updates.ai_concierge_enabled    = true;
      updates.ai_concierge_enabled_at = new Date().toISOString();
      // ai_concierge_enabled_by is a UUID column — only stamp it if we actually
      // have a member uuid (team session). Owner sessions don't have one.
      if (user.memberId) updates.ai_concierge_enabled_by = user.memberId;
    } else {
      updates.ai_concierge_enabled = false;
      // Don't clear enabled_at / enabled_by — preserves the audit trail.
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('venues').update(updates).eq('id', venueId);
  if (error) {
    if (error.code === '23514') {
      // CHECK constraint failure (eligibility guard at the DB level)
      return NextResponse.json({
        error: 'Database refused to enable AI: eligibility constraint failed. Refresh and check that the Venue Concierge add-on is active and A2P is verified.',
        detail: error.message,
      }, { status: 422 });
    }
    console.error('[ai-concierge settings] PATCH failed:', error.message);
    return NextResponse.json({ error: 'Failed to update', detail: error.message }, { status: 500 });
  }

  // First-time enable → seed the venue resources cache so the activation cron
  // doesn't have to do it on its first run. Best-effort.
  if (updates.ai_concierge_enabled === true) {
    void ensureVenueAiResources(venueId).catch((e) => {
      console.error('[ai-concierge settings] ensureVenueAiResources failed:', e);
    });
    // Analytics: funnel milestone — first time this venue turns AI on.
    void import('@/lib/analytics')
      .then(({ trackMilestone }) => trackMilestone('ai_enabled', {
        venueId, userEmail: user.memberEmail, role: user.role, label: 'AI Concierge enabled',
      }))
      .catch(() => { /* non-fatal */ });
  }

  const updatedResult = await loadVenueRow(venueId);
  if (!updatedResult) return NextResponse.json({ error: 'Venue not found after update' }, { status: 500 });
  return NextResponse.json(shapePayload(updatedResult.venue, updatedResult.plan));
}
