import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import OpenAI from 'openai';

const PLATFORM_DOCS = `
# StoryPay Platform Documentation

## Overview
StoryPay is a proposal and payment platform built specifically for wedding venues. It lets you send branded contracts, collect e-signatures, and get paid — all in one place.

## Navigation / Sections
- **Home (Dashboard)**: Overview of revenue, proposals, customers, pending payments. Has a date range filter and recent proposals/transactions.
- **Proposals**: Create, send, edit, and track proposals and contracts. Includes templates. Status flow: Draft → Sent → Opened → Signed → Paid.
- **Customers**: Manage your client database. Add customers, view their history, create proposals/invoices directly from their profile.
- **Transactions**: View Charges (paid proposals), Payment Schedules (installment plans), and Subscriptions. Can issue refunds from Charges tab.
- **Reports**: Run 6 financial reports (Revenue, Proposals, Customer Summary, AR Aging, Payment Methods, Refunds). Download as CSV, Excel, or PDF.
- **Ask AI**: This AI assistant. Ask any question about the platform or your account.
- **What's New**: Changelog of latest features and a Feature Requests board where you can vote on what to build next.
- **Support**: Submit a support ticket.
- **Settings**: Manage venue info, branding (logo, contact info, address, footer note), payment processing status, billing fee settings, and messaging integrations.

## Proposals
- Click **Proposals** → **Create Proposal** to start a new proposal.
- You must select a template first, then fill in customer details and pricing.
- Payment types: Full Payment, Installment Plan, or Subscription.
- Send via SMS/email through GHL (if connected), or copy the proposal link manually.
- Clients open the link, read the contract, sign it, then pay.
- You can resend a proposal from the Proposals tab using the refresh icon.
- Proposal statuses: Draft, Sent, Opened, Signed, Paid, Refunded.

## Templates
- Go to **Proposals → Templates** to create and manage proposal templates.
- Use the full WYSIWYG editor (like Google Docs) to write your contract content.
- Click **Generate with AI** to have AI draft a complete proposal from your details.
- Add signature fields (Signature, Printed Name, Date) that appear at the bottom for clients to fill in.
- Preview any template before editing using the **Preview** button.

## Invoices
- Go to **Proposals → Create Invoice** to send a one-off invoice (no template needed).
- Add multiple line items with names, descriptions, and amounts.
- The total auto-calculates.
- Clients receive the invoice via SMS/email and can pay online.

## Customers
- Go to **Customers** to view all clients.
- Click **Add Customer** to add a new client manually.
- Each customer row has: **View Customer**, **Create Proposal**, and **Create Invoice** buttons.
- Click on a customer name to view their full profile with proposal history and total spend.

## Transactions
- **Charges tab**: All paid transactions. Click **View Transaction** to see full details. Click **Refund** to issue a refund.
- **Payment Schedules tab**: Installment plans. Shows total, number of payments, and status.
- **Subscriptions tab**: Recurring subscription payments.
- All tabs have a **View Customer** button to jump to the client profile.

## Reports
- Go to **Reports** to run any of 6 built-in reports.
- Use the date range picker to filter by time period.
- Click **Preview** to see data before downloading.
- Download as **CSV**, **Excel (.xlsx)**, or **PDF** (branded with your venue header).
- Report types: Revenue, Proposals, Customer Summary, AR Aging (overdue), Payment Method Breakdown, Refunds.

## Settings
- **Venue Branding**: Add your logo URL, contact email, phone, website, address, and a footer note for documents.
- **Payment Processing**: Shows your LunarPay merchant account status (Active, Pending, Under Review).
- **Billing**: Configure the processing fee percentage passed to clients at checkout.
- **Messaging**: Connect your GHL (Go High Level) account for SMS/email notifications.

## Refunds
- Go to **Transactions → Charges**.
- Find the charge and click **Refund**.
- Confirm the amount in the popup and click **Issue Refund**.
- The refund processes immediately through LunarPay.

## Payment Processing
- StoryPay uses **LunarPay** (powered by Fortis) for all payment processing.
- Your account must complete Fortis onboarding before you can accept payments.
- Card numbers never touch StoryPay's servers — they go directly to Fortis (PCI SAQ-A compliant).

## GHL / Messaging Integration
- Go to **Settings → Messaging** and click **Connect Account**.
- Once connected, SMS and email notifications are sent automatically when proposals are created or signed.

## Ask AI
- Ask any question about your account, reports, proposals, invoices, or how to use the platform.
- After Ask AI attempts to help, you can request human support.
- Human support emails are sent to clients@storyvenuemarketing.com with your full account context.

## Common Questions
- **How do I create a proposal?** Go to Proposals → Create Proposal → select a template → fill in client details and pricing → Send.
- **How do I see my revenue?** Check the Home dashboard (filter by date range) or run a Revenue Report.
- **How do I refund a payment?** Go to Transactions → Charges → find the charge → click Refund.
- **Why can't I accept payments?** Your LunarPay merchant account may still be pending. Check Settings → Payment Processing.
- **How do I add my logo?** Go to Settings → Venue Branding → enter your logo URL.
- **How do I see who voted on feature requests?** Go to What's New → Feature Requests.
- **How do I send a test proposal?** Create a proposal to yourself using your own email.
`;

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

  // Fetch venue + live data context
  const [{ data: venue }, { data: proposals }, { data: customers }] = await Promise.all([
    supabaseAdmin.from('venues').select('id, name, email, onboarding_status, setup_completed, ghl_connected').eq('id', venueId).single(),
    supabaseAdmin.from('proposals').select('id, customer_name, customer_email, status, price, payment_type, sent_at, paid_at, created_at').eq('venue_id', venueId).order('created_at', { ascending: false }).limit(100),
    supabaseAdmin.from('proposals').select('customer_email, price, status').eq('venue_id', venueId),
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
  const uniqueCustomers = new Set((customers ?? []).map(c => c.customer_email).filter(Boolean)).size;
  const sent = allProposals.filter(p => p.status !== 'draft').length;
  const conversionRate = sent > 0 ? Math.round((paid.length / sent) * 100) : 0;
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

  const accountContext = `
VENUE ACCOUNT:
- Name: ${venue?.name || 'Unknown'}
- Email: ${venue?.email || 'Not set'}
- Account ID: ${venueId}
- Payment processing: ${venue?.onboarding_status || 'unknown'} ${venue?.setup_completed ? '(setup complete)' : '(setup not complete)'}
- GHL/Messaging connected: ${venue?.ghl_connected ? 'Yes' : 'No'}

LIVE FINANCIAL DATA:
- Total revenue (all time): ${fmt(totalRevenue)}
- This month (${thisMonth}): ${fmt(thisMonthRevenue)}
- Last month (${lastMonth}): ${fmt(lastMonthRevenue)}
- Total paid proposals: ${paid.length}
- Conversion rate: ${conversionRate}%

PIPELINE:
- Pending (sent/opened): ${pending.length} — value: ${fmt(pending.reduce((s, p) => s + (p.price ?? 0), 0))}
- Signed (awaiting payment): ${signed.length} — value: ${fmt(signed.reduce((s, p) => s + (p.price ?? 0), 0))}
- Total proposals: ${allProposals.length}
- Unique customers: ${uniqueCustomers}

RECENT PROPOSALS (last 10):
${allProposals.slice(0, 10).map(p => `- ${p.customer_name || 'Unknown'} | ${p.status} | ${fmt(p.price ?? 0)} | ${p.payment_type} | ${(p.sent_at || p.created_at || '').slice(0, 10)}`).join('\n')}
`.trim();

  const systemPrompt = `You are Ask AI, the intelligent support assistant built into StoryPay — a proposal and payment platform for wedding venues.

You help venue owners with:
- Platform support and how-to questions
- Understanding their dashboard, reports, proposals, invoices, and contracts
- Account and billing questions
- Navigation and feature explanations
- Troubleshooting

=== PLATFORM DOCUMENTATION ===
${PLATFORM_DOCS}

=== CLIENT ACCOUNT DATA ===
${accountContext}

=== BEHAVIOR RULES ===
1. Always try to answer using the documentation and account data above
2. When asked about account data (revenue, proposals, customers), use the real numbers above
3. Never make up financial figures, contract details, or account information
4. Be concise, warm, and action-oriented
5. After answering, offer a relevant follow-up or next step
6. If you cannot answer confidently, say so honestly and suggest escalation
7. Do NOT immediately suggest contacting support — try to answer first
8. After your answer, if it's a complex issue, you can gently add: "Still need help? I can connect you with our support team."
9. Format responses clearly — use bullet points for steps, bold for key terms
10. Keep responses under 250 words unless a detailed walkthrough is needed

=== TONE ===
Friendly, professional, calm, helpful, clear. Not robotic. Not salesy.`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-20),
      ],
      max_tokens: 600,
      temperature: 0.5,
    });

    const reply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response. Please try again.';
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('[ai/chat] error:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 500 });
  }
}
