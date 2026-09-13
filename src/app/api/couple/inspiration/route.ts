import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';
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
  const gate = await resolveCoupleWeddingContext(request, { requireLinked: true });
  if (!gate.ok) return gate.res;
  const link = gate.ctx.wedding;
  return NextResponse.json({ inspiration: await loadInspiration(link.id) });
}

/** PUT — replace the board. Optimistic concurrency via `inspiration.rev`. */
export async function PUT(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { write: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const link = gate.ctx.wedding;

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
