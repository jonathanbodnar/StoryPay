/**
 * GET /api/admin/support/inbox-analytics
 *
 * Powers the "Support Analytics" admin tab's "Concierge Team Performance"
 * section: bride-inquiry volume + first-response-time metrics for the
 * StoryPay concierge team, rolled up across every venue.
 *
 * Query params:
 *   from, to   YYYY-MM-DD (inclusive) — required-ish; defaults to last 30 days
 *
 * Data model recap (see conversation_messages):
 *   sender_kind='contact'                                = bride/lead inbound message
 *   sender_kind='concierge' AND sent_by_support_user_id   = StoryPay concierge
 *     IS NOT NULL                                           replying as the venue
 *
 * Response-time attribution: within each thread, messages are walked in
 * chronological order. Every 'contact' message starts a clock; the clock
 * stops at the next 'concierge' message with sent_by_support_user_id set,
 * UNLESS another 'contact' message arrives first (in which case the earlier
 * inbound message is "unanswered" — tallied, never silently dropped). Other
 * sender kinds (owner/team/system/ai) in between don't stop the clock and
 * don't reset it — they're simply not concierge replies.
 *
 * Everything here is scoped to the selected date range (both the message
 * query and the derived "currently overdue / unanswered" counts), matching
 * how every other admin analytics tab on this page works. Because
 * classifySla always compares against the real current time, an inquiry
 * that's still unanswered as of "now" will correctly show as overdue even
 * though the underlying query is windowed — as long as the window covers
 * recent activity (the default "Last 30 days" always does).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';
import { classifySla } from '@/lib/support/sla';
import { hourFloatInTimeZone, sun0WeekdayInTimeZone, DEFAULT_VENUE_TIMEZONE } from '@/lib/venue-timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function verifyAccess(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || id.allowedTabs.has('support-analytics');
}

/** Fetch every row for a query in 1000-row pages (PostgREST hard cap). */
async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  const maxRows = 200_000;
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

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

interface MessageRow {
  thread_id: string;
  sender_kind: string;
  created_at: string;
  sent_by_support_user_id: string | null;
  audience: string | null;
}

interface ResponseSample {
  threadId: string;
  agentId: string;
  inboundAt: string;
  replyAt: string;
  minutes: number;
}

interface UnansweredSample {
  threadId: string;
  inboundAt: string;
}

const AFTER_HOURS_START = 9; // 9am
const AFTER_HOURS_END = 18; // 6pm

