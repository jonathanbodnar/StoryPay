import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const c = await cookies();
  if (!c.get('venue_id')?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { text, variation = 0 } = await req.json() as { text: string; variation?: number };
  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });

  const variationHint = variation > 0
    ? ` This is variation #${variation + 1} — use noticeably different phrasing than a typical first attempt.`
    : '';

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a professional copywriter and editor. Rewrite the provided text to be clearer, more polished, and grammatically perfect. Fix any spelling or grammar errors. Never use em dashes (—) or en dashes (–) — replace them with commas or periods. Keep the same meaning, voice, and approximate length.${variationHint} Return ONLY the rewritten text with no explanation, no quotes, no commentary.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.65 + variation * 0.12,
    max_tokens: 600,
  });

  const refined = completion.choices[0]?.message?.content?.trim() ?? text;
  return NextResponse.json({ refined });
}
