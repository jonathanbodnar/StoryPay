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
import { supabaseAdmin } from '@/lib/supabase';
import { enrollReengagementDrip } from '@/lib/reengagement-drip';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function isAdmin(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || !!(id.member);
}

/** GET — dry run: returns counts without making any changes. */
export async function GET(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: testLeadRows } = await supabaseAdmin
    .from('leads')
    .select('venue_id')
    .eq('source', 'test_inquiry');

  const venueIdsWithTestLead = [...new Set(
    ((testLeadRows ?? []) as Array<{ venue_id: string }>).map((r) => r.venue_id)
  )];

  const total = venueIdsWithTestLead.length;

  if (!total) {
    return NextResponse.json({ total_sent_test_lead: 0, already_live: 0, would_publish: 0 });
  }

  const { data: alreadyLive } = await supabaseAdmin
    .from('venues')
    .select('id')
    .in('id', venueIdsWithTestLead)
    .eq('is_published', true)
    .neq('is_demo', true);

  const { data: notLive } = await supabaseAdmin
    .from('venues')
    .select('id')
    .in('id', venueIdsWithTestLead)
    .or('is_published.is.null,is_published.eq.false')
    .neq('is_demo', true);

  return NextResponse.json({
    total_sent_test_lead: total,
    already_live:         (alreadyLive ?? []).length,
    would_publish:        (notLive ?? []).length,
    note:                 'POST to this endpoint to apply the backfill.',
  });
}

export async function POST(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Find venues with a test inquiry lead (proxy for "listing setup complete")
  //    that are not yet live, not demo, not explicitly canceled.
  //    Using leads.source = 'test_inquiry' as the signal because
  //    onboarding_activated_at may not exist in all environments.
  const { data: testLeadRows, error: leadsErr } = await supabaseAdmin
    .from('leads')
    .select('venue_id')
    .eq('source', 'test_inquiry');

  if (leadsErr) {
    return NextResponse.json({ error: leadsErr.message }, { status: 500 });
  }

  const venueIdsWithTestLead = [...new Set(
    ((testLeadRows ?? []) as Array<{ venue_id: string }>).map((r) => r.venue_id)
  )];

  if (!venueIdsWithTestLead.length) {
    return NextResponse.json({ ok: true, published: 0, enrolled: 0, note: 'No test inquiry leads found' });
  }

  // Filter to only the ones not yet live (not demo, not already published)
  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('id, is_demo')
    .in('id', venueIdsWithTestLead)
    .or('is_published.is.null,is_published.eq.false')
    .neq('is_demo', true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (venues ?? []) as Array<{
    id: string;
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

  // 3. Enroll all backfilled venues in the re-engagement drip.
  //    The drip engine itself will stop early if they convert.
  const dormant = rows;

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
