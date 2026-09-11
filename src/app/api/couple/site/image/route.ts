import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'couple-images';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

let bucketEnsured = false;
async function ensureBucket(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bucketEnsured) return { ok: true };
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) return { ok: false, error: `listBuckets: ${listErr.message}` };
  if ((buckets ?? []).some((b) => b.name === BUCKET)) {
    bucketEnsured = true;
    return { ok: true };
  }
  const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ALLOWED_MIME,
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    return { ok: false, error: `createBucket: ${createErr.message}` };
  }
  bucketEnsured = true;
  return { ok: true };
}

/**
 * Issue a short-lived signed upload URL into the public `couple-images` bucket,
 * scoped to the authenticated bride. The client PUTs the file directly, then
 * stores the returned publicUrl on couple_sites.photo_url / cover_url.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { fileName?: string; contentType?: string; size?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const fileName = body.fileName ?? '';
  const contentType = (body.contentType ?? '').toLowerCase();
  const size = typeof body.size === 'number' ? body.size : 0;

  if (!fileName || !contentType) {
    return NextResponse.json({ error: 'fileName and contentType required' }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(contentType)) {
    return NextResponse.json({ error: `Unsupported content type: ${contentType}` }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${Math.round(MAX_BYTES / (1024 * 1024))}MB` }, { status: 400 });
  }

  const ensured = await ensureBucket();
  if (!ensured.ok) {
    console.error('[couple/site/image] ensureBucket failed:', ensured.error);
    return NextResponse.json({ error: `Storage unavailable: ${ensured.error}` }, { status: 500 });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const objectKey = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(objectKey);
  if (error || !data) {
    console.error('[couple/site/image] createSignedUploadUrl failed:', error?.message);
    return NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 });
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(objectKey);
  return NextResponse.json({
    bucket: BUCKET,
    path: objectKey,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: pub.publicUrl,
  });
}