export async function GET(req: NextRequest) {
  if (!(await verifyAccess())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const fromParam = sp.get('from');
  const toParam = sp.get('to');

  let sinceIso: string;
  let untilIso: string;
  if (fromParam && toParam) {
    sinceIso = new Date(`${fromParam}T00:00:00.000Z`).toISOString();
    untilIso = new Date(`${toParam}T23:59:59.999Z`).toISOString();
  } else {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86_400_000);
    sinceIso = new Date(from.toISOString().slice(0, 10) + 'T00:00:00.000Z').toISOString();
    untilIso = to.toISOString();
  }

  try {
    // All bride-facing external messages in range (any sender_kind — we need
    // non-contact/non-concierge rows too, so they don't get mistaken for gaps).
    // audience='venue_direct' is a side-channel (venue talking directly to
    // their own bride) and is excluded — not concierge-facing.
    const messages = await fetchAll<MessageRow>((from, to) => {
      return supabaseAdmin
        .from('conversation_messages')
        .select('thread_id, sender_kind, created_at, sent_by_support_user_id, audience')
        .eq('visibility', 'external')
        .or('audience.neq.venue_direct,audience.is.null')
        .gte('created_at', sinceIso)
        .lte('created_at', untilIso)
        .order('thread_id', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, to);
    });

    // Group by thread, preserving chronological order (already sorted by the query).
    const byThread = new Map<string, MessageRow[]>();
    for (const m of messages) {
      const arr = byThread.get(m.thread_id);
      if (arr) arr.push(m);
      else byThread.set(m.thread_id, [m]);
    }

    const responseSamples: ResponseSample[] = [];
    const unanswered: UnansweredSample[] = [];
    let totalInquiries = 0;
    let totalReplies = 0;

    for (const [threadId, msgs] of byThread) {
      let pendingInboundAt: string | null = null;
      for (const m of msgs) {
        if (m.sender_kind === 'contact') {
          totalInquiries += 1;
          // A new inbound message arrives before the previous one got a reply.
          if (pendingInboundAt) unanswered.push({ threadId, inboundAt: pendingInboundAt });
          pendingInboundAt = m.created_at;
          continue;
        }
        if (m.sender_kind === 'concierge' && m.sent_by_support_user_id) {
          totalReplies += 1;
          if (pendingInboundAt) {
            const deltaMin = (new Date(m.created_at).getTime() - new Date(pendingInboundAt).getTime()) / 60_000;
            responseSamples.push({
              threadId,
              agentId: m.sent_by_support_user_id,
              inboundAt: pendingInboundAt,
              replyAt: m.created_at,
              minutes: Math.max(0, deltaMin),
            });
            pendingInboundAt = null;
          }
        }
      }
      if (pendingInboundAt) unanswered.push({ threadId, inboundAt: pendingInboundAt });
    }

    // "Currently overdue" — last unanswered inbound per thread, classified
    // against the real current time (classifySla defaults asOf=now).
    const lastUnansweredByThread = new Map<string, string>();
    for (const u of unanswered) {
      const existing = lastUnansweredByThread.get(u.threadId);
      if (!existing || u.inboundAt > existing) lastUnansweredByThread.set(u.threadId, u.inboundAt);
    }
    let overdueThreadsCount = 0;
    for (const inboundAt of lastUnansweredByThread.values()) {
      const level = classifySla(inboundAt).level;
      if (level === 'red' || level === 'critical') overdueThreadsCount += 1;
    }

    const responseMinutes = responseSamples.map((s) => s.minutes);
    const avgResponseMinutes = mean(responseMinutes);
    const medianResponseMinutes = median(responseMinutes);

    // ── Time-of-day distribution (concierge replies, America/New_York) ──────
    const hourBuckets = new Array<number>(24).fill(0);
    const replyHourFloats: number[] = [];
    for (const s of responseSamples) {
      const hf = hourFloatInTimeZone(s.replyAt, DEFAULT_VENUE_TIMEZONE);
      hourBuckets[Math.min(23, Math.floor(hf))] += 1;
      replyHourFloats.push(hf);
    }
    const avgReplyHour = mean(replyHourFloats);

    // ── Day-of-week distribution (inbound vs outbound, America/New_York) ────
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const inboundByDay = new Array<number>(7).fill(0);
    const outboundByDay = new Array<number>(7).fill(0);
    for (const m of messages) {
      const dow = sun0WeekdayInTimeZone(m.created_at, DEFAULT_VENUE_TIMEZONE);
      if (m.sender_kind === 'contact') inboundByDay[dow] += 1;
      else if (m.sender_kind === 'concierge' && m.sent_by_support_user_id) outboundByDay[dow] += 1;
    }
    const dayOfWeek = dayLabels.map((label, i) => ({ day: label, inbound: inboundByDay[i], outbound: outboundByDay[i] }));

    // ── Hour × day-of-week heatmap (concierge replies) ──────────────────────
    const heatmap: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const s of responseSamples) {
      const dow = sun0WeekdayInTimeZone(s.replyAt, DEFAULT_VENUE_TIMEZONE);
      const hf = hourFloatInTimeZone(s.replyAt, DEFAULT_VENUE_TIMEZONE);
      heatmap[dow][Math.min(23, Math.floor(hf))] += 1;
    }

    // ── After-hours % (outside 9am-6pm America/New_York) ────────────────────
    const afterHoursCount = replyHourFloats.filter((hf) => hf < AFTER_HOURS_START || hf >= AFTER_HOURS_END).length;
    const afterHoursPct = replyHourFloats.length > 0 ? Math.round((afterHoursCount / replyHourFloats.length) * 1000) / 10 : 0;

    // ── Per-agent leaderboard ────────────────────────────────────────────────
    const agentIds = Array.from(new Set(responseSamples.map((s) => s.agentId)));
    const { data: agentRows } = agentIds.length
      ? await supabaseAdmin
          .from('support_team_members')
          .select('id, name, first_name, last_name, active')
          .in('id', agentIds)
      : { data: [] as { id: string; name: string; first_name: string | null; last_name: string | null; active: boolean | null }[] };

    const agentNameById = new Map<string, string>();
    for (const a of (agentRows ?? []) as Array<{ id: string; name: string; first_name: string | null; last_name: string | null }>) {
      const nm = a.name || [a.first_name, a.last_name].filter(Boolean).join(' ') || 'Unknown agent';
      agentNameById.set(a.id, nm);
    }

    // Threads each agent has replied in at least once — used to attribute
    // "inquiries they personally handled" (every bride message on a thread
    // they're actively working, whether or not THEY answered that specific
    // message) and their personal overdue-thread count.
    const threadsByAgent = new Map<string, Set<string>>();
    const repliesByAgent = new Map<string, ResponseSample[]>();
    for (const s of responseSamples) {
      const arr = repliesByAgent.get(s.agentId) ?? [];
      arr.push(s);
      repliesByAgent.set(s.agentId, arr);
      const set = threadsByAgent.get(s.agentId) ?? new Set<string>();
      set.add(s.threadId);
      threadsByAgent.set(s.agentId, set);
    }

    const inquiriesByThread = new Map<string, number>();
    for (const msgs of byThread.values()) {
      const threadId = msgs[0]?.thread_id;
      if (!threadId) continue;
      inquiriesByThread.set(threadId, msgs.filter((m) => m.sender_kind === 'contact').length);
    }

    const leaderboard = agentIds.map((agentId) => {
      const replies = repliesByAgent.get(agentId) ?? [];
      const threads = threadsByAgent.get(agentId) ?? new Set<string>();
      const minutes = replies.map((r) => r.minutes);
      const hours = replies.map((r) => hourFloatInTimeZone(r.replyAt, DEFAULT_VENUE_TIMEZONE));
      let inquiriesHandled = 0;
      for (const t of threads) inquiriesHandled += inquiriesByThread.get(t) ?? 0;
      let overdue = 0;
      for (const t of threads) {
        const inboundAt = lastUnansweredByThread.get(t);
        if (inboundAt && (classifySla(inboundAt).level === 'red' || classifySla(inboundAt).level === 'critical')) overdue += 1;
      }
      return {
        agentId,
        name: agentNameById.get(agentId) ?? 'Unknown agent',
        replies: replies.length,
        avgResponseMinutes: mean(minutes),
        medianResponseMinutes: median(minutes),
        replyRate: inquiriesHandled > 0 ? Math.round((replies.length / inquiriesHandled) * 1000) / 10 : 0,
        inquiriesHandled,
        avgResponseHour: mean(hours),
        overdueThreads: overdue,
      };
    }).sort((a, b) => b.replies - a.replies);

    // ── SLA trend (bonus): % of open/unanswered threads in each SLA bucket, per day ──
    // Approximation scoped to the selected window: only considers inbound
    // messages that themselves fall within [from, to]. A bride message sent
    // before the window that's still unanswered inside it won't be counted —
    // an accepted trade-off for a single date-range-bound query (see route doc).
    const dayKeys: string[] = [];
    {
      const startDay = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : new Date(sinceIso.slice(0, 10) + 'T00:00:00.000Z');
      const endDay = toParam ? new Date(`${toParam}T00:00:00.000Z`) : new Date(untilIso.slice(0, 10) + 'T00:00:00.000Z');
      const maxDays = 400;
      for (let d = new Date(startDay), i = 0; d.getTime() <= endDay.getTime() && i < maxDays; d = new Date(d.getTime() + 86_400_000), i += 1) {
        dayKeys.push(d.toISOString().slice(0, 10));
      }
    }

    const slaTrend = dayKeys.map((dayKey) => {
      const asOfMs = new Date(`${dayKey}T23:59:59.999Z`).getTime();
      const buckets = { green: 0, yellow: 0, red: 0, critical: 0 };
      for (const msgs of byThread.values()) {
        let lastContactAt: string | null = null;
        let answeredAfterLastContact = false;
        for (const m of msgs) {
          const t = new Date(m.created_at).getTime();
          if (t > asOfMs) break;
          if (m.sender_kind === 'contact') {
            lastContactAt = m.created_at;
            answeredAfterLastContact = false;
          } else if (m.sender_kind === 'concierge' && m.sent_by_support_user_id && lastContactAt) {
            answeredAfterLastContact = true;
          }
        }
        if (lastContactAt && !answeredAfterLastContact) {
          buckets[classifySla(lastContactAt, asOfMs).level] += 1;
        }
      }
      const openTotal = buckets.green + buckets.yellow + buckets.red + buckets.critical;
      const pct = (n: number) => (openTotal > 0 ? Math.round((n / openTotal) * 1000) / 10 : 0);
      return {
        day: dayKey,
        openTotal,
        greenPct: pct(buckets.green),
        yellowPct: pct(buckets.yellow),
        redPct: pct(buckets.red),
        criticalPct: pct(buckets.critical),
      };
    });

    return NextResponse.json({
      window: { from: sinceIso, to: untilIso },
      summary: {
        totalInquiries,
        totalReplies,
        replyRate: totalInquiries > 0 ? Math.round(((totalInquiries - unanswered.length) / totalInquiries) * 1000) / 10 : 0,
        avgResponseMinutes,
        medianResponseMinutes,
        overdueThreadsCount,
        unansweredCount: unanswered.length,
      },
      timeOfDay: { hours: hourBuckets, avgHour: avgReplyHour },
      dayOfWeek,
      heatmap,
      afterHours: { pct: afterHoursPct, count: afterHoursCount, total: replyHourFloats.length, windowLabel: '9am–6pm ET' },
      leaderboard,
      slaTrend,
    });
  } catch (err) {
    console.error('[inbox-analytics] query failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load inbox analytics' },
      { status: 500 },
    );
  }
}
