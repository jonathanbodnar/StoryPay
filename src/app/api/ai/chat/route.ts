import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import OpenAI from 'openai';

const PLATFORM_DOCS = `
# StoryPay Platform Documentation

## Overview
StoryPay is an all-in-one platform for wedding venues to manage proposals, invoices, payments, a booking calendar, contact CRM profiles, email templates, branding, integrations, and team members — all from one place.

## Navigation / Sections
- Home (Dashboard): Revenue overview, KPI cards, recent proposals and transactions, date range filter.
- Ask AI: Sidebar entry plus floating sparkle (bottom-right) — answers questions using live account data and this documentation (updated for Venue listing, Media library, Reviews, Conversations, public API/embed, and Help Center).
- Contacts: Full CRM — contact profiles with Overview, Notes, Activity timeline, Payments, Tasks, Documents; configurable sales pipeline and stages in the profile header (aligned with Leads when email matches).
- Conversations: Unified inbox per contact — **Team only** internal notes (optional @mentions to teammates) vs **Email contact** outbound messages. Threads use venue customers; external sends email when the contact has an email on file. Path: /dashboard/conversations. Related DB: conversation_threads, conversation_messages (migration 022). **Two-way** by design: outbound email uses a per-thread Reply-To on the inbound subdomain (e.g. inbound.storyvenue.com) and Resend's email.received webhook at /api/webhooks/inbound-email appends the customer's reply to the same thread. Outbound SMS goes through the connected GHL sub-account's A2P number; inbound SMS is posted back via GHL webhooks and threaded by phone number.
- Calendar: Book and track all venue events (tours, weddings, receptions, tastings, meetings, rehearsals, holds, blocked dates). Syncs with Calendly, Google Calendar, Outlook, and Apple Calendar. Event chips take their color from the assigned **venue space** (the old per-event-type color legend was removed). The New/Edit Event modal supports **inline Space management** (add/edit/remove without leaving the form), a **contact search** field that attaches the event to a venue customer, and an **Assigned team member** picker when team members are present.
- Venue listing (sidebar flyout, Store icon): **Dashboard** — edit how the venue appears on storyvenue.com (description, slug, capacity, publish toggle); autosaves. **Media library** — shared image assets for the venue (upload once, reuse URLs): JPEG, PNG, WebP, AVIF, GIF only; max 10MB each; video uploads are not supported. **Photos** — cover + gallery for the directory listing (upload directly or pick from Media library). **Analytics** — (1) GA4 Measurement ID for full Google Analytics integration; (2) **Real-time visitor map** — interactive Leaflet world map showing live and recent visitors to your listing with pulsing markers, hover tooltips (city/region), and zoom controls. **Reviews** — (1) StoryVenue reviews: star ratings and testimonials; statuses published / pending / hidden; published reviews feed the public directory via API and embed; (2) **Google Reviews tab**: connect your Google Business Profile via auto-search or by pasting a Google Maps link to display your Google reviews on your storyvenue.com listing. Paths: /dashboard/listing, /dashboard/listing/media, /dashboard/listing/images, /dashboard/listing/analytics, /dashboard/listing/reviews.
- Leads: Kanban and list views for inquiries — same configurable sales pipelines and stages as contact profiles. Includes pipeline intelligence (open pipeline vs weighted forecast, rough referral/directory revenue vs listing spend), per-lead opportunity value on cards, assignable owners, marketing tags, trigger links, an audit trail (stage/value/owner changes and logged calls), and mobile-friendly actions (drag cards, log call, quick note). **Every contact shows up in the pipeline**: the server reconciles leads and venue_customers on load so any contact with a real email has a lead snapped to its contact-profile pipeline/stage (contact stage is the source of truth), and broken references heal to the default pipeline's first stage instead of disappearing. The **+ Add Lead** modal includes a **Space** picker with inline add/edit/remove (same UX as the calendar event modal). Pipeline stage colors use a popover color picker with a **hex code** input, the native color wheel, and preset swatches.
- Reports: 7 downloadable financial reports (CSV, Excel, PDF). Owners and admins only.
- Payments (sidebar flyout): New, Proposals, Proposal Templates, Installments, Subscriptions, Transactions.
- Marketing (sidebar flyout): Analytics, Lead Capture Forms, email tools, trigger links & tags (availability depends on role).
- Help Center: Searchable categories and articles (including Venue listing, Reviews, Conversations, Ask AI, Leads); contextual suggestions by page; voice search; article ratings.
- What's New: Changelog and Feature Requests board. The sidebar menu item shows a **red dot with unread count** whenever there are entries a user hasn't reviewed; visiting the page marks everything read for that user (per-user read state). Feature Requests submitted by venues can be **approved, edited, or removed** by super admins. When a super admin approves a request it's automatically converted into a **What's New** changelog entry with an outcome-based auto-generated headline + description, and the request is removed from the venue's own feature-request list.
- Settings (sidebar flyout): General (venue info, service fee), Branding, Email Templates, Integrations (Calendly, Google Calendar, QuickBooks, FreshBooks), Team (roles, invites, **Hide $** for team members — owners only), Notifications. Venues may also store **listing marketing monthly spend** on the account for Leads ROI — when that value exists, insights use it.
- Sidebar collapse (desktop): Chevron next to the logo narrows the sidebar to an icon rail and shows a compact mark; preference is saved in the browser.

## Venue listing, reviews, and storyvenue.com
- Public read API (no login): GET /api/public/venues/[slug] returns published venue fields plus **published** reviews only (404 if venue not published).
- Reviews embed (for the marketing site): GET /embed/listing-reviews/[slug] — iframe-friendly page; Content-Security-Policy allows framing from storyvenue.com. The Reviews dashboard shows a copy-paste iframe snippet using the venue slug.
- Full public preview on app host: /venue/[slug] (same data as API).
- Supabase: listing_reviews table (migration 024); optional listing_reviews_public view for anon-safe reads (migration 025). Service role is used for dashboard APIs.

## Google Reviews (listing)
- Venue listing → Reviews → Google tab lets you connect your Google Business Profile so your Google reviews appear on your storyvenue.com listing.
- **Search flow (primary)**: The tab auto-searches Google using your venue name and location as soon as it opens. If your business appears in results, click "Yes, that's us" to link it.
- **Google Maps URL paste (fallback)**: If the search doesn't return your business (common for service-area businesses with no storefront), expand "Can't find it? Paste a Google Maps link instead" and paste any Google Maps URL — share link (maps.app.goo.gl), full browser URL, or a link from your Google Business Profile. The system extracts the Place ID automatically.
- **Service-area businesses**: If your business has no fixed address (you travel to clients), the Google Places API cannot look it up by name. Use the Maps URL fallback instead. If that also fails, copy your Place ID from Google's Place ID Finder (linked in the UI) and paste it directly.
- Once connected, a green "Connected to Google Business" banner appears. StoryPay caches your reviews and refreshes them periodically. You can force a refresh with the refresh icon.
- Requires GOOGLE_PLACES_API_KEY to be set in the environment. If not set, a 503 response is returned and the fallback is shown.
- On the public storyvenue.com listing, up to 5 Google reviews are shown in a single-column layout. A "See all Google reviews" button links directly to your Google Maps listing so couples can read every review.

## Listing analytics — Real-time visitor map
- Path: /dashboard/listing/analytics → scroll to "Live visitor map" section.
- The interactive world map shows real-time and recent visitors to your public storyvenue.com listing.
- **Live markers** (pulsing red dot): visitors active within the last 90 seconds (heartbeat signal received).
- **Recent markers** (indigo dot): visitors seen within the last 30 minutes.
- Zoom in/out with the + / − controls (Google Maps style). Pan by dragging.
- Hover a marker to see the visitor's city, region, country, and how recently they were active.
- The map always shows (even with no visitors); an overlay reads "No visitors in the last 30 minutes" when the map is empty.
- Powered by Leaflet.js + OpenStreetMap (CartoDB Positron tiles). No Google Maps billing.
- Geographic data (latitude, longitude, city, region, country) is captured server-side via ip-api.com on every tracking event and stored in the listing_events table (migration 057).
- The realtime API endpoint /api/listing-analytics/realtime returns geo_points: one entry per active session with lat, lng, city, region, country, flag, and live boolean.

## Media library (shared venue images)
- Path: /dashboard/listing/media (sidebar → Venue listing → Media library). Central library for image files your venue reuses across the product.
- Upload images here; each file gets a stable public URL you can copy. Supported types: JPEG, PNG, WebP, AVIF, GIF. Max 10MB per file. Video uploads are not supported.
- Where it connects: **Listing photos** (/dashboard/listing/images) — "From media library" adds an image to the gallery. **Marketing → Email templates** — Image block → "Choose from media library". **Marketing → Lead Capture Forms** — Image block → "Choose from media library". **Settings → Branding** — "Choose from media library" for the logo (or upload a file separately). Deleting an asset in Media library removes the file from storage and breaks any remaining links to that URL.
- Database: venue_media_assets table (migration 030); files stored in Supabase Storage bucket venue-images under paths like {venueId}/media/...

## Conversations (inbox)
- List threads with contact names; open thread to load messages.
- Composer: toggle **Team only** vs **Email contact** before sending; @mentions only on team notes.
- Requires conversation tables applied in Supabase (022); service role on server.

## Calendar
- Go to Calendar in the sidebar.
- Add events: click any day or click "+ Add Event". Event types: Wedding, Reception, Tour, Phone call, Tasting, Meeting, Rehearsal, Hold, Blocked, Other.
- Statuses: Confirmed, Tentative/Hold, Cancelled.
- Assign events to a specific bookable space (e.g. Barn, Garden, Ballroom) — manage spaces via "Manage Spaces" button.
- Double-booking protection: if a space already has an event during that time window, you get a conflict warning with details. You can override it if needed (e.g. back-to-back setup times).
- Revenue View: 12-month grid showing wedding/tour counts per month at a glance — click a month to jump to it.
- iCal sync: subscribe from Google Calendar, Outlook, or Apple Calendar using the iCal URL in Settings → Integrations.
- Calendly sync: connect Calendly in Settings → Integrations — new bookings appear on the calendar automatically.
- Public availability page: shareable link showing open/booked dates with no customer info exposed — find it in Settings → Integrations.

## Contact profiles (CRM)
- Go to Contacts → click a contact name to open their full profile.
- Tabs: Overview, Notes, Activity (timeline), Payments, Tasks, Documents.
- Overview: edit contact info; partner/second contact; Wedding Details (date, ceremony type, guest count, space, rehearsal, coordinator, catering notes); referral source.
- Notes: timestamped internal notes (editable after creation).
- Activity: unified reverse-chronological timeline — proposals, payments, notes, files, tasks, Calendly, pipeline stage changes, etc.
- Payments: proposals and invoices; installments; copy link, resend, refund.
- Tasks: due dates, complete/reopen, inline edit; overdue highlighted.
- Documents: upload (max 10MB); types Contract, Floor Plan, Vendor Agreement, Insurance, Photo, Other; statuses Pending, Received, Approved.
- Pipeline (card below header): Use the **Pipeline** dropdown to pick one of your venue's sales pipelines (same pipelines as Leads / Kanban). **Stage** pills list that pipeline's stages with colors from your setup — click a pill to move the contact; saves to the server (UI updates immediately). If a lead exists with the same email, you may see "Linked to lead — stage syncs both ways". Default template stages often include Lead, Conversations Started, Lead Contacted, Tour Booked, Proposal Sent, Wedding Booked, Follow up, Not Interested — venues can rename, add, or reorder stages on the Leads page.
- Legacy pipeline_stage slug may still appear in older integrations; the Kanban pipeline IDs are the source of truth for the dashboard UI.
- Referral source: Instagram, Google, Wedding Wire, The Knot, Referral, Venue Website, Facebook, Other.

## Leads (sales pipeline)
- Leads → Kanban (columns = stages) or List. Switch pipelines with the pipeline picker; edit stages/pipelines from Leads (gear / Edit).
- **Insights strip** (below the header): summarizes **open pipeline** (sum of opportunity values), **weighted pipeline** (each deal × stage win probability; default probabilities by stage kind if a stage has no custom %), **booked revenue** attributed to directory vs referrals (matched from paid proposals by customer email), and a simple **ROI hint** vs **listing marketing monthly spend** when that monthly budget exists on the venue account.
- **Cards and columns** show opportunity value; columns and cards also show **weighted (wtd)** amounts. **Assignee** initials can appear on cards when a lead has an owner.
- **Lead drawer**: edit fields; **Owner** dropdown (team members); **Activity & audit** (who changed stage, opportunity value, or owner; **Log a call** posts to the audit feed); **Timeline** for notes, tasks, emails, etc.; **Hide $**: some team roles never see dollar amounts (see Team).
- **Trust / permissions**: Stage, value, and assignment changes are logged with actor (owner vs team member). Venue owners can mark team members **Hide $** under Settings → Team so those users see masked amounts (•••) in CRM.
- Moving a lead or updating a linked contact profile stage keeps CRM and pipeline consistent when emails match.

## Integrations

### Calendly
- Connect at Settings → Integrations → Calendly → Connect.
- Requires a Personal Access Token from calendly.com/integrations/api_webhooks.
- Once connected: new bookings appear on StoryPay calendar in real time; contact profiles auto-created; cancellations auto-update.
- Sync Now button imports all upcoming Calendly events on demand.

### Google Calendar / Outlook / Apple Calendar (iCal)
- One-way sync: StoryPay events appear in your calendar app.
- Find your iCal URL: Settings → Integrations → Google Calendar / Outlook & Apple Calendar card.
- Google Calendar: + next to Other calendars → From URL → paste → Add calendar.
- Outlook: Add calendar → Subscribe from web → paste URL → Import.
- Apple Calendar: File → New Calendar Subscription → paste URL → set refresh to Every Hour.
- iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.
- Updates may take up to 24 hours depending on the app.

### Public Availability Page
- Shareable link showing open/booked dates — no customer names exposed.
- Find it: Settings → Integrations → Google Calendar card → Public Availability Page section.
- Share on your website or with prospects to let them check date availability.

### QuickBooks Online
- Connect at Settings → Integrations → QuickBooks card → Connect.
- Redirects to Intuit for authorization. Once connected, paid transactions sync as sales receipts.
- Sync Now forces an immediate sync. Disconnect anytime.

### FreshBooks
- Connect at Settings → Integrations → FreshBooks card → Connect.
- Redirects to FreshBooks for authorization. Charges sync as invoices automatically.

## Proposals
- Go to Payments → New to create a proposal or invoice.
- Proposals require a template and include an e-signature step. Invoices do not.
- Payment types: Full Payment, Installment Plan, Subscription.
- Clients receive an email/SMS with a link to review, sign (if proposal), and pay.
- Proposal statuses: Draft, Sent, Opened, Signed, Paid, Refunded, Cancelled.
- Resend a proposal from the Proposals list or contact profile using the refresh icon.

## Proposal Templates
- Go to Payments → Proposal Templates to create and manage templates.
- Use the WYSIWYG editor to write contract content.
- Click Generate with AI to have AI draft a complete template.
- Add signature fields (Signature, Printed Name, Date) at the bottom.

## Invoices
- Go to Payments → New → Create Invoice for a one-off invoice without a template.
- Add multiple line items; total auto-calculates.
- Clients receive it via email/SMS and pay online.

## Transactions
- Charges tab: All paid transactions. Click Refund to issue a refund.
- Payment Schedules tab: Installment plans.
- Subscriptions tab: Recurring payments.

## Reports
- 7 report types: Revenue, Proposals, Customer Summary, AR Aging, Payment Method Breakdown, Refunds, Bank Reconciliation.
- Filter by date range. Download as CSV, Excel, or PDF.

## Branding & Customization
- Go to Settings → Branding to upload a logo and set brand colors. You can also pick a logo image from **Media library** (shared images) via "Choose from media library".
- Logo and colors appear on all emails, invoices, and proposals sent to clients.
- Color presets available (Default, Ivory & Gold, Sage & Stone, etc.) — click a preset to apply and save instantly.
- Custom colors: Primary/button color, background color, button text color.
- Contact info (email, phone, address) shown on documents.

## Email Templates
- Go to Settings → Email Templates to customize every type of outgoing email.
- Template types: Invoice, Proposal, Payment Confirmation, Payment Notification, Subscription Confirmation, Subscription Cancelled, Payment Failed.
- Each template has: Subject Line, Email Heading, Body Text, Button Text, Footer Text.
- Click Preview to see exactly what the email will look like.
- Click Send Test to send a test version to any email address.

## Team Members
- Go to Settings → Team to manage who has access to your account.
- Three roles:
  - Owner: Full access to everything including Calendar, Settings, Reports, team management, and integrations.
  - Admin: Access to proposals, contacts, calendar, most settings. Cannot manage team, general settings, or integrations.
  - Member: Can only view proposals, contacts, and calendar. No access to Settings or Reports.
- Click Add Team Member to invite someone by email.
- They receive a branded invite email with an Accept Invitation link.
- **Hide pipeline revenue (Leads / CRM)**: When logged in as the **venue owner** (not a team-member session), each active non-owner member row can show a **Hide $** control. Enabling it hides opportunity amounts, weighted totals, and related money lines for that person while they use the dashboard.

## Get Started Checklist (Onboarding)
- New accounts see a Get Started bubble on the dashboard (owners only).
- 6 steps: Branding, Email Templates, First Template, First Proposal, Send Proposal, Invite Team Member.
- To restart: Settings → General → Restart Setup Guide.

## SMS Notifications
- SMS is sent automatically when proposals and invoices are created (if customer has a phone number).
- Phone numbers must be in US format — auto-formatted to E.164.
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
- Rate articles with thumbs up/down to help improve documentation.

## Common Questions
- How do I create a proposal? Payments → New → select a template → fill in client details → Send.
- How do I see my revenue? Home dashboard (filter by date) or Reports → Revenue.
- How do I refund a payment? Transactions → Charges → click Refund.
- Why can't I accept payments? LunarPay account may be pending. Check Settings → Payment Processing.
- How do I add my logo? Settings → Branding → upload a logo file, or choose an image from Media library (JPEG/PNG/WebP/AVIF/GIF).
- How do I upload images once and reuse them? Venue listing → Media library — upload files, copy URLs, or pick from the library on Photos, email templates, forms, and Branding.
- How do I add a team member? Settings → Team → Add Team Member.
- How do I add a wedding date or guest count to a contact? Open the contact profile → Overview tab → Wedding Details → edit.
- How do I add tasks for a contact? Contact profile → Tasks tab → type a task and press Enter.
- How do I upload a contract to a contact profile? Contact profile → Documents tab → select type Contract → Upload File.
- How do I connect Calendly? Settings → Integrations → Calendly → Connect → paste your Personal Access Token.
- How do I sync with Google Calendar? Settings → Integrations → copy your iCal URL → add as a subscribed calendar in Google Calendar.
- How do I see my available dates? Settings → Integrations → Public Availability Page URL — share this link.
- How do I add a venue space (barn, garden)? Calendar page → Manage Spaces → add name and color. You can also add or edit spaces inline from the **Space** picker inside the New Event modal (Calendar) or the New Lead modal (Leads).
- Why aren't my leads showing up in the pipeline? Open the Leads page — it auto-reconciles on load: every contact with a real email is placed in the pipeline + stage stored on its contact profile, and broken pipeline/stage references heal to the default pipeline. If you still don't see a lead, check the contact profile's Pipeline + Stage on the Contacts page.
- How do I pick a custom color for a pipeline stage? Leads → Edit pipelines → click the color swatch on any stage (or the new-stage row) → use the color wheel, type a **Hex code**, or pick a preset in the popover.
- Where do inbound email replies go? Into the same Conversations thread — Resend's email.received webhook posts replies back to /api/webhooks/inbound-email. SMS replies from the couple return via GHL and attach to the thread by phone number.
- What is the red dot on What's New? It shows how many release notes you haven't read. Opening the What's New page marks them all read for your user.
- How do I request a new feature? What's New → Feature Requests → Submit a request. A super admin reviews it; if approved it becomes a new What's New entry automatically.
- What is a pipeline / stage? Venues use configurable **sales pipelines** (see Leads). On a contact profile, pick a pipeline and click **stage pills** to move someone through your funnel; stages match your Kanban columns. Linked leads with the same email can stay in sync.
- How do I collapse the sidebar? Desktop: click the chevron beside the logo (narrow icon rail + compact mark). Preference saves for this browser.
- The browser tab shows the StoryVenue icon; if it looks outdated after an update, hard-refresh or clear site data (favicons cache aggressively).
- How do I track where a lead came from? Contact profile → Overview → Referral Source dropdown.
- Why can't a team member see Settings? Members only see proposals, contacts, and calendar. Admins see most settings. Only owners see General, Team, and Integrations.
- How do I restart the setup guide? Settings → General → Restart Setup Guide (owners only).
- What is weighted pipeline on Leads? Each opportunity value is multiplied by the **win probability** of its stage (defaults by stage kind; venues can store 0–100% per stage). Weighted totals appear as **wtd** on columns and cards and in the insights strip.
- How do I assign a lead to someone? Open the lead drawer → **Owner** → pick an active team member (or Unassigned).
- Where is the audit trail for a lead? Lead drawer → **Activity & audit** — stage, value, and owner changes; use **Log a call** to record a conversation.
- Why can't someone see dollar amounts on leads? An owner may have enabled **Hide $** for that team member under Settings → Team.
- What is listing marketing spend for? An optional monthly budget stored on the venue — when set, the Leads insights strip compares rough directory-attributed booked revenue to it for a simple ROI figure.
- Where do I manage listing reviews? Sidebar → Venue listing → Reviews. Mark reviews **published** to include them in the public API and embed. The Google tab lets you connect your Google Business Profile to show Google reviews on your listing.
- How do I connect my Google Business Profile reviews? Venue listing → Reviews → Google tab. The tab auto-searches for your business. If found, click "Yes, that's us." If not found, expand the fallback and paste any Google Maps URL (share link or full URL) — the system extracts the Place ID automatically.
- My Google Business Profile isn't showing up in the search results. What do I do? Service-area businesses (no physical storefront) cannot be found via Google's text search API. Use the "Paste a Google Maps link" fallback: copy the URL from your Google Maps listing and paste it. If that still fails, use Google's Place ID Finder tool (linked in the fallback UI) and paste the Place ID directly.
- How do I see real-time visitors on my listing? Venue listing → Analytics → scroll to "Live visitor map." The interactive world map shows live visitors (pulsing red, last 90 seconds) and recent visitors (indigo, last 30 minutes) with city-level detail. Use + / − to zoom.
- Why don't reviews show on storyvenue.com? The live directory page may be a separate site — paste the iframe from the Reviews page, or consume GET /api/public/venues/<slug>. Ensure migration 024 (and optionally 025) is applied on Supabase. For Google reviews to appear on storyvenue.com, you must connect your Google Business Profile on the Reviews → Google tab.
- What is Conversations? Sidebar → Conversations — team-only notes vs emails to contacts, per thread.
- Why do I see an error about conversations migration? Apply 022_conversations.sql in Supabase and set SUPABASE_SERVICE_ROLE_KEY on the host.
`;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'AI not configured.' }, { status: 503 });
  }

  const { messages, pathname } = await request.json();
  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 });
  }

  const onLeadsPage = typeof pathname === 'string' && pathname.startsWith('/dashboard/leads');

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
- Unique contacts: ${uniqueCustomers}

