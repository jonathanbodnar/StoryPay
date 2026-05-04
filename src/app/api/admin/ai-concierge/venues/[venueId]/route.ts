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

export const dynamic = 'force-dynamic';

interface PatchBody {
  a2p_verified?:        boolean;
  ai_concierge_enabled?: boolean;
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

  if (!touched) {
    return NextResponse.json({ error: 'No supported fields in patch' }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('venues')
    .update(update)
    .eq('id', venueId)
    .select('id, name, email, ai_concierge_enabled, a2p_verified, directory_addon_concierge, ai_assistant_persona_name, ai_concierge_enabled_at, sms_provider, ghl_location_id, created_at')
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
