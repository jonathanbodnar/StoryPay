import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';
import { getAdminIdentity } from '@/lib/admin-identity';
import { forgetSessionRow, revokeVenueSessions } from '@/lib/session-revoke';
import { forgetSuspendedVenues } from '@/lib/venue-suspension';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/venues/[id]/suspend
 * Body: { action: 'suspend' | 'unsuspend', reason?: string }
 *
 * Suspending signs out the venue's owner and team and keeps them out: sign-in
 * refuses them, the proxy treats any session of a suspended venue as signed
 * out (sending the dashboard to /suspended), and its API keys stop working.
 * Its automated texts and emails to couples pause too (lib/venue-suspension).
 * The admin's signed "View as venue" cookie still gets in. The 100-year
 * Supabase ban on the owner's auth user is kept for older auth paths.
 *
 * NOTE: This segment MUST use the slug name `[id]` to match the sibling
 * routes under /api/admin/venues/[id]/* — Next.js refuses to boot if two
 * dynamic segments at the same path use different slug names.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Only master super admin may suspend/unsuspend
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: venueId } = await params;
  if (!venueId) {
    return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });
  }

  let body: { action?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'suspend' && action !== 'unsuspend') {
    return NextResponse.json(
      { error: 'action must be "suspend" or "unsuspend"' },
      { status: 400 },
    );
  }

  // Fetch the venue to get the owner's auth user id
  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('id, name, owner_id, is_suspended')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr) {
    return NextResponse.json({ error: venueErr.message }, { status: 500 });
  }
  if (!venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const ownerId = (venue as { owner_id?: string | null }).owner_id;

  // Identify who is performing the action (for the audit trail)
  const identity = await getAdminIdentity();
  const adminEmail = identity.member?.email ?? process.env.ADMIN_EMAIL ?? 'super-admin';

  if (action === 'suspend') {
    // Apply Supabase auth ban — 876,000 hours ≈ 100 years
    if (ownerId) {
      const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(ownerId, {
        ban_duration: '876000h',
      });
      if (banErr) {
        console.error('[admin/suspend] ban error:', banErr);
        return NextResponse.json({ error: `Auth ban failed: ${banErr.message}` }, { status: 500 });
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from('venues')
      .update({
        is_suspended: true,
        suspended_at: new Date().toISOString(),
        suspended_by: adminEmail,
      })
      .eq('id', venueId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Force-logout any active StoryPay sessions for this venue (the Supabase ban
    // above only blocks fresh logins, not already-issued session cookies).
    await revokeVenueSessions(venueId);
    // And its automated texts and emails to couples pause (lib/venue-suspension).
    forgetSuspendedVenues();

    console.log(`[admin/suspend] venue ${venueId} suspended by ${adminEmail}`);
    return NextResponse.json({ ok: true, action: 'suspended', venueName: (venue as { name: string }).name });
  }

  // action === 'unsuspend'
  if (ownerId) {
    const { error: unbanErr } = await supabaseAdmin.auth.admin.updateUserById(ownerId, {
      ban_duration: 'none',
    });
    if (unbanErr) {
      console.error('[admin/suspend] unban error:', unbanErr);
      return NextResponse.json({ error: `Auth unban failed: ${unbanErr.message}` }, { status: 500 });
    }
  }

  const { error: updateErr } = await supabaseAdmin
    .from('venues')
    .update({
      is_suspended: false,
      suspended_at: null,
      suspended_by: null,
    })
    .eq('id', venueId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  forgetSessionRow('venues', venueId);
  forgetSuspendedVenues();

  console.log(`[admin/suspend] venue ${venueId} unsuspended by ${adminEmail}`);
  return NextResponse.json({ ok: true, action: 'unsuspended', venueName: (venue as { name: string }).name });
}
