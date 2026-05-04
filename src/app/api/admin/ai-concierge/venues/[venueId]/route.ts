/**
 * Super-admin per-venue AI Concierge actions.
 *
 *   PATCH { a2p_verified?, ai_concierge_enabled?, action? }
 *
 * Supported actions / fields:
 *   - a2p_verified (bool):       super admin attests the venue is A2P verified.
 *                                Idempotent. When flipped to false while AI is
 *                                enabled, we ALSO disable AI (DB constraint
 *                                would reject the row otherwise).
 *   - ai_concierge_enabled (bool): force the master toggle. Bypasses the
 *                                  venue's own UI and the eligibility CHECK
 *                                  by ALSO ensuring a2p_verified=true and
 *                                  directory_addon_concierge=true. If the
 *                                  venue isn't an addon holder we refuse
 *                                  rather than silently grant access.
 *   - action='pause_all_leads': moves every ai_active lead at the venue to
 *                                'paused', clears ai_next_send_at. Useful as
 *                                a per-venue mini-kill-switch (without
 *                                touching the global one).
 *
 * Returns the updated venue snapshot (same shape as the venues list rows).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureVenueAiResources } from '@/lib/ai-concierge/venue-resources';
import { clearVenueSpendCache } from '@/lib/ai-concierge/spend-caps';

export const dynamic = 'force-dynamic';

interface PatchBody {
  a2p_verified?:        boolean;
  ai_concierge_enabled?: boolean;
  /**
   * Per-venue daily SMS send cap. Pass:
   *   - a positive integer (1..100000) to set the per-venue override
   *   - null to clear the override (use platform default)
   */
  ai_daily_send_cap?:           number | null;
  /** Warning threshold % (1..100). Default 80 if null. */
  ai_daily_alert_threshold_pct?: number | null;
  action?:              'pause_all_leads';
  reason?:              string;
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ venueId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { venueId } = await ctx.params;
  if (!venueId) return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });

  let body: PatchBody;
  try {
    body = await request.json() as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── Action: pause_all_leads ────────────────────────────────────────────
  if (body.action === 'pause_all_leads') {
    // Two-step so we can write per-lead audit rows: first SELECT the IDs of
    // every ai_active lead, then UPDATE them to paused, then INSERT one
    // ai_state_transitions row per lead.
    const { data: activeIdsRaw, error: selErr } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', venueId)
      .eq('ai_state', 'ai_active');
    if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
    const activeIds = (activeIdsRaw ?? []).map((r) => r.id as string);

    if (activeIds.length === 0) {
      return NextResponse.json({ ok: true, paused: 0 });
    }

    const { error: pauseErr } = await supabaseAdmin
      .from('leads')
      .update({
        ai_state:        'paused',
        ai_next_send_at: null,
        updated_at:      new Date().toISOString(),
      })
      .in('id', activeIds);

    if (pauseErr) return NextResponse.json({ error: pauseErr.message }, { status: 500 });

    // Per-lead audit rows. Best-effort: a missed audit doesn't undo the
    // pause action.
    const auditRows = activeIds.map((leadId) => ({
      lead_id:      leadId,
      venue_id:     venueId,
      from_state:   'ai_active',
      to_state:     'paused',
      reason:       'admin_force_reset',
      triggered_by: 'admin:ai-concierge-panel',
      metadata:     { kind: 'pause_all_leads', operator_reason: body.reason ?? null },
    }));
    void supabaseAdmin.from('ai_state_transitions').insert(auditRows)
      .then(() => {}, (e: unknown) => { console.error('[admin/ai-concierge] pause_all_leads audit failed:', e); });

    return NextResponse.json({ ok: true, paused: activeIds.length });
  }

  // ── Field updates: a2p_verified / ai_concierge_enabled ─────────────────
  const update: Record<string, unknown> = {};
  let touched = false;

  if (typeof body.a2p_verified === 'boolean') {
    update.a2p_verified = body.a2p_verified;
    touched = true;

    // If we're flipping a2p OFF, force ai off too — otherwise the DB CHECK
    // constraint will reject the row update.
    if (body.a2p_verified === false) {
      update.ai_concierge_enabled = false;
      update.ai_concierge_enabled_at = null;
    }
  }

  if (typeof body.ai_concierge_enabled === 'boolean') {
    if (body.ai_concierge_enabled === true) {
      // Verify eligibility (mirror the DB CHECK constraint, but with a nice
      // error message). When the operator wants to enable, we don't bypass —
      // they have to make the venue eligible first.
      const { data: v } = await supabaseAdmin
        .from('venues')
        .select('a2p_verified, directory_addon_concierge')
        .eq('id', venueId)
        .maybeSingle();
      const needs: string[] = [];
      const a2pNow = update.a2p_verified === true || (update.a2p_verified === undefined && v?.a2p_verified === true);
      if (!a2pNow)                                    needs.push('a2p_verified');
      if (!v?.directory_addon_concierge)              needs.push('directory_addon_concierge');
      if (needs.length > 0) {
        return NextResponse.json({
          error:   'Venue is not eligible to enable AI Concierge',
          missing: needs,
        }, { status: 422 });
      }
      update.ai_concierge_enabled    = true;
      update.ai_concierge_enabled_at = new Date().toISOString();
      // ai_concierge_enabled_by is UUID (references a user); super admin
      // doesn't have a venue-side user row, so leave NULL. The
      // ai_state_transitions audit trail records 'admin:ai-concierge-panel'
      // separately.
    } else {
      update.ai_concierge_enabled    = false;
      // leave ai_concierge_enabled_at as the historical timestamp
    }
    touched = true;
  }

  if (body.ai_daily_send_cap !== undefined) {
    if (body.ai_daily_send_cap === null) {
      update.ai_daily_send_cap = null;
    } else {
      const n = Number(body.ai_daily_send_cap);
      if (!Number.isFinite(n) || n < 1 || n > 100_000) {
        return NextResponse.json({
          error: 'ai_daily_send_cap must be null or an integer between 1 and 100000',
        }, { status: 422 });
      }
      update.ai_daily_send_cap = Math.floor(n);
    }
    touched = true;
  }

  if (body.ai_daily_alert_threshold_pct !== undefined) {
    if (body.ai_daily_alert_threshold_pct === null) {
      update.ai_daily_alert_threshold_pct = 80;
    } else {
      const n = Number(body.ai_daily_alert_threshold_pct);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        return NextResponse.json({
          error: 'ai_daily_alert_threshold_pct must be null or an integer between 1 and 100',
        }, { status: 422 });
      }
      update.ai_daily_alert_threshold_pct = Math.floor(n);
    }
    touched = true;
  }

  if (!touched) {
    return NextResponse.json({ error: 'No supported fields in patch' }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('venues')
    .update(update)
    .eq('id', venueId)
    .select('id, name, email, ai_concierge_enabled, a2p_verified, directory_addon_concierge, ai_assistant_persona_name, ai_concierge_enabled_at, sms_provider, ghl_location_id, ai_daily_send_cap, ai_daily_alert_threshold_pct, a2p_brand_id, a2p_brand_status, a2p_campaign_id, a2p_campaign_status, a2p_last_checked_at, a2p_last_check_error, created_at')
    .maybeSingle();

  if (updateErr) {
    if (updateErr.code === '23514') {
      return NextResponse.json({
        error: 'Database constraint rejected the update — venue is not eligible (addon + A2P required)',
      }, { status: 422 });
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  // If we just enabled AI, prime the resources cache so the first cron tick
  // doesn't wait on resolver work.
  if (update.ai_concierge_enabled === true) {
    void ensureVenueAiResources(venueId).catch((e) => {
      console.error('[admin/ai-concierge] ensureVenueAiResources failed:', e);
    });
  }

  // If we touched any spend-cap field, invalidate the in-memory cache so
  // the cron picks up the new cap on the next lead it processes.
  if (
    update.ai_daily_send_cap            !== undefined
    || update.ai_daily_alert_threshold_pct !== undefined
  ) {
    clearVenueSpendCache(venueId);
  }

  return NextResponse.json({
    venue: {
      ...updated,
      ghlConnected: !!updated.ghl_location_id,
      isEligible:
        updated.directory_addon_concierge === true
        && updated.a2p_verified         === true
        && !!updated.ghl_location_id,
    },
  });
}
