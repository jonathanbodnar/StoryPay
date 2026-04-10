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

  const { data: req } = await supabaseAdmin
    .from('feature_requests')
    .select('id, title, description, vote_count, status, created_at, completed_at, changelog_id')
    .eq('id', id)
    .single();

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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

  const updateFields: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'completed') {
    updateFields.completed_at = new Date().toISOString();

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
        updateFields.changelog_id = entry.id;
      }
    }
  }

  const { error } = await supabaseAdmin
    .from('feature_requests')
    .update(updateFields)
    .eq('id', id);

  if (error) {
    console.error('[feature-request PATCH] error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id, status });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  await supabaseAdmin
    .from('feature_request_votes')
    .delete()
    .eq('request_id', id);

  const { error } = await supabaseAdmin
    .from('feature_requests')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
