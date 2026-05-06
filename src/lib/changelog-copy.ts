import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { stripEmDashes } from '@/lib/ai-text-cleanup';

export type ChangelogCopy = {
  title: string;
  description: string;
  category: 'feature' | 'improvement' | 'fix';
};

type GenerateInput = {
  requestTitle: string;
  requestDescription: string | null | undefined;
  category?: 'feature' | 'improvement' | 'fix';
};

/**
 * Produces a clean, outcome-framed changelog heading and description from a
 * feature-request title + description. Falls back to a deterministic template
 * if OpenAI is unavailable so approvals never fail.
 *
 * The writing rules are intentionally tight:
 *   - headline: short, plain English, describes the capability
 *   - description: outcome-first, 1–3 sentences, explains what the venue
 *     owner can do now and why it matters to their workflow
 */
export async function generateChangelogCopy(input: GenerateInput): Promise<ChangelogCopy> {
  const category = input.category ?? inferCategory(input.requestTitle, input.requestDescription);
  const fallback = buildFallbackCopy(input, category);

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return fallback;

  try {
    const deepseek = getDeepSeekClient();
    const prompt = buildPrompt(input, category);
    const completion = await deepseek.chat.completions.create({
      model: DEEPSEEK_MODEL,
      temperature: 0.4,
      max_tokens: 280,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are the product marketing writer for StoryVenue, a SaaS for wedding venues. ' +
            'You turn shipped feature-requests into changelog entries. Always respond with strict JSON. ' +
            'NEVER use em dashes (—) or en dashes (–). Use commas, periods, or new sentences instead.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = safeParse(raw);
    const title = stripEmDashes(sanitizeLine(parsed.title, 80)) || fallback.title;
    const description = stripEmDashes(sanitizeParagraph(parsed.description, 400)) || fallback.description;
    return { title, description, category };
  } catch (err) {
    console.warn('[changelog-copy] DeepSeek fallback:', err);
    return fallback;
  }
}

function buildPrompt(input: GenerateInput, category: ChangelogCopy['category']): string {
  const desc = (input.requestDescription ?? '').trim();
  return [
    'Write an outcome-based changelog entry for the feature-request below.',
    '',
    `Category: ${category} (feature | improvement | fix)`,
    `Request title: ${input.requestTitle}`,
    desc ? `Request details: ${desc}` : 'Request details: (none provided)',
    '',
    'Requirements:',
    '- "title": a short, plain-English heading that names the capability.',
    '  Avoid words like "Add", "Implement", "Build", "Completed". Max ~8 words.',
    '- "description": 1–3 sentences written FROM the venue owner\'s perspective.',
    '  Lead with what they can do now, then state the business outcome — saved',
    '  time, fewer mistakes, more bookings, faster follow-up, clearer numbers, etc.',
    '- No internal jargon, no ticket numbers, no emojis, no markdown.',
    '- Respond as strict JSON: {"title": "...", "description": "..."}',
  ].join('\n');
}

function safeParse(raw: string): { title?: string; description?: string } {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj as { title?: string; description?: string };
  } catch {
    // fallthrough — try to rescue a {...} block
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]) as { title?: string; description?: string }; } catch { /* ignore */ }
  }
  return {};
}

function sanitizeLine(s: unknown, max: number): string {
  const t = typeof s === 'string' ? s.trim().replace(/^["']|["']$/g, '') : '';
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function sanitizeParagraph(s: unknown, max: number): string {
  const t = typeof s === 'string' ? s.trim() : '';
  if (!t) return '';
  const cleaned = t.replace(/\s+/g, ' ');
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

function inferCategory(title: string, desc?: string | null): ChangelogCopy['category'] {
  const hay = `${title} ${desc ?? ''}`.toLowerCase();
  if (/\b(bug|crash|error|broken|fix|regression|hotfix)\b/.test(hay)) return 'fix';
  if (/\b(faster|speed|improve|polish|refine|cleanup|optimi[sz]e|simplif|streamline)\b/.test(hay)) return 'improvement';
  return 'feature';
}

/**
 * Fallback that never fails: derives a clean heading by stripping leading
 * imperative verbs, and writes a conservative outcome-based paragraph.
 */
function buildFallbackCopy(input: GenerateInput, category: ChangelogCopy['category']): ChangelogCopy {
  const rawTitle = (input.requestTitle ?? '').trim();
  const desc = (input.requestDescription ?? '').trim();

  const cleaned = rawTitle
    .replace(/^\s*(please\s+)?(add|implement|build|create|support|enable|make|give\s+me|we\s+need|can\s+we)\b[:,\s]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const titleCore = cleaned || rawTitle || 'Update shipped';
  const title = titleCore.charAt(0).toUpperCase() + titleCore.slice(1);

  const what = desc || `${titleCore} is now available in your dashboard.`;
  const outcome =
    category === 'fix'
      ? 'You will spend less time troubleshooting and more time running your venue.'
      : category === 'improvement'
        ? 'Your day-to-day workflow is faster and more reliable, so you can focus on booking and serving couples.'
        : 'You can move work forward faster with less manual effort — more time for the conversations that win bookings.';

  const description = sanitizeParagraph(`${what} ${outcome}`, 400);
  return { title, description, category };
}
