import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase';
import { HELP_CATEGORIES } from '@/lib/help-articles';

// One-time route to generate and store OpenAI embeddings for every help article.
// Admin-only: requires either:
//   - admin session cookie (role=admin in the super-admin panel), OR
//   - Authorization: Bearer <ADMIN_SECRET> header (for CI / server-side seeding)
// NOT available to venue users — each call burns hundreds of OpenAI tokens.

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const authHeader  = request.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const adminSecret = process.env.ADMIN_SECRET;

  // Accept the admin bearer token OR the admin session cookie.
  const isBearerAdmin = !!(adminSecret && bearerToken === adminSecret);
  const isSessionAdmin = cookieStore.get('admin_session')?.value === '1';

  if (!isBearerAdmin && !isSessionAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
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

    // Use SECURITY DEFINER RPC to bypass PostgREST schema cache
    for (let j = 0; j < batch.length; j++) {
      const { error } = await supabaseAdmin.rpc('upsert_help_embedding', {
        p_article_id: batch[j].id,
        p_embedding:  embeddingRes.data[j].embedding,
        p_updated_at: new Date().toISOString(),
      });
      results.push({ id: batch[j].id, status: error ? 'error' : 'ok', error: error?.message });
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
