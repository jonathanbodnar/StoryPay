/**
 * POST /api/admin/backfill-owner-ghl-venues
 *
 * One-way backfill: pushes every existing SaaS venue (StoryVenue's own
 * customers) into the platform owner's GoHighLevel sub-account as a contact,
 * tags each contact "saas-client", and creates/advances an opportunity for
 * each in the owner's "SaaS Clients" pipeline (stage tracks the venue
 * lifecycle), so the owner's GHL matches the SaaS list. Idempotent — reuses
 * each venue's owner_ghl_contact_id / owner_ghl_opportunity_id and safe to
 * re-run as venues sign up and progress.
 *
 * Requires the owner GHL integration to be configured via env:
 *   OWNER_GHL_LOCATION_ID, OWNER_GHL_PIT_TOKEN (see src/lib/owner-ghl-sync.ts).
 *
 * GET  → dry-run: how many venues would be pushed + opportunities created vs
 *        moved (no GHL writes).
 * POST → applies the backfill. Body (optional JSON):
 *          { onlyPublished?: boolean, limit?: number }
 *        Defaults: onlyPublished=false (all non-demo venues), no limit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';
import { diagnoseOwnerGhl, getOwnerGhlConfig, pushVenueToOwnerGhl } from '@/lib/owner-ghl-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Backfilling many venues serially against GHL can take a while.
export const maxDuration = 300;

async function isAdmin(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin;
}

interface VenueRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  slug: string | null;
  city: string | null;
  state: string | null;
  owner_ghl_contact_id: string | null;
  owner_ghl_opportunity_id: string | null;
  is_published: boolean | null;
  // Lifecycle columns so pushVenueToOwnerGhl can place/advance the opportunity.
  directory_subscription_status: string | null;
  directory_subscription_external_id: string | null;
  directory_card_on_file: boolean | null;
}

const SELECT =
  'id, name, email, phone, owner_first_name, owner_last_name, slug, city, state, owner_ghl_contact_id, owner_ghl_opportunity_id, is_published, directory_subscription_status, directory_subscription_external_id, directory_card_on_file';

async function fetchVenues(onlyPublished: boolean, limit: number | null): Promise<VenueRow[]> {
  // Paginate past Supabase's 1,000-row cap.
  const rows: VenueRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = supabaseAdmin
      .from('venues')
      .select(SELECT)
      .neq('is_demo', true)
      .order('created_at', { ascending: true })
      .range(from, from + page - 1);
    if (onlyPublished) q = q.eq('is_published', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as VenueRow[];
    rows.push(...batch);
    if (batch.length < page) break;
    if (limit && rows.length >= limit) break;
  }
  // A venue needs an email or phone to become a GHL contact.
  const eligible = rows.filter((v) => (v.email && v.email.trim()) || (v.phone && v.phone.trim()));
  return limit ? eligible.slice(0, limit) : eligible;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ?diagnose=1 — surface WHY the sync is failing (auth / pipeline / contact write).
  if (req.nextUrl.searchParams.get('diagnose')) {
    return NextResponse.json(await diagnoseOwnerGhl());
  }
  if (!getOwnerGhlConfig()) {
    return NextResponse.json(
      { error: 'Owner GHL not configured. Set OWNER_GHL_LOCATION_ID and OWNER_GHL_PIT_TOKEN.' },
      { status: 400 },
    );
  }
  try {
    const all = await fetchVenues(false, null);
    const published = all.filter((v) => v.is_published).length;
    const alreadyLinked = all.filter((v) => v.owner_ghl_contact_id).length;
    // Opportunity dry-run: venues WITH a stored opportunity id would be MOVED
    // (stage advanced to match their current lifecycle); the rest would get a
    // new opportunity CREATED on first sync.
    const opportunitiesToMove = all.filter((v) => v.owner_ghl_opportunity_id).length;
    const opportunitiesToCreate = all.length - opportunitiesToMove;
    return NextResponse.json({
      eligible_total: all.length,
      published,
      already_linked: alreadyLinked,
      opportunities_to_create: opportunitiesToCreate,
      opportunities_to_move: opportunitiesToMove,
      note:
        'POST to apply (tags every contact "saas-client" + creates/advances a "SaaS Clients" ' +
        'pipeline opportunity per venue). Body: { onlyPublished?: boolean, limit?: number }.',
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!getOwnerGhlConfig()) {
    return NextResponse.json(
      { error: 'Owner GHL not configured. Set OWNER_GHL_LOCATION_ID and OWNER_GHL_PIT_TOKEN.' },
      { status: 400 },
    );
  }

  let onlyPublished = false;
  let limit: number | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { onlyPublished?: boolean; limit?: number };
    onlyPublished = body.onlyPublished === true;
    if (typeof body.limit === 'number' && body.limit > 0) limit = Math.floor(body.limit);
  } catch {
    /* no body — use defaults */
  }

  try {
    const venues = await fetchVenues(onlyPublished, limit);
    let synced = 0;
    let failed = 0;
    let opportunitiesCreated = 0;
    let opportunitiesMoved = 0;

    // Serial to stay well under GHL rate limits; this route is a one-off.
    for (const v of venues) {
      const hadOpportunity = Boolean(v.owner_ghl_opportunity_id);
      const contactId = await pushVenueToOwnerGhl(v);
      if (contactId) synced++;
      else failed++;
      // pushVenueToOwnerGhl mutates the row's owner_ghl_opportunity_id in place
      // when it creates a new opportunity, so we can classify create vs move.
      if (hadOpportunity) opportunitiesMoved++;
      else if (v.owner_ghl_opportunity_id) opportunitiesCreated++;
    }

    console.log(
      '[backfill-owner-ghl-venues] synced', synced, 'failed', failed,
      'opps created', opportunitiesCreated, 'moved', opportunitiesMoved, 'of', venues.length,
    );
    return NextResponse.json({
      ok: true,
      attempted: venues.length,
      synced,
      failed,
      opportunities_created: opportunitiesCreated,
      opportunities_moved: opportunitiesMoved,
      onlyPublished,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
