/**
 * One-time backfill: merge lead rows that share the same normalized email AND
 * the same normalized phone number within a venue. These pairs are the
 * `same_email_and_phone` case that `autoMergeExactDuplicates` (src/lib/merge-leads.ts)
 * now handles automatically going forward for newly-created leads — this
 * script cleans up the backlog that accumulated before that safety net
 * existed (support-inbox / GHL-sync check-then-insert races).
 *
 * Uses the exact same `mergeLeadsInto` the app uses for manual "merge
 * duplicate" clicks, so notes/tags/activity/automations all migrate the same
 * way — this is not a raw SQL delete.
 *
 * Usage:
 *   npx tsx scripts/backfill-merge-exact-duplicate-leads.ts                # dry run, all venues
 *   npx tsx scripts/backfill-merge-exact-duplicate-leads.ts --apply        # execute, all venues
 *   npx tsx scripts/backfill-merge-exact-duplicate-leads.ts --venue=<id>   # scope to one venue
 *   npx tsx scripts/backfill-merge-exact-duplicate-leads.ts --venue=<id> --apply
 */

import { supabaseAdmin } from '../src/lib/supabase';
import { mergeLeadsInto } from '../src/lib/merge-leads';

const APPLY = process.argv.includes('--apply');
const venueArg = process.argv.find((a) => a.startsWith('--venue='));
const VENUE_FILTER = venueArg ? venueArg.split('=')[1] : null;

const SYSTEM_ACTOR = { memberId: null, isOwner: false };

function normEmail(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase();
}
function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

type LeadRow = { id: string; email: string | null; phone: string | null; created_at: string };

async function fetchAllLeads(venueId: string): Promise<LeadRow[]> {
  const out: LeadRow[] = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, email, phone, created_at')
      .eq('venue_id', venueId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`[fetchAllLeads] ${venueId}: ${error.message}`);
    out.push(...((data ?? []) as LeadRow[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function processVenue(venueId: string, venueName: string): Promise<{ groups: number; merged: number; failed: number }> {
  const leads = await fetchAllLeads(venueId);

  const groups = new Map<string, LeadRow[]>();
  for (const l of leads) {
    const em = normEmail(l.email);
    const ph = normPhone(l.phone);
    if (!em || !ph) continue;
    const key = `${em}|${ph}`;
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  }

  const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  if (dupGroups.length === 0) return { groups: 0, merged: 0, failed: 0 };

  console.log(`\n[${venueName}] ${dupGroups.length} duplicate group(s), ${dupGroups.reduce((s, [, a]) => s + a.length - 1, 0)} mergeable row(s)`);

  let merged = 0;
  let failed = 0;

  for (const [key, arr] of dupGroups) {
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const [keep, ...rest] = arr;
    console.log(`  ${key}: keep=${keep.id} (${keep.created_at}) merge=[${rest.map((r) => r.id).join(', ')}]`);

    if (!APPLY) continue;

    // Merge sequentially into the same keep id — mergeLeadsInto folds fields
    // additively (message/notes concatenated, max opportunity_value, etc.)
    // so repeated merges onto one target are safe.
    for (const r of rest) {
      const result = await mergeLeadsInto(venueId, keep.id, r.id, SYSTEM_ACTOR, {
        auto: true,
        backfill: true,
        reason: 'same_email_and_phone',
      });
      if (result.ok) {
        merged++;
      } else {
        failed++;
        console.error(`    ✗ merge ${r.id} -> ${keep.id} failed: ${result.error}`);
      }
    }
  }

  return { groups: dupGroups.length, merged, failed };
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE (will merge) ===' : '=== DRY RUN (pass --apply to execute) ===');

  let venues: { id: string; name: string }[];
  if (VENUE_FILTER) {
    const { data, error } = await supabaseAdmin.from('venues').select('id, name').eq('id', VENUE_FILTER);
    if (error) throw error;
    venues = (data ?? []) as { id: string; name: string }[];
  } else {
    const { data, error } = await supabaseAdmin.from('venues').select('id, name').eq('is_demo', false);
    if (error) throw error;
    venues = (data ?? []) as { id: string; name: string }[];
  }

  let totalGroups = 0;
  let totalMerged = 0;
  let totalFailed = 0;

  for (const v of venues) {
    const { groups, merged, failed } = await processVenue(v.id, v.name);
    totalGroups += groups;
    totalMerged += merged;
    totalFailed += failed;
  }

  console.log('\n=== Summary ===');
  console.log('Venues scanned:', venues.length);
  console.log('Duplicate groups found:', totalGroups);
  if (APPLY) {
    console.log('Rows merged:', totalMerged);
    console.log('Failures:', totalFailed);
  } else {
    console.log('(dry run — nothing was changed, re-run with --apply)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
