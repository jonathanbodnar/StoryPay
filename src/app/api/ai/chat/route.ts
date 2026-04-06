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

  const { messages } = await request.json();
  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 });
  }

  // ── Fetch venue context ──────────────────────────────────────────────────────
  const [{ data: venue }, { data: proposals }, { data: customers }] = await Promise.all([
    supabaseAdmin.from('venues').select('name, email').eq('id', venueId).single(),
    supabaseAdmin.from('proposals')
      .select('id, customer_name, customer_email, status, price, payment_type, sent_at, paid_at, created_at')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin.from('proposals')
      .select('customer_name, customer_email, customer_phone, price, status')
      .eq('venue_id', venueId),
  ]);

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

  const allProposals = proposals ?? [];
  const paid = allProposals.filter(p => p.status === 'paid');
  const pending = allProposals.filter(p => p.status === 'sent' || p.status === 'opened');
  const signed = allProposals.filter(p => p.status === 'signed');
  const totalRevenue = paid.reduce((s, p) => s + (p.price ?? 0), 0);
  const thisMonthRevenue = paid.filter(p => (p.paid_at || p.created_at)?.startsWith(thisMonth)).reduce((s, p) => s + (p.price ?? 0), 0);
  const lastMonthRevenue = paid.filter(p => (p.paid_at || p.created_at)?.startsWith(lastMonth)).reduce((s, p) => s + (p.price ?? 0), 0);

  const uniqueCustomers = new Set((customers ?? []).map(c => c.customer_email).filter(Boolean));

  // Top customers by spend
  const customerSpend: Record<string, { name: string; spend: number; count: number }> = {};
  for (const p of paid) {
    const key = p.customer_email || p.customer_name || 'unknown';
    if (!customerSpend[key]) customerSpend[key] = { name: p.customer_name || p.customer_email || 'Unknown', spend: 0, count: 0 };
    customerSpend[key].spend += p.price ?? 0;
    customerSpend[key].count++;
  }
  const topCustomers = Object.values(customerSpend)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5)
    .map(c => `${c.name}: $${(c.spend / 100).toFixed(2)} (${c.count} booking${c.count !== 1 ? 's' : ''})`);

  // Conversion rate
  const sent = allProposals.filter(p => p.status !== 'draft').length;
  const conversionRate = sent > 0 ? Math.round((paid.length / sent) * 100) : 0;

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const contextBlock = `
VENUE: ${venue?.name || 'Unknown Venue'} (${venue?.email || ''})
TODAY: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

FINANCIAL SUMMARY:
- Total revenue (all time): ${fmt(totalRevenue)}
- This month revenue (${thisMonth}): ${fmt(thisMonthRevenue)}
- Last month revenue (${lastMonth}): ${fmt(lastMonthRevenue)}
- Total paid proposals: ${paid.length}
- Conversion rate (sent → paid): ${conversionRate}%

PIPELINE:
- Total proposals: ${allProposals.length}
- Pending (sent/opened, not yet signed): ${pending.length} — Total value: ${fmt(pending.reduce((s, p) => s + (p.price ?? 0), 0))}
- Signed (awaiting payment): ${signed.length} — Total value: ${fmt(signed.reduce((s, p) => s + (p.price ?? 0), 0))}
- Drafts: ${allProposals.filter(p => p.status === 'draft').length}

CUSTOMERS:
- Unique customers: ${uniqueCustomers.size}
- Top clients by spend: ${topCustomers.length > 0 ? topCustomers.join('; ') : 'None yet'}

RECENT PROPOSALS (last 10):
${allProposals.slice(0, 10).map(p =>
  `- ${p.customer_name || 'Unknown'}: ${p.status} | ${fmt(p.price ?? 0)} | ${p.payment_type} | ${(p.sent_at || p.created_at || '').slice(0, 10)}`
).join('\n')}
`.trim();

  const systemPrompt = `You are Ask AI, the intelligent assistant built into StoryPay — a proposal and payment platform for wedding venues. You help venue owners understand their business data, use the platform, and grow their bookings.

CURRENT VENUE DATA:
${contextBlock}

YOUR CAPABILITIES:
- Answer questions about the venue's revenue, proposals, customers, and pipeline using the data above
- Explain how to use any StoryPay feature (proposals, invoices, templates, payments, refunds, reports, etc.)
- Provide wedding venue business advice (contracts, pricing, deposits, client communication)
- Suggest actionable insights based on their data
- Help draft messages or follow-up copy for clients

RULES:
- Be concise, warm, and professional
- When citing numbers from their data, be specific and accurate
- If asked about something not in the data above, be honest that you don't have that detail but offer to help in another way
- Format responses with bullet points or short paragraphs for readability
- Never make up data — only reference what's in the context above
- Address the venue owner directly, not in third person
- Keep responses focused and actionable`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-20), // keep last 20 messages for context window efficiency
      ],
      max_tokens: 800,
      temperature: 0.6,
    });

    const reply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response. Please try again.';
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('[ai/chat] error:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 500 });
  }
}
