import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import { sanitizeLayout, type WeddingLayout } from '@/lib/wedding-layout';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadLayout(weddingId: string): Promise<WeddingLayout> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('layout')
    .eq('id', weddingId)
    .maybeSingle();
  return sanitizeLayout((data as { layout?: unknown } | null)?.layout);
}

/** GET — the bride's room layout for her linked wedding. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }
  return NextResponse.json({ layout: await loadLayout(link.id) });
}

/** PUT — replace the layout. Optimistic concurrency via `layout.rev`. */
export async function PUT(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let body: { layout?: unknown };
  try {
    body = (await request.json()) as { layout?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeLayout(body.layout);
  const current = await loadLayout(link.id);

  // Someone else (the venue) saved since this client last loaded — reject so the
  // client reloads instead of silently clobbering their work.
  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', layout: current }, { status: 409 });
  }

  const next: WeddingLayout = { rev: current.rev + 1, elements: incoming.elements };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ layout: next })
    .eq('id', link.id);
  if (error) {
    console.error('[couple/layout PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, layout: next });
}
