/**
 * Bulk-reorder handoff rules.
 *
 *   POST { order: string[] }   — array of rule IDs in their NEW order
 *
 * Re-numbers `position` to 10, 20, 30, … so subsequent inserts can land
 * cleanly between two rules without immediately needing another reorder.
 *
 * Atomic semantics: we issue one UPDATE per rule. If the array contains an
 * unknown ID the update simply matches zero rows (no error). Rules omitted
 * from the array keep their existing position — we only renumber the IDs
 * we received. This means the operator can reorder a subset (the visible
 * filtered slice in the UI) without disturbing the rest.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { clearHandoffRulesCache } from '@/lib/ai-concierge/handoff-rules';

export const dynamic = 'force-dynamic';

interface ReorderBody { order?: string[] }

export async function POST(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: ReorderBody;
  try { body = await request.json() as ReorderBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const ids = body.order;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'order must be a non-empty array of rule IDs' }, { status: 400 });
  }
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'order contains duplicate IDs' }, { status: 400 });
  }

  const now = new Date().toISOString();
  let updated = 0;
  const errors: Array<{ id: string; error: string }> = [];

  await Promise.all(ids.map(async (id, idx) => {
    const newPosition = (idx + 1) * 10;
    const { error, count } = await supabaseAdmin
      .from('handoff_rules')
      .update({ position: newPosition, updated_at: now }, { count: 'exact' })
      .eq('id', id);
    if (error) {
      errors.push({ id, error: error.message });
      return;
    }
    if (count && count > 0) updated += 1;
  }));

  clearHandoffRulesCache();
  return NextResponse.json({ ok: errors.length === 0, updated, errors });
}
