import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET  /api/admin/errors  — list + filter the platform error log.
 *   Query params:
 *     status   new|investigating|resolved|ignored  (default: excludes resolved+ignored unless 'all')
 *     level    info|warning|error|critical
 *     source   api|client|sms|email|payment|webhook|ai|cron|other
 *     venueId  uuid
 *     q        free-text search over message/category/route
 *     days     lookback window (default 7; 0 = all time)
 *     limit    max rows (default 200, cap 500)
 *     countOnly 1 → return only { unresolved } for the sidebar badge
 *
 * PATCH /api/admin/errors — update triage state.
 *   Body: { id | ids[], status?, notes? }
 */

async function requireErrorsAccess() {
  const id = await getAdminIdentity();
  return id.allowedTabs.has('errors');
}

export async function GET(req: NextRequest) {
  if (!(await requireErrorsAccess())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;

  // Lightweight badge count — unresolved (new + investigating).
  if (sp.get('countOnly') === '1') {
    const { count } = await supabaseAdmin
      .from('error_logs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'investigating']);
    return NextResponse.json({ unresolved: count ?? 0 });
  }

  try {
    const status  = sp.get('status');
    const level   = sp.get('level');
    const source  = sp.get('source');
    const venueId = sp.get('venueId');
    const q       = (sp.get('q') || '').trim();
    const days    = sp.has('days') ? Number(sp.get('days')) : 7;
    const limit   = Math.min(Number(sp.get('limit') || 200), 500);

    let query = supabaseAdmin
      .from('error_logs')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(limit);

    if (status === 'all') {
      // no status filter
    } else if (status) {
      query = query.eq('status', status);
    } else {
      query = query.in('status', ['new', 'investigating']);
    }

    if (level)   query = query.eq('level', level);
    if (source)  query = query.eq('source', source);
    if (venueId) query = query.eq('venue_id', venueId);
    if (Number.isFinite(days) && days > 0) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('last_seen_at', since);
    }
    if (q) {
      const safe = q.replace(/[%,()]/g, ' ');
      query = query.or(`message.ilike.%${safe}%,category.ilike.%${safe}%,route.ilike.%${safe}%`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Summary stats over the same window (independent of status filter) so the
    // header counters reflect reality regardless of what's filtered in the list.
    const sinceIso = Number.isFinite(days) && days > 0
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      : new Date(0).toISOString();
    const { data: statRows } = await supabaseAdmin
      .from('error_logs')
      .select('level, status, occurrence_count')
      .gte('last_seen_at', sinceIso)
      .limit(5000);

    const stats = {
      total: 0, critical: 0, error: 0, warning: 0, info: 0,
      unresolved: 0, occurrences: 0,
    };
    for (const r of (statRows ?? []) as { level: string; status: string; occurrence_count: number }[]) {
      stats.total += 1;
      stats.occurrences += r.occurrence_count ?? 1;
      if (r.level in stats) (stats as Record<string, number>)[r.level] += 1;
      if (r.status === 'new' || r.status === 'investigating') stats.unresolved += 1;
    }

    // Enrich rows with venue names in one batch (best-effort).
    const venueIds = Array.from(new Set(
      ((rows ?? []) as { venue_id: string | null }[])
        .map(r => r.venue_id).filter((v): v is string => !!v),
    ));
    const venueNames: Record<string, string> = {};
    if (venueIds.length > 0) {
      const { data: venues } = await supabaseAdmin
        .from('venues')
        .select('id, name')
        .in('id', venueIds);
      for (const v of (venues ?? []) as { id: string; name: string | null }[]) {
        venueNames[v.id] = v.name ?? '';
      }
    }

    return NextResponse.json({ rows: rows ?? [], stats, venueNames });
  } catch (err) {
    console.error('[admin/errors GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const id = await getAdminIdentity();
  if (!id.allowedTabs.has('errors')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      id?: string; ids?: string[]; status?: string; notes?: string;
    };
    const ids = body.ids ?? (body.id ? [body.id] : []);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (body.status) {
      if (!['new', 'investigating', 'resolved', 'ignored'].includes(body.status)) {
        return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      }
      update.status = body.status;
      if (body.status === 'resolved') {
        update.resolved_at = new Date().toISOString();
        update.resolved_by = id.isMasterSuperAdmin ? 'master_admin' : (id.member?.email ?? 'admin');
      } else {
        update.resolved_at = null;
        update.resolved_by = null;
      }
    }
    if (typeof body.notes === 'string') update.notes = body.notes.slice(0, 4000);

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('error_logs').update(update).in('id', ids);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (err) {
    console.error('[admin/errors PATCH]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE /api/admin/errors?olderThanDays=N — manual purge of old logs. */
export async function DELETE(req: NextRequest) {
  if (!(await requireErrorsAccess())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const days = Number(req.nextUrl.searchParams.get('olderThanDays') || 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin.from('error_logs').delete().lt('created_at', cutoff);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, purgedBefore: cutoff });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
