/**
 * Super-admin live runs feed for AI Concierge.
 *
 * Returns the most recent rows from `ai_runs` across all venues, joined to
 * the venue name and the lead's friendly name (for the admin's at-a-glance
 * column). Supports filtering by venue, outcome, and a paging cursor.
 *
 *   GET ?limit=50&cursor=<iso>&venueId=<uuid>&outcome=<sent|...>
 *
 * Returns:
 *   {
 *     rows:       AiRunRow[],
 *     nextCursor: string | null,
 *     summary:    { sentLast24h, failedLast24h, optedOutLast24h }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface RawAiRun {
  id:                  string;
  lead_id:             string;
  venue_id:            string;
  ai_config_version:   number | null;
  attempt_number:      number | null;
  angle_used:          string | null;
  sms_provider:        string | null;
  provider_message_id: string | null;
  outcome:             string;
  error_detail:        string | null;
  final_sent_text:     string | null;
  created_at:          string;
}

interface AiRunRow extends RawAiRun {
  venue_name:          string | null;
  lead_first_name:     string | null;
  lead_last_name:      string | null;
  lead_email:          string | null;
}

const MAX_LIMIT = 200;
const ALLOWED_OUTCOMES: ReadonlySet<string> = new Set([
  'sent',
  'invalid_phone', 'dnd', 'permanent_error',
  'transient_error', 'auth_error',
  'expired', 'manual_re_enable',
  'llm_error', 'reschedule_quiet_hours',
]);

export async function GET(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url       = new URL(request.url);
  const limitRaw  = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit     = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), MAX_LIMIT) : 50;
  const cursor    = url.searchParams.get('cursor');                    // ISO timestamp
  const venueId   = url.searchParams.get('venueId') || null;
  const outcome   = url.searchParams.get('outcome') || null;

  // Build the runs query
  let q = supabaseAdmin
    .from('ai_runs')
    .select('id, lead_id, venue_id, ai_config_version, attempt_number, angle_used, sms_provider, provider_message_id, outcome, error_detail, final_sent_text, created_at')
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (cursor)              q = q.lt('created_at', cursor);
  if (venueId)             q = q.eq('venue_id', venueId);
  if (outcome && ALLOWED_OUTCOMES.has(outcome)) q = q.eq('outcome', outcome);

  const { data: runsRaw, error: runsErr } = await q;
  if (runsErr) {
    if (runsErr.code === '42P01') {
      return NextResponse.json({ error: 'ai_runs table missing — run migration 098 first', schemaMissing: true }, { status: 503 });
    }
    return NextResponse.json({ error: runsErr.message }, { status: 500 });
  }
  const runs = (runsRaw as RawAiRun[] | null) ?? [];

  // Pagination cursor
  const hasMore = runs.length > limit;
  const trimmed = hasMore ? runs.slice(0, limit) : runs;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].created_at : null;

  // Hydrate venue + lead names (small follow-up queries; cheap for limit≤200)
  const venueIds = Array.from(new Set(trimmed.map((r) => r.venue_id)));
  const leadIds  = Array.from(new Set(trimmed.map((r) => r.lead_id)));

  const [{ data: venuesRows }, { data: leadsRows }] = await Promise.all([
    venueIds.length > 0
      ? supabaseAdmin.from('venues').select('id, name').in('id', venueIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    leadIds.length > 0
      ? supabaseAdmin.from('leads').select('id, first_name, last_name, email').in('id', leadIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; email: string | null }[] }),
  ]);

  const venueById = new Map<string, string>();
  for (const v of (venuesRows ?? []) as { id: string; name: string | null }[]) {
    venueById.set(v.id, v.name ?? '—');
  }
  const leadById = new Map<string, { first_name: string | null; last_name: string | null; email: string | null }>();
  for (const l of (leadsRows ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]) {
    leadById.set(l.id, { first_name: l.first_name, last_name: l.last_name, email: l.email });
  }

  const rows: AiRunRow[] = trimmed.map((r) => {
    const lead = leadById.get(r.lead_id);
    return {
      ...r,
      venue_name:      venueById.get(r.venue_id) ?? null,
      lead_first_name: lead?.first_name ?? null,
      lead_last_name:  lead?.last_name ?? null,
      lead_email:      lead?.email ?? null,
    };
  });

  // Summary counters (last 24h, no filters applied — gives the operator a
  // global pulse independent of what they're currently filtering on)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const summary = await loadSummary(since);

  return NextResponse.json({ rows, nextCursor, summary });
}

async function loadSummary(sinceIso: string) {
  // Three independent counts; safe to do in parallel.
  const [sent, failed, optedOut] = await Promise.all([
    supabaseAdmin.from('ai_runs').select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso).eq('outcome', 'sent'),
    supabaseAdmin.from('ai_runs').select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso).in('outcome', ['transient_error', 'auth_error', 'permanent_error', 'invalid_phone', 'llm_error']),
    supabaseAdmin.from('ai_runs').select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso).in('outcome', ['dnd']),
  ]);
  return {
    sentLast24h:     sent.count     ?? 0,
    failedLast24h:   failed.count   ?? 0,
    optedOutLast24h: optedOut.count ?? 0,
  };
}
