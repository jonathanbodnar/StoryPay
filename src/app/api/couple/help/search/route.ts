import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { normaliseHelpQuery } from '@/lib/help-search';

/**
 * Semantic search over the COUPLE help articles (Wedding Planner side).
 *
 * Mirror of /api/help/search but scoped to the `couple` corpus, so a bride can
 * never be served venue-owner articles (billing, plans, marketing tooling) and
 * vice versa.
 *
 * Auth is the couple's own session (bearer JWT), deliberately NOT the wedding
 * context helper: a couple must be able to read help before they have connected
 * to a venue, and help content is not wedding data.
 *
 * POST { query } → { results: [{ article_id, similarity }], normalisedQuery }
 * Same response shape as the venue route so one client component serves both.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  let query: unknown;
  try {
    ({ query } = (await request.json()) as { query?: unknown });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof query !== 'string' || query.trim().length < 2) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  const normalised = normaliseHelpQuery(query.trim());

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: normalised,
    });

    const { data, error } = await supabaseAdmin.rpc('match_help_articles_v2', {
      query_embedding: embeddingRes.data[0].embedding,
      p_corpus: 'couple',
      match_count: 6,
      match_threshold: 0.25,
    });

    if (error) {
      console.error('[couple/help/search] rpc error:', error);
      // Non-fatal: the client falls back to its own keyword matching.
      return NextResponse.json({ results: [], error: error.message }, { status: 500 });
    }

    const results = (data ?? []) as { article_id: string; similarity: number }[];
    return NextResponse.json({ results, normalisedQuery: normalised });
  } catch (err) {
    console.error('[couple/help/search] error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
