import { NextRequest, NextResponse } from 'next/server';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { isCoupleSlugTaken, normalizeCoupleSlug } from '@/lib/couple-sites';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/couple/site/slug-check?slug=jenny-and-mike — live availability. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = new URL(request.url).searchParams.get('slug') ?? '';
  const slug = normalizeCoupleSlug(raw);
  if (!slug) {
    return NextResponse.json({ ok: false, slug: null, available: false, reason: 'invalid' });
  }
  const taken = await isCoupleSlugTaken(slug, user.id);
  return NextResponse.json({ ok: true, slug, available: !taken, reason: taken ? 'taken' : 'ok' });
}
