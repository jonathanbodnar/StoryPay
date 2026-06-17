import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/analytics/activity — paginated activity feed.
 *   Query params:
 *     limit    rows per page (default 50, max 200)
 *     offset   row offset for pagination (default 0)
 *     event    filter to a specific event name (e.g. 'click', 'milestone')
 *     venue    filter to a venue name substring
 *     kind     'auto' | 'milestone'
 *     q        free-text search over event/label/path
 */

async function requireAccess() {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || id.allowedTabs.has('analytics');
}

export async function GET(req: NextRequest) {
  if (!(await requireAccess())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const limit  = Math.min(Number(sp.get('limit')  || 50), 200);
    const offset = Math.max(Number(sp.get('offset') || 0),  0);
    const kind   = sp.get('kind')  || '';
    const q      = (sp.get('q')    || '').trim();

    let query = supabaseAdmin
      .from('analytics_events')
      .select('id, created_at, event, kind, venue_id, user_email, role, path, label, session_id, properties', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (kind) query = query.eq('kind', kind);
    if (q) {
      const safe = q.replace(/[%,()]/g, ' ');
      query = query.or(`event.ilike.%${safe}%,label.ilike.%${safe}%,path.ilike.%${safe}%`);
    }

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);

    // Enrich with venue names.
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

    return NextResponse.json({
      rows: rows ?? [],
      total: count ?? 0,
      limit,
      offset,
      venueNames,
    });
  } catch (err) {
    console.error('[admin/analytics/activity GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
