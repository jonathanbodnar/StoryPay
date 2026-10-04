/**
 * /api/admin/setup-guide — the Setup Guide's lesson videos (Admin → Setup guide).
 *
 * GET — the saved link for each lesson, plus the ones that ship by default.
 * PUT { videos: { lessonId: url } } — save them. A link has to be a YouTube,
 *     Vimeo, Loom, Wistia or Cloudflare Stream video; an empty value removes
 *     the lesson's video and its placeholder comes back.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { loadSetupGuideVideoLinks, SETUP_GUIDE_VIDEOS_KEY } from '@/lib/setup-guide-server';
import { SETUP_GUIDE_DEFAULT_VIDEOS, SETUP_LESSON_IDS, setupLesson, videoEmbedUrl } from '@/lib/setup-guide';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const saved = await loadSetupGuideVideoLinks();
  const videos: Record<string, string> = {};
  for (const id of SETUP_LESSON_IDS) {
    const raw = id in saved ? saved[id] : SETUP_GUIDE_DEFAULT_VIDEOS[id];
    videos[id] = typeof raw === 'string' ? raw : '';
  }
  return NextResponse.json({ videos });
}

export async function PUT(req: NextRequest) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { videos?: unknown } | null;
  const incoming = body?.videos;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return NextResponse.json({ error: 'Send { videos: { lesson: link } }.' }, { status: 400 });
  }

  const next: Record<string, string> = {};
  for (const id of SETUP_LESSON_IDS) {
    const raw = (incoming as Record<string, unknown>)[id];
    const link = typeof raw === 'string' ? raw.trim() : '';
    if (link && !videoEmbedUrl(link)) {
      return NextResponse.json(
        { error: `“${setupLesson(id)?.title}” needs a YouTube, Vimeo, Loom, Wistia or Cloudflare Stream link.`, lesson: id },
        { status: 400 },
      );
    }
    // Saved even when empty, so clearing a lesson that has a default video sticks.
    next[id] = link;
  }

  const { error } = await supabaseAdmin
    .from('admin_kv_cache')
    .upsert({ key: SETUP_GUIDE_VIDEOS_KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) {
    console.error('[admin/setup-guide] save:', error.message);
    return NextResponse.json({ error: 'Could not save the videos.' }, { status: 500 });
  }
  return NextResponse.json({ videos: next });
}
