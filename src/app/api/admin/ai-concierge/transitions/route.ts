/**
 * Super-admin AI state-transition feed.
 *
 * Returns the most recent rows from `ai_state_transitions` across all venues,
 * hydrated with venue + lead names. Same filtering/paging contract as the
 * runs feed (see ../runs/route.ts).
 *
 *   GET ?limit=50&cursor=<iso>&venueId=<uuid>&reason=<reason>
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface RawTransition {
  id:           string;
  lead_id:      string;
  venue_id:     string;
  from_state:   string | null;
  to_state:     string;
  reason:       string | null;
  triggered_by: string | null;
  metadata:     Record<string, unknown> | null;
  created_at:   string;
}

interface TransitionRow extends RawTransition {
  venue_name:      string | null;
  lead_first_name: string | null;
  lead_last_name:  string | null;
  lead_email:      string | null;
}

const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url      = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
  const limit    = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), MAX_LIMIT) : 50;
  const cursor   = url.searchParams.get('cursor');
  const venueId  = url.searchParams.get('venueId') || null;
  const reason   = url.searchParams.get('reason')  || null;

  let q = supabaseAdmin
    .from('ai_state_transitions')
    .select('id, lead_id, venue_id, from_state, to_state, reason, triggered_by, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (cursor)  q = q.lt('created_at', cursor);
  if (venueId) q = q.eq('venue_id', venueId);
  if (reason)  q = q.eq('reason', reason);

  const { data: txnsRaw, error } = await q;
  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'ai_state_transitions table missing — run migration 098 first', schemaMissing: true }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const txns = (txnsRaw as RawTransition[] | null) ?? [];

  const hasMore    = txns.length > limit;
  const trimmed    = hasMore ? txns.slice(0, limit) : txns;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].created_at : null;

  const venueIds = Array.from(new Set(trimmed.map((r) => r.venue_id)));
  const leadIds  = Array.from(new Set(trimmed.map((r) => r.lead_id)));

  const [{ data: venuesRows }, { data: leadsRows }] = await Promise.all([
    venueIds.length > 0
      ? supabaseAdmin.from('venues').select('id, name').in('id', venueIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
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

  const rows: TransitionRow[] = trimmed.map((r) => {
    const lead = leadById.get(r.lead_id);
    return {
      ...r,
      venue_name:      venueById.get(r.venue_id) ?? null,
      lead_first_name: lead?.first_name ?? null,
      lead_last_name:  lead?.last_name ?? null,
      lead_email:      lead?.email ?? null,
    };
  });

  return NextResponse.json({ rows, nextCursor });
}
