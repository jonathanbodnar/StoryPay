import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';
import { sanitizeVendors, type WeddingVendors } from '@/lib/wedding-vendors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadVendors(weddingId: string): Promise<WeddingVendors> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('vendors')
    .eq('id', weddingId)
    .maybeSingle();
  return sanitizeVendors((data as { vendors?: unknown } | null)?.vendors);
}

/** GET — the couple's vendor directory for her linked wedding. */
export async function GET(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { requireLinked: true });
  if (!gate.ok) return gate.res;
  const link = gate.ctx.wedding;
  return NextResponse.json({ vendors: await loadVendors(link.id) });
}

/** PUT — replace the vendor directory. Optimistic concurrency via `vendors.rev`. */
export async function PUT(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { write: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const link = gate.ctx.wedding;

  let body: { vendors?: unknown };
  try {
    body = (await request.json()) as { vendors?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeVendors(body.vendors);
  const current = await loadVendors(link.id);

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', vendors: current }, { status: 409 });
  }

  const next: WeddingVendors = { rev: current.rev + 1, items: incoming.items };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ vendors: next })
    .eq('id', link.id);
  if (error) {
    console.error('[couple/vendors PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, vendors: next });
}
