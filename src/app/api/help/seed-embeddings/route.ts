import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { HELP_CATEGORIES } from '@/lib/help-articles';

// One-time route to generate and store OpenAI embeddings for every help article.
// Accepts either:
//   - a valid venue_id session cookie (normal logged-in user), OR
//   - an Authorization: Bearer <ADMIN_SECRET> header (for server-side seeding)

export async function POST(request: NextRequest) {
  // Auth: cookie session OR admin bearer token
  const cookieStore = await cookies();
  const venueId     = cookieStore.get('venue_id')?.value;
  const authHeader  = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const adminSecret = process.env.ADMIN_SECRET;

  const isAdmin  = adminSecret && bearerToken === adminSecret;
  const isVenue  = !!venueId;

  if (!isAdmin && !isVenue) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
