import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { normaliseHelpQuery } from '@/lib/help-search';

export async function POST(request: NextRequest) {
  // Require venue session
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  const { query } = await request.json();
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  const normalised = normaliseHelpQuery(query.trim());

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Embed the search query using the same model used to embed articles
    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: normalised,
    });

    const queryVector = embeddingRes.data[0].embedding;

    // Cosine similarity search via pgvector RPC
    const { data, error } = await supabaseAdmin.rpc('match_help_articles', {
      query_embedding: queryVector,
      match_count: 6,
      match_threshold: 0.25,
    });

    if (error) {
      console.error('[help/search] rpc error:', error);
      return NextResponse.json({ results: [], error: error.message }, { status: 500 });
    }

    // Returns [{article_id, similarity}] sorted best first
    const results = (data ?? []) as { article_id: string; similarity: number }[];
    return NextResponse.json({ results, normalisedQuery: normalised });

  } catch (err) {
    console.error('[help/search] error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
