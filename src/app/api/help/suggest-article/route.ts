import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'AI not configured.' }, { status: 503 });
  }

  const { conversation } = await request.json() as {
    conversation: { role: string; content: string }[];
  };

  if (!Array.isArray(conversation) || conversation.length < 2) {
    return NextResponse.json({ error: 'conversation required' }, { status: 400 });
  }

  const question = conversation.find(m => m.role === 'user')?.content || '';
  const convoText = conversation
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n\n');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a technical writer for StoryPay, a wedding venue management platform.
Your job is to draft a concise help article from a real user conversation.

Rules:
- Title: clear, specific, action-oriented (e.g. "How to refund a customer payment")
- Body: plain text, no markdown, use "- " for bullet points and "1. " for numbered steps
- Length: 150–300 words
- Tone: friendly, direct, platform-specific
- Base the content on the AI's responses in the conversation, not the user's question

Respond with valid JSON only:
{"title": "...", "body": "..."}`,
        },
        {
          role: 'user',
          content: `Draft a help article from this conversation:\n\n${convoText}`,
        },
      ],
      max_tokens: 600,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const { title, body } = JSON.parse(raw) as { title?: string; body?: string };

    if (!title || !body) {
      return NextResponse.json({ error: 'AI did not return a valid article.' }, { status: 500 });
    }

    const { error: dbErr } = await supabaseAdmin
      .from('suggested_articles')
      .insert({ title, body, source_question: question, venue_id: venueId, status: 'draft' });

    if (dbErr) {
      console.error('[suggest-article] db error:', dbErr);
      return NextResponse.json({ error: 'Failed to save article draft.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, title });
  } catch (err) {
    console.error('[suggest-article] error:', err);
    return NextResponse.json({ error: 'Failed to generate article.' }, { status: 500 });
  }
}
