import { NextRequest, NextResponse } from 'next/server';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { stripEmDashes } from '@/lib/ai-text-cleanup';
import { checkAiRateLimit, capInputLength } from '@/lib/ai-rate-limit';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// Hard cap: refine-text input. 3 000 chars ≈ 750 tokens — enough for any
// real venue copy block; rejects prompt-stuffing attempts.
const MAX_INPUT_CHARS = 3_000;

export async function POST(req: NextRequest) {
  const deepseek = getDeepSeekClient();
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limited = checkAiRateLimit(req, venueId, 'refine-text');
  if (limited) return limited;

  const { text: rawText, variation = 0 } = await req.json() as { text: string; variation?: number };
  const text = capInputLength(rawText, MAX_INPUT_CHARS);
  if (!text.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });

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
    temperature: 0.65 + Math.min(variation, 5) * 0.12,
    max_tokens: 600,
  });

  const refined = stripEmDashes(completion.choices[0]?.message?.content?.trim() ?? text);
  return NextResponse.json({ refined });
}
