import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import { sanitizeBudget, type WeddingBudget } from '@/lib/wedding-budget';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Budget is COUPLE-PRIVATE. There is deliberately no venue counterpart to this
 * route, and no venue-facing endpoint selects couple_weddings.budget, so the
 * venue never sees it.
 */

async function loadBudget(weddingId: string): Promise<WeddingBudget> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('budget')
    .eq('id', weddingId)
    .maybeSingle();
  return sanitizeBudget((data as { budget?: unknown } | null)?.budget);
}

/** GET — the couple's private budget for her linked wedding. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }
  return NextResponse.json({ budget: await loadBudget(link.id) });
}

/** PUT — replace the budget. Optimistic concurrency via `budget.rev`. */
export async function PUT(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let body: { budget?: unknown };
  try {
    body = (await request.json()) as { budget?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = sanitizeBudget(body.budget);
  const current = await loadBudget(link.id);

  if (incoming.rev !== current.rev) {
    return NextResponse.json({ error: 'stale', budget: current }, { status: 409 });
  }

  const next: WeddingBudget = { rev: current.rev + 1, target: incoming.target, lines: incoming.lines };
  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ budget: next })
    .eq('id', link.id);
  if (error) {
    console.error('[couple/budget PUT]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, budget: next });
}
