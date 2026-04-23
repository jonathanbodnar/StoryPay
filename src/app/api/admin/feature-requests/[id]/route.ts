import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateChangelogCopy } from '@/lib/changelog-copy';

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

  // Try full select; fall back to base columns if optional ones are missing.
  let req: Record<string, unknown> | null = null;
  {
    const { data, error } = await supabaseAdmin
      .from('feature_requests')
      .select('id, title, description, vote_count, status, created_at, completed_at, changelog_id, admin_read_at, category')
      .eq('id', id)
      .maybeSingle();

    if (error && /completed_at|changelog_id|admin_read_at|category/i.test(error.message)) {
      // Production DB missing optional columns — retry without them.
      const { data: plain, error: plainErr } = await supabaseAdmin
        .from('feature_requests')
        .select('id, title, description, vote_count, status, created_at')
        .eq('id', id)
        .maybeSingle();
      if (plainErr) {
        console.error('[admin feature GET] fallback error:', plainErr.message);
        return NextResponse.json({ error: plainErr.message }, { status: 500 });
      }
      req = plain ? { ...plain, completed_at: null, changelog_id: null, admin_read_at: null, category: 'feature_request' } : null;
    } else if (error) {
      console.error('[admin feature GET] error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      req = data;
    }
  }

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
  const {
    status,
    title: editTitle,
    description: editDescription,
    changelogTitle,
    changelogDescription,
    changelogCategory,
    admin_read,
  } = body as {
    status?: string;
    title?: string;
    description?: string;
    changelogTitle?: string;
    changelogDescription?: string;
    changelogCategory?: 'feature' | 'improvement' | 'fix';
    admin_read?: boolean;
  };

  // Mark-as-read / unread toggle — fast path.
  if (typeof admin_read === 'boolean') {
    const { error } = await supabaseAdmin
      .from('feature_requests')
      .update({ admin_read_at: admin_read ? new Date().toISOString() : null })
      .eq('id', id);
    if (error) {
      if (/admin_read_at/i.test(error.message)) {
        // Column not yet migrated; pretend success so the UI doesn't error.
        return NextResponse.json({ id, admin_read });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ id, admin_read });
  }

  // Admin-only "edit" path — title/description changes without a status flip.
  if (!status) {
    if (typeof editTitle !== 'string' && typeof editDescription !== 'string') {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    const edits: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof editTitle === 'string') {
      if (!editTitle.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
      edits.title = editTitle.trim();
    }
    if (typeof editDescription === 'string') {
      edits.description = editDescription.trim() || null;
    }
    const { error } = await supabaseAdmin.from('feature_requests').update(edits).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id, ...edits });
  }

  const valid = ['open', 'planned', 'in_progress', 'completed'];
  if (!valid.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const updateFields: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'completed') {
    updateFields.completed_at = new Date().toISOString();

    const { data: fr } = await supabaseAdmin
      .from('feature_requests')
      .select('title, description')
      .eq('id', id)
      .maybeSingle();

    const manualTitle = changelogTitle?.trim();
    const manualDesc = changelogDescription?.trim();
    const needsAutoGen = !manualTitle || !manualDesc;

    const copy = needsAutoGen
      ? await generateChangelogCopy({
          requestTitle: fr?.title ?? manualTitle ?? 'Update shipped',
          requestDescription: fr?.description ?? manualDesc ?? null,
          category: changelogCategory,
        })
      : { title: manualTitle!, description: manualDesc!, category: (changelogCategory || 'feature') as 'feature' | 'improvement' | 'fix' };

    const finalTitle = manualTitle || copy.title;
    const finalDescription = manualDesc || copy.description;
    const finalCategory = changelogCategory || copy.category;

    // First insert with the feature_request_id back-link; if the column does
    // not exist yet (pre-migration 048) retry without it so approvals never fail.
    const baseInsert = {
      title: finalTitle,
      description: finalDescription,
      category: finalCategory,
      released_at: new Date().toISOString(),
    } as const;

    let entryId: string | null = null;
    const first = await supabaseAdmin
      .from('changelog_entries')
      .insert({ ...baseInsert, feature_request_id: id })
      .select('id')
      .single();
    if (first.error) {
      if (/feature_request_id/i.test(first.error.message)) {
        const retry = await supabaseAdmin
          .from('changelog_entries')
          .insert(baseInsert)
          .select('id')
          .single();
        if (!retry.error && retry.data) entryId = retry.data.id as string;
        else console.error('[feature-request PATCH] changelog insert error:', retry.error?.message);
      } else {
        console.error('[feature-request PATCH] changelog insert error:', first.error.message);
      }
    } else if (first.data) {
      entryId = first.data.id as string;
    }
    if (entryId) updateFields.changelog_id = entryId;
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
