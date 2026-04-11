import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { HELP_CATEGORIES } from '@/lib/help-articles';

// One-time route (or re-run whenever articles change) to generate and store
// OpenAI embeddings for every help article.
// Only callable by an authenticated venue session (no admin secret needed since
// embeddings are not sensitive — it just prevents public abuse of the endpoint).

export async function POST() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Build the text we embed per article: title + tags + body (trimmed to ~500 chars)
  const articles = HELP_CATEGORIES.flatMap(c =>
    c.articles.map(a => ({
      id: a.id,
      text: `${a.title}. ${a.tags.join(', ')}. ${a.body.slice(0, 500)}`,
    }))
  );

  const results: { id: string; status: 'ok' | 'error'; error?: string }[] = [];

  // Embed in batches of 8 to avoid rate limit bursts
  const BATCH = 8;
  for (let i = 0; i < articles.length; i += BATCH) {
    const batch = articles.slice(i, i + BATCH);

    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch.map(a => a.text),
    });

    const upserts = batch.map((a, j) => ({
      article_id: a.id,
      embedding:  embeddingRes.data[j].embedding,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from('help_article_embeddings')
      .upsert(upserts, { onConflict: 'article_id' });

    for (const a of batch) {
      results.push({ id: a.id, status: error ? 'error' : 'ok', error: error?.message });
    }

    // Small pause between batches
    if (i + BATCH < articles.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const ok  = results.filter(r => r.status === 'ok').length;
  const err = results.filter(r => r.status === 'error').length;

  return NextResponse.json({ seeded: ok, errors: err, results });
}
