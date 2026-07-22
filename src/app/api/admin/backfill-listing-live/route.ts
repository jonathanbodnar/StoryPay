/**
 * POST /api/admin/backfill-listing-live
 *
 * One-time (and idempotent) backfill that:
 *   1. Sets is_published = true for every venue that sent a test inquiry
 *      (onboarding_activated_at IS NOT NULL) but whose listing is currently
 *      not live (is_published = false or NULL), excluding demos and
 *      explicitly canceled accounts.
 *   2. Enrolls those same venues in the re-engagement drip if they don't
 *      yet have an active subscription — so they start receiving emails
 *      going forward.
 *
 * Only callable by a super-admin session.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { enrollReengagementDrip } from '@/lib/reengagement-drip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function isAdmin(): Promise<boolean> {
  const c = await cookies();
  const adminEmail = c.get('admin_email')?.value;
  if (!adminEmail) return false;
  const { data } = await supabaseAdmin
    .from('super_admins')
    .select('id')
    .eq('email', adminEmail)
    .maybeSingle();
  return !!data;
}

export async function POST(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Find venues that: sent test lead, listing not live, not demo, not canceled
  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('id, directory_subscription_status, is_demo')
    .not('onboarding_activated_at', 'is', null)
    .or('is_published.is.null,is_published.eq.false')
    .neq('is_demo', true)
    .neq('directory_subscription_status', 'canceled');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (venues ?? []) as Array<{
    id: string;
    directory_subscription_status: string | null;
    is_demo: boolean | null;
  }>;

  if (!rows.length) {
    return NextResponse.json({ ok: true, published: 0, enrolled: 0 });
  }

  const ids = rows.map((r) => r.id);

  // 2. Flip is_published = true for all
  const { error: updateErr } = await supabaseAdmin
    .from('venues')
    .update({ is_published: true })
    .in('id', ids);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // 3. Enroll dormant ones in the re-engagement drip
  const dormant = rows.filter((r) => {
    const sub = r.directory_subscription_status ?? '';
    return sub !== 'active' && sub !== 'past_due';
  });

  let enrolled = 0;
  for (const r of dormant) {
    try {
      await enrollReengagementDrip(r.id);
      enrolled++;
    } catch (e) {
      console.warn('[backfill-listing-live] drip enroll failed:', r.id, e);
    }
  }

  return NextResponse.json({
    ok: true,
    published: ids.length,
    enrolled,
  });
}
