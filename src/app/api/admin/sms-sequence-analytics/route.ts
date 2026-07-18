import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';
import {
  SEQUENCE_PHASES,
  automationNameForPhase,
  type SequencePhaseKey,
} from '@/lib/booking-system-sequences';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/sms-sequence-analytics
 *
 * Super-admin rollup of SMS reply performance for the Booking System (Speed to
 * Lead) sequences, aggregated across every venue running the same standard
 * sequence. SMS has no open rate — a reply is the signal — so per step we
 * report sends, first-replies, reply rate, and median time-to-reply.
 *
 * Query params:
 *   phase     phase2 | phase4 | phase5 | phase6   (default phase2)
 *   from,to   YYYY-MM-DD window (inclusive)        (or use `days`)
 *   days      lookback window in days              (default 30; 0 = all time)
 *   venue_id  restrict to a single venue           (optional)
 */

async function requireAccess() {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || id.allowedTabs.has('sms-analytics');
}

/** Fetch every row for a query in 1000-row pages (PostgREST hard cap). */
async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  const maxRows = 500_000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await buildQuery(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = -1;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

export async function GET(request: NextRequest) {
  if (!(await requireAccess())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const phase = (sp.get('phase') ?? 'phase2') as SequencePhaseKey;
  const automationName = automationNameForPhase(phase);
  if (!automationName) {
    return NextResponse.json({ error: 'Unknown phase' }, { status: 400 });
  }
  const venueId = sp.get('venue_id') || null;

  // Resolve the window.
  const fromStr = sp.get('from');
  const toStr = sp.get('to');
  let sinceIso: string | null = null;
  let untilIso: string | null = null;
  if (fromStr) sinceIso = new Date(`${fromStr}T00:00:00.000Z`).toISOString();
  if (toStr) untilIso = new Date(`${toStr}T23:59:59.999Z`).toISOString();
  if (!fromStr && !toStr) {
    const days = sp.get('days') != null ? Number(sp.get('days')) : 30;
    if (days > 0) sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  }

  try {
    // 1) Automations across all venues that share this sequence name.
    let autoQ = supabaseAdmin
      .from('marketing_automations')
      .select('id, venue_id')
      .eq('name', automationName);
    if (venueId) autoQ = autoQ.eq('venue_id', venueId);
    const { data: autos, error: autoErr } = await autoQ;
    if (autoErr) throw autoErr;
    const automations = (autos ?? []) as Array<{ id: string; venue_id: string }>;
    const automationIds = automations.map((a) => a.id);

    if (automationIds.length === 0) {
      return NextResponse.json({
        phase,
        automationName,
        phases: SEQUENCE_PHASES.map((p) => ({ key: p.key, title: p.title })),
        steps: [],
        totals: { sends: 0, replies: 0, replyRate: 0, venueCount: 0, automationCount: 0 },
        venues: [],
        window: { since: sinceIso, until: untilIso },
      });
    }

    // 2) Live SMS step bodies/labels for these automations (representative copy).
    const stepRows = await fetchAll<{ automation_id: string; step_order: number; step_type: string; config_json: Record<string, unknown> | null }>(
      (from, to) => supabaseAdmin
        .from('marketing_automation_steps')
        .select('automation_id, step_order, step_type, config_json')
        .in('automation_id', automationIds)
        .range(from, to),
    );
    const bodiesByStep = new Map<number, string[]>();
    const labelsByStep = new Map<number, string[]>();
    const smsStepOrders = new Set<number>();
    for (const s of stepRows) {
      if (s.step_type !== 'send_sms') continue;
      smsStepOrders.add(s.step_order);
      const cfg = (s.config_json ?? {}) as Record<string, unknown>;
      if (typeof cfg.body === 'string' && cfg.body.trim()) {
        const arr = bodiesByStep.get(s.step_order) ?? [];
        arr.push(cfg.body);
        bodiesByStep.set(s.step_order, arr);
      }
      if (typeof cfg.label === 'string' && cfg.label.trim()) {
        const arr = labelsByStep.get(s.step_order) ?? [];
        arr.push(cfg.label);
        labelsByStep.set(s.step_order, arr);
      }
    }

    // 3) Sends per step (execution logs, success SMS, non-test).
    const sendLogs = await fetchAll<{ step_order: number | null; venue_id: string }>(
      (from, to) => {
        let x = supabaseAdmin
          .from('marketing_automation_execution_logs')
          .select('step_order, venue_id')
          .in('automation_id', automationIds)
          .eq('step_type', 'send_sms')
          .eq('status', 'success')
          .eq('is_test', false);
        if (sinceIso) x = x.gte('executed_at', sinceIso);
        if (untilIso) x = x.lte('executed_at', untilIso);
        return x.range(from, to);
      },
    );
    const sendsByStep = new Map<number, number>();
    const sendVenues = new Set<string>();
    for (const r of sendLogs) {
      if (r.step_order == null) continue;
      sendsByStep.set(r.step_order, (sendsByStep.get(r.step_order) ?? 0) + 1);
      if (r.venue_id) sendVenues.add(r.venue_id);
    }

    // 4) Replies per step (best-effort; table may not exist yet pre-migration).
    const repliesByStep = new Map<number, number>();
    const hoursByStep = new Map<number, number[]>();
    let repliesTableMissing = false;
    try {
      const replyRows = await fetchAll<{ step_order: number; step_body: string | null; hours_to_reply: number | null }>(
        (from, to) => {
          let x = supabaseAdmin
            .from('marketing_sms_reply_events')
            .select('step_order, step_body, hours_to_reply')
            .eq('automation_name', automationName);
          if (venueId) x = x.eq('venue_id', venueId);
          if (sinceIso) x = x.gte('replied_at', sinceIso);
          if (untilIso) x = x.lte('replied_at', untilIso);
          return x.range(from, to);
        },
      );
      for (const r of replyRows) {
        repliesByStep.set(r.step_order, (repliesByStep.get(r.step_order) ?? 0) + 1);
        if (r.hours_to_reply != null) {
          const arr = hoursByStep.get(r.step_order) ?? [];
          arr.push(Number(r.hours_to_reply));
          hoursByStep.set(r.step_order, arr);
        }
        // Fall back to reply-event body snapshot if the step has no live body.
        if (r.step_body && !bodiesByStep.has(r.step_order)) {
          bodiesByStep.set(r.step_order, [r.step_body]);
        }
      }
    } catch (e) {
      repliesTableMissing = true;
      console.error('[sms-sequence-analytics] reply events query failed:', e);
    }

    // 5) Compose per-step rows for every SMS step in the sequence.
    const allSteps = Array.from(new Set<number>([
      ...smsStepOrders,
      ...sendsByStep.keys(),
      ...repliesByStep.keys(),
    ])).sort((a, b) => a - b);

    const steps = allSteps.map((order, i) => {
      const sends = sendsByStep.get(order) ?? 0;
      const replies = repliesByStep.get(order) ?? 0;
      return {
        step_order: order,
        position: i + 1,
        label: mostCommon(labelsByStep.get(order) ?? []) ?? `Step ${i + 1}`,
        body: mostCommon(bodiesByStep.get(order) ?? []) ?? '',
        sends,
        replies,
        replyRate: sends > 0 ? Math.round((replies / sends) * 1000) / 10 : 0,
        medianHoursToReply: median(hoursByStep.get(order) ?? []),
      };
    });

    const totalSends = steps.reduce((a, s) => a + s.sends, 0);
    const totalReplies = steps.reduce((a, s) => a + s.replies, 0);

    // 6) Venue list for the drill-down dropdown (all venues with this sequence).
    let venues: Array<{ id: string; name: string }> = [];
    if (!venueId) {
      const venueIds = Array.from(new Set(automations.map((a) => a.venue_id)));
      if (venueIds.length) {
        const { data: vRows } = await supabaseAdmin
          .from('venues')
          .select('id, name')
          .in('id', venueIds)
          .order('name', { ascending: true });
        venues = (vRows ?? []) as Array<{ id: string; name: string }>;
      }
    }

    return NextResponse.json({
      phase,
      automationName,
      phases: SEQUENCE_PHASES.map((p) => ({ key: p.key, title: p.title })),
      steps,
      totals: {
        sends: totalSends,
        replies: totalReplies,
        replyRate: totalSends > 0 ? Math.round((totalReplies / totalSends) * 1000) / 10 : 0,
        venueCount: venueId ? 1 : sendVenues.size,
        automationCount: automationIds.length,
      },
      venues,
      repliesTableMissing,
      window: { since: sinceIso, until: untilIso },
    });
  } catch (e) {
    console.error('[sms-sequence-analytics] failed:', e);
    return NextResponse.json({ error: (e as Error).message ?? 'Failed' }, { status: 500 });
  }
}
