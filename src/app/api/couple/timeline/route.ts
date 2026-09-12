import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import { sanitizeTimeline, type WeddingTimeline } from '@/lib/wedding-timeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadTimeline(weddingId: string): Promise<WeddingTimeline> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('timeline')
    .eq('id', weddingId)
    .maybeSingle();
  return sanitizeTimeline((data as { timeline?: unknown } | null)?.timeline);
}

/** GET — the couple's day-of timeline for her linked wedding. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }
  return NextResponse.json({ timeline: await loadTimeline(link.id) });
}

/** PUT — replace the timeline. Optimistic concurrency via `timeline.rev`. */
export async function PUT(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let body: { timeline?: unknown };
  try {
    body = (await request.json()) as { timeline?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeTimeline(body.timeline);
  const current = await loadTimeline(link.id);

  // Someone else (the venue) saved since this client last loaded — reject so the
  // client reloads instead of silently clobbering their work.
  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', timeline: current }, { status: 409 });
  }

  const next: WeddingTimeline = { rev: current.rev + 1, events: incoming.events };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ timeline: next })
    .eq('id', link.id);
  if (error) {
    console.error('[couple/timeline PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, timeline: next });
}
