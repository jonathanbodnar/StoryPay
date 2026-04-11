// Shared help article data — imported by both the Help Center page and
// the ContextualHelpBadge so the content is never duplicated.

export interface HelpArticle {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface HelpCategory {
  id: string;
  label: string;
  color: string;
  // icon name string — components import lucide icons themselves
  iconName: string;
  articles: HelpArticle[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    iconName: 'Zap',
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
    iconName: 'LayoutDashboard',
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
    iconName: 'Users',
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
    iconName: 'CreditCard',
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
    iconName: 'BarChart2',
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
    iconName: 'Palette',
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
    iconName: 'Mail',
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
    iconName: 'Link2',
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
    iconName: 'UsersRound',
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
    iconName: 'Bell',
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
    iconName: 'Sparkles',
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

// ─── Flat article lookup ──────────────────────────────────────────────────────

export const ALL_ARTICLES: (HelpArticle & { catId: string; catLabel: string; catColor: string })[] =
  HELP_CATEGORIES.flatMap(c =>
    c.articles.map(a => ({ ...a, catId: c.id, catLabel: c.label, catColor: c.color }))
  );

export function getArticleById(id: string) {
  return ALL_ARTICLES.find(a => a.id === id);
}

// ─── Page → article mapping ───────────────────────────────────────────────────
// Keys are matched against pathname using startsWith (most specific first).

export const PAGE_ARTICLE_MAP: Record<string, string[]> = {
  // Home
  '/dashboard': ['dash-kpis', 'dash-chart', 'gs-onboarding'],

  // Customers
  '/dashboard/customers': ['cust-add', 'cust-search', 'cust-profile'],

  // Payments — new proposal / invoice
  '/dashboard/payments/new':        ['pay-new', 'pay-templates', 'pay-installments'],
  '/dashboard/invoices/new':        ['pay-new', 'pay-installments', 'pay-subscriptions'],

  // Proposals list + edit
  '/dashboard/payments/proposals':  ['pay-status', 'pay-new', 'pay-templates'],
  '/dashboard/proposals/templates': ['pay-templates', 'pay-new'],
  '/dashboard/proposals':           ['pay-templates', 'pay-new', 'pay-status'],

  // Payment schedules
  '/dashboard/payments/installments':  ['pay-installments', 'pay-new'],
  '/dashboard/payments/subscriptions': ['pay-subscriptions', 'pay-new'],

  // Transactions
  '/dashboard/transactions': ['pay-transactions', 'pay-status'],

  // Reports
  '/dashboard/reports': ['rep-overview', 'rep-download'],

  // Settings
  '/dashboard/settings/branding':        ['brand-setup'],
  '/dashboard/settings/email-templates': ['email-types', 'email-variables'],
  '/dashboard/settings/integrations':    ['int-quickbooks', 'int-freshbooks'],
  '/dashboard/settings/team':            ['team-invite', 'team-roles'],
  '/dashboard/settings/notifications':   ['notif-settings'],
  '/dashboard/settings':                 ['gs-overview', 'gs-onboarding'],

  // What's New / Updates
  '/dashboard/updates': ['ai-overview', 'gs-overview'],

  // AI
  '/dashboard/ai':   ['ai-overview', 'ai-screenshot', 'ai-voice', 'ai-escalate'],
  '/dashboard/help': ['gs-overview', 'ai-overview'],
};

// Returns the best-matching article IDs for a given pathname.
export function getArticlesForPath(pathname: string): string[] {
  // Try exact match first, then longest prefix
  if (PAGE_ARTICLE_MAP[pathname]) return PAGE_ARTICLE_MAP[pathname];
  const sorted = Object.keys(PAGE_ARTICLE_MAP).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (pathname.startsWith(key)) return PAGE_ARTICLE_MAP[key];
  }
  return ['gs-overview', 'ai-overview'];
}
