/**
 * Standalone seed script — run with:
 *   OPENAI_API_KEY=sk-... SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-embeddings.mjs
 *
 * Or if env vars are already set:
 *   node scripts/seed-embeddings.mjs
 */

const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!OPENAI_KEY)   { console.error('Missing OPENAI_API_KEY');   process.exit(1); }
if (!SUPABASE_URL) { console.error('Missing SUPABASE_URL');     process.exit(1); }
if (!SUPABASE_KEY) { console.error('Missing SUPABASE key');     process.exit(1); }

// ─── Article data (kept in sync with src/lib/help-articles.ts) ────────────────
const ARTICLES = [
  // Getting Started
  { id: 'gs-overview',    tags: ['overview','intro','dashboard','what is','storypay'],        title: 'Platform overview',                         body: 'StoryPay is an all-in-one platform for wedding venues to manage proposals, invoices, payments, customers, a booking calendar, branding, email templates, and team members.' },
  { id: 'gs-onboarding',  tags: ['checklist','onboarding','setup','first steps','restart'],   title: 'Get Started checklist',                     body: 'When you first access your dashboard you will see a Get Started checklist. It tracks 6 steps: Branding, Email Templates, First Template, First Proposal, Send Proposal, Invite Team Member.' },
  { id: 'gs-login',       tags: ['login','link','access','sign in','token'],                  title: 'Logging in and your login link',            body: 'StoryPay uses magic-link login. You receive a personalised login URL. Opening that link sets your session automatically — no password needed. Session lasts 30 days.' },
  // Dashboard
  { id: 'dash-kpis',      tags: ['kpi','revenue','metrics','home','stats'],                   title: 'Understanding your KPI cards',              body: 'The Home dashboard shows six KPI cards: Total Revenue, New Proposals, Signed Proposals, Pending Amount, Refunds, Avg Proposal Value. Use the date range picker to change the period.' },
  { id: 'dash-chart',     tags: ['chart','graph','revenue','status','pipeline'],              title: 'Revenue chart and proposal status breakdown', body: 'Below the KPI cards is an area chart showing daily or monthly revenue. Beneath the chart is a status breakdown showing Draft, Sent, Viewed, Signed, Paid, Refunded, Cancelled proposals.' },
  // Calendar
  { id: 'cal-overview',   tags: ['calendar','events','booking','schedule','tour','wedding'],  title: 'Calendar overview',                         body: 'The Calendar shows all venue events — tours, weddings, receptions, tastings, meetings, rehearsals, holds, and blocked dates. Month view with color-coded event chips. Revenue View shows 12-month grid.' },
  { id: 'cal-spaces',     tags: ['spaces','barn','garden','ballroom','room','venue space'],   title: 'Managing venue spaces',                     body: 'Add bookable spaces (e.g. Barn, Garden, Ballroom) via Manage Spaces on the Calendar page. Each space gets a color. Filter the calendar by space using the filter pills above the grid.' },
  { id: 'cal-add-event',  tags: ['add event','new event','book','schedule','create event'],   title: 'Adding and editing events',                 body: 'Click any day or the Add Event button to create an event. Fill in title, type, status, space, customer email, date and time, notes. Click Save Event. Click an event chip to see details or delete.' },
  { id: 'cal-conflicts',  tags: ['conflict','double booking','overlap','same date'],          title: 'Double-booking protection',                 body: 'StoryPay checks for booking conflicts at the database level. If a space is already booked during that time you get a conflict warning. You can override it if needed.' },
  { id: 'cal-ical',       tags: ['ical','google calendar','outlook','apple calendar','sync','subscribe','phone'], title: 'Syncing with Google Calendar, Outlook, Apple Calendar', body: 'StoryPay provides an iCal subscription feed. Find your iCal URL at Settings → Integrations. In Google Calendar: + next to Other calendars → From URL → paste URL. In Outlook: Add calendar → Subscribe from web.' },
  { id: 'cal-calendly',   tags: ['calendly','sync','booking','tour booking','integration'],   title: 'Connecting Calendly',                       body: 'Connect Calendly at Settings → Integrations → Calendly → Connect. Requires a Personal Access Token from calendly.com/integrations/api_webhooks. New bookings appear on calendar instantly. Customer profiles auto-created.' },
  { id: 'cal-availability', tags: ['availability','public','share','open dates','prospects'], title: 'Public availability page',                  body: 'StoryPay generates a public availability page showing open/booked dates without revealing customer info. Find the URL at Settings → Integrations. Share on your website or with prospects.' },
  // Customers (CRM)
  { id: 'cust-add',       tags: ['add customer','new customer','create contact'],             title: 'Adding a customer',                         body: 'Go to Customers and click Add Customer. Fill in First Name, Last Name, Email, Phone, Address. You can also create a customer inline while building a proposal.' },
  { id: 'cust-search',    tags: ['search','find customer','filter'],                          title: 'Searching and filtering customers',          body: 'On the Customers page there is a search bar. Type any part of a name, email, or phone number and results filter in real time. Results are paginated 20 per page.' },
  { id: 'cust-profile',   tags: ['customer profile','crm','profile','tabs','overview'],       title: 'Customer profile — overview and tabs',      body: 'Click a customer name to open their full profile. 5 tabs: Overview (contact, partner info, wedding details, notes), Activity (timeline), Payments, Tasks, Documents. Pipeline stage and referral source in header.' },
  { id: 'cust-pipeline',  tags: ['pipeline','stage','lead','referral','source','funnel'],     title: 'Pipeline stages and referral source',       body: 'Pipeline stages: Inquiry, Tour Scheduled, Proposal Sent, Booked, Event Complete, Post-Event Follow-up. Click any stage on the customer profile to update it. Referral source: Instagram, Google, Wedding Wire, etc.' },
  { id: 'cust-tasks',     tags: ['tasks','todo','checklist','follow up','reminder'],          title: 'Customer tasks',                            body: 'Tasks tab on a customer profile. Add tasks with optional due dates. Overdue tasks show in red. Check off completed tasks — they collapse but stay visible. Tasks are internal only.' },
  { id: 'cust-documents', tags: ['documents','files','upload','contract','floor plan','insurance'], title: 'Customer documents and files',        body: 'Documents tab lets you upload files: contracts, floor plans, vendor agreements, insurance, photos. Max 10MB. Each file has a type and status (Pending, Received, Approved). Click to download.' },
  // Payments
  { id: 'pay-new',        tags: ['new proposal','new invoice','create','send','draft'],       title: 'Creating a new proposal or invoice',        body: 'Go to Payments New. Choose Proposal or Invoice mode. Find or create the customer. Add line items. Choose payment type: full payment, installment plan, or subscription. Click Send or Save Draft.' },
  { id: 'pay-templates',  tags: ['template','contract','reuse','edit template'],              title: 'Proposal templates',                        body: 'Templates save your standard contract text. Create at Payments Proposal Templates New Template. Add signing fields: Signature, Printed Name, Date. Set default pricing.' },
  { id: 'pay-status',     tags: ['status','draft','sent','signed','paid','cancelled'],        title: 'Proposal statuses explained',               body: 'Proposal statuses: Draft, Sent, Viewed, Signed, Paid, Fully Paid, Refunded, Cancelled. Resend a proposal at any status from the Proposals list or customer profile.' },
  { id: 'pay-installments', tags: ['installment','payment plan','deposit','schedule'],       title: 'Installment plans',                         body: 'Installment plans let customers pay in stages. Configure deposit amount, second payment, and final balance with due dates. Customers are automatically reminded by email.' },
  { id: 'pay-subscriptions', tags: ['subscription','recurring','weekly','monthly'],          title: 'Subscriptions',                             body: 'Subscriptions charge the customer on a repeating weekly or monthly schedule. Set charge amount, frequency, and start date. View active subscriptions at Payments Subscriptions.' },
  { id: 'pay-transactions', tags: ['transactions','charges','refund','history'],             title: 'Viewing transactions and issuing refunds',  body: 'Go to Payments Transactions. Charges tab lists every payment. To refund: find the charge, click Refund, enter amount, confirm. Refunds appear within 3-7 business days.' },
  // Reports
  { id: 'rep-overview',   tags: ['reports','export','csv','pdf','excel','download'],         title: 'Available reports',                         body: '7 report types: Revenue, Proposals, Customers, Aging, Payment Methods, Refunds, Bank Reconciliation. Filter by date range. Download as CSV, Excel, or PDF.' },
  { id: 'rep-download',   tags: ['download','export','csv','excel','pdf'],                   title: 'Downloading and exporting reports',         body: 'After previewing a report three download buttons appear: CSV, Excel xlsx, PDF. Downloads happen instantly in your browser.' },
  // Branding
  { id: 'brand-setup',    tags: ['branding','logo','colors','brand','customize'],            title: 'Setting up your brand',                     body: 'Go to Settings Branding. Upload your logo. Choose a color preset or custom colors. Fill in contact info. Live preview updates in real time.' },
  // Email Templates
  { id: 'email-types',    tags: ['email','templates','automated','notification','test email'], title: 'Email template types',                    body: '7 email template types: Invoice, Proposal, Payment Confirmation, Payment Notification, Subscription Confirmation, Subscription Cancelled, Payment Failed. Toggle each on or off.' },
  { id: 'email-variables', tags: ['variables','merge','dynamic','placeholders','template'],  title: 'Using merge variables in email templates',  body: 'Merge variables are placeholders replaced with real data when the email sends: organization, customer_name, amount, invoice_number, due_date, payment_method.' },
  // Integrations
  { id: 'int-calendly',   tags: ['calendly','booking','sync','tour booking','integration','connect'], title: 'Connecting Calendly',              body: 'Connect at Settings → Integrations → Calendly → Connect. Paste your Personal Access Token from calendly.com/integrations/api_webhooks. New bookings appear in real time. Cancellations auto-update.' },
  { id: 'int-google-cal', tags: ['google calendar','outlook','apple calendar','ical','sync','subscribe','phone calendar'], title: 'Google Calendar, Outlook & Apple Calendar sync', body: 'Find your iCal URL at Settings → Integrations. Google Calendar: + Other calendars → From URL → paste. Outlook: Add calendar → Subscribe from web. Apple: File → New Calendar Subscription.' },
  { id: 'int-quickbooks', tags: ['quickbooks','accounting','integration','sync','qbo'],      title: 'Connecting QuickBooks Online',              body: 'Go to Settings Integrations. Click Connect on QuickBooks Online. Authorise on Intuit. Invoices and payments sync automatically. Click Sync Now for immediate sync.' },
  { id: 'int-freshbooks', tags: ['freshbooks','accounting','integration','sync'],            title: 'Connecting FreshBooks',                     body: 'Go to Settings Integrations. Click Connect on FreshBooks. Authorise access. Invoices and charges sync to FreshBooks automatically. Disconnect at any time.' },
  // Team
  { id: 'team-invite',    tags: ['team','invite','add member','staff','user','email invite'], title: 'Inviting team members',                    body: 'Go to Settings Team. Click Add Team Member. Fill in name, email, role. Member receives a branded invitation email with Accept Invitation button. Resend, edit, or remove via the menu. Venue owners can enable Hide dollar signs for CRM for specific members.' },
  { id: 'team-roles',     tags: ['roles','permissions','owner','admin','member','access'],    title: 'Team roles and permissions',                body: 'Three roles: Owner full access including calendar, settings, and integrations. Admin manage proposals, customers, calendar, most settings. Member view proposals, customers, calendar only. Owners can hide pipeline revenue amounts per team member on Leads.' },
  // Notifications
  { id: 'notif-settings', tags: ['notifications','email alerts','sms alerts','alerts'],      title: 'Configuring notification settings',         body: 'Go to Settings Notifications. Toggle email and SMS notifications: payment received, failed, invoice paid, proposal signed, viewed, weekly digest. Save to apply.' },
  { id: 'sms-notifications', tags: ['sms','text message','phone','messaging','ghl'],         title: 'SMS notifications for customers',           body: 'SMS is sent automatically when proposals and invoices are created if the customer has a phone number. Requires GHL sub-account connected. Phone numbers auto-formatted to E.164.' },
  // Ask AI
  { id: 'ai-overview',    tags: ['ask ai','ai','chat','assistant','help'],                   title: 'What is Ask AI?',                           body: 'Ask AI is your built-in assistant powered by live account data and product documentation. Knows revenue, proposals, and on the Leads page a detailed lead pipeline snapshot. Open via the sparkle button.' },
  { id: 'leads-crm-intelligence', tags: ['weighted','roi','audit','owner','hide revenue','insights'], title: 'Leads pipeline intelligence and audit', body: 'Leads shows open and weighted pipeline, referral and directory revenue hints, assignable owners, activity audit for stage value and owner changes, log a call, and Hide dollar amounts for some team roles.' },
  { id: 'ai-screenshot',  tags: ['screenshot','image','attach','vision','photo'],            title: 'Sending a screenshot to Ask AI',            body: 'Ask AI supports images. Click the paperclip icon to attach a screenshot. The AI analyses the screenshot and responds. Useful when confused by something on screen.' },
  { id: 'ai-voice',       tags: ['voice','microphone','speech','dictate'],                   title: 'Using voice input',                         body: 'On supported browsers a microphone icon appears in the Ask AI input bar. Click the mic and speak your question. Words are transcribed automatically into the text field.' },
  { id: 'ai-escalate',    tags: ['support','escalate','human','contact','help'],             title: 'Escalating to human support',               body: 'After Ask AI replies a Still need help button appears. Click it, describe your issue, and click Send to Support. The team receives your full conversation history. You get a follow-up by email.' },
];

async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

async function upsertEmbedding(articleId, embedding) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_help_embedding`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      p_article_id: articleId,
      p_embedding:  embedding,
      p_updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  return true;
}

async function main() {
  console.log(`Seeding ${ARTICLES.length} articles...`);
  const BATCH = 8;
  let seeded = 0, errors = 0;

  for (let i = 0; i < ARTICLES.length; i += BATCH) {
    const batch  = ARTICLES.slice(i, i + BATCH);
    const inputs = batch.map(a => `${a.title}. ${a.tags.join(', ')}. ${a.body.slice(0, 500)}`);

    try {
      const vectors = await embedBatch(inputs);
      for (let j = 0; j < batch.length; j++) {
        try {
          await upsertEmbedding(batch[j].id, vectors[j]);
          console.log(`  ✓ ${batch[j].id}`);
          seeded++;
        } catch (e) {
          console.error(`  ✗ ${batch[j].id}: ${e.message}`);
          errors++;
        }
      }
    } catch (e) {
      console.error(`  Batch ${i}-${i+BATCH} failed: ${e.message}`);
      errors += batch.length;
    }

    if (i + BATCH < ARTICLES.length) await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone: ${seeded} seeded, ${errors} errors`);
}

main().catch(console.error);
