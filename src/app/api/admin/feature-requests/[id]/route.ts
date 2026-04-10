import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Use RPC to bypass PostgREST schema cache for new columns (completed_at, changelog_id)
  const { data: rows, error: rpcErr } = await supabaseAdmin
    .rpc('get_feature_request_detail', { p_id: id });

  const req = (Array.isArray(rows) ? rows[0] : rows) ?? null;

  if (rpcErr || !req) {
    // Fallback to direct select (old columns only)
    const { data: fallback } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, description, vote_count, status, created_at')
      .eq('id', id)
      .single();
    if (!fallback) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Patch missing new columns
    Object.assign(fallback, { completed_at: null, changelog_id: null });
    Object.assign(req ?? {}, fallback);
    if (!req) return NextResponse.json({ ...fallback, voters: [], changelogEntry: null });
  }

  // Get changelog entry if linked
  let changelogEntry = null;
  if (req.changelog_id) {
    const { data } = await supabaseAdmin
      .from('changelog_entries')
      .select('id, title, description, category, released_at')
      .eq('id', req.changelog_id)
      .single();
    changelogEntry = data;
  }

  const { data: votes } = await supabaseAdmin
    .from('feature_request_votes')
    .select('venue_id, created_at')
    .eq('request_id', id)
    .order('created_at', { ascending: false });

  const venueIds = (votes ?? []).map(v => v.venue_id);
  let venueMap: Record<string, string> = {};
  if (venueIds.length > 0) {
    const { data: venues } = await supabaseAdmin
      .from('venues')
      .select('id, name')
      .in('id', venueIds);
    venueMap = Object.fromEntries((venues ?? []).map(v => [v.id, v.name]));
  }

  const voters = (votes ?? []).map(v => ({
    venue_id: v.venue_id,
    venue_name: venueMap[v.venue_id] || 'Unknown Venue',
    voted_at: v.created_at,
  }));

  return NextResponse.json({ ...req, voters, changelogEntry });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { status, changelogTitle, changelogDescription, changelogCategory } = body;

  const valid = ['open', 'planned', 'in_progress', 'completed'];
  if (!valid.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  let completedAt: string | null = null;
  let changelogId: string | null = null;

  // When marking completed: create changelog entry first (direct insert, no new columns referenced)
  if (status === 'completed') {
    completedAt = new Date().toISOString();

    if (changelogTitle?.trim()) {
      const { data: entry, error: clErr } = await supabaseAdmin
        .from('changelog_entries')
        .insert({
          title: changelogTitle.trim(),
          description: changelogDescription?.trim() || '',
          category: changelogCategory || 'feature',
          released_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (!clErr && entry) {
        changelogId = entry.id;
      }
    }
  }

  // Use RPC to bypass PostgREST schema cache — avoids "column not found" errors
  const { data, error } = await supabaseAdmin.rpc('update_feature_request_status', {
    p_id: id,
    p_status: status,
    p_completed_at: completedAt,
    p_changelog_id: changelogId,
  });

  if (error) {
    console.error('[feature-request PATCH] RPC error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(row ?? { id, status });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { error } = await supabaseAdmin.from('feature_requests').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
