import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { mergeLeadsInto } from '@/lib/merge-leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * POST /api/leads/duplicates/merge
 * body: { keep_lead_id: string, merge_lead_id: string }
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { keep_lead_id?: string; merge_lead_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const keepId = (body.keep_lead_id ?? '').trim();
  const mergeId = (body.merge_lead_id ?? '').trim();
  if (!keepId || !mergeId) {
    return NextResponse.json({ error: 'keep_lead_id and merge_lead_id are required' }, { status: 400 });
  }

  const result = await mergeLeadsInto(venueId, keepId, mergeId, {
    memberId: user.memberId,
    isOwner: user.isOwner,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, kept_lead_id: keepId, merged_lead_id: mergeId });
}
