/**
 * One-time data migration: wedding-directory Supabase → StoryPay Supabase.
 *
 * What it does:
 *   1. Reads every row from the directory project's `venues` and `leads` tables
 *      via the Supabase service role key.
 *   2. For each directory venue, finds the matching StoryPay `venues` row by
 *      email (auth user -> storypay venue). Rows without a match are skipped
 *      and listed at the end so you can create those StoryPay accounts first.
 *   3. Upserts rows into StoryPay's `venue_listings` (keeps the slug stable).
 *   4. Inserts leads with the new `storypay_venue_id` + `venue_listing_id`.
 *
 * Idempotent — re-run safely. Uses `ON CONFLICT` on `venue_listings.slug`.
 *
 * Run:
 *   DIR_SUPABASE_URL=... \
 *   DIR_SUPABASE_SERVICE_ROLE_KEY=... \
 *   STORYPAY_SUPABASE_URL=... \
 *   STORYPAY_SUPABASE_SERVICE_ROLE_KEY=... \
 *   STORYPAY_DATABASE_URL=postgres://... \
 *   npx tsx scripts/migrate-directory-data.ts
 */

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const DIR_URL     = requireEnv('DIR_SUPABASE_URL');
const DIR_KEY     = requireEnv('DIR_SUPABASE_SERVICE_ROLE_KEY');
const SP_URL      = requireEnv('STORYPAY_SUPABASE_URL');
const SP_KEY      = requireEnv('STORYPAY_SUPABASE_SERVICE_ROLE_KEY');
const SP_PG       = requireEnv('STORYPAY_DATABASE_URL');

const dir = createClient(DIR_URL, DIR_KEY, { auth: { persistSession: false } });
const spa = createClient(SP_URL, SP_KEY, { auth: { persistSession: false } });
const sql = postgres(SP_PG, { prepare: false, ssl: 'require', max: 3 });

