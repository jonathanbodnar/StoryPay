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
      updates.directory_subscription_status = 'none';
      updates.directory_subscription_external_id = null;
    } else if (typeof body.directory_plan_id === 'string') {
      const pid = body.directory_plan_id.trim();
      const { data: planRow } = await supabaseAdmin
        .from('directory_plans')
        .select('id, price_monthly_cents')
        .eq('id', pid)
        .maybeSingle();
      if (!planRow) return NextResponse.json({ error: 'Invalid directory_plan_id' }, { status: 400 });
      updates.directory_plan_id = pid;
      const price = planRow.price_monthly_cents ?? 0;
      if (price > 0) {
        updates.directory_subscription_status = 'pending_payment';
        updates.directory_subscription_external_id = null;
      } else {
        updates.directory_subscription_status = 'active';
        updates.directory_subscription_external_id = null;
      }
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
      'id, name, directory_plan_id, directory_verified_status, directory_sponsored_status, directory_subscription_status',
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  return NextResponse.json({ venue: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: venueId } = await params;
  if (!venueId) return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });

  // Confirm the venue exists and grab owner_id for auth cleanup
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, owner_id')
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Clean up Supabase Storage files for this venue (best-effort — don't block on failure)
  try {
    const storageBuckets = [
      { bucket: 'venue-images', prefix: `${venueId}/` },
      { bucket: 'venue-assets', prefix: `venue-logos/${venueId}/` },
      { bucket: 'venue-assets', prefix: `venue-covers/${venueId}/` },
    ];
    for (const { bucket, prefix } of storageBuckets) {
      const { data: files } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map((f: { name: string }) => `${prefix}${f.name}`);
        await supabaseAdmin.storage.from(bucket).remove(paths);
      }
    }
  } catch {
    // Storage cleanup failure is non-fatal — proceed with DB deletion
  }

  // Delete the venue — all related rows cascade automatically
  const { error } = await supabaseAdmin.from('venues').delete().eq('id', venueId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Delete the Supabase Auth user + profile so the email is freed for re-registration
  const ownerId = (venue as { owner_id?: string | null }).owner_id;
  if (ownerId) {
    try {
      await supabaseAdmin.from('profiles').delete().eq('id', ownerId);
    } catch (e) {
      console.warn('[admin/venues/delete] profile deletion failed (non-fatal):', e);
    }
    try {
      await supabaseAdmin.auth.admin.deleteUser(ownerId);
    } catch (e) {
      console.warn('[admin/venues/delete] auth user deletion failed (non-fatal):', e);
    }
  }

  return NextResponse.json({ deleted: true, venueId, venueName: venue.name });
}