RECENT PROPOSALS (last 10):
${allProposals.slice(0, 10).map(p => `- ${p.customer_name || 'Unknown'} | ${p.status} | ${fmt(p.price ?? 0)} | ${p.payment_type} | ${(p.sent_at || p.created_at || '').slice(0, 10)}`).join('\n')}
`.trim();

  // --- Leads page context -------------------------------------------------
  //
  // When the user is on /dashboard/leads (or asks about leads), we pull a
  // dense snapshot of their lead pipeline so Ask AI can answer questions
  // like "how many leads this month?", "most requested wedding months?",
  // "find a lead named Smith", etc. We keep this scoped to when the user is
  // actually on the leads page so we don't pay this cost on every call.
  interface LeadSnapshot {
    id: string;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
    venue_name: string | null;
    venue_website_url: string | null;
    wedding_date: string | null;
    guest_count: number | null;
    booking_timeline: string | null;
    message: string | null;
    opportunity_value: number | null;
    pipeline_id: string | null;
    stage_id: string | null;
    status: string;
    source: string;
    created_at: string;
  }
  interface StageSnapshot { id: string; name: string; kind: string; }
  interface NoteSnapshot { lead_id: string; content: string; created_at: string; }

  let leadsContext = '';
  if (onLeadsPage) {
    const [{ data: leads }, { data: stages }, { data: notes }] = await Promise.all([
      supabaseAdmin
        .from('leads')
        .select(
          'id, name, first_name, last_name, email, phone, venue_name, venue_website_url, ' +
          'wedding_date, guest_count, booking_timeline, message, opportunity_value, ' +
          'pipeline_id, stage_id, status, source, created_at',
        )
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabaseAdmin
        .from('lead_pipeline_stages')
        .select('id, name, kind')
        .eq('venue_id', venueId),
      supabaseAdmin
        .from('lead_notes')
        .select('lead_id, content, created_at')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const allLeads  = (leads  ?? []) as unknown as LeadSnapshot[];
    const allStages = (stages ?? []) as unknown as StageSnapshot[];
    const allNotes  = (notes  ?? []) as unknown as NoteSnapshot[];
    const stagesById = new Map<string, { name: string; kind: string }>();
    for (const s of allStages) stagesById.set(s.id, { name: s.name, kind: s.kind });

    const thisMonthLeads = allLeads.filter((l) => (l.created_at || '').startsWith(thisMonth)).length;
    const lastMonthLeads = allLeads.filter((l) => (l.created_at || '').startsWith(lastMonth)).length;

    // Counts by stage name
    const byStage = new Map<string, number>();
    for (const l of allLeads) {
      const s = l.stage_id ? stagesById.get(l.stage_id) : null;
      const name = s?.name ?? '(no stage)';
      byStage.set(name, (byStage.get(name) ?? 0) + 1);
    }

    // Total pipeline value (open + won stages)
    const pipelineValue = allLeads.reduce((sum, l) => sum + Number(l.opportunity_value ?? 0), 0);

    // Most common wedding months
    const monthCounts = new Map<string, number>();
    for (const l of allLeads) {
      if (!l.wedding_date) continue;
      const m = l.wedding_date.slice(0, 7);
      monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
    }
    const topMonths = [...monthCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([m, c]) => `${m} (${c})`).join(', ');

    // Notes per lead (useful for "find leads who mentioned X")
    const notesByLead = new Map<string, string[]>();
    for (const n of allNotes) {
      const arr = notesByLead.get(n.lead_id) ?? [];
      if (arr.length < 3) arr.push(n.content.slice(0, 140));
      notesByLead.set(n.lead_id, arr);
    }

    leadsContext = `
