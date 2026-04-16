/**
 * One-time storage migration: wedding-directory Supabase Storage →
 * StoryPay Supabase Storage (bucket `venue-images`).
 *
 * Strategy:
 *   - List every object under `venue-images` in the source project.
 *   - Download each one as a stream, then upload to the destination project
 *     under the SAME key so existing `cover_image_url` / `gallery_images`
 *     paths keep resolving after the host-name is rewritten in SQL.
 *   - Skip files that already exist at the destination (safe to re-run).
 *
 * After this script succeeds, run the SQL pass below in the Supabase SQL
 * editor to rewrite existing URL columns from `<dir>.supabase.co` to the
 * StoryPay project's Supabase hostname:
 *
 *   UPDATE public.venue_listings
 *   SET cover_image_url = REPLACE(cover_image_url, 'https://OLD.supabase.co', 'https://blclfnsztrxfhcfauzer.supabase.co')
 *   WHERE cover_image_url LIKE 'https://OLD.supabase.co/%';
 *
 *   UPDATE public.venue_listings
 *   SET gallery_images = REPLACE(gallery_images::text, 'https://OLD.supabase.co', 'https://blclfnsztrxfhcfauzer.supabase.co')::jsonb
 *   WHERE gallery_images::text LIKE '%https://OLD.supabase.co%';
 *
 * Run:
 *   DIR_SUPABASE_URL=... \
 *   DIR_SUPABASE_SERVICE_ROLE_KEY=... \
 *   STORYPAY_SUPABASE_URL=... \
 *   STORYPAY_SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/migrate-directory-storage.ts
 */

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'venue-images';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing env var: ${name}`); process.exit(1); }
  return v;
}

const DIR_URL = requireEnv('DIR_SUPABASE_URL');
const DIR_KEY = requireEnv('DIR_SUPABASE_SERVICE_ROLE_KEY');
const SP_URL  = requireEnv('STORYPAY_SUPABASE_URL');
const SP_KEY  = requireEnv('STORYPAY_SUPABASE_SERVICE_ROLE_KEY');

const dir = createClient(DIR_URL, DIR_KEY, { auth: { persistSession: false } });
const spa = createClient(SP_URL, SP_KEY, { auth: { persistSession: false } });

async function listRecursive(prefix = ''): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await dir.storage.from(BUCKET).list(prefix, { limit: 1000, offset: 0 });
  if (error) throw new Error(`list(${prefix}): ${error.message}`);
  if (!data) return out;

  for (const entry of data) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      out.push(...(await listRecursive(key)));
    } else {
      out.push(key);
    }
  }
  return out;
}

async function objectExists(path: string): Promise<boolean> {
  const idx = path.lastIndexOf('/');
  const prefix = idx === -1 ? '' : path.slice(0, idx);
  const name = idx === -1 ? path : path.slice(idx + 1);
  const { data } = await spa.storage.from(BUCKET).list(prefix, { limit: 1000 });
  return (data ?? []).some((e) => e.name === name && e.id !== null);
}

async function ensureDestinationBucket(): Promise<void> {
  const { data } = await spa.storage.listBuckets();
  if (!data?.find((b) => b.name === BUCKET)) {
    const { error } = await spa.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
    if (error) throw new Error(`createBucket: ${error.message}`);
    console.log('Created destination bucket.');
  }
}

async function main() {
  await ensureDestinationBucket();

  console.log('→ Listing source objects…');
  const keys = await listRecursive('');
  console.log(`  ${keys.length} objects`);

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of keys) {
    try {
      if (await objectExists(key)) {
        skipped++;
        continue;
      }
      const { data: blob, error: dErr } = await dir.storage.from(BUCKET).download(key);
      if (dErr || !blob) throw new Error(`download: ${dErr?.message ?? 'no blob'}`);
      const contentType = (blob as Blob).type || 'application/octet-stream';
      const { error: uErr } = await spa.storage.from(BUCKET).upload(key, blob, {
        contentType,
        upsert: false,
      });
      if (uErr) throw new Error(`upload: ${uErr.message}`);
      copied++;
      if (copied % 20 === 0) console.log(`  ...${copied} copied`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${key}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\nDone. copied=${copied} skipped=${skipped} failed=${failed}`);
  console.log('\nNext: run the SQL at the top of this file to rewrite URL hostnames.');
}

main().catch((e) => { console.error(e); process.exit(1); });
