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
  /** Joined from directory_plans via directory_plan_id */
  directory_plans:             { feature_flags: Record<string, unknown> | null } | null;
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

async function loadVenueRow(venueId: string): Promise<VenueRow | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, ai_concierge_enabled, a2p_verified, directory_addon_concierge, ai_assistant_persona_name, ai_concierge_notify_emails, ai_concierge_enabled_at, ai_concierge_resources, ghl_connected, notification_email, email, directory_plans(feature_flags)',
    )
    .eq('id', venueId)
    .maybeSingle();
  return (data as VenueRow | null) ?? null;
}

function shapePayload(v: VenueRow): AiConciergeSettingsPayload {
  // Concierge can be granted via explicit addon purchase OR by plan inclusion
  // (feature_flags.addon_concierge_included = true on the plan).
  const planFlags = v.directory_plans?.feature_flags ?? {};
  const planIncludesConcierge = planFlags['addon_concierge_included'] === true;
  const addon  = v.directory_addon_concierge === true || planIncludesConcierge;
  const a2p    = v.a2p_verified === true;
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

  const venue = await loadVenueRow(user.venueId);
  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  return NextResponse.json(shapePayload(venue));
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

  const current = await loadVenueRow(venueId);
  if (!current) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

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

  // Master enable flag (with eligibility guard)
  if (body.enabled !== undefined) {
    if (body.enabled === true) {
      const planFlags2 = current.directory_plans?.feature_flags ?? {};
      const planConcierge = planFlags2['addon_concierge_included'] === true;
      const eligible = (current.directory_addon_concierge === true || planConcierge) && current.a2p_verified === true;
      if (!eligible) {
        return NextResponse.json({
          error:    'AI Concierge is not eligible to be enabled yet',
          blockers: shapePayload(current).eligibility.blockers,
        }, { status: 422 });
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
  }

  const updated = await loadVenueRow(venueId);
  if (!updated) return NextResponse.json({ error: 'Venue not found after update' }, { status: 500 });
  return NextResponse.json(shapePayload(updated));
}
