/**
 * POST /api/admin/backfill-gbp-verified
 *
 * Retroactive backfill: auto-enables the Verified badge for every venue that:
 *   1. Has a Google Business Profile connected (google_place_id IS NOT NULL), AND
 *   2. Has a card on file — either:
 *        a. directory_card_on_file = true  (Free plan or any post-174 signup), OR
 *        b. directory_subscription_external_id IS NOT NULL with an active/trialing status
 *           (paid subscribers who pre-date the card_on_file column)
 *
 * Only promotes directory_verified_status from 'none' or 'draft' → 'approved'.
 * Leaves 'pending', 'approved', and 'rejected' untouched to preserve any
 * super-admin manual decisions.
 *
 * GET  → dry-run, returns counts without making changes.
 * POST → applies the backfill. Idempotent: safe to re-run.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function isAdmin(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || !!(id.member);
}

type VenueRow = {
  id: string;
  google_place_id: string | null;
  directory_verified_status: string;
  directory_card_on_file: boolean | null;
  directory_subscription_external_id: string | null;
  directory_subscription_status: string | null;
};

function meetsCardCriteria(row: VenueRow): boolean {
  if (row.directory_card_on_file === true) return true;
  const status = row.directory_subscription_status ?? '';
  return (
    !!row.directory_subscription_external_id &&
    ['active', 'trialing', 'past_due'].includes(status)
  );
}

function hasGbp(row: VenueRow): boolean {
  return typeof row.google_place_id === 'string' && row.google_place_id.trim().length > 0;
}

async function fetchCandidates(): Promise<{ eligible: VenueRow[]; alreadyApproved: number }> {
  // Fetch all non-demo venues that have a GBP connected and a non-terminal
  // verified status (i.e. not already 'approved' or 'rejected' by an admin).
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select(
      'id, google_place_id, directory_verified_status, directory_card_on_file, directory_subscription_external_id, directory_subscription_status',
    )
    .not('google_place_id', 'is', null)
    .neq('is_demo', true);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as VenueRow[];

  // Split into already-approved and eligible-to-promote.
  let alreadyApproved = 0;
  const eligible: VenueRow[] = [];

  for (const row of rows) {
    if (!hasGbp(row)) continue; // safety: filter empty strings
    if (row.directory_verified_status === 'approved') {
      alreadyApproved++;
      continue;
    }
    // Skip admin-rejected — don't override explicit rejection.
    if (row.directory_verified_status === 'rejected') continue;
    // Only promote if card is on file.
    if (!meetsCardCriteria(row)) continue;
    eligible.push(row);
  }

  return { eligible, alreadyApproved };
}

/** GET — dry run: returns counts without making any changes. */
export async function GET(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { eligible, alreadyApproved } = await fetchCandidates();
    return NextResponse.json({
      already_approved:  alreadyApproved,
      would_auto_verify: eligible.length,
      breakdown: eligible.map((r) => ({
        id:                r.id,
        current_status:    r.directory_verified_status,
        card_on_file:      r.directory_card_on_file,
        has_subscription:  !!r.directory_subscription_external_id,
      })),
      note: 'POST to this endpoint to apply the backfill.',
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** POST — applies the backfill. */
export async function POST(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { eligible, alreadyApproved } = await fetchCandidates();

    if (!eligible.length) {
      return NextResponse.json({
        ok:               true,
        already_approved: alreadyApproved,
        verified:         0,
        note:             'No eligible venues found.',
      });
    }

    const ids = eligible.map((r) => r.id);

    const { error: upErr } = await supabaseAdmin
      .from('venues')
      .update({ directory_verified_status: 'approved' })
      .in('id', ids);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    console.log('[backfill-gbp-verified] auto-verified', ids.length, 'venues');

    return NextResponse.json({
      ok:               true,
      already_approved: alreadyApproved,
      verified:         ids.length,
      venue_ids:        ids,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
