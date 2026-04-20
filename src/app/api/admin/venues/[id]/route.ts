import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { isDirectoryBadgeStatus } from '@/lib/directory-badges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: venueId } = await params;
  if (!venueId) return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });

  let body: {
    directory_plan_id?: string | null;
    directory_verified_status?: string;
    directory_sponsored_status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ('directory_plan_id' in body) {
    if (body.directory_plan_id === null || body.directory_plan_id === '') {
      updates.directory_plan_id = null;
    } else if (typeof body.directory_plan_id === 'string') {
      const pid = body.directory_plan_id.trim();
      const { data: plan } = await supabaseAdmin.from('directory_plans').select('id').eq('id', pid).maybeSingle();
      if (!plan) return NextResponse.json({ error: 'Invalid directory_plan_id' }, { status: 400 });
      updates.directory_plan_id = pid;
    } else {
      return NextResponse.json({ error: 'Invalid directory_plan_id' }, { status: 400 });
    }
  }

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
    .select(
      'id, name, directory_plan_id, directory_verified_status, directory_sponsored_status',
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  return NextResponse.json({ venue: data });
}
