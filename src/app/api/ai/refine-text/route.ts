import { NextRequest, NextResponse } from 'next/server';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { stripEmDashes } from '@/lib/ai-text-cleanup';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const deepseek = getDeepSeekClient();
  const c = await cookies();
  if (!c.get('venue_id')?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { text, variation = 0 } = await req.json() as { text: string; variation?: number };
  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });

  const variationHint = variation > 0
    ? ` This is variation #${variation + 1}, use noticeably different phrasing than a typical first attempt.`
    : '';

  const completion = await deepseek.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: `You are a professional copywriter and editor. Rewrite the provided text to be clearer, more polished, and grammatically perfect. Fix any spelling or grammar errors. NEVER use em dashes (—) or en dashes (–). Replace them with commas, periods, or new sentences. Keep the same meaning, voice, and approximate length.${variationHint} Return ONLY the rewritten text with no explanation, no quotes, no commentary.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.65 + variation * 0.12,
    max_tokens: 600,
  });

  const refined = stripEmDashes(completion.choices[0]?.message?.content?.trim() ?? text);
  return NextResponse.json({ refined });
}
