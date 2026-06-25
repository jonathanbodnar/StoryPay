/**
 * POST /api/onboarding/regenerate-field
 *
 * One-tap "give me a new version" for an AI-written field on the Review step.
 * Editing a wall of text is friction; regenerating is delight. Returns fresh
 * copy for a single field without persisting it (the Review step's normal save
 * path writes it when the owner continues), so they can preview before keeping.
 *
 * Body: { field: 'about_venue' | 'congratulatory_message' | 'pricing_intro' | 'availability_text' }
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { cleanCopy } from '@/lib/guide-copy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

type Field = 'about_venue' | 'congratulatory_message' | 'pricing_intro' | 'availability_text';

const FIELD_SPEC: Record<Field, { instruction: string; max: number }> = {
  about_venue: {
    instruction:
      '4 to 5 vivid sentences describing the venue, weaving in the differentiators and why couples love getting married here. Stay between 450 and 650 characters and NEVER exceed 680 characters.',
    max: 680,
  },
  congratulatory_message: {
    instruction:
      '3 to 4 warm sentences congratulating the bride, welcoming her, and previewing what this guide covers. About 300 to 450 characters.',
    max: 480,
  },
  pricing_intro: {
    instruction:
      '2 to 3 reassuring sentences introducing the pricing section, transparent and confident. About 220 to 340 characters.',
    max: 380,
  },
  availability_text: {
    instruction:
      '1 to 2 sentences about availability and seasonality with gentle urgency to book. About 120 to 240 characters.',
    max: 380,
  },
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const field = String(body.field ?? '') as Field;
  if (!FIELD_SPEC[field]) {
    return NextResponse.json({ error: 'Unknown field' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, location_city, location_state, description, features, capacity_max, price_min')
    .eq('id', venueId)
    .maybeSingle();

  const venueName = (venue?.name as string) || 'our venue';
  const loc = [venue?.location_city, venue?.location_state].filter(Boolean).join(', ');
  const features = Array.isArray(venue?.features)
    ? (venue!.features as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];

  const spec = FIELD_SPEC[field];

  // AI path. Falls back to a varied template so the button always returns copy.
  let text = '';
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const client = getDeepSeekClient();
      const prompt = `You are writing one section of a warm wedding-venue "Pricing & Availability Guide" for a bride. Write in second person, friendly and confident, never generic or salesy. Output ONLY valid JSON: { "text": "..." }.

STYLE RULES (follow strictly):
- NEVER use these banned words or any variant: "nestled", "timeless", "magical", "serene", "dream day", "backdrop".
- NEVER use salesy filler like "Let's get started" or any call-to-action sign-off.
- NEVER use em dashes or en dashes. Use a period or comma.
- Short, declarative, outcome-first sentences. No filler.

Venue: ${venueName}${loc ? ` (${loc})` : ''}
Existing description: ${(venue?.description as string) || '(none)'}
Capacity (max): ${venue?.capacity_max ?? '(unknown)'}
Starting price: ${venue?.price_min ?? '(unknown)'}
What makes it special: ${features.length ? features.join(', ') : '(unknown)'}

Write a fresh version of this section, different in wording from a typical first draft: ${spec.instruction}`;

      const res = await client.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.9,
        max_tokens: 400,
      });
      const raw = res.choices[0]?.message?.content ?? '';
      const parsed = JSON.parse(raw) as { text?: string };
      text = typeof parsed.text === 'string' ? parsed.text : '';
    } catch (e) {
      console.warn('[regenerate-field] AI failed, using template', e);
    }
  }

  if (!text.trim()) {
    const feat = features.length ? features.slice(0, 3).join(', ') : 'a beautiful setting and a team that handles the details';
    const templates: Record<Field, string[]> = {
      about_venue: [
        `${venueName} gives you ${feat}, all in one place. Couples choose us because the spaces flow naturally from getting ready to the last dance, and our team knows every corner of this place. You can shape the day around your vision instead of forcing it to fit ours. Come see it in person and we will help you picture the rest.`,
        `At ${venueName}, the setting does a lot of the work for you. With ${feat}, the day moves easily from ceremony to celebration, and our team is hands-on with the details that matter. Whether you want something intimate or a full party, the space flexes to match. Tour it once and you will know.`,
      ],
      congratulatory_message: [
        `Congratulations on your engagement. We would be honored to host your wedding at ${venueName}. This guide walks you through pricing, spaces, and availability so you can picture your day with us. Take your time, and reach out whenever you are ready.`,
        `Congratulations, and welcome. Getting married at ${venueName} should feel exciting, not overwhelming. This guide lays out everything you need to plan with confidence, from pricing to availability. We cannot wait to show you around.`,
      ],
      pricing_intro: [
        `Here is a clear look at our pricing so you can plan with confidence. No hidden fees, no surprises, and we are happy to tailor the details to fit your day.`,
        `We keep pricing transparent so you always know where you stand. Everything below is laid out plainly, and we will gladly walk you through the options that fit your celebration.`,
      ],
      availability_text: [
        `Popular dates book quickly, so reach out soon to check availability for your season.`,
        `Our calendar fills fast, especially in peak season. Message us with your date and we will tell you right away if it is open.`,
      ],
    };
    const opts = templates[field];
    text = opts[Math.floor(Math.random() * opts.length)];
  }

  text = cleanCopy(text).slice(0, spec.max);
  return NextResponse.json({ text });
}
