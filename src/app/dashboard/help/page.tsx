'use client';

import { useState, useMemo, useRef, useCallback, useEffect, useTransition } from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import {
  Search, Sparkles, ChevronRight, ChevronDown, X, Send, Loader2,
  LayoutDashboard, Users, BarChart2, CreditCard, FileText, Receipt,
  Calendar, RefreshCw, Palette, Mail, UsersRound, Bell, Link2,
  Settings, HelpCircle, Mic, MicOff, Smile, Paperclip,
  BookOpen, Zap, DollarSign, Package,
} from 'lucide-react';
import {
  HELP_CATEGORIES,
  ALL_ARTICLES,
  getArticlesForPath,
  getArticleById,
  type HelpArticle,
} from '@/lib/help-articles';
import { normaliseHelpQuery } from '@/lib/help-search';

// ─── Icon map (help-articles stores icon names as strings) ────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Zap, LayoutDashboard, Users, BarChart2, CreditCard, FileText, Receipt,
  Calendar, RefreshCw, Palette, Mail, UsersRound, Bell, Link2,
  Settings, HelpCircle, BookOpen, Sparkles, DollarSign, Package,
};

// ─── Local type aliases ───────────────────────────────────────────────────────

type Article  = HelpArticle;
interface Category {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  articles: Article[];
}

// Map shared data to local shape (inject resolved icon)
const CATEGORIES: Category[] = HELP_CATEGORIES.map(c => ({
  ...c,
  icon: ICON_MAP[c.iconName] ?? HelpCircle,
}));

// ─── (inline article data removed — imported from @/lib/help-articles) ───────

