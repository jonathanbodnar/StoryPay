/**
 * POST /api/admin/backfill-venue-knowledge
 *
 * Retroactively generates the AI Concierge venue knowledge base for every
 * published venue that doesn't have it yet (or all of them with ?force=1).
 * Runs sequentially to be gentle on the LLM API; processes up to `limit`
 * venues per call (default 25) and reports how many remain, so you can call it
 * repeatedly until remaining = 0.
 *
 * GET returns a dry-run count.
 *
 * Mirrors /api/admin/backfill-venue-seo (same auth + batching pattern).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateVenueKnowledge } from '@/lib/ai-concierge/venue-knowledge';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function isAdmin(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || !!id.member;
}

async function pendingVenueIds(force: boolean): Promise<string[]> {
  let q = supabaseAdmin
    .from('venues')
    .select('id')
    .eq('is_published', true)
    .neq('is_demo', true)
    .not('slug', 'is', null);
  if (!force) q = q.is('ai_venue_knowledge_generated_at', null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

export async function GET(): Promise<NextResponse> {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const pending = await pendingVenueIds(false);
    return NextResponse.json({
      pending: pending.length,
      note: 'POST to generate (25 per call by default; pass ?limit=N or ?force=1).',
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const force = req.nextUrl.searchParams.get('force') === '1';
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 25, 100);

  let ids: string[];
  try {
    ids = await pendingVenueIds(force);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const batch = ids.slice(0, limit);
  let generated = 0;
  const errors: string[] = [];

  for (const id of batch) {
    const res = await generateVenueKnowledge(id);
    if (res.ok) generated++;
    else errors.push(`${id}: ${res.error}`);
    // Missing columns means migration 182 hasn't run — stop immediately.
    if (res.error === 'knowledge_columns_missing') break;
  }

  return NextResponse.json({
    ok: true,
    generated,
    remaining: ids.length - generated,
    errors: errors.slice(0, 10),
  });
}
