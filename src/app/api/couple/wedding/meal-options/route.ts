import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * PUT /api/couple/wedding/meal-options
 * Bride-defined meal choices for her guests. Body: { options: string[] }.
 * Stored on couple_weddings.meal_options — the guest meal picker reads from it.
 */
export async function PUT(request: NextRequest) {
  const gate = await resolveCoupleWeddingContext(request, { write: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const link = gate.ctx.wedding;

  let body: { options?: unknown };
  try {
    body = (await request.json()) as { options?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = Array.isArray(body.options) ? body.options : [];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim().slice(0, 80);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    options.push(t);
    if (options.length >= 12) break;
  }

  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ meal_options: options })
    .eq('id', link.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, options });
}
