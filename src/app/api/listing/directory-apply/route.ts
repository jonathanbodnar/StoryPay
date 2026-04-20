import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Venue owner/admin requests verification or sponsored placement (sets status to pending).
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Only owners and admins can submit applications' }, { status: 403 });
  }

  let body: { kind?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const kind = body.kind === 'sponsored' ? 'sponsored' : body.kind === 'verified' ? 'verified' : null;
  if (!kind) {
    return NextResponse.json({ error: 'kind must be "verified" or "sponsored"' }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('venues')
    .select('id, directory_verified_status, directory_sponsored_status')
    .eq('id', user.venueId)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const v = row as { directory_verified_status?: string; directory_sponsored_status?: string };
  const field = kind === 'verified' ? 'directory_verified_status' : 'directory_sponsored_status';
  const current = kind === 'verified' ? v.directory_verified_status : v.directory_sponsored_status;
  const cur = current ?? 'none';

  if (cur === 'pending') {
    return NextResponse.json({ error: 'An application is already pending review.' }, { status: 400 });
  }
  if (cur === 'approved') {
    return NextResponse.json({ error: 'This request is already approved.' }, { status: 400 });
  }
  if (cur === 'draft') {
    return NextResponse.json(
      { error: 'Your application is being prepared by our team. You will be notified when it is ready.' },
      { status: 400 },
    );
  }

  const { error: updErr } = await supabaseAdmin
    .from('venues')
    .update({ [field]: 'pending' })
    .eq('id', user.venueId);

  if (updErr) {
    console.error('[directory-apply]', updErr.message);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, kind, status: 'pending' });
}
