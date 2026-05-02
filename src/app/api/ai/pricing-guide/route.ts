import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/ai/pricing-guide
 *
 * Body:
 *   {
 *     section: keyof typeof SECTION_PROMPTS,
 *     mode:   'generate' | 'rewrite' | 'variation',
 *     draft?: string,                   // current text the owner has typed
 *     variation?: number,               // 0,1,2…  bumps temperature
 *     extras?: Record<string, unknown>, // e.g. package name, space capacity
 *   }
 *
 * Always returns formal, outcome-oriented, conversion-focused copy with
 * perfect grammar and no em-dashes. Pulls a tiny venue context (name,
 * location, type) so the generated copy feels specific to this venue.
 */

type Mode = 'generate' | 'rewrite' | 'variation';

interface Body {
  section: string;
  mode: Mode;
  draft?: string;
  variation?: number;
  extras?: Record<string, unknown>;
}

// ── Section-specific creative briefs ───────────────────────────────────────
//
// Each entry is a short user-facing brief that gets appended to the global
// system prompt so the model knows what kind of paragraph to produce.
const SECTION_PROMPTS: Record<string, { label: string; brief: string; maxTokens: number }> = {
  congratulatory_message: {
    label: 'Welcome / congratulations message',
    brief:
      'Write a warm, formal congratulatory paragraph addressed to a newly engaged couple who is considering this venue. ' +
      'Acknowledge their engagement, thank them for considering the venue, and frame this guide as the easiest way to picture their wedding day here. ' +
      'Two to four sentences. Keep it inviting, never pushy.',
    maxTokens: 260,
  },
  about_venue: {
    label: 'About the venue',
    brief:
      'Write an evocative "About the venue" paragraph designed to make a couple emotionally picture their wedding here. ' +
      'Lead with the unique character of the property, follow with the experience it creates for guests, and end with a sentence that hints at the kind of celebration it makes possible. ' +
      'Three to five sentences. Confident, warm, and concrete — name specific features rather than generic adjectives.',
    maxTokens: 380,
  },
  accommodations: {
    label: 'Accommodations',
    brief:
      'Write an "Accommodations" paragraph that explains where the wedding party and guests can stay (on-site lodging, partner hotels, room counts, getting-ready suites, etc). ' +
      'Frame it around guest experience and convenience — the outcome being that everyone wakes up close, relaxed, and on time. ' +
      'Two to four sentences.',
    maxTokens: 320,
  },
  pricing_intro: {
    label: 'Pricing intro',
    brief:
      'Write a confident, transparent "Pricing & packages" intro paragraph that frames the upcoming package list. ' +
      'Reassure the couple that the pricing is straightforward, that packages can be tailored, and that the team is here to help them choose what fits. ' +
      'Two to three sentences. Never apologize for the price; frame it as investment in a memorable celebration.',
    maxTokens: 260,
  },
  package_description: {
    label: 'Package description',
    brief:
      'Write a one-paragraph description of a wedding package. Open with the kind of celebration it creates (the outcome), then list the experience the couple and guests will have. ' +
      'Two to three sentences. Confident and concrete; do NOT restate the package name or price.',
    maxTokens: 220,
  },
  package_included_items: {
    label: 'Package included items',
    brief:
      'Produce a clean bullet list (newline separated, NO markdown, NO leading dashes or numbers) of 5 to 9 high-value items included in this wedding package. ' +
      'Each item should be specific, concrete, and benefit-oriented. ' +
      'Examples: "Ten hours of exclusive venue access", "On-site wedding day coordinator", "Complimentary one-hour rehearsal the day prior".',
    maxTokens: 260,
  },
  space_description: {
    label: 'Space description',
    brief:
      'Write a one-paragraph description of a single ceremony or reception space. Lead with the feeling it creates, then describe what the space is best for and how it accommodates guests. ' +
      'Two to three sentences. Vivid but formal.',
    maxTokens: 220,
  },
  availability_text: {
    label: 'Availability',
    brief:
      'Write a short, confident paragraph about availability. Encourage early reservation without sounding pushy, mention that prime dates fill quickly, and invite the couple to reach out for current open dates. ' +
      'Two to three sentences.',
    maxTokens: 240,
  },
  cta_headline: {
    label: 'Call-to-action headline',
    brief:
      'Write a single, short call-to-action headline (4 to 9 words) that invites the couple to book a tour or save their date. ' +
      'No punctuation at the end except a question mark if it is naturally a question. ' +
      'Return ONLY the headline.',
    maxTokens: 60,
  },
  cta_body: {
    label: 'Call-to-action body',
    brief:
      'Write a 2-sentence call-to-action body that follows a "save the date / book a tour" headline. ' +
      'Make the next step feel low-friction and inviting. End by telling them how to reach the venue (phone, email, or "tap the button below" works).',
    maxTokens: 200,
  },
  review_polish: {
    label: 'Polish review',
    brief:
      'Lightly polish the provided couple review for grammar, clarity, and flow without changing its meaning, voice, or tone. ' +
      'Keep it the same approximate length and never invent new claims. Return ONLY the polished text.',
    maxTokens: 360,
  },
};

