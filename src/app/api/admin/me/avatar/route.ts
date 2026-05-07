/**
 * POST /api/admin/me/avatar
 *
 * Upload a profile picture for the currently logged-in team member.
 * Master super admin (env-based) doesn't have a DB row so they can't have an
 * avatar — they get a 403 with a clear message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';
import { ensureAdminTeamSchema } from '@/lib/admin-team-schema-ensure';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AVATAR_BUCKET = 'admin-avatars';
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try { await ensureAdminTeamSchema(); } catch { /* fall through */ }
  const id = await getAdminIdentity();
  if (id.isMasterSuperAdmin) {
    return NextResponse.json(
      { error: 'Master super admin profile is managed via environment variables.' },
      { status: 403 },
    );
  }
  if (!id.member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json({ error: 'File must be under 5MB' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const path = `${id.member.id}/avatar-${Date.now()}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Make sure the bucket exists FIRST. createBucket is idempotent enough for
  // our needs and avoids the "upload then fall back to create" dance that
  // sometimes hangs when the underlying storage table is in a weird state.
  try {
    const created = await supabaseAdmin.storage.createBucket(AVATAR_BUCKET, {
      public: true,
      fileSizeLimit: AVATAR_MAX_BYTES,
    });
    if (created.error && !/already exists/i.test(created.error.message ?? '')) {
      console.warn('[admin-avatar] createBucket warning:', created.error);
    }
  } catch (e) {
    console.warn('[admin-avatar] createBucket threw (continuing):', e);
  }

  const upload = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (upload.error) {
    console.error('[admin-avatar] upload failed:', upload.error);
    return NextResponse.json({
      error: `Image upload failed: ${upload.error.message}. Make sure the 'admin-avatars' Supabase Storage bucket exists and is public.`,
    }, { status: 500 });
  }

  const { data: urlData } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const { error: dbErr } = await supabaseAdmin
    .from('support_team_members')
    .update({ avatar_url: publicUrl })
    .eq('id', id.member.id);

  if (dbErr) {
    console.error('[admin-avatar] db update failed:', dbErr);
    return NextResponse.json({
      error: `Image uploaded but profile update failed: ${dbErr.message}. ` +
             `Try refreshing the page; if it persists, run "NOTIFY pgrst, 'reload schema'" in Supabase SQL editor.`,
    }, { status: 500 });
  }

  return NextResponse.json({ url: publicUrl });
}
