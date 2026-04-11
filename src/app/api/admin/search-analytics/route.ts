import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token || token !== process.env.ADMIN_SECRET) return false;
  return true;
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Aggregate: top zero-result searches in last 30 days
  const { data: zeroResults, error: e1 } = await supabaseAdmin
    .from('help_search_logs')
    .select('search_term')
    .eq('result_count', 0)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  // Aggregate: top searches overall in last 30 days
  const { data: allSearches, error: e2 } = await supabaseAdmin
    .from('help_search_logs')
    .select('search_term, result_count')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (e1 || e2) {
    console.error('[search-analytics]', e1 || e2);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }

  function tally(rows: { search_term: string }[]) {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.search_term] = (counts[r.search_term] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([term, count]) => ({ term, count }));
  }

  return NextResponse.json({
    zeroResults: tally(zeroResults ?? []),
    topSearches: tally((allSearches ?? []).map(r => ({ search_term: r.search_term }))),
    totalSearches: (allSearches ?? []).length,
    totalZeroResults: (zeroResults ?? []).length,
  });
}
