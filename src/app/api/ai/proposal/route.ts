import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getVenueFromSession } from '@/lib/session';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OpenAI not configured. Add OPENAI_API_KEY to your environment variables.' }, { status: 503 });
  }

  const venue = await getVenueFromSession();
  const venueName = venue?.name || 'Our Venue';

  const body = await request.json();
  const {
    clientName,
    eventDate,
    guestCount,
    packageName,
    packagePrice,
    venueSpaces,
    includedServices,
    paymentType,
    depositAmount,
    specialNotes,
    tone = 'professional',
  } = body;

  if (!clientName) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = `You are an expert wedding venue coordinator writing a professional proposal for a client. Generate a complete, elegant wedding venue proposal in HTML format.

VENUE: ${venueName}
CLIENT: ${clientName}
EVENT DATE: ${eventDate || 'To be confirmed'}
GUEST COUNT: ${guestCount || 'To be confirmed'}
PACKAGE: ${packageName || 'Wedding Package'}
PACKAGE PRICE: ${packagePrice ? `$${packagePrice}` : 'To be discussed'}
${venueSpaces ? `VENUE SPACES: ${venueSpaces}` : ''}
${includedServices ? `INCLUDED SERVICES: ${includedServices}` : ''}
${paymentType ? `PAYMENT STRUCTURE: ${paymentType}` : ''}
${depositAmount ? `DEPOSIT REQUIRED: $${depositAmount}` : ''}
${specialNotes ? `SPECIAL NOTES/REQUESTS: ${specialNotes}` : ''}
TONE: ${tone}

Generate a complete HTML proposal with these sections:
1. A warm, personalized welcome/introduction addressed to ${clientName}
2. Event Details (date, guest count, venue spaces)
3. Package Overview with what's included (make it detailed and appealing)
4. Pricing & Payment Structure
5. Terms & Conditions (include standard wedding venue terms: cancellation policy, damage deposit, vendor access, noise ordinance compliance, alcohol policy, final headcount deadline)
6. Next Steps / Call to Action

FORMAT RULES:
- Use proper HTML tags: <h1>, <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>, <hr>
- Use <h1> only for the main title
- Use <h2> for section headings
- Use <ul><li> for lists of inclusions
- Make it warm, professional, and compelling
- Do NOT include <html>, <head>, <body>, or <style> tags — only the inner content
- Do NOT include any markdown, only HTML
- The proposal should feel personalized, not generic
- Include the venue name ${venueName} throughout naturally`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert wedding venue coordinator. Write eloquent, professional, and warm wedding venue proposals in clean HTML. Your proposals are detailed, personalized, and compelling.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 3000,
      temperature: 0.7,
    });

    const html = completion.choices[0]?.message?.content || '';
    return NextResponse.json({ html });
  } catch (err) {
    console.error('[ai/proposal] OpenAI error:', err);
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 });
  }
}
