/**
 * POST /api/admin/backfill-owner-ghl-venues
 *
 * One-way backfill: pushes every existing SaaS venue (StoryVenue's own
 * customers) into the platform owner's GoHighLevel sub-account as a contact,
 * so the owner's GHL list matches the SaaS list. Idempotent — reuses each
 * venue's owner_ghl_contact_id and safe to re-run as new venues sign up.
 *
 * Requires the owner GHL integration to be configured via env:
 *   OWNER_GHL_LOCATION_ID, OWNER_GHL_PIT_TOKEN (see src/lib/owner-ghl-sync.ts).
 *
 * GET  → dry-run: how many venues would be pushed (no GHL writes).
 * POST → applies the backfill. Body (optional JSON):
 *          { onlyPublished?: boolean, limit?: number }
 *        Defaults: onlyPublished=false (all non-demo venues), no limit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';
import { getOwnerGhlConfig, pushVenueToOwnerGhl } from '@/lib/owner-ghl-sync';

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
  is_published: boolean | null;
}

const SELECT =
  'id, name, email, phone, owner_first_name, owner_last_name, slug, city, state, owner_ghl_contact_id, is_published';

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

export async function GET(): Promise<NextResponse> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    return NextResponse.json({
      eligible_total: all.length,
      published,
      already_linked: alreadyLinked,
      note: 'POST to apply. Body: { onlyPublished?: boolean, limit?: number }.',
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

    // Serial to stay well under GHL rate limits; this route is a one-off.
    for (const v of venues) {
      const contactId = await pushVenueToOwnerGhl(v);
      if (contactId) synced++;
      else failed++;
    }

    console.log('[backfill-owner-ghl-venues] synced', synced, 'failed', failed, 'of', venues.length);
    return NextResponse.json({
      ok: true,
      attempted: venues.length,
      synced,
      failed,
      onlyPublished,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
