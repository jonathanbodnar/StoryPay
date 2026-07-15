/**
 * /api/listing/booking-report
 *
 * GET  — returns the compiled report data for the venue's last 30 days
 *         (funnel steps, conversions, sources, KPIs) + current schedule settings.
 *
 * POST — sends the report email immediately to the provided address(es).
 *         Body: { emails: string[] }
 *
 * PATCH — saves / updates the auto-send schedule.
 *          Body: { enabled: boolean; emails: string[] }
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  bucketLeadSource,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCE_ORDER,
  type LeadSourceBucket,
} from '@/lib/lead-source';
import { sendEmail } from '@/lib/email';
import {
  buildBookingReportHtml,
  type BookingReportData,
  type FunnelStep,
  type SourceRow,
} from '@/lib/booking-report-email';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type StageInfo = { name: string; kind: string; position: number };

function leadRank(
  status: string,
  stage: StageInfo | undefined,
): { rank: 1 | 2 | 3 | 4; lost: boolean } {
  const name = (stage?.name ?? '').toLowerCase();
  const kind = stage?.kind ?? '';
  const lost = kind === 'lost' || status === 'not_interested';
  const won  = kind === 'won'  || status === 'booked_wedding';
  if (won) return { rank: 4, lost: false };
  if (name.includes('tour') || name.includes('proposal') || status === 'tour_booked' || status === 'proposal_sent') {
    return { rank: 3, lost };
  }
  if (name.includes('conversation') || name.includes('contacted') || name.includes('follow up') || status === 'contacted') {
    return { rank: 2, lost };
  }
  return { rank: 1, lost };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Compile report data ───────────────────────────────────────────────────────

async function compileReport(venueId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const until = new Date().toISOString();

  const [
    { data: venueRow },
    { data: leads },
    { data: stages },
    { data: analytics },
  ] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('name, report_schedule_enabled, report_schedule_emails, report_schedule_next_at')
      .eq('id', venueId)
      .maybeSingle(),

    supabaseAdmin
      .from('leads')
      .select('status, stage_id, first_touch_utm, source, referral_source')
      .eq('venue_id', venueId)
      .gte('created_at', since)
      .limit(5000),

    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, kind, position')
      .eq('venue_id', venueId),

    // listing_events for views + form submits + avg session duration
    supabaseAdmin
      .from('listing_events')
      .select('event_type, session_duration_seconds')
      .eq('venue_id', venueId)
      .gte('created_at', since),
  ]);

  const venue = venueRow as {
    name: string;
    report_schedule_enabled: boolean;
    report_schedule_emails: string[];
    report_schedule_next_at: string | null;
  } | null;

  // ── Funnel ────────────────────────────────────────────────────────────────
  const stageById = new Map<string, StageInfo>(
    ((stages ?? []) as Array<{ id: string; name: string; kind: string; position: number }>).map(
      (s) => [s.id, { name: s.name, kind: s.kind, position: s.position }],
    ),
  );

  let leadsCount = 0, conversations = 0, tours = 0, weddings = 0;
  const sourceCounts: Record<LeadSourceBucket, number> = { meta: 0, google: 0, direct: 0, other: 0 };

  type LeadRow = {
    status: string; stage_id: string | null;
    first_touch_utm: Record<string, unknown> | null;
    source: string | null; referral_source: string | null;
  };

  for (const row of (leads ?? []) as LeadRow[]) {
    const bucket = bucketLeadSource({
      first_touch_utm: row.first_touch_utm,
      source: row.source,
      referral_source: row.referral_source,
    });
    sourceCounts[bucket] += 1;
    leadsCount += 1;
    const { rank, lost } = leadRank(row.status ?? 'new', row.stage_id ? stageById.get(row.stage_id) : undefined);
    if (rank >= 4) weddings += 1;
    if (rank >= 3 && !lost) tours += 1;
    if (rank >= 2 && !lost) conversations += 1;
  }

  const steps: FunnelStep[] = [
    { key: 'leads',         label: 'Leads',                count: leadsCount   },
    { key: 'conversations', label: 'Conversations Started', count: conversations },
    { key: 'tours',         label: 'Booked Tours',          count: tours        },
    { key: 'weddings',      label: 'Booked Weddings',       count: weddings     },
  ];
  const conversions = steps.slice(1).map((step, i) => {
    const from = steps[i].count;
    return from > 0 ? Math.round((step.count / from) * 100) : null;
  });

  const sources: SourceRow[] = LEAD_SOURCE_ORDER.map((key) => ({
    key,
    label: LEAD_SOURCE_LABELS[key],
    count: sourceCounts[key],
  }));

  // ── Listing analytics ─────────────────────────────────────────────────────
  type EventRow = { event_type: string; session_duration_seconds: number | null };
  const events = (analytics ?? []) as EventRow[];

  const totalViews   = events.filter((e) => e.event_type === 'pageview').length;
  const formSubmits  = events.filter((e) => e.event_type === 'form_submit').length;

  const durations    = events
    .map((e) => e.session_duration_seconds)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const avgSessionDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const fromDate = fmtDate(since);
  const toDate   = fmtDate(until);

  const SITE = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

  return {
    reportData: {
      venueName:          venue?.name ?? 'Your Venue',
      periodLabel:        `${fromDate} – ${toDate}`,
      fromDate,
      toDate,
      steps,
      conversions,
      sources,
      totalLeads:         leadsCount,
      totalViews,
      formSubmits,
      avgSessionDuration,
      dashboardUrl:       `${SITE}/dashboard/listing`,
    } satisfies BookingReportData,
    schedule: {
      enabled:  venue?.report_schedule_enabled ?? false,
      emails:   venue?.report_schedule_emails ?? [],
      nextAt:   venue?.report_schedule_next_at ?? null,
    },
  };
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { reportData, schedule } = await compileReport(venueId);
  return NextResponse.json({ reportData, schedule });
}

// ── POST — send now ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { emails?: unknown };
  const emails = Array.isArray(body.emails) ? (body.emails as string[]).filter((e) => typeof e === 'string' && e.includes('@')) : [];
  if (!emails.length) return NextResponse.json({ error: 'At least one valid email is required.' }, { status: 400 });

  const { reportData } = await compileReport(venueId);
  const html = buildBookingReportHtml(reportData);

  const results = await Promise.all(
    emails.map((to) =>
      sendEmail({
        to,
        subject: `Bride Booking System™ Report — ${reportData.periodLabel} | ${reportData.venueName}`,
        html,
      }),
    ),
  );

  const failed = results.filter((r) => !r.success);
  if (failed.length) {
    return NextResponse.json({ error: `Failed to send to ${failed.length} address(es).` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sent: emails.length });
}

// ── PATCH — save schedule ─────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { enabled?: unknown; emails?: unknown };
  const enabled = body.enabled === true;
  const emails  = Array.isArray(body.emails)
    ? (body.emails as string[]).filter((e) => typeof e === 'string' && e.includes('@')).slice(0, 10)
    : [];

  // Set next_send_at to 30 days from now when enabling; null when disabling.
  const nextAt = enabled ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null;

  const { error } = await supabaseAdmin
    .from('venues')
    .update({
      report_schedule_enabled: enabled,
      report_schedule_emails:  emails,
      report_schedule_next_at: nextAt,
    } as Record<string, unknown>)
    .eq('id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, enabled, emails, nextAt });
}
