import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * POST /api/leads/duplicates/dismiss
 * body: { lead_id: string, other_lead_id: string }
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { lead_id?: string; other_lead_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const a = (body.lead_id ?? '').trim();
  const b = (body.other_lead_id ?? '').trim();
  if (!a || !b || a === b) {
    return NextResponse.json({ error: 'lead_id and other_lead_id are required' }, { status: 400 });
  }

  const now = new Date().toISOString();

  const [{ data: row1 }, { data: row2 }] = await Promise.all([
    supabaseAdmin
      .from('lead_duplicate_candidates')
      .select('id')
      .eq('venue_id', venueId)
      .eq('status', 'open')
      .eq('lead_id', a)
      .eq('matches_lead_id', b)
      .maybeSingle(),
    supabaseAdmin
      .from('lead_duplicate_candidates')
      .select('id')
      .eq('venue_id', venueId)
      .eq('status', 'open')
      .eq('lead_id', b)
      .eq('matches_lead_id', a)
      .maybeSingle(),
  ]);

  const ids = [row1, row2]
    .filter(Boolean)
    .map((r) => (r as { id: string }).id);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No open duplicate pair found' }, { status: 404 });
  }

  const { error: upErr } = await supabaseAdmin
    .from('lead_duplicate_candidates')
    .update({ status: 'dismissed', resolved_at: now })
    .in('id', ids);

  if (upErr) {
    console.error('[dismiss duplicate update]', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
