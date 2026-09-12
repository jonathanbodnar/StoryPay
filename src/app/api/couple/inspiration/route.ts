import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import { sanitizeInspiration, type WeddingInspiration } from '@/lib/wedding-inspiration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadInspiration(weddingId: string): Promise<WeddingInspiration> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('inspiration')
    .eq('id', weddingId)
    .maybeSingle();
  return sanitizeInspiration((data as { inspiration?: unknown } | null)?.inspiration);
}

/** GET — the couple's inspiration board for her linked wedding. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }
  return NextResponse.json({ inspiration: await loadInspiration(link.id) });
}

/** PUT — replace the board. Optimistic concurrency via `inspiration.rev`. */
export async function PUT(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let body: { inspiration?: unknown };
  try {
    body = (await request.json()) as { inspiration?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeInspiration(body.inspiration);
  const current = await loadInspiration(link.id);

  // Someone else (the venue) saved since this client last loaded — reject so the
  // client reloads instead of silently clobbering their work.
  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', inspiration: current }, { status: 409 });
  }

  const next: WeddingInspiration = { rev: current.rev + 1, items: incoming.items };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ inspiration: next })
    .eq('id', link.id);
  if (error) {
    console.error('[couple/inspiration PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inspiration: next });
}
