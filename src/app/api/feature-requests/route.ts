import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin.rpc('get_feature_requests', {
    p_venue_id: venueId,
  });

  if (error) {
    console.error('[feature-requests] RPC error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Exclude completed requests — those are shown only in the dedicated
  // /api/feature-requests/completed endpoint (the Completed section).
  const active = (data ?? []).filter(
    (r: { status?: string }) => r.status !== 'completed',
  );

  // If the RPC was updated (migration 054) it already includes category.
  // For any row missing it (pre-migration), fall back to 'feature_request'.
  const withCategory = active.map((r: Record<string, unknown>) => ({
    ...r,
    category: (r.category as string | undefined) ?? 'feature_request',
  }));

  return NextResponse.json(withCategory);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { title, description, category } = await request.json();
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

  const VALID_CATEGORIES = ['feature_request', 'bug_report', 'improvement', 'other'] as const;
  const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'feature_request';

  const { data, error } = await supabaseAdmin.rpc('submit_feature_request', {
    p_venue_id: venueId,
    p_title: title.trim(),
    p_description: description?.trim() || null,
    p_category: safeCategory,
  });

  if (error) {
    console.error('[feature-requests] submit RPC error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(row, { status: 201 });
}