// ── Global system prompt ───────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = [
  'You are a senior wedding-industry copywriter writing for a wedding venue\'s "Pricing & Availability Guide" — a polished lead magnet sent to engaged couples after they request information.',
  '',
  'NON-NEGOTIABLE STYLE RULES:',
  '• Voice is formal, warm, and confident — never casual, never salesy, never breathless.',
  '• Language is OUTCOME-BASED: describe the experience, the feeling, and the wedding day the couple will have, not the features in isolation.',
  '• Grammar and spelling must be perfect. American English.',
  '• Never use em dashes (—) or en dashes (–). Replace with commas, periods, or "and".',
  '• Never invent specific facts that are not in the venue context (no fake awards, history, capacity numbers, prices, or quotes).',
  '• Never address the reader as "you guys" or use the word "stunning". Avoid clichés like "tying the knot", "your big day", and "happily ever after".',
  '• Use present tense and active voice. Vary sentence length for rhythm.',
  '',
  'OUTPUT RULES:',
  '• Return ONLY the requested copy with no preamble, no quotes, no commentary, no markdown headings.',
].join('\n');

async function getVenueContext(): Promise<string> {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return '';

  const { data } = await supabaseAdmin
    .from('venues')
    .select(
      'name, venue_type, location_city, location_state, capacity_min, capacity_max, indoor_outdoor, features',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (!data) return '';

  const lines: string[] = ['VENUE CONTEXT:'];
  if (data.name) lines.push(`• Name: ${data.name}`);
  if (data.venue_type) lines.push(`• Venue type: ${data.venue_type}`);
  if (data.location_city || data.location_state) {
    lines.push(`• Location: ${[data.location_city, data.location_state].filter(Boolean).join(', ')}`);
  }
  if (data.capacity_min || data.capacity_max) {
    lines.push(
      `• Capacity: ${data.capacity_min ?? '—'}${
        data.capacity_max ? ` to ${data.capacity_max}` : '+'
      } guests`,
    );
  }
  if (data.indoor_outdoor) lines.push(`• Setting: ${data.indoor_outdoor}`);
  if (Array.isArray(data.features) && data.features.length > 0) {
    lines.push(`• Notable features: ${data.features.slice(0, 12).join(', ')}`);
  }
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  const c = await cookies();
  if (!c.get('venue_id')?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { section, mode, draft = '', variation = 0, extras = {} } = body;
  const promptDef = SECTION_PROMPTS[section];
  if (!promptDef) {
    return NextResponse.json({ error: `Unknown section: ${section}` }, { status: 400 });
  }

  const venueContext = await getVenueContext();

  // Build the per-call user message based on mode
  let userMessage: string;

  const extrasBlock =
    Object.keys(extras).length > 0
      ? `\n\nADDITIONAL CONTEXT FOR THIS SECTION:\n${Object.entries(extras)
          .filter(([, v]) => v !== '' && v !== null && v !== undefined)
          .map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${v}`)
          .join('\n')}`
      : '';

  if (mode === 'rewrite' && draft.trim()) {
    userMessage = [
      `TASK: Rewrite the following draft for the "${promptDef.label}" section of the guide.`,
      'Improve clarity, flow, and grammar. Make it more outcome-based and high-converting while preserving the owner\'s intent and key facts.',
      promptDef.brief,
      venueContext,
      extrasBlock,
      '',
      'DRAFT:',
      draft.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');
  } else if (mode === 'variation' && draft.trim()) {
    userMessage = [
      `TASK: Produce variation #${variation + 1} of the "${promptDef.label}" section.`,
      'Use noticeably different phrasing, sentence structure, and angle than the previous draft, while keeping the same intent and meaning. Same approximate length.',
      promptDef.brief,
      venueContext,
      extrasBlock,
      '',
      'PREVIOUS DRAFT:',
      draft.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');
  } else {
    // generate from scratch (or no draft yet)
    userMessage = [
      `TASK: Write the "${promptDef.label}" section of the guide from scratch.`,
      promptDef.brief,
      venueContext,
      extrasBlock,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // Bump temperature for variations to push the model away from its first answer
  const baseTemp = mode === 'rewrite' ? 0.55 : 0.7;
  const temperature = Math.min(0.95, baseTemp + variation * 0.1);

  try {
    const deepseek = getDeepSeekClient();
    const completion = await deepseek.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: BASE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature,
      max_tokens: promptDef.maxTokens,
    });

    let text = completion.choices[0]?.message?.content?.trim() ?? '';

    // Defensive cleanups: strip surrounding quotes, em/en dashes, leading bullets
    text = text.replace(/^["'""]+|["'""]+$/g, '').trim();
    text = text.replace(/[—–]/g, ', ');

    if (section === 'package_included_items') {
      // Normalize bullet list into a clean newline-separated list
      text = text
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-•*\d+.)\s]+/, '').trim())
        .filter(Boolean)
        .join('\n');
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error('[ai/pricing-guide]', err);
    const message = err instanceof Error ? err.message : 'AI request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
