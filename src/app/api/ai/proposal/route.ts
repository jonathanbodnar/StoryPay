import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getVenueFromSession } from '@/lib/session';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { stripEmDashes } from '@/lib/ai-text-cleanup';
import { checkAiRateLimit, capInputLength } from '@/lib/ai-rate-limit';

// Field-level char caps — generous for real data, stops prompt stuffing.
const CAP = { short: 200, medium: 500, notes: 1_000 };

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = checkAiRateLimit(request, venueId, 'proposal');
  if (limited) return limited;

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: 'AI not configured. Add DEEPSEEK_API_KEY to your environment variables.' }, { status: 503 });
  }

  const venue = await getVenueFromSession();
  const venueName = venue?.name || 'Our Venue';

  const body = await request.json();
  const {
    isTemplate:       rawIsTemplate,
    clientName:       rawClientName,
    eventDate:        rawEventDate,
    guestCount:       rawGuestCount,
    packageName:      rawPackageName,
    packagePrice:     rawPackagePrice,
    venueSpaces:      rawVenueSpaces,
    includedServices: rawIncludedServices,
    paymentType:      rawPaymentType,
    depositAmount:    rawDepositAmount,
    specialNotes:     rawSpecialNotes,
    tone = 'professional',
  } = body;

  const isTemplate       = Boolean(rawIsTemplate);
  const clientName       = capInputLength(rawClientName       ?? '', CAP.short);
  const eventDate        = capInputLength(rawEventDate        ?? '', CAP.short);
  const guestCount       = capInputLength(String(rawGuestCount  ?? ''), CAP.short);
  const packageName      = capInputLength(rawPackageName      ?? '', CAP.medium);
  const packagePrice     = capInputLength(String(rawPackagePrice ?? ''), CAP.short);
  const venueSpaces      = capInputLength(rawVenueSpaces      ?? '', CAP.medium);
  const includedServices = capInputLength(rawIncludedServices ?? '', CAP.medium);
  const paymentType      = capInputLength(rawPaymentType      ?? '', CAP.short);
  const depositAmount    = capInputLength(String(rawDepositAmount ?? ''), CAP.short);
  const specialNotes     = capInputLength(rawSpecialNotes     ?? '', CAP.notes);

  // Client name is only required for send-to-client proposals, not templates.
  if (!isTemplate && !clientName.trim()) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
  }

  const deepseek = getDeepSeekClient();

  // Template mode: generate a reusable proposal with [PLACEHOLDER] tokens where
  // client-specific data goes. The venue owner assigns this template when
  // creating a real proposal, then fills in the client's actual details.
  const prompt = isTemplate
    ? `You are an expert wedding venue coordinator. Generate a complete, elegant REUSABLE wedding venue proposal TEMPLATE in HTML format for ${venueName}.

This is a TEMPLATE — use the exact placeholder tokens below wherever client-specific information goes. Do NOT invent fake client names or dates. The placeholders will be replaced with real data when the proposal is sent.

PLACEHOLDERS TO USE (copy them exactly):
- [CLIENT NAME] — where the client's name appears
- [EVENT DATE] — where the event date appears
- [GUEST COUNT] — where the guest count appears
- [VENUE SPACES] — where the selected spaces appear

PACKAGE: ${packageName || 'Wedding Package'}
PACKAGE PRICE: ${packagePrice ? `$${packagePrice}` : '[PACKAGE PRICE]'}
${includedServices ? `INCLUDED SERVICES: ${includedServices}` : ''}
${paymentType ? `PAYMENT STRUCTURE: ${paymentType}` : ''}
${depositAmount ? `DEPOSIT REQUIRED: $${depositAmount}` : ''}
${specialNotes ? `SPECIAL NOTES: ${specialNotes}` : ''}
TONE: ${tone}

Generate a complete HTML proposal TEMPLATE with these sections:
1. A warm welcome/introduction addressed to [CLIENT NAME]
2. Event Details ([EVENT DATE], [GUEST COUNT] guests, [VENUE SPACES])
3. Package Overview with what's included (make it detailed and appealing)
4. Pricing & Payment Structure
5. Terms & Conditions (cancellation policy, damage deposit, vendor access, noise ordinance compliance, alcohol policy, final headcount deadline)
6. Signature / Acceptance section with a signature line for [CLIENT NAME] and a date line

FORMAT RULES:
- Use proper HTML tags: <h1>, <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>, <hr>
- Use <h1> only for the main title
- Use <h2> for section headings
- Use <ul><li> for lists of inclusions
- Do NOT include <html>, <head>, <body>, or <style> tags — only the inner content
- Do NOT include any markdown, only HTML
- Include the venue name ${venueName} throughout naturally
- Every placeholder must appear in square brackets exactly as listed above`
    : `You are an expert wedding venue coordinator writing a professional proposal for a client. Generate a complete, elegant wedding venue proposal in HTML format.

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
    const completion = await deepseek.chat.completions.create({
      model: DEEPSEEK_MODEL,
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

    const html = stripEmDashes(completion.choices[0]?.message?.content || '');
    return NextResponse.json({ html });
  } catch (err) {
    console.error('[ai/proposal] DeepSeek error:', err);
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 500 });
  }
}