async function listAllDirectoryVenues() {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  const page = 500;
  while (true) {
    const { data, error } = await dir.from('venues').select('*').range(from, from + page - 1);
    if (error) throw new Error(`Directory venues read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

async function listAllDirectoryLeads() {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  const page = 500;
  while (true) {
    const { data, error } = await dir.from('leads').select('*').range(from, from + page - 1);
    if (error) throw new Error(`Directory leads read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

async function ownerIdToEmail(ownerId: string): Promise<string | null> {
  const { data: profile } = await dir.from('profiles').select('email, full_name').eq('id', ownerId).single();
  if (profile && 'email' in profile && profile.email) return String(profile.email);
  const { data: user } = await dir.auth.admin.getUserById(ownerId);
  return user?.user?.email ?? null;
}

async function findStoryPayVenueByEmail(email: string): Promise<string | null> {
  const { data } = await spa.from('venues').select('id').ilike('email', email).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function main() {
  console.log('→ Reading directory venues…');
  const venues = await listAllDirectoryVenues();
  console.log(`  found ${venues.length} venues`);

  console.log('→ Reading directory leads…');
  const leads = await listAllDirectoryLeads();
  console.log(`  found ${leads.length} leads`);

  const oldToNewListingId = new Map<string, string>();
  const skippedVenues: { id: string; reason: string }[] = [];

  for (const v of venues) {
    const ownerId = v.owner_id as string | null;
    if (!ownerId) { skippedVenues.push({ id: String(v.id), reason: 'no owner_id' }); continue; }

    const email = await ownerIdToEmail(ownerId);
    if (!email) { skippedVenues.push({ id: String(v.id), reason: 'no email for owner' }); continue; }

    const spVenueId = await findStoryPayVenueByEmail(email);
    if (!spVenueId) {
      skippedVenues.push({ id: String(v.id), reason: `no StoryPay venue for ${email}` });
      continue;
    }

    const rows = await sql`
      INSERT INTO public.venue_listings (
        storypay_venue_id, slug, name, description, venue_type,
        location_full, location_city, location_state, lat, lng,
        capacity_min, capacity_max, price_min, price_max, indoor_outdoor,
        features, cover_image_url, gallery_images, availability_notes,
        is_published, onboarding_completed, notification_email, email_notifications,
        created_at
      ) VALUES (
        ${spVenueId}, ${v.slug}, ${v.name}, ${v.description}, ${v.venue_type},
        ${v.location_full}, ${v.location_city}, ${v.location_state}, ${v.lat}, ${v.lng},
        ${v.capacity_min}, ${v.capacity_max}, ${v.price_min}, ${v.price_max}, ${v.indoor_outdoor},
        ${JSON.stringify(v.features ?? [])}::jsonb,
        ${v.cover_image_url},
        ${JSON.stringify(v.gallery_images ?? [])}::jsonb,
        ${v.availability_notes},
        ${v.is_published ?? false}, ${v.onboarding_completed ?? false},
        ${v.notification_email}, ${v.email_notifications ?? true},
        ${v.created_at ?? new Date().toISOString()}
      )
      ON CONFLICT (storypay_venue_id) DO UPDATE SET
        slug                  = EXCLUDED.slug,
        name                  = EXCLUDED.name,
        description           = EXCLUDED.description,
        venue_type            = EXCLUDED.venue_type,
        location_full         = EXCLUDED.location_full,
        location_city         = EXCLUDED.location_city,
        location_state        = EXCLUDED.location_state,
        lat                   = EXCLUDED.lat,
        lng                   = EXCLUDED.lng,
        capacity_min          = EXCLUDED.capacity_min,
        capacity_max          = EXCLUDED.capacity_max,
        price_min             = EXCLUDED.price_min,
        price_max             = EXCLUDED.price_max,
        indoor_outdoor        = EXCLUDED.indoor_outdoor,
        features              = EXCLUDED.features,
        cover_image_url       = EXCLUDED.cover_image_url,
        gallery_images        = EXCLUDED.gallery_images,
        availability_notes    = EXCLUDED.availability_notes,
        is_published          = EXCLUDED.is_published,
        onboarding_completed  = EXCLUDED.onboarding_completed,
        notification_email    = EXCLUDED.notification_email,
        email_notifications   = EXCLUDED.email_notifications
      RETURNING id
    `;
    oldToNewListingId.set(String(v.id), String(rows[0].id));
    console.log(`  ✓ listing ${v.slug ?? v.id} -> ${rows[0].id}`);
  }

  console.log('→ Migrating leads…');
  let insertedLeads = 0;
  let skippedLeads = 0;
  for (const l of leads) {
    const newListingId = oldToNewListingId.get(String(l.venue_id));
    if (!newListingId) { skippedLeads++; continue; }

    const ownerVenue = await sql`
      SELECT storypay_venue_id FROM public.venue_listings WHERE id = ${newListingId} LIMIT 1
    `;
    const spVenueId = ownerVenue[0]?.storypay_venue_id;
    if (!spVenueId) { skippedLeads++; continue; }

    await sql`
      INSERT INTO public.leads (
        venue_listing_id, storypay_venue_id, name, email, phone,
        event_date, guest_count, booking_timeline, message, notes,
        status, source, created_at
      ) VALUES (
        ${newListingId}, ${spVenueId}, ${l.name}, ${l.email}, ${l.phone},
        ${l.wedding_date}, ${l.guest_count}, ${l.booking_timeline}, ${l.message}, ${l.notes},
        ${l.status ?? 'new'}, 'directory-migration',
        ${l.created_at ?? new Date().toISOString()}
      )
    `;
    insertedLeads++;
  }

  console.log(`\nDone.`);
  console.log(`  Listings inserted/updated: ${oldToNewListingId.size}`);
  console.log(`  Listings skipped:          ${skippedVenues.length}`);
  console.log(`  Leads inserted:            ${insertedLeads}`);
  console.log(`  Leads skipped:             ${skippedLeads}`);
  if (skippedVenues.length > 0) {
    console.log(`\nSkipped venues (no StoryPay account yet):`);
    for (const s of skippedVenues) console.log(`  - ${s.id}: ${s.reason}`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
