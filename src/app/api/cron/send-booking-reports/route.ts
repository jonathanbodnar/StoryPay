/**
 * GET /api/cron/send-booking-reports
 *
 * Runs daily (e.g. 08:00 UTC). Finds every venue whose
 * report_schedule_enabled = true AND report_schedule_next_at <= now(),
 * compiles a 30-day Bride Booking System™ report, emails it to the stored
 * addresses, then advances next_at by 30 days.
 *
 * Railway cron example:
 *   0 8 * * *  GET /api/cron/send-booking-reports?secret=$CRON_SECRET
 */

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

function cronSecret(): string {
  return process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
}

function authorized(req: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return true;
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  const qs     = req.nextUrl.searchParams.get('secret') ?? '';
  return bearer === secret || qs === secret;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

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

async function buildReportForVenue(
  venueId: string,
  venueName: string,
): Promise<BookingReportData> {
  const days  = 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const until = new Date().toISOString();

  const [{ data: leads }, { data: stages }, { data: events }] = await Promise.all([
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

    supabaseAdmin
      .from('listing_events')
      .select('event_type, session_duration_seconds')
      .eq('venue_id', venueId)
      .gte('created_at', since),
  ]);

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

  type EventRow = { event_type: string; session_duration_seconds: number | null };
  const evtRows = (events ?? []) as EventRow[];
  const totalViews   = evtRows.filter((e) => e.event_type === 'pageview').length;
  const formSubmits  = evtRows.filter((e) => e.event_type === 'form_submit').length;
  const durations    = evtRows
    .map((e) => e.session_duration_seconds)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const avgSessionDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  void fmtDuration; // used in email template, not here

  const SITE = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
  const fromDate = fmtDate(since);
  const toDate   = fmtDate(until);

  return {
    venueName,
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
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date().toISOString();

  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, report_schedule_emails, report_schedule_next_at')
    .eq('report_schedule_enabled', true)
    .lte('report_schedule_next_at', now)
    .not('report_schedule_next_at', 'is', null);

  if (error) {
    console.error('[booking-report cron] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type VenueRow = { id: string; name: string; report_schedule_emails: string[]; report_schedule_next_at: string };
  const rows = (venues ?? []) as VenueRow[];

  let sent = 0;
  let failed = 0;

  for (const venue of rows) {
    const emails = (venue.report_schedule_emails ?? []).filter((e) => e.includes('@'));
    if (!emails.length) continue;

    try {
      const reportData = await buildReportForVenue(venue.id, venue.name);
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

      const ok = results.every((r) => r.success);
      if (ok) {
        // Advance next send by 30 days from the originally scheduled time to
        // avoid drift (e.g. if cron runs a few hours late).
        const prev = new Date(venue.report_schedule_next_at).getTime();
        const nextAt = new Date(prev + 30 * 86_400_000).toISOString();
        await supabaseAdmin
          .from('venues')
          .update({ report_schedule_next_at: nextAt } as Record<string, unknown>)
          .eq('id', venue.id);
        sent++;
      } else {
        failed++;
        console.warn(`[booking-report cron] partial failure for venue ${venue.id}`);
      }
    } catch (e) {
      failed++;
      console.error(`[booking-report cron] error for venue ${venue.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true, processed: rows.length, sent, failed });
}
