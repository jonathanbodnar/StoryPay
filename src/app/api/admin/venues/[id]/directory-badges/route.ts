import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { DIRECTORY_BADGE_STATUSES, isDirectoryBadgeStatus } from '@/lib/directory-badges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get('admin_token')?.value;
  return adminToken && adminToken === process.env.ADMIN_SECRET;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: venueId } = await params;
  if (!venueId) {
    return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });
  }

  let body: { directory_verified_status?: string; directory_sponsored_status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (body.directory_verified_status !== undefined) {
    if (!isDirectoryBadgeStatus(body.directory_verified_status)) {
      return NextResponse.json({ error: 'Invalid directory_verified_status' }, { status: 400 });
    }
    updates.directory_verified_status = body.directory_verified_status;
  }
  if (body.directory_sponsored_status !== undefined) {
    if (!isDirectoryBadgeStatus(body.directory_sponsored_status)) {
      return NextResponse.json({ error: 'Invalid directory_sponsored_status' }, { status: 400 });
    }
    updates.directory_sponsored_status = body.directory_sponsored_status;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .update(updates)
    .eq('id', venueId)
    .select('id, directory_verified_status, directory_sponsored_status')
    .single();

  if (error) {
    console.error('[admin/directory-badges]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ venue: data });
}
