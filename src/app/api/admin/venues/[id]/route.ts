import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { isDirectoryBadgeStatus } from '@/lib/directory-badges';
import { cancelVenueSubscription, changeVenuePlan } from '@/lib/venue-billing';
import bcrypt from 'bcryptjs';

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
    password?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  // ── Set venue password ────────────────────────────────────────────────────
  if (typeof body.password === 'string') {
    if (body.password.trim().length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    updates.password_hash = await bcrypt.hash(body.password.trim(), 12);
    // Only updating the password — skip the rest of the field validation
    if (Object.keys(body).length === 1) {
      const { error: upErr } = await supabaseAdmin
        .from('venues')
        .update(updates)
        .eq('id', venueId);
      if (upErr) {
        console.error('[admin/venues PATCH] password update error:', upErr);
        return NextResponse.json({ error: upErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
  }

  // Plan changes go through the same flow as the venue-facing UI so the
  // LunarPay subscription is actually rolled over (cancel + recreate at
  // next renewal) under the HQ merchant — not stranded with the wrong
  // amount in LP. The helpers below own the venues-row writes for the
  // plan/subscription columns, so we don't merge them into `updates`.
  let planChangeCheckoutUrl: string | null = null;
  if ('directory_plan_id' in body) {
    if (body.directory_plan_id === null || body.directory_plan_id === '') {
      // Clear plan: cancel any LP sub (best-effort), then reset.
      try {
        await cancelVenueSubscription(venueId);
      } catch (e) {
        // cancelVenueSubscription throws on LP failure but we still need
        // the admin to be able to clear the plan locally.
        console.warn('[admin/venues PATCH] LP cancel failed during plan clear:', e);
      }
      const { error: clearErr } = await supabaseAdmin
        .from('venues')
        .update({
          directory_plan_id:                  null,
          directory_subscription_status:      'none',
          directory_subscription_external_id: null,
        })
        .eq('id', venueId);
      if (clearErr) {
        return NextResponse.json({ error: clearErr.message }, { status: 500 });
      }
    } else if (typeof body.directory_plan_id === 'string') {
      const pid = body.directory_plan_id.trim();
      // Validate plan exists before delegating to changeVenuePlan so we
      // return a clean 400 (not a 500 from the helper).
      const { data: planRow } = await supabaseAdmin
        .from('directory_plans')
        .select('id')
        .eq('id', pid)
        .maybeSingle();
      if (!planRow) return NextResponse.json({ error: 'Invalid directory_plan_id' }, { status: 400 });
      try {
        const result = await changeVenuePlan(venueId, pid);
        if (result.kind === 'checkout_required') {
          // Venue has no LP sub on file (e.g. free → paid for the first
          // time). Admin can copy this URL to the venue owner so they can
          // enter a card. The plan is already pre-assigned in 'pending'
          // status by changeVenuePlan.
          planChangeCheckoutUrl = result.url;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Plan change failed';
        return NextResponse.json({ error: msg }, { status: 502 });
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

  // If a plan change was applied via the helper but no other fields were
  // sent, skip the no-op final UPDATE — return what the venue row looks
  // like now. Otherwise apply the badge/password updates and return.
  const hasOtherUpdates = Object.keys(updates).length > 0;
  const planChanged = 'directory_plan_id' in body;
  if (!hasOtherUpdates && !planChanged) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  if (hasOtherUpdates) {
    const { error: upErr } = await supabaseAdmin
      .from('venues')
      .update(updates)
      .eq('id', venueId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select(
      'id, name, directory_plan_id, directory_verified_status, directory_sponsored_status, directory_subscription_status, directory_subscription_external_id',
    )
    .eq('id', venueId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  return NextResponse.json({ venue: data, checkoutUrl: planChangeCheckoutUrl ?? undefined });
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