=== LEADS ===
TOTALS:
- All leads: ${allLeads.length}
- New this month (${thisMonth}): ${thisMonthLeads}
- New last month (${lastMonth}): ${lastMonthLeads}
- Total pipeline value: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(pipelineValue)}

BY STAGE:
${[...byStage.entries()].map(([n, c]) => `- ${n}: ${c}`).join('\n') || '- (no leads yet)'}

TOP REQUESTED WEDDING MONTHS: ${topMonths || 'none yet'}

RECENT LEADS (most recent first, up to 30):
${allLeads.slice(0, 30).map((l) => {
  const stage = l.stage_id ? stagesById.get(l.stage_id) : null;
  const name = [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || l.name || 'Unnamed';
  const val = l.opportunity_value != null ? ` · $${Number(l.opportunity_value).toLocaleString()}` : '';
  const wed = l.wedding_date ? ` · wedding ${l.wedding_date}` : '';
  const venue = l.venue_name ? ` · venue: ${l.venue_name}` : '';
  const url = l.venue_website_url ? ` · ${l.venue_website_url}` : '';
  const stageLabel = stage ? ` [${stage.name}]` : '';
  const leadNotes = notesByLead.get(l.id);
  const notesLine = leadNotes && leadNotes.length > 0
    ? `\n    notes: ${leadNotes.map((n) => `"${n.replace(/\s+/g, ' ').trim()}"`).join('; ')}`
    : '';
  const inquiry = l.message ? `\n    inquiry: "${l.message.slice(0, 140).replace(/\s+/g, ' ').trim()}"` : '';
  return `- ${name}${stageLabel} · ${l.email}${l.phone ? ` · ${l.phone}` : ''}${val}${wed}${venue}${url}${inquiry}${notesLine}`;
}).join('\n')}
`.trim();
  }

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
${leadsContext ? '\n' + leadsContext + '\n' : ''}
=== BEHAVIOR RULES ===
1. Always try to answer using the documentation and account data above
2. When asked about account data (revenue, proposals, contacts), use the real numbers above
3. Never make up financial figures, contract details, or account information
4. Be concise, warm, and action-oriented
5. After answering, offer a relevant follow-up or next step
6. If you cannot answer confidently, say so honestly and suggest escalation
7. Do NOT immediately suggest contacting support — try to answer first
8. After your answer, if it's a complex issue, you can gently add: "Still need help? I can connect you with our support team."
9. Format responses clearly — use numbered lists or dashes for steps, plain text only
10. Keep responses under 250 words unless a detailed walkthrough is needed
11. When the user is on the Leads page (you'll see "=== LEADS ===" above), use that data to answer things like "how many leads do I have this month?", "find the lead named Smith", "what's the most requested wedding month?", "total pipeline value", "who hasn't been contacted in 7 days?", etc. If they ask to find a specific lead, repeat the lead's name, stage, email, phone, wedding date and value in your answer so they don't have to scroll.
12. When referring to leads, suggest the user open the Leads page using this link: [Open Leads](/dashboard/leads)

=== FORMATTING ===
- NEVER use any markdown whatsoever: absolutely no **bold**, no *italic*, no __underline__, no ### headers, no # symbols, no backticks, no asterisks around words
- Use plain text only — asterisks will be shown literally to the user and look broken
- Use numbered lists (1. 2. 3.) or dashes (- item) for lists
- Keep headings as plain text with a colon, e.g. "How to Access Reports:"
- When directing the user to a specific page, include ONE navigation link using ONLY this format: [Button Label](/dashboard/path)
  Examples: [Open Branding Settings](/dashboard/settings/branding) [View Proposals](/dashboard/payments/proposals) [Go to Reports](/dashboard/reports) [Manage Contacts](/dashboard/contacts) [View Transactions](/dashboard/transactions) [Open Calendar](/dashboard/calendar) [Open Integrations](/dashboard/settings/integrations) [Marketing analytics](/dashboard/marketing/analytics) [Email templates](/dashboard/marketing/email/templates) [Trigger links](/dashboard/marketing/trigger-links) [Lead Capture Forms](/dashboard/marketing/form-builder) [Media library](/dashboard/listing/media) [Listing photos](/dashboard/listing/images)
- Only link to real dashboard paths. Valid paths: /dashboard, /dashboard/calendar, /dashboard/contacts, /dashboard/conversations, /dashboard/leads, /dashboard/listing, /dashboard/listing/media, /dashboard/listing/images, /dashboard/listing/analytics, /dashboard/listing/reviews, /dashboard/marketing/analytics, /dashboard/marketing/email/templates, /dashboard/marketing/email/campaigns, /dashboard/marketing/workflows, /dashboard/marketing/trigger-links, /dashboard/marketing/form-builder, /dashboard/payments/proposals, /dashboard/payments/new, /dashboard/transactions, /dashboard/reports, /dashboard/settings, /dashboard/settings/branding, /dashboard/settings/integrations, /dashboard/settings/team, /dashboard/settings/notifications, /dashboard/settings/email-templates, /dashboard/help
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
