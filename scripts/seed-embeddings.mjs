/**
 * Standalone seed script — run with:
 *   OPENAI_API_KEY=sk-... SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-embeddings.mjs
 *
 * Or if Railway/env is set:
 *   node scripts/seed-embeddings.mjs
 */

const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!OPENAI_KEY)   { console.error('Missing OPENAI_API_KEY');   process.exit(1); }
if (!SUPABASE_URL) { console.error('Missing SUPABASE_URL');     process.exit(1); }
if (!SUPABASE_KEY) { console.error('Missing SUPABASE key');     process.exit(1); }

// ─── Article data (inline copy — no TS imports needed) ────────────────────────
const ARTICLES = [
  { id: 'gs-overview',    tags: ['overview','intro','dashboard','what is'],             title: 'Platform overview',                          body: 'StoryVenue is an all-in-one platform for wedding venues to manage proposals, invoices, payments, customers, and team members.' },
  { id: 'gs-onboarding',  tags: ['checklist','onboarding','setup','first steps'],       title: 'Get Started checklist',                      body: 'When you first access your dashboard you will see a Get Started checklist. It tracks 6 steps: Payment Processing, First Customer, First Proposal, Branding, Email Templates, Team Member.' },
  { id: 'gs-login',       tags: ['login','link','access','sign in','token'],            title: 'Logging in and your login link',             body: 'StoryVenue uses magic-link login. You receive a personalised login URL. Opening that link sets your session automatically — no password needed. Your session lasts 30 days.' },
  { id: 'dash-kpis',      tags: ['kpi','revenue','metrics','home','stats'],             title: 'Understanding your KPI cards',               body: 'The Home dashboard shows six KPI cards: Total Revenue, New Proposals, Signed Proposals, Pending Amount, Refunds, Avg Proposal Value. Use the date range picker to change the period.' },
  { id: 'dash-chart',     tags: ['chart','graph','revenue','status','pipeline'],        title: 'Revenue chart and proposal status breakdown', body: 'Below the KPI cards is an area chart showing daily or monthly revenue. Beneath the chart is a status breakdown showing Draft, Sent, Viewed, Signed, Paid, Refunded, Cancelled proposals.' },
  { id: 'cust-add',       tags: ['add customer','new customer','create contact'],       title: 'Adding a customer',                          body: 'Go to Customers and click Add Customer. Fill in First Name, Last Name, Email, Phone, Address. You can also create a customer inline while building a proposal.' },
  { id: 'cust-search',    tags: ['search','find customer','filter'],                   title: 'Searching and filtering customers',           body: 'On the Customers page there is a search bar. Type any part of a name, email, or phone number and results filter in real time. Results are paginated 20 per page.' },
  { id: 'cust-profile',   tags: ['customer profile','proposals','history','refund'],   title: 'Customer profile and proposal history',      body: 'Click a customer name to open their profile. Edit contact details, see all proposals, copy proposal links, resend proposal emails, issue refunds on completed payments.' },
  { id: 'pay-new',        tags: ['new proposal','new invoice','create','send','draft'], title: 'Creating a new proposal or invoice',         body: 'Go to Payments New. Choose Proposal or Invoice mode. Find or create the customer. Add line items. Choose payment type: full payment, installment plan, or subscription. Click Send or Save Draft.' },
  { id: 'pay-templates',  tags: ['template','contract','reuse','edit template'],       title: 'Proposal templates',                         body: 'Templates save your standard contract text. Create at Payments Proposal Templates New Template. Add signing fields: Signature, Printed Name, Date. Set default pricing.' },
  { id: 'pay-status',     tags: ['status','draft','sent','signed','paid','cancelled'], title: 'Proposal statuses explained',                body: 'Proposal statuses: Draft saved not sent, Sent emailed to customer, Viewed customer opened the link, Signed customer completed e-signature, Paid payment received, Fully Paid all payments collected, Refunded, Cancelled.' },
  { id: 'pay-installments', tags: ['installment','payment plan','deposit','schedule'], title: 'Installment plans',                          body: 'Installment plans let customers pay in stages. Configure deposit amount and due date, second payment, final balance. Customers are automatically reminded by email as due dates approach.' },
  { id: 'pay-subscriptions', tags: ['subscription','recurring','weekly','monthly'],   title: 'Subscriptions',                              body: 'Subscriptions charge the customer on a repeating weekly or monthly schedule until cancelled. Set charge amount, frequency, and start date. Card is charged automatically.' },
  { id: 'pay-transactions', tags: ['transactions','charges','refund','history'],       title: 'Viewing transactions and issuing refunds',   body: 'Go to Payments Transactions. Charges tab lists every payment. To issue a refund: find the charge, click Refund, enter amount, confirm. Refunds appear within 3-7 business days.' },
  { id: 'rep-overview',   tags: ['reports','export','csv','pdf','excel','download'],  title: 'Available reports',                          body: 'Go to Reports. Select a date range. 7 report types: Revenue, Proposals, Customers, Aging, Payment Methods, Refunds, Bank Reconciliation. Click Preview then download as CSV, Excel, or PDF.' },
  { id: 'rep-download',   tags: ['download','export','csv','excel','pdf'],            title: 'Downloading and exporting reports',          body: 'After previewing a report three download buttons appear: CSV plain text, Excel formatted xlsx file, PDF print-ready document. Downloads happen instantly in your browser.' },
  { id: 'brand-setup',    tags: ['branding','logo','colors','brand','customize'],     title: 'Setting up your brand',                      body: 'Go to Settings Branding. Upload your logo. Choose a brand color. Fill in contact details email phone address. Add tagline and website URL. Live Preview updates as you type.' },
  { id: 'email-types',    tags: ['email','templates','automated','notification'],      title: 'Email template types',                       body: '7 email template types: Invoice, Proposal, Payment Confirmation, Payment Notification, Subscription Confirmation, Subscription Cancelled, Payment Failed. Toggle Enable or Disable each.' },
  { id: 'email-variables', tags: ['variables','merge','dynamic','placeholders'],      title: 'Using merge variables in email templates',   body: 'Merge variables are placeholders replaced with real data when the email sends. Common variables: organization, customer_name, amount, invoice_number, due_date, payment_method.' },
  { id: 'int-quickbooks', tags: ['quickbooks','accounting','integration','sync','qbo'], title: 'Connecting QuickBooks Online',             body: 'Go to Settings Integrations. Click Connect on QuickBooks Online. Authorise on Intuit. Invoices and payments sync automatically. Click Sync Now for immediate sync.' },
  { id: 'int-freshbooks', tags: ['freshbooks','accounting','integration','sync'],     title: 'Connecting FreshBooks',                      body: 'Go to Settings Integrations. Click Connect on FreshBooks. Authorise access. Invoices and charges sync to FreshBooks automatically. Disconnect at any time.' },
  { id: 'team-invite',    tags: ['team','invite','add member','staff','user'],         title: 'Inviting team members',                      body: 'Go to Settings Team. Click Add Team Member. Fill in First Name, Email, Role: Owner Admin or Member. Team member appears immediately. Resend invite, change role, or remove at any time.' },
  { id: 'team-roles',     tags: ['roles','permissions','owner','admin','member'],      title: 'Team roles and permissions',                 body: 'Three roles: Owner full access including billing. Admin manage proposals customers invoices settings. Member view and create proposals customers only. Change role via the menu on their row.' },
  { id: 'notif-settings', tags: ['notifications','email alerts','sms alerts'],        title: 'Configuring notification settings',          body: 'Go to Settings Notifications. Toggle email and SMS notifications: payment received, payment failed, invoice paid, proposal signed, proposal viewed, weekly summary digest. Save to apply.' },
  { id: 'ai-overview',    tags: ['ask ai','ai','chat','assistant','help'],             title: 'What is Ask AI?',                            body: 'Ask AI is your built-in assistant powered by live account data. Knows current revenue, proposals, customer pipeline. Open by clicking the sparkle button. Ask anything about the platform or your account.' },
  { id: 'ai-screenshot',  tags: ['screenshot','image','attach','vision','photo'],     title: 'Sending a screenshot to Ask AI',             body: 'Ask AI supports images. Click the paperclip icon to attach a screenshot. The AI will analyse the screenshot and respond based on what it sees. Useful when confused by something on screen.' },
  { id: 'ai-voice',       tags: ['voice','microphone','speech','dictate'],            title: 'Using voice input',                          body: 'On supported browsers a microphone icon appears in the Ask AI input bar. Click the mic icon and speak your question. Words are transcribed automatically. Click mic again to stop recording.' },
  { id: 'ai-escalate',    tags: ['support','escalate','human','contact','help'],       title: 'Escalating to human support',               body: 'After Ask AI replies a Still need help button appears. Click it, describe your issue, and click Send to Support. The team receives your full conversation history. You get a follow-up by email.' },
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
