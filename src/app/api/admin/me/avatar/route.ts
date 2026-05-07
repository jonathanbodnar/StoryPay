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

  const upload = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (upload.error) {
    // Auto-create the bucket if it doesn't exist yet.
    const msg = upload.error.message ?? '';
    if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('Bucket')) {
      const created = await supabaseAdmin.storage.createBucket(AVATAR_BUCKET, {
        public: true,
        fileSizeLimit: AVATAR_MAX_BYTES,
      });
      if (created.error && !created.error.message?.includes('already exists')) {
        console.error('[admin-avatar] bucket create failed:', created.error);
        return NextResponse.json({ error: 'Storage not available' }, { status: 500 });
      }
      const retry = await supabaseAdmin.storage
        .from(AVATAR_BUCKET)
        .upload(path, buffer, { contentType: file.type, upsert: true });
      if (retry.error) {
        console.error('[admin-avatar] retry upload failed:', retry.error);
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
    } else {
      console.error('[admin-avatar] upload failed:', upload.error);
      return NextResponse.json({ error: upload.error.message }, { status: 500 });
    }
  }

  const { data: urlData } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const { error: dbErr } = await supabaseAdmin
    .from('support_team_members')
    .update({ avatar_url: publicUrl })
    .eq('id', id.member.id);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ url: publicUrl });
}