const _PLACEHOLDER: Category[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: Zap,
    color: '#f59e0b',
    articles: [
      {
        id: 'gs-overview',
        title: 'Platform overview',
        tags: ['overview', 'intro', 'dashboard', 'what is'],
        body: `StoryVenue is an all-in-one platform for wedding venues to manage proposals, invoices, payments, customers, and team members — all from one place.

After logging in you land on the Home dashboard which shows your revenue, pipeline, recent proposals, and recent transactions at a glance.

Navigation lives in the left sidebar (or the hamburger menu on mobile). The main sections are:
- Home — your live snapshot
- Customers — manage contacts
- Reports — 7 downloadable report types
- Payments — proposals, invoices, installments, subscriptions
- Settings — branding, email templates, integrations, team, notifications

The floating sparkle button (bottom-right) opens Ask AI, which can answer questions about your account in real time.`,
      },
      {
        id: 'gs-onboarding',
        title: 'Get Started checklist',
        tags: ['checklist', 'onboarding', 'setup', 'first steps'],
        body: `When you first access your dashboard you'll see a "Get Started" checklist on the Home page. It tracks 6 steps:

1. Payment Processing — connect your LunarPay merchant account (Settings → General)
2. First Customer — add your first customer record
3. First Proposal — create and send a proposal
4. Branding — upload your logo and pick brand colors (Settings → Branding)
5. Email Templates — customise your automated emails (Settings → Email Templates)
6. Team Member — invite a colleague (Settings → Team)

Once all 6 are done the checklist collapses. You can also dismiss it early.`,
      },
      {
        id: 'gs-login',
        title: 'Logging in and your login link',
        tags: ['login', 'link', 'access', 'sign in', 'token'],
        body: `StoryVenue uses magic-link login. You receive a personalised login URL from your account manager. Opening that link sets your session automatically — no password needed.

Your session lasts 30 days. If it expires, contact support or your account manager for a fresh link.

To log out, click Logout at the bottom of the sidebar.`,
      },
    ],
  },
  {
    id: 'dashboard',
    label: 'Home Dashboard',
    icon: LayoutDashboard,
    color: '#6366f1',
    articles: [
      {
        id: 'dash-kpis',
        title: 'Understanding your KPI cards',
        tags: ['kpi', 'revenue', 'metrics', 'home', 'stats'],
        body: `The Home dashboard shows six KPI cards at the top:

- Total Revenue — sum of all completed payments in the selected period
- New Proposals — proposals created in the period
- Signed Proposals — proposals that have been e-signed
- Pending Amount — value of proposals awaiting payment
- Refunds — total refunded in the period
- Avg. Proposal Value — average revenue per signed proposal

Use the date range picker (top-right of the dashboard) to change the period. Preset options include Today, Last 7 days, This month, Last month, Last 90 days, and Year to date.`,
      },
      {
        id: 'dash-chart',
        title: 'Revenue chart and proposal status breakdown',
        tags: ['chart', 'graph', 'revenue', 'status', 'pipeline'],
        body: `Below the KPI cards is an area chart showing daily or monthly revenue over the selected period.

Beneath the chart you'll see a status breakdown showing how many proposals are in each stage: Draft, Sent, Viewed, Signed, Paid, Refunded, and Cancelled.

The two tables at the bottom show your 5 most recent proposals (with links to view or edit) and your 5 most recent charges (with customer names and amounts).`,
      },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: Users,
    color: '#10b981',
    articles: [
      {
        id: 'cust-add',
        title: 'Adding a customer',
        tags: ['add customer', 'new customer', 'create contact'],
        body: `Go to Customers in the sidebar. Click the "+ Add Customer" button (top right).

Fill in:
- First Name (required)
- Last Name (required)
- Email (required)
- Phone
- Address, City, State, Zip

Click Save. The customer appears in your list immediately.

Tip: You can also create a customer inline while building a new proposal or invoice — just type their name in the customer search field and select "Add new customer".`,
      },
      {
        id: 'cust-search',
        title: 'Searching and filtering customers',
        tags: ['search', 'find customer', 'filter'],
        body: `On the Customers page there is a search bar at the top. Type any part of a name, email, or phone number and results filter in real time.

Results are paginated (20 per page). Use the Previous / Next buttons at the bottom to navigate.`,
      },
      {
        id: 'cust-profile',
        title: 'Customer profile and proposal history',
        tags: ['customer profile', 'proposals', 'history', 'refund'],
        body: `Click a customer's name to open their profile. From here you can:

- Edit contact details inline
- See all proposals linked to that customer
- Copy a proposal's public link
- Resend a proposal email
- Issue a refund on a completed payment (click Refund on the relevant proposal row, enter the amount, and confirm)

All changes save automatically.`,
      },
    ],
  },
  {
    id: 'payments',
    label: 'Payments & Proposals',
    icon: CreditCard,
    color: '#3b82f6',
    articles: [
      {
        id: 'pay-new',
        title: 'Creating a new proposal or invoice',
        tags: ['new proposal', 'new invoice', 'create', 'send', 'draft'],
        body: `Go to Payments → New in the sidebar.

Step 1 — Choose mode: Proposal (includes a signable contract) or Invoice (line items only, no contract).

Step 2 — Find or create the customer. Type their name or email in the customer search box. If they don't exist yet, fill in the manual fields.

Step 3 — For proposals, choose a template (or start from scratch) and edit the contract text. The AI Proposal Generator can draft contract language for you — click the "Generate with AI" button and describe your event.

Step 4 — Add line items. Type a product name (autocompletes from your saved products) or enter a custom item. Each line has a description, quantity, and price.

Step 5 — Choose a payment type:
- Full payment — customer pays the full amount at once
- Installment plan — set a deposit, a second payment, and a final balance with due dates
- Subscription — recurring charges on a weekly/monthly schedule

Step 6 — Click Send to email the proposal/invoice to the customer, or Save Draft to keep it for later.

The customer receives a branded email with a link to view, sign (if proposal), and pay online.`,
      },
      {
        id: 'pay-templates',
        title: 'Proposal templates',
        tags: ['template', 'contract', 'reuse', 'edit template'],
        body: `Templates save your standard contract text so you don't re-type it every time.

To create a template: Payments → Proposal Templates → New Template.
- Give it a name
- Write or paste the contract body in the rich-text editor
- Add signing fields: Signature, Printed Name, Date (drag to reorder)
- Optionally set default pricing and payment type
- Click Save Template

To use a template: when creating a new proposal, choose the template from the dropdown. All the text and signing fields load automatically.

To edit an existing template: Payments → Proposal Templates → click Edit on any template card.`,
      },
      {
        id: 'pay-status',
        title: 'Proposal statuses explained',
        tags: ['status', 'draft', 'sent', 'signed', 'paid', 'cancelled'],
        body: `Each proposal moves through these statuses:

- Draft — saved but not yet sent to the customer
- Sent — emailed to the customer
- Viewed — the customer has opened the link
- Signed — the customer completed the e-signature
- Paid — at least one payment has been received
- Fully Paid — all scheduled payments collected
- Refunded — a refund has been processed
- Cancelled — manually cancelled

You can resend the proposal email at any status by clicking Resend on the proposals list or on the customer profile.`,
      },
      {
        id: 'pay-installments',
        title: 'Installment plans',
        tags: ['installment', 'payment plan', 'deposit', 'schedule'],
        body: `Installment plans let customers pay in structured stages. When creating a proposal or invoice, select "Installment Plan" as the payment type.

You can configure:
- Deposit amount and due date (often due at signing)
- Second payment amount and due date
- Final balance due date (remainder of total)

Customers are automatically reminded by email as due dates approach. You can view all active plans at Payments → Installments.`,
      },
      {
        id: 'pay-subscriptions',
        title: 'Subscriptions',
        tags: ['subscription', 'recurring', 'weekly', 'monthly'],
        body: `Subscriptions charge the customer on a repeating schedule (weekly or monthly) until cancelled.

When creating a proposal or invoice, select "Subscription" as the payment type and set:
- Charge amount
- Frequency (weekly / monthly)
- Start date

The customer's card is charged automatically. You can view and cancel active subscriptions at Payments → Subscriptions.`,
      },
      {
        id: 'pay-transactions',
        title: 'Viewing transactions and issuing refunds',
        tags: ['transactions', 'charges', 'refund', 'history'],
        body: `Go to Payments → Transactions (or click Transactions in the sidebar).

The Charges tab lists every payment received, with customer name, amount, date, and status.

To issue a refund:
1. Find the charge in the list
2. Click Refund
3. Enter the refund amount (partial or full)
4. Confirm — the refund is processed and the customer is notified by email

Refunds typically appear in the customer's account within 3–7 business days.

The Installments and Subscriptions tabs list active payment plans.`,
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart2,
    color: '#8b5cf6',
    articles: [
      {
        id: 'rep-overview',
        title: 'Available reports',
        tags: ['reports', 'export', 'csv', 'pdf', 'excel', 'download'],
        body: `Go to Reports in the sidebar. Select a date range (default: Year to date) then pick from 7 report types:

1. Revenue — total income, broken down by period
2. Proposals — all proposals with status, amount, and customer
3. Customers — customer list with contact info and total spend
4. Aging — outstanding balances and how overdue they are
5. Payment Methods — breakdown of charges by card type
6. Refunds — all refunds issued in the period
7. Bank Reconciliation — charges and payouts for accounting

Click Preview to see the data in a table, then download as CSV, Excel (.xlsx), or PDF.`,
      },
      {
        id: 'rep-download',
        title: 'Downloading and exporting reports',
        tags: ['download', 'export', 'csv', 'excel', 'pdf'],
        body: `After previewing a report, three download buttons appear:

- CSV — plain text, opens in any spreadsheet app
- Excel — formatted .xlsx file
- PDF — print-ready document

Downloads happen instantly in your browser — no email required. For large date ranges (e.g. full year) the download may take a few seconds.`,
      },
    ],
  },
  {
    id: 'branding',
    label: 'Branding',
    icon: Palette,
    color: '#ec4899',
    articles: [
      {
        id: 'brand-setup',
        title: 'Setting up your brand',
        tags: ['branding', 'logo', 'colors', 'brand', 'customize'],
        body: `Go to Settings → Branding.

Upload your logo — click the upload area or drag-and-drop an image. Recommended size: 400×100 px, PNG or SVG.

Choose a brand color by clicking one of the preset swatches or entering a hex code. This color appears on your proposals, invoices, and customer-facing emails.

Fill in your contact details (email, phone, address) — these appear in the footer of every email and document you send.

Add a tagline and website URL if you'd like them on customer documents.

The live Preview panel on the right updates as you type, showing exactly how your invoices will look.

Click Save when done.`,
      },
    ],
  },
  {
    id: 'email-templates',
    label: 'Email Templates',
    icon: Mail,
    color: '#f97316',
    articles: [
      {
        id: 'email-types',
        title: 'Email template types',
        tags: ['email', 'templates', 'automated', 'notification'],
        body: `StoryVenue sends automated emails on your behalf. You can customise each one at Settings → Email Templates.

The 7 template types are:

1. Invoice — sent when you send an invoice to a customer
2. Proposal — sent when you send a proposal
3. Payment Confirmation — sent to the customer after a successful payment
4. Payment Notification — sent to you when you receive a payment
5. Subscription Confirmation — sent to the customer when a subscription starts
6. Subscription Cancelled — sent to the customer when a subscription ends
7. Payment Failed — sent when a payment attempt fails

Each template has a subject line, heading, body, optional button text, and footer. Toggle the Enable/Disable switch to turn individual emails on or off.`,
      },
      {
        id: 'email-variables',
        title: 'Using merge variables in email templates',
        tags: ['variables', 'merge', 'dynamic', 'placeholders', 'template'],
        body: `Each email template supports merge variables — placeholders that get replaced with real data when the email sends.

Common variables:
- {{organization}} — your venue name
- {{customer_name}} — the recipient's name
- {{amount}} — the payment or invoice amount
- {{invoice_number}} — the invoice ID
- {{due_date}} — the payment due date
- {{payment_method}} — how the customer paid

The variable list is shown on the right side of each template editor. Click a variable pill to copy it, then paste it anywhere in the subject, heading, or body.

Preview your template using the Preview button — it shows a sample email with dummy data filled in.`,
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Link2,
    color: '#14b8a6',
    articles: [
      {
        id: 'int-quickbooks',
        title: 'Connecting QuickBooks Online',
        tags: ['quickbooks', 'accounting', 'integration', 'sync', 'qbo'],
        body: `Go to Settings → Integrations. Click Connect on the QuickBooks Online card.

You'll be redirected to Intuit to authorise the connection. After approving, you're returned to StoryVenue and the integration shows as Connected.

Once connected:
- Invoices and payments sync automatically to QuickBooks
- Click Sync Now to force an immediate sync
- The Sync History table shows the last 10 sync events with status and timestamp

To disconnect: click Disconnect. Your existing QuickBooks data is not deleted.`,
      },
      {
        id: 'int-freshbooks',
        title: 'Connecting FreshBooks',
        tags: ['freshbooks', 'accounting', 'integration', 'sync'],
        body: `Go to Settings → Integrations. Click Connect on the FreshBooks card.

You'll be redirected to FreshBooks to authorise access. After approving, the card shows Connected.

Invoices and charges sync to FreshBooks automatically. Use Sync Now for a manual sync. Disconnect at any time from the same page.`,
      },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    icon: UsersRound,
    color: '#64748b',
    articles: [
      {
        id: 'team-invite',
        title: 'Inviting team members',
        tags: ['team', 'invite', 'add member', 'staff', 'user'],
        body: `Go to Settings → Team. Click "+ Add Team Member".

Fill in:
- First Name (required)
- Last Name
- Email (required)
- Role: Owner, Admin, or Member

Role permissions:
- Owner — full access to everything including billing
- Admin — manage proposals, customers, and settings
- Member — view and manage proposals and customers (no settings access)

Click Add Member. The team member appears in the list immediately. You can resend their invite, change their role, or remove them at any time.`,
      },
      {
        id: 'team-roles',
        title: 'Team roles and permissions',
        tags: ['roles', 'permissions', 'owner', 'admin', 'member', 'access'],
        body: `There are three roles:

Owner
- Full access to everything
- Can manage billing, integrations, and all settings
- Cannot be removed (there must always be at least one owner)

Admin
- Can manage proposals, customers, invoices, and settings
- Can invite and remove Members (but not other Admins or Owners)

Member
- Can view and create proposals and customers
- Cannot access Settings, Reports, or financial data

To change a member's role: click the menu (three dots) on their row → Change Role.`,
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    color: '#ef4444',
    articles: [
      {
        id: 'notif-settings',
        title: 'Configuring notification settings',
        tags: ['notifications', 'email alerts', 'sms alerts', 'alerts'],
        body: `Go to Settings → Notifications to control which events trigger an email or SMS to you.

Email notifications you can toggle:
- Payment received
- Payment failed
- Invoice paid
- Proposal signed
- Proposal viewed
- Weekly summary digest

SMS notifications (requires messaging connected):
- High-value payment received
- Payment failed

Toggle each switch on or off, then click Save. Changes take effect immediately.`,
      },
    ],
  },
  {
    id: 'ai',
    label: 'Ask AI',
    icon: Sparkles,
    color: '#1b1b1b',
    articles: [
      {
        id: 'ai-overview',
        title: 'What is Ask AI?',
        tags: ['ask ai', 'ai', 'chat', 'assistant', 'help'],
        body: `Ask AI is your built-in assistant, powered by your live account data. It knows your current revenue, recent proposals, customer pipeline, and more.

Open it by clicking the sparkle button (bottom-right corner of any page) or by clicking Ask AI or Support in the sidebar.

You can ask questions like:
- "How much revenue did I make last month?"
- "Show me my open proposals"
- "How do I issue a refund?"
- "What reports are available?"

Ask AI answers in plain language without jargon. It uses your real account data to give accurate, personalised answers.`,
      },
      {
        id: 'ai-screenshot',
        title: 'Sending a screenshot to Ask AI',
        tags: ['screenshot', 'image', 'attach', 'vision', 'photo'],
        body: `Ask AI supports images. Click the paperclip icon in the input area to attach a screenshot from your device.

Once attached, type your question (or leave it blank) and press Send. The AI will analyse the screenshot and respond based on what it sees.

This is useful if you're confused by something on screen — just snap a screenshot and ask "What does this mean?" or "How do I fix this?".`,
      },
      {
        id: 'ai-voice',
        title: 'Using voice input',
        tags: ['voice', 'microphone', 'speech', 'dictate'],
        body: `On supported browsers (Chrome, Edge, Safari on iOS), a microphone icon appears in the Ask AI input bar.

Click the mic icon and speak your question. Your words are transcribed into the text field automatically. You can then edit the text before sending, or press Send immediately.

To stop recording early, click the mic icon again (it turns red while active).`,
      },
      {
        id: 'ai-escalate',
        title: 'Escalating to human support',
        tags: ['support', 'escalate', 'human', 'contact', 'help'],
        body: `After Ask AI replies, a "Still need help? Contact support →" button appears.

Click it, describe your issue in the text box, and click Send to Support. The support team receives your full conversation history plus your note, so they have full context.

You'll get a follow-up by email. Alternatively, email clients@storyvenuemarketing.com directly.`,
      },
    ],
  },
];
void _PLACEHOLDER; // suppress unused warning — data comes from shared module

// ─── Inline AI chat (mini) ────────────────────────────────────────────────────

interface AiMsg { role: 'user' | 'assistant'; content: string; }

function InlineAI() {
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isListening, setIsListening]   = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSpeechSupported(!!(w['SpeechRecognition'] || w['webkitSpeechRecognition']));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function toggleVoice() {
    const w = window as unknown as Record<string, unknown>;
    const SR = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as (new () => {
      continuous: boolean; interimResults: boolean; lang: string;
      start(): void; stop(): void;
      onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
    }) | undefined;
    if (!SR) return;
    if (isListening) { recRef.current?.stop(); setIsListening(false); return; }
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = 'en-US';
    r.onresult = (e) => setInput(p => p ? p + ' ' + e.results[0][0].transcript : e.results[0][0].transcript);
    r.onend = () => setIsListening(false);
    r.onerror = () => setIsListening(false);
    recRef.current = r; r.start(); setIsListening(true);
  }

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if ((!content && !pendingImage) || loading) return;
    const userMsg: AiMsg = { role: 'user', content: content || '(screenshot attached)' };
    const updated = [...messages, userMsg];
    setMessages(updated); setInput(''); setPendingImage(null); setLoading(true); setError('');

    const apiMessages = updated.map(m => ({ role: m.role, content: m.content }));
    try {
      const res  = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return; }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  }, [input, pendingImage, loading, messages]);

  const PROMPTS = [
    'How do I create a proposal?',
    'How do installment plans work?',
    'How do I connect QuickBooks?',
    'How do I customise my emails?',
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-900">
                  <Sparkles size={12} className="text-white" />
                </div>
                <span className="text-sm font-semibold text-gray-900">Ask AI</span>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                I have access to your live account data. Ask me anything about the platform or your account.
              </p>
            </div>
            <div className="space-y-2">
              {PROMPTS.map(p => (
                <button key={p} onClick={() => send(p)}
                  className="w-full text-left rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 hover:border-gray-300 hover:shadow-sm transition-all">
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`h-6 w-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 ${m.role === 'user' ? 'bg-gray-200' : 'bg-gray-900'}`}>
                  {m.role === 'user'
                    ? <span className="text-[9px] font-bold text-gray-500">You</span>
                    : <Sparkles size={11} className="text-white" />}
                </div>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-white border border-gray-200 text-gray-900 rounded-tr-sm' : 'bg-gray-900 text-white rounded-tl-sm'}`}>
                  {m.content.split('\n').map((line, j) => {
                    if (!line.trim()) return <div key={j} className="h-1" />;
                    if (line.trimStart().startsWith('- ')) return (
                      <div key={j} className="flex gap-1.5 mb-0.5">
                        <span className="mt-2 h-1 w-1 rounded-full bg-current flex-shrink-0 opacity-60" />
                        <span>{line.replace(/^[-\s]+/, '')}</span>
                      </div>
                    );
                    return <p key={j} className="mb-0.5 leading-relaxed">{line.replace(/^\d+\.\s/, (m) => m)}</p>;
                  })}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <div className="h-6 w-6 rounded-full bg-gray-900 flex items-center justify-center">
                  <Sparkles size={11} className="text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-gray-900 px-3 py-2.5">
                  <div className="flex gap-1 items-center">
                    {[0,1,2].map(i => (
                      <div key={i} className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {error && <p className="text-xs text-red-500 px-1">{error}</p>}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-100 p-3">
        {pendingImage && (
          <div className="relative mb-2 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingImage} alt="attachment" className="h-14 rounded-lg border border-gray-200 object-cover" />
            <button onClick={() => setPendingImage(null)} className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-gray-700 text-white flex items-center justify-center">
              <X size={9} />
            </button>
          </div>
        )}
        {isListening && (
          <p className="text-xs text-red-500 font-medium mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Listening...
          </p>
        )}
        <div className="rounded-xl border border-gray-200 bg-gray-50 focus-within:border-gray-300 focus-within:bg-white transition-colors overflow-hidden">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything..."
            rows={1}
            disabled={loading}
            className="w-full bg-transparent px-3 pt-2.5 pb-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none resize-none disabled:opacity-50"
            style={{ maxHeight: 80, lineHeight: '1.4', fontSize: 15 }}
            onInput={e => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 80) + 'px';
            }}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                title="Attach screenshot">
                <Paperclip size={14} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
              {speechSupported && (
                <button type="button" onClick={toggleVoice}
                  className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${isListening ? 'bg-red-100 text-red-500' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                  title="Voice input">
                  {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              )}
            </div>
            <button onClick={() => send()} disabled={(!input.trim() && !pendingImage) || loading}
              className="h-7 w-7 rounded-full bg-gray-900 text-white flex items-center justify-center disabled:opacity-40 transition-all">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Search term normalisation (imported from shared lib) ─────────────────────
const normaliseQuery = normaliseHelpQuery;

// ─── Highlight helper ─────────────────────────────────────────────────────────
// Splits `text` around all case-insensitive matches of `term` and wraps
// matches in a yellow <mark> span.

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term || term.length < 2) return <>{text}</>;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase()
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5 not-italic font-medium">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// Returns the best snippet from body text that contains the search term,
// with a small window of surrounding context (~140 chars).
function getBestSnippet(body: string, term: string): string {
  if (!term || term.length < 2) return body.split('\n').find(l => l.trim()) || '';
  const lower = body.toLowerCase();
  const idx   = lower.indexOf(term.toLowerCase());
  if (idx === -1) return body.split('\n').find(l => l.trim()) || '';
  const start = Math.max(0, idx - 60);
  const end   = Math.min(body.length, idx + term.length + 80);
  let snippet = body.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '\u2026' + snippet;
  if (end < body.length) snippet = snippet + '\u2026';
  return snippet;
}

// ─── Article view ─────────────────────────────────────────────────────────────

function ArticleBody({ text, highlight = '' }: { text: string; highlight?: string }) {
  const term = normaliseQuery(highlight);
  return (
    <div className="text-sm text-gray-700 leading-relaxed space-y-1.5">
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (line.trimStart().startsWith('- ')) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400 flex-shrink-0" />
              <span><Highlight text={line.replace(/^[-\s]+/, '')} term={term} /></span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line.trimStart())) {
          return <p key={i} className="pl-1 font-medium text-gray-800"><Highlight text={line} term={term} /></p>;
        }
        return <p key={i}><Highlight text={line} term={term} /></p>;
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [query, setQuery]                 = useState('');
  const [activeCat, setActiveCat]         = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [expandedCats, setExpandedCats]   = useState<Set<string>>(new Set());
  const [showAI, setShowAI]               = useState(false);
  const normalisedQuery = useMemo(() => normaliseQuery(query), [query]);

  // ── Semantic search state ──────────────────────────────────────────────────
  // semanticIds: ordered article IDs from the vector similarity API
  // semanticOnly: IDs returned by semantic search but NOT by substring search
  const [semanticIds,   setSemanticIds]   = useState<string[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError,   setSemanticError]   = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fire semantic search 400ms after the user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!normalisedQuery || normalisedQuery.length < 3) {
      setSemanticIds([]);
      setSemanticLoading(false);
      setSemanticError(false);
      return;
    }
    setSemanticLoading(true);
    setSemanticError(false);
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch('/api/help/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: normalisedQuery }),
        });
        if (!res.ok) { setSemanticError(true); setSemanticLoading(false); return; }
        const data = await res.json();
        const ids  = (data.results as { article_id: string; similarity: number }[]).map(r => r.article_id);
        setSemanticIds(ids);
      } catch {
        setSemanticError(true);
      } finally {
        setSemanticLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [normalisedQuery]);

  // Deep-link: /dashboard/help?article=pay-new opens that article directly
  useEffect(() => {
    const id = searchParams.get('article');
    if (id) {
      const a = getArticleById(id);
      if (a) {
        setActiveArticle(a);
        setArticleHighlight('');
        // Remove the query param without a full navigation
        router.replace('/dashboard/help');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Contextual articles for the *previous* page (stored in referrer logic via
  // the badge — here we just surface them in the sidebar as "Suggested for you")
  const contextualIds      = useMemo(() => getArticlesForPath(pathname), [pathname]);
  const contextualArticles = useMemo(
    () => contextualIds.map(id => getArticleById(id)).filter(Boolean) as NonNullable<ReturnType<typeof getArticleById>>[],
    [contextualIds]
  );

  const allArticles = useMemo(() => ALL_ARTICLES, []);

  // Substring results (fast, synchronous)
  const substringResults = useMemo(() => {
    if (!normalisedQuery || normalisedQuery.length < 2) return new Set<string>();
    const q = normalisedQuery.toLowerCase();
    return new Set(
      allArticles
        .filter(a =>
          a.title.toLowerCase().includes(q) ||
          a.body.toLowerCase().includes(q) ||
          a.tags.some(t => t.toLowerCase().includes(q))
        )
        .map(a => a.id)
    );
  }, [normalisedQuery, allArticles]);

  // Merged results: semantic order first, then any substring-only hits appended.
  // Each result carries a flag for whether semantic found it (but keyword didn't).
  const searchResults = useMemo(() => {
    if (!normalisedQuery || normalisedQuery.length < 2) return [];

    const seen    = new Set<string>();
    const merged: { article: typeof allArticles[0]; semanticOnly: boolean }[] = [];

    // 1. Semantic results (in similarity order) — may or may not overlap substring
    for (const id of semanticIds) {
      const a = allArticles.find(x => x.id === id);
      if (a && !seen.has(id)) {
        seen.add(id);
        merged.push({ article: a, semanticOnly: !substringResults.has(id) });
      }
    }

    // 2. Append any substring hits that semantic didn't return
    for (const id of substringResults) {
      if (!seen.has(id)) {
        const a = allArticles.find(x => x.id === id);
        if (a) { seen.add(id); merged.push({ article: a, semanticOnly: false }); }
      }
    }

    return merged;
  }, [semanticIds, substringResults, normalisedQuery, allArticles]);

  const isSearching   = normalisedQuery.length >= 2;
  const showLoading   = isSearching && semanticLoading && searchResults.length === 0;

  const activeCategory = activeCat ? CATEGORIES.find(c => c.id === activeCat) : null;

  const [articleHighlight, setArticleHighlight] = useState('');

  function selectArticle(article: Article) {
    setActiveArticle(article);
    setArticleHighlight(normalisedQuery);
    setShowAI(false);
  }

  function toggleCat(id: string) {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <BookOpen size={22} className="text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-900">Help Center</h1>
        </div>
        <p className="text-gray-500 text-sm ml-9">Documentation, guides, and platform reference for StoryVenue.</p>
      </div>

      {/* ── Search + AI toggle ── */}
      <div className="flex gap-3 mb-8">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder={'Search or ask anything\u2026 e.g. \u201chow do I create a proposal\u201d or \u201crefund\u201d'}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveCat(null); setActiveArticle(null); }}
            className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100 shadow-sm"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={15} />
            </button>
          )}
        </div>
        <button
          onClick={() => { setShowAI(v => !v); setActiveArticle(null); setActiveCat(null); setQuery(''); }}
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all shadow-sm ${showAI ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
        >
          <Sparkles size={15} />
          Ask AI
        </button>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Sidebar: categories ── */}
        <aside className="hidden lg:block w-60 flex-shrink-0 space-y-3">

          {/* Contextual: suggested articles for the current page */}
          {contextualArticles.length > 0 && !isSearching && !activeArticle && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-amber-100 flex items-center gap-2">
                <span className="text-amber-500 text-xs">✦</span>
                <p className="text-xs font-semibold text-amber-800">Suggested for this page</p>
              </div>
              <nav className="p-2 space-y-0.5">
                {contextualArticles.map(a => (
                  <button
                    key={a.id}
                    onClick={() => { setActiveArticle(a); setArticleHighlight(''); setActiveCat(null); setQuery(''); setShowAI(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left text-amber-900 hover:bg-amber-100`}
                  >
                    <div className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.catColor }} />
                    <span className="flex-1 truncate text-xs">{a.title}</span>
                    <ChevronRight size={11} className="text-amber-400 flex-shrink-0" />
                  </button>
                ))}
              </nav>
            </div>
          )}

          {/* All topics */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Topics</p>
            </div>
            <nav className="p-2 space-y-0.5">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                const isActive = activeCat === cat.id && !isSearching;
                return (
                  <button
                    key={cat.id}
                    onClick={() => { setActiveCat(cat.id); setActiveArticle(null); setQuery(''); setShowAI(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
                  >
                    <Icon size={14} />
                    <span className="flex-1">{cat.label}</span>
                    <span className={`text-xs ${isActive ? 'text-white/50' : 'text-gray-400'}`}>{cat.articles.length}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 min-w-0">

          {/* Ask AI panel */}
          {showAI && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden mb-6" style={{ height: 520 }}>
              <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-gray-100 bg-gray-900">
                <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-none">Ask AI</p>
                  <p className="text-[11px] text-white/50 mt-0.5">Powered by your live account data</p>
                </div>
              </div>
              <div className="h-[calc(520px-57px)] flex flex-col">
                <InlineAI />
              </div>
            </div>
          )}

          {/* Search results */}
          {isSearching && !showAI && (
            <div>
              {/* Header row */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-500">
                    {showLoading
                      ? <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin text-gray-400" /> Searching&hellip;</span>
                      : searchResults.length === 0
                        ? <>No articles found for <span className="font-medium text-gray-700">&ldquo;{query}&rdquo;</span></>
                        : <>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for <span className="font-medium text-gray-700">&ldquo;{normalisedQuery}&rdquo;</span></>
                    }
                  </p>
                  {/* Semantic search indicator */}
                  {!semanticLoading && semanticIds.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                      <Sparkles size={9} /> AI-powered
                    </span>
                  )}
                </div>
                {normalisedQuery !== query.trim().toLowerCase() && query.trim() && (
                  <p className="text-xs text-gray-400 italic hidden sm:block">Searching: &ldquo;{normalisedQuery}&rdquo;</p>
                )}
              </div>

              {/* Loading skeleton */}
              {showLoading && (
                <div className="space-y-3">
                  {[0,1,2].map(i => (
                    <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 animate-pulse">
                      <div className="flex gap-3">
                        <div className="h-7 w-7 rounded-lg bg-gray-100 flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 bg-gray-100 rounded w-2/3" />
                          <div className="h-2.5 bg-gray-50 rounded w-1/4" />
                          <div className="h-2.5 bg-gray-50 rounded w-full" />
                          <div className="h-2.5 bg-gray-50 rounded w-3/4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* No results */}
              {!showLoading && searchResults.length === 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-8 text-center">
                  <HelpCircle size={32} className="text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm mb-1">No articles match your search.</p>
                  <p className="text-gray-400 text-xs mb-5">Try different words, or ask AI directly.</p>
                  <button onClick={() => { setShowAI(true); setQuery(''); }}
                    className="inline-flex items-center gap-2 rounded-xl bg-gray-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-gray-800 transition-colors">
                    <Sparkles size={14} /> Ask AI instead
                  </button>
                </div>
              )}

              {/* Results list */}
              {!showLoading && searchResults.length > 0 && (
                <div className="space-y-3">
                  {searchResults.map(({ article: a, semanticOnly }) => {
                    const cat  = CATEGORIES.find(c => c.id === a.catId)!;
                    const Icon = cat.icon;
                    // For semantic-only hits there's no substring to highlight,
                    // so show the first meaningful body line as the snippet.
                    const snippet = semanticOnly
                      ? a.body.split('\n').find(l => l.trim()) || ''
                      : getBestSnippet(a.body, normalisedQuery);
                    return (
                      <button
                        key={a.id}
                        onClick={() => { selectArticle(a); setQuery(''); }}
                        className="w-full text-left rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-gray-300 transition-all p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: cat.color + '18' }}>
                            <Icon size={14} style={{ color: cat.color }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <p className="text-sm font-semibold text-gray-900">
                                {semanticOnly
                                  ? a.title
                                  : <Highlight text={a.title} term={normalisedQuery} />}
                              </p>
                              {semanticOnly && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[9px] font-medium text-violet-600 flex-shrink-0">
                                  <Sparkles size={8} /> related
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mb-1.5">{cat.label}</p>
                            <p className="text-xs text-gray-500 leading-relaxed">
                              {semanticOnly
                                ? snippet
                                : <Highlight text={snippet} term={normalisedQuery} />}
                            </p>
                          </div>
                          <ChevronRight size={14} className="text-gray-300 flex-shrink-0 mt-1" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Category + article view */}
          {!isSearching && !showAI && (
            <>
              {activeArticle ? (
                /* Single article */
                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100">
                    <button
                      onClick={() => setActiveArticle(null)}
                      className="text-xs text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1"
                    >
                      ← Back
                    </button>
                    {activeCategory && (
                      <>
                        <span className="text-gray-300 text-xs">/</span>
                        <span className="text-xs text-gray-400">{activeCategory.label}</span>
                      </>
                    )}
                  </div>
                  <div className="p-6 sm:p-8">
                    <h2 className="text-xl font-bold text-gray-900 mb-5">
                      <Highlight text={activeArticle.title} term={articleHighlight} />
                    </h2>
                    <ArticleBody text={activeArticle.body} highlight={articleHighlight} />
                    <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-between">
                      <p className="text-xs text-gray-400">Not what you were looking for?</p>
                      <button onClick={() => setShowAI(true)}
                        className="flex items-center gap-1.5 rounded-xl bg-gray-900 text-white px-3.5 py-2 text-xs font-medium hover:bg-gray-800 transition-colors">
                        <Sparkles size={12} /> Ask AI
                      </button>
                    </div>
                  </div>
                </div>
              ) : activeCategory ? (
                /* Category article list */
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: activeCategory.color + '18' }}>
                      <activeCategory.icon size={18} style={{ color: activeCategory.color }} />
                    </div>
                    <h2 className="text-lg font-bold text-gray-900">{activeCategory.label}</h2>
                    <span className="text-xs text-gray-400">{activeCategory.articles.length} articles</span>
                  </div>
                  <div className="space-y-2">
                    {activeCategory.articles.map(a => (
                      <button
                        key={a.id}
                        onClick={() => selectArticle(a)}
                        className="w-full text-left rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-gray-300 transition-all px-5 py-4 flex items-center justify-between gap-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{a.body.split('\n')[0]}</p>
                        </div>
                        <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* All categories grid */
                <div>
                  {/* Mobile: expandable category list */}
                  <div className="lg:hidden space-y-2 mb-6">
                    {CATEGORIES.map(cat => {
                      const Icon = cat.icon;
                      const open = expandedCats.has(cat.id);
                      return (
                        <div key={cat.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                          <button onClick={() => toggleCat(cat.id)}
                            className="w-full flex items-center justify-between px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.color + '18' }}>
                                <Icon size={15} style={{ color: cat.color }} />
                              </div>
                              <span className="text-sm font-semibold text-gray-900">{cat.label}</span>
                              <span className="text-xs text-gray-400">{cat.articles.length}</span>
                            </div>
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                          </button>
                          {open && (
                            <div className="border-t border-gray-100 divide-y divide-gray-50">
                              {cat.articles.map(a => (
                                <button key={a.id} onClick={() => selectArticle(a)}
                                  className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-gray-50 transition-colors">
                                  <span className="text-sm text-gray-700">{a.title}</span>
                                  <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop: category cards grid */}
                  <div className="hidden lg:grid grid-cols-2 xl:grid-cols-3 gap-4">
                    {CATEGORIES.map(cat => {
                      const Icon = cat.icon;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => { setActiveCat(cat.id); setActiveArticle(null); }}
                          className="text-left rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-gray-300 transition-all p-5 group"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl transition-colors" style={{ backgroundColor: cat.color + '18' }}>
                              <Icon size={18} style={{ color: cat.color }} />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-gray-900 group-hover:text-gray-700">{cat.label}</p>
                              <p className="text-xs text-gray-400">{cat.articles.length} article{cat.articles.length !== 1 ? 's' : ''}</p>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {cat.articles.slice(0, 3).map(a => (
                              <p key={a.id} className="text-xs text-gray-500 flex items-center gap-1.5">
                                <span className="h-1 w-1 rounded-full bg-gray-300 flex-shrink-0" />
                                {a.title}
                              </p>
                            ))}
                            {cat.articles.length > 3 && (
                              <p className="text-xs text-gray-400 pl-2.5">+{cat.articles.length - 3} more</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
