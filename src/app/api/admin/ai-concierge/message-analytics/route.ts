/**
 * GET /api/admin/ai-concierge/message-analytics
 *
 * Super-admin rollup of AI Concierge master-message performance, aggregated
 * across every venue (matches the global AI monitor). For each of the 11
 * curated master-message angle keys (migration 181) we report:
 *
 *   sends      — ai_runs where angle_used = key AND outcome = 'sent'
 *   replies    — inbound bride replies attributed to that angle via last-touch
 *                (the same approach SmsSequenceAnalyticsPanel uses for SMS steps:
 *                 a reply is credited to the most recent AI 'sent' run for that
 *                 lead before she replied; one credit per lead/enrollment)
 *   replyRate  — replies ÷ sends (%)
 *
 * SMS has no click tracking, so `clicks` is always null and the UI renders "—".
 *
 * Query params:
 *   from,to   YYYY-MM-DD window (inclusive)   (or use `days`)
 *   days      lookback window in days         (default 30; 0 = all time)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The curated master-message angle keys (migration 181), in prompt order, with
// operator-friendly labels for the analytics table.
const MASTER_ANGLES: Array<{ key: string; label: string }> = [
  { key: 'personal_check_in', label: 'Personal check-in' },
  { key: 'date_urgency',      label: 'Date urgency' },
  { key: 'caring_check_in',   label: 'Caring check-in' },
  { key: 'bridge_call',       label: 'Bridge to a call' },
  { key: 'bridge_tour',       label: 'Bridge to a tour' },
  { key: 'head_count',        label: 'Head count' },
  { key: 'onsite_options',    label: "What's included" },
  { key: 'indoor_outdoor',    label: 'Indoor / outdoor' },
  { key: 'pinterest_style',   label: 'Pinterest style' },
  { key: 'budget',            label: 'Budget' },
  { key: 'venue_style',       label: 'Venue style' },
];
const MASTER_KEYS = new Set(MASTER_ANGLES.map((a) => a.key));

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

interface SentRun { lead_id: string; angle_used: string | null; created_at: string; }

export async function GET(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;

  // Resolve the window (same contract as sms-sequence-analytics).
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
    // 1) Sent runs in the window — powers the per-angle send counts.
    const sentRuns = await fetchAll<SentRun>((from, to) => {
      let q = supabaseAdmin
        .from('ai_runs')
        .select('lead_id, angle_used, created_at')
        .eq('outcome', 'sent');
      if (sinceIso) q = q.gte('created_at', sinceIso);
      if (untilIso) q = q.lte('created_at', untilIso);
      return q.order('created_at', { ascending: false }).range(from, to);
    });

    const sendsByAngle = new Map<string, number>();
    for (const r of sentRuns) {
      if (!r.angle_used) continue;
      sendsByAngle.set(r.angle_used, (sendsByAngle.get(r.angle_used) ?? 0) + 1);
    }

    // 2) Inbound bride replies in the window (any inbound_* transition reason).
    const replies = await fetchAll<{ lead_id: string; created_at: string; reason: string | null }>((from, to) => {
      let q = supabaseAdmin
        .from('ai_state_transitions')
        .select('lead_id, created_at, reason')
        .like('reason', 'inbound_%');
      if (sinceIso) q = q.gte('created_at', sinceIso);
      if (untilIso) q = q.lte('created_at', untilIso);
      return q.order('created_at', { ascending: true }).range(from, to);
    });

    // First inbound reply per lead — one credit per enrollment (matches SMS).
    const firstReplyByLead = new Map<string, string>();
    for (const r of replies) {
      if (!firstReplyByLead.has(r.lead_id)) firstReplyByLead.set(r.lead_id, r.created_at);
    }

    // 3) Last-touch attribution. For each replied lead, find the most recent
    //    AI 'sent' run at or before her first reply and credit that angle.
    //    Pull sent runs for those leads (no lower bound so a send just before
    //    the window still attributes correctly).
    const repliedLeadIds = Array.from(firstReplyByLead.keys());
    const repliesByAngle = new Map<string, number>();
    if (repliedLeadIds.length > 0) {
      const attributionRuns = await fetchAllForLeads(repliedLeadIds, untilIso);
      // Sorted desc per lead so the first <= reply time wins (most recent).
      const runsByLead = new Map<string, SentRun[]>();
      for (const r of attributionRuns) {
        const arr = runsByLead.get(r.lead_id) ?? [];
        arr.push(r);
        runsByLead.set(r.lead_id, arr);
      }
      for (const [leadId, replyAt] of firstReplyByLead) {
        const runs = runsByLead.get(leadId);
        if (!runs) continue;
        const credited = runs.find((run) => run.created_at <= replyAt && run.angle_used);
        if (credited?.angle_used) {
          repliesByAngle.set(credited.angle_used, (repliesByAngle.get(credited.angle_used) ?? 0) + 1);
        }
      }
    }

    // 4) Compose rows: always the 11 master angles, plus any legacy angle key
    //    that actually has sends in the window (so nothing is silently hidden).
    const legacyKeys = Array.from(sendsByAngle.keys()).filter((k) => !MASTER_KEYS.has(k)).sort();
    const rowSpecs = [
      ...MASTER_ANGLES,
      ...legacyKeys.map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
    ];

    const rows = rowSpecs.map(({ key, label }) => {
      const sends = sendsByAngle.get(key) ?? 0;
      const repliesN = repliesByAngle.get(key) ?? 0;
      return {
        angle: key,
        label,
        legacy: !MASTER_KEYS.has(key),
        sends,
        replies: repliesN,
        replyRate: sends > 0 ? Math.round((repliesN / sends) * 1000) / 10 : 0,
        clicks: null as number | null, // SMS has no click tracking
      };
    });

    const totalSends = rows.reduce((a, r) => a + r.sends, 0);
    const totalReplies = rows.reduce((a, r) => a + r.replies, 0);

    return NextResponse.json({
      rows,
      totals: {
        sends: totalSends,
        replies: totalReplies,
        replyRate: totalSends > 0 ? Math.round((totalReplies / totalSends) * 1000) / 10 : 0,
        leadsReplied: firstReplyByLead.size,
      },
      clicksTrackable: false,
      window: { since: sinceIso, until: untilIso },
    });
  } catch (e) {
    console.error('[ai-concierge message-analytics] failed:', e);
    return NextResponse.json({ error: (e as Error).message ?? 'Failed' }, { status: 500 });
  }
}

/** Fetch all 'sent' runs for the given leads (<= untilIso), ordered newest-first. */
async function fetchAllForLeads(leadIds: string[], untilIso: string | null): Promise<SentRun[]> {
  const out: SentRun[] = [];
  const chunkSize = 200; // keep the IN() list well under URL/statement limits
  for (let i = 0; i < leadIds.length; i += chunkSize) {
    const chunk = leadIds.slice(i, i + chunkSize);
    const pageSize = 1000;
    for (let offset = 0; offset < 200_000; offset += pageSize) {
      let q = supabaseAdmin
        .from('ai_runs')
        .select('lead_id, angle_used, created_at')
        .eq('outcome', 'sent')
        .in('lead_id', chunk);
      if (untilIso) q = q.lte('created_at', untilIso);
      const { data, error } = await q
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as SentRun[];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
  }
  return out;
}
