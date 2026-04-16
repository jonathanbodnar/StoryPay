import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const BUCKET = 'venue-images';
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return Boolean(token && token === process.env.ADMIN_SECRET);
}

/**
 * Provisions the `venue-images` Supabase Storage bucket used by directory
 * listings. Public read so the directory site can render images with anon key
 * (or even no auth via getPublicUrl).
 *
 * Idempotent — safe to re-run.
 */
export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: existing, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const already = existing?.find((b) => b.name === BUCKET);

  if (!already) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME,
    });
    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, created: true, bucket: BUCKET });
  }

  const { error: updateErr } = await supabaseAdmin.storage.updateBucket(BUCKET, {
    public: true,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: ALLOWED_MIME,
  });
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: false, bucket: BUCKET, note: 'Bucket already existed; settings refreshed.' });
}
