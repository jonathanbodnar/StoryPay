import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import { sanitizeChecklist, type WeddingChecklist } from '@/lib/wedding-checklist';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadChecklist(weddingId: string): Promise<WeddingChecklist> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('checklist')
    .eq('id', weddingId)
    .maybeSingle();
  return sanitizeChecklist((data as { checklist?: unknown } | null)?.checklist);
}

/** GET — the couple's planning checklist for her linked wedding. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }
  return NextResponse.json({ checklist: await loadChecklist(link.id) });
}

/** PUT — replace the checklist. Optimistic concurrency via `checklist.rev`. */
export async function PUT(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let body: { checklist?: unknown };
  try {
    body = (await request.json()) as { checklist?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeChecklist(body.checklist);
  const current = await loadChecklist(link.id);

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', checklist: current }, { status: 409 });
  }

  const next: WeddingChecklist = { rev: current.rev + 1, items: incoming.items };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ checklist: next })
    .eq('id', link.id);
  if (error) {
    console.error('[couple/checklist PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, checklist: next });
}
