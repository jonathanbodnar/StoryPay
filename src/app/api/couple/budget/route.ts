import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';
import { sanitizeBudget, type WeddingBudget } from '@/lib/wedding-budget';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Budget is OWNER-PRIVATE. There is deliberately no venue counterpart to this
 * route, and no venue-facing endpoint selects couple_weddings.budget, so the
 * venue never sees it. Wedding Planner collaborators (view OR edit) are also
 * locked out here via `ownerOnly` — budget stays private to the owning couple.
 */

async function loadBudget(weddingId: string): Promise<WeddingBudget> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('budget')
    .eq('id', weddingId)
    .maybeSingle();
  return sanitizeBudget((data as { budget?: unknown } | null)?.budget);
}

/** GET — the couple's private budget for her linked wedding. Owner only. */
export async function GET(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const link = gate.ctx.wedding;
  return NextResponse.json({ budget: await loadBudget(link.id) });
}

/** PUT — replace the budget. Owner only. Optimistic concurrency via `budget.rev`. */
export async function PUT(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { ownerOnly: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const link = gate.ctx.wedding;

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
