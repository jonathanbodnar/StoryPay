import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import OpenAI from 'openai';
import { getArticleById } from '@/lib/help-articles';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  const { article_id, rating } = await request.json() as {
    article_id: string;
    rating: 'up' | 'down';
  };

  if (!article_id || !['up', 'down'].includes(rating)) {
    return NextResponse.json({ error: 'article_id and rating (up|down) required' }, { status: 400 });
  }

  const { error: insertErr } = await supabaseAdmin
    .from('article_ratings')
    .insert({ article_id, rating, venue_id: venueId || null });

  if (insertErr) {
    console.error('[rate-article] insert error:', insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Check if this article has crossed the threshold for an AI rewrite (2+ thumbs-down)
  if (rating === 'down' && process.env.OPENAI_API_KEY) {
    const { count } = await supabaseAdmin
      .from('article_ratings')
      .select('*', { count: 'exact', head: true })
      .eq('article_id', article_id)
      .eq('rating', 'down');

    if ((count ?? 0) >= 2) {
      // Check if we already have a pending rewrite draft for this article
      const { data: existing } = await supabaseAdmin
        .from('suggested_articles')
        .select('id')
        .eq('source_question', `rewrite:${article_id}`)
        .eq('status', 'draft')
        .maybeSingle();

      if (!existing) {
        const article = getArticleById(article_id);
        if (article) {
          // Fire-and-forget rewrite
          rewriteArticle(article_id, article.title, article.body).catch(console.error);
        }
      }
    }
  }

  return NextResponse.json({ success: true });
}

async function rewriteArticle(articleId: string, title: string, body: string) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a technical writer for StoryPay, a wedding venue management platform.
Rewrite the following help article to be clearer and more helpful.
Rules:
- Keep the same topic but improve clarity, structure, and completeness
- Plain text only, no markdown. Use "- " for bullets and "1. " for numbered steps
- 150–350 words
- Friendly, action-oriented tone
Respond with valid JSON only: {"title": "...", "body": "..."}`,
      },
      {
        role: 'user',
        content: `Rewrite this article:\n\nTitle: ${title}\n\n${body}`,
      },
    ],
    max_tokens: 700,
    temperature: 0.4,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const { title: newTitle, body: newBody } = JSON.parse(raw) as { title?: string; body?: string };
  if (!newTitle || !newBody) return;

  await supabaseAdmin.from('suggested_articles').insert({
    title: newTitle,
    body: newBody,
    source_question: `rewrite:${articleId}`,
    status: 'draft',
  });
}
