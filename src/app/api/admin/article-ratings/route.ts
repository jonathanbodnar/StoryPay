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

  // Get all ratings aggregated by article_id
  const { data, error } = await supabaseAdmin
    .from('article_ratings')
    .select('article_id, rating');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const agg: Record<string, { up: number; down: number }> = {};
  for (const r of data ?? []) {
    if (!agg[r.article_id]) agg[r.article_id] = { up: 0, down: 0 };
    if (r.rating === 'up') agg[r.article_id].up++;
    else agg[r.article_id].down++;
  }

  const rows = Object.entries(agg)
    .map(([article_id, counts]) => ({ article_id, ...counts, total: counts.up + counts.down }))
    .sort((a, b) => b.down - a.down);

  return NextResponse.json(rows);
}
