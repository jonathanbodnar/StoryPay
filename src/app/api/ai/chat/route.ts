import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import OpenAI from 'openai';

const PLATFORM_DOCS = `
# StoryPay Platform Documentation

## Overview
StoryPay is an all-in-one platform for wedding venues to manage proposals, invoices, payments, customers, email templates, branding, and team members — all from one place.

## Navigation / Sections
- Home (Dashboard): Revenue overview, KPI cards, recent proposals and transactions, date range filter.
- Customers: Manage your client database. Add, view, and create proposals/invoices from a customer profile.
- Reports: 6 downloadable financial reports (CSV, Excel, PDF).
- Payments: Create proposals/invoices, manage templates, installments, subscriptions, transactions.
- Help Center: Searchable documentation with AI-assisted answers.
- What's New: Changelog and Feature Requests board.
- Settings: General, Branding, Email Templates, Integrations, Team, Notifications.
- Ask AI: This assistant — answers questions about your account in real time.

## Proposals
- Go to Payments → New to create a proposal or invoice.
- Proposals require a template. Invoices do not.
- Payment types: Full Payment, Installment Plan, Subscription.
- Clients receive an email/SMS with a link to review, sign, and pay.
- Proposal statuses: Draft, Sent, Opened, Signed, Paid, Refunded.
- Resend a proposal from the Proposals list using the refresh icon.

## Proposal Templates
- Go to Payments → Proposal Templates to create and manage templates.
- Use the WYSIWYG editor to write contract content.
- Click Generate with AI to have AI draft a complete template.
- Add signature fields (Signature, Printed Name, Date) at the bottom.

## Invoices
- Go to Payments → New → Create Invoice for a one-off invoice without a template.
- Add multiple line items; total auto-calculates.
- Clients receive it via email/SMS and pay online.

## Customers
- Go to Customers to view all clients.
- Add Customer to create a new record manually.
- Each row has View, Create Proposal, and Create Invoice actions.
- Click a customer name to see their full history and total spend.

## Transactions
- Charges tab: All paid transactions. Click Refund to issue a refund.
- Payment Schedules tab: Installment plans.
- Subscriptions tab: Recurring payments.

## Reports
- 6 report types: Revenue, Proposals, Customer Summary, AR Aging, Payment Method Breakdown, Refunds.
- Filter by date range. Download as CSV, Excel, or PDF.

## Branding & Customization
- Go to Settings → Branding to upload a logo and set brand colors.
- Logo and colors appear on all emails, invoices, and proposals sent to clients.
- Color presets available (Default, Ivory & Gold, Sage & Stone, etc.) — click a preset to apply and save instantly.
- Custom colors: Primary/button color, background color, button text color.
- Contact info (email, phone, address) shown on documents.
- All emails use the venue logo in a white header with a brand-color strip underneath.

## Email Templates
- Go to Settings → Email Templates to customize every type of outgoing email.
- Template types: Invoice, Proposal, Payment Confirmation, Payment Notification, Subscription Confirmation, Subscription Cancelled, Payment Failed.
- Each template has: Subject Line, Email Heading, Body Text, Button Text (optional), Footer Text (optional).
- Click Preview to see exactly what the email will look like.
- Click Send Test to send a test version to any email address.
- Toggle Enable/Disable to turn a template on or off.
- All emails use your venue branding (logo, brand color).

## Settings → General
- Payment Processing: Shows LunarPay merchant account status.
- Setup Guide: Restart the Getting Started checklist on your dashboard (owners only).
- Messaging: Connect GHL (Go High Level) for SMS notifications.

## Team Members
- Go to Settings → Team to manage who has access to your account.
- Three roles:
  - Owner: Full access to everything including settings, team management, branding.
  - Admin: Access to proposals, customers, reports, branding, email templates. Cannot manage team or general settings.
  - Member: Can only view and manage proposals and customers. No access to settings or reports.
- Click Add Team Member to invite someone by email.
- They receive a branded invite email with an Accept Invitation link.
- Click the ... menu on any member to Edit, Resend Invite, or Remove.
- Team members can update their own profile (name, email) at Settings → Profile.

## Get Started Checklist (Onboarding)
- New accounts see a Get Started bubble on the dashboard (owners only).
- Click the bubble to open a modal with 6 setup steps:
  1. Create Your Profile and Branding
  2. Customize Email Templates
  3. Create Your First Proposal Template
  4. Create Your First Proposal
  5. Send Your First Proposal
  6. Invite a Team Member
- Check off each step manually as you complete it.
- Once all steps are checked, click "I'm Ready" to dismiss the bubble permanently.
- To restart the guide, go to Settings → General → Restart Setup Guide.

## SMS Notifications
- SMS is sent automatically when proposals and invoices are created (if customer has a phone number).
- Phone numbers must be in US format — the system auto-formats them to +1XXXXXXXXXX (E.164).
- SMS routes through your GHL sub-account's A2P approved phone number.

## Refunds
- Go to Transactions → Charges → find the charge → click Refund.
- Confirm the amount and click Issue Refund. Processes immediately through LunarPay.

## Payment Processing
- StoryPay uses LunarPay (powered by Fortis) for all payment processing.
- Account must complete Fortis onboarding before accepting payments.
- Card numbers go directly to Fortis — PCI SAQ-A compliant.

## Help Center
- Go to Help Center for searchable documentation.
- Use voice search (mic icon) to speak your question.
- Each article has related articles at the bottom.
- Click Ask AI in the Help Center to chat with the AI assistant.
- Rate articles with thumbs up/down to help improve documentation.

## Common Questions
- How do I create a proposal? Payments → New → select a template → fill in client details → Send.
- How do I see my revenue? Home dashboard (filter by date) or Reports → Revenue.
- How do I refund a payment? Transactions → Charges → click Refund.
- Why can't I accept payments? LunarPay account may be pending. Check Settings → Payment Processing.
- How do I add my logo? Settings → Branding → upload logo file.
- How do I change my brand colors? Settings → Branding → Color Presets or Custom Colors.
- How do I add a team member? Settings → Team → Add Team Member.
- Why can't a team member see Settings? Members only see proposals and customers. Admins see most settings. Only owners see General and Team.
- How do I customize emails? Settings → Email Templates → select a type → edit → Save.
- How do I send a test email? Settings → Email Templates → select a type → Send Test.
- How do I restart the setup guide? Settings → General → Restart Setup Guide (owners only).
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
9. Format responses clearly — use numbered lists or dashes for steps, plain text only
10. Keep responses under 250 words unless a detailed walkthrough is needed

=== FORMATTING ===
- NEVER use any markdown whatsoever: absolutely no **bold**, no *italic*, no __underline__, no ### headers, no # symbols, no backticks, no asterisks around words
- Use plain text only — asterisks will be shown literally to the user and look broken
- Use numbered lists (1. 2. 3.) or dashes (- item) for lists
- Keep headings as plain text with a colon, e.g. "How to Access Reports:"
- When directing the user to a specific page, include ONE navigation link using ONLY this format: [Button Label](/dashboard/path)
  Examples: [Open Branding Settings](/dashboard/settings) [View Proposals](/dashboard/proposals) [Go to Reports](/dashboard/reports) [Manage Customers](/dashboard/customers) [View Transactions](/dashboard/transactions)
- Only link to real dashboard paths. Valid paths: /dashboard, /dashboard/proposals, /dashboard/customers, /dashboard/transactions, /dashboard/reports, /dashboard/settings, /dashboard/help
- Place the link on its own line at the end of the relevant sentence or step, not inline mid-sentence

=== TONE ===
Friendly, professional, calm, helpful, clear. Not robotic. Not salesy.`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Check if any message contains an image (vision request)
  const hasImage = messages.some((m: { role: string; content: unknown }) =>
    Array.isArray(m.content) && m.content.some((c: { type: string }) => c.type === 'image_url')
  );

  try {
    const completion = await openai.chat.completions.create({
      model: hasImage ? 'gpt-4o' : 'gpt-4o-mini', // use gpt-4o for vision
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-20),
      ],
      max_tokens: hasImage ? 800 : 600,
      temperature: 0.5,
    });

    const reply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response. Please try again.';
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('[ai/chat] error:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 500 });
  }
}
