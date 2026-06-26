import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import { stripEmDashes } from '@/lib/ai-text-cleanup';
import { checkAiRateLimit } from '@/lib/ai-rate-limit';

const PLATFORM_DOCS = `
# StoryVenue Platform Documentation

## Overview
StoryVenue is an all-in-one platform for wedding venues to manage proposals, invoices, payments, a booking calendar, contact CRM profiles, email templates, branding, integrations, and team members — all from one place.

## Navigation / Sections
- Home (Dashboard): Revenue overview, KPI cards (Total Revenue, New Proposals, Signed Proposals, Pending Amount, Refunds, Avg. Proposal Value), area revenue chart, proposal status breakdown, recent proposals table (links to detail pages), recent transactions table, and a **Weddings & Income Trends** section — a ComposedChart showing weddings booked and revenue by month with MoM%, YoY%, and prior-year overlays for the trailing 12 months.
- Ask AI: Sidebar entry plus floating sparkle (bottom-right) — answers questions using live account data and this documentation (updated for Venue listing, Media library, Reviews, Conversations, public API/embed, and Help Center).
- Contacts: Full CRM — contact profiles with Overview, Notes, Activity timeline, Payments, Tasks, Documents; configurable sales pipeline and stages in the profile header (aligned with Leads when email matches).
- Conversations: Unified inbox per contact — **Team only** internal notes (optional @mentions to teammates) vs **External** outbound messages with a channel toggle for **Email** or **SMS** per message. Threads use venue customers. Path: /dashboard/conversations. Related DB: conversation_threads, conversation_messages (migration 022). **Two-way** by design and **iMessage-style instant**: every outbound message has a "Sent" green check or red "Failed" badge once the upstream API confirms; inbound replies arrive in real time via Supabase Realtime broadcast (webhook path) with a 3-second polling fallback so replies always land within a few seconds even when the webhook isn't configured. Outbound email goes via Resend with a per-thread signed Reply-To on the inbound subdomain (e.g. reply.storypay.io); Resend's email.received webhook at /api/webhooks/inbound-email appends the bride's reply to the same thread. Outbound SMS goes through the connected StoryVenue Legacy (GHL) sub-account's A2P number; inbound SMS arrives via the GHL webhook (POST /api/webhooks/ghl) with a polling fallback that scans the GHL conversation messages list every 3 seconds while the thread is open. Threads can carry both SMS AND email at once — the inbound handlers do not gate on thread channel.
- Calendar: Book and track all venue events (tours, weddings, receptions, tastings, meetings, rehearsals, holds, blocked dates). Syncs with Calendly, Google Calendar, Outlook, and Apple Calendar. Event chips take their color from the assigned **venue space** (the old per-event-type color legend was removed). The New/Edit Event modal supports **inline Space management** (add/edit/remove without leaving the form), a **contact search** field that attaches the event to a venue customer, and an **Assigned team member** picker when team members are present.
- Venue listing (sidebar flyout, Store icon): **Bride Booking System™ Analytics** (/dashboard/listing) — the primary analytics hub showing the live visitor map, booking funnel (Leads → Conversations → Tours → Weddings), KPI cards, daily views chart, traffic sources, geography, lead insights, UTM builder, and QR code. **Free-plan users see this page blurred with an upgrade overlay.** **Venue Listing Editor** (/dashboard/listing/venue-listing) — edit how the venue appears on storyvenue.com (description, slug, capacity, publish toggle). **Photos** — cover + gallery for the directory listing. **Reviews** — StoryVenue reviews + Google reviews. **Speed to Lead System** — 6-phase automation. Paths: /dashboard/listing (analytics), /dashboard/listing/venue-listing (editor), /dashboard/listing/media, /dashboard/listing/images, /dashboard/listing/analytics, /dashboard/listing/reviews, /dashboard/listing/booking-system.
- Leads: Kanban and list views for inquiries — same configurable sales pipelines and stages as contact profiles. Includes pipeline intelligence (open pipeline vs weighted forecast, rough referral/directory revenue vs listing spend), per-lead opportunity value on cards, assignable owners, marketing tags, trigger links, an audit trail (stage/value/owner changes and logged calls), and mobile-friendly actions (drag cards, log call, quick note). **Every contact shows up in the pipeline**: the server reconciles leads and venue_customers on load so any contact with a real email has a lead snapped to its contact-profile pipeline/stage (contact stage is the source of truth), and broken references heal to the default pipeline's first stage instead of disappearing. The **+ Add Lead** modal includes a **Space** picker with inline add/edit/remove (same UX as the calendar event modal). Pipeline stage colors use a popover color picker with a **hex code** input, the native color wheel, and preset swatches.
  **Lead card quick actions** — each Kanban card shows a row of icon buttons for the most common actions without opening the drawer:
  - **Call** — log a call directly from the card (opens the quick log-call input).
  - **SMS** — opens a quick SMS composer to the contact's phone via GHL.
  - **Email** — opens a quick email composer to the contact.
  - **Notes** — add a quick note attached to the lead.
  - **Tags** — manage marketing tags on the lead.
  - **Calendar** — schedule an appointment for this contact directly from the card (opens the New Event modal pre-filled with their info).
  These buttons appear on hover so the card stays compact; tap on mobile to reveal them.
- Reports: 7 downloadable financial reports (CSV, Excel, PDF). Owners and admins only.
- Payments (sidebar flyout): New, Proposals, Proposal Templates, Installments, Subscriptions, Transactions. **Packages / Offerings** (/dashboard/offerings) — the unified Items + Bundles catalog for all products and packages you sell. Bundles can have a linked contract template that auto-loads in the proposal builder.
- Marketing (sidebar flyout): Analytics, Emails (campaigns), Audiences, Forms, Workflows, Trigger links & tags. All three email surfaces (Templates / Campaigns / Automations) use the Flodesk-style drag-and-drop builder — see "Marketing email builder" section below.
- Help Center: Searchable categories and articles (including Venue listing, Reviews, Conversations, Ask AI, Leads); contextual suggestions by page; voice search; article ratings.
- What's New: Changelog and Feature Requests board. The sidebar menu item shows a **red dot with unread count** whenever there are entries a user hasn't reviewed; visiting the page marks everything read for that user (per-user read state). Feature Requests submitted by venues can be **approved, edited, or removed** by super admins. When a super admin approves a request it's automatically converted into a **What's New** changelog entry with an outcome-based auto-generated headline + description, and the request is removed from the venue's own feature-request list.
- Settings (sidebar flyout): General (venue info, service fee), Branding, Email Templates, Integrations (Calendly, Google Calendar, QuickBooks, FreshBooks), Team (roles, invites, **Hide $** for team members — owners only), Notifications, **Push Notifications** (toggle browser push alerts per event type), **Calendar** (5 tabs: General, Connections, Availability, Booking Rules, Notifications). Venues may also store **listing marketing monthly spend** on the account for Leads ROI — when that value exists, insights use it.
- Sidebar collapse (desktop): Chevron next to the logo narrows the sidebar to an icon rail and shows a compact mark; preference is saved in the browser.
- Announcement ticker (top of every page, dark "News" bar): broadcasts platform-wide messages from the StoryVenue team (downtime, new features, billing/compliance updates). It is **intentionally NOT dismissible** from the venue side — there is no X / close button. Visibility is controlled exclusively from the **super admin Announcements tab**: each row has Activate / Deactivate; deactivating an announcement removes it from every venue's ticker on the next page load. Hovering pauses the scroll so users can read or click an embedded link. If a venue user asks how to "remove" or "close" the news bar, the answer is they cannot — only StoryVenue support can deactivate the message, and they will when it's no longer relevant. Implementation: src/components/AnnouncementTicker.tsx pulls /api/announcements, which calls the get_active_announcements RPC (filters is_active = true). Super admin UI lives at /admin → Announcements.

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
- Once connected, a green "Connected to Google Business" banner appears. StoryVenue caches your reviews and refreshes them periodically. You can force a refresh with the refresh icon.
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
- Powered by Leaflet.js + OpenStreetMap (CartoDB Positron tiles). No Google Maps billing. Note: this analytics visitor map is distinct from the location map shown on the public storyvenue.com venue listing page — that map uses Mapbox GL JS (replaced OpenStreetMap in May 2026) and is venue-facing for display to couples browsing the directory.
- Geographic data (latitude, longitude, city, region, country) is captured server-side via ip-api.com on every tracking event and stored in the listing_events table (migration 057).
- The realtime API endpoint /api/listing-analytics/realtime returns geo_points: one entry per active session with lat, lng, city, region, country, flag, and live boolean.

## Listing analytics — historical retention & "Daily views" chart
- listing_events is a permanent log. There is **no auto-prune, no TTL, no cron job, and no DELETE pipeline** anywhere in the codebase that touches this table. The only delete pathway is venues.id ON DELETE CASCADE if a venue itself is removed.
- The Analytics dashboard's date-range picker (1 / 7 / 14 / 30 / 60 / 90 days, plus 365 days for lead insights) is a query window, NOT a retention boundary. Switching to a longer window pulls more history out of the same permanent log.
- The "Daily views — last N days" chart in /dashboard/listing/analytics is **server-side backfilled**: the API (/api/listing-analytics) walks every UTC day in the requested window from today-(days-1) to today and emits a row for each, filling in views/unique_sessions/impressions from the listing_events bucket if present, or zeros if the day had no traffic. So a 30-day request always returns exactly 30 rows. Sparse weeks render as a flat-zero line with spikes on the busy days — that's correct, not missing data.
- The chart's empty-state message ("No view data yet — visit your public listing to test tracking") only fires when total_views, total_impressions, AND unique_sessions are all zero across the entire window — i.e. the venue has had literally zero traffic in the period.
- If a venue owner says "my view counts aren't saving," 99% of the time the answer is "they ARE saving — your listing simply hasn't received traffic on the empty days. Switch to 60 / 90 days to see more history, and confirm by visiting your own public listing in incognito and watching the Live visitor map and total-views counter update within ~10 seconds."

## Media (shared images + files)
- Path: /dashboard/media (top-level sidebar → **Media**). One library for everything you reuse across the product. The legacy URL /dashboard/listing/media now redirects here.
- Supports **images AND files**. Allowed types: images (JPG/PNG/WEBP/AVIF/GIF), PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPT/PPTX), CSV, TXT. Max 25 MB per file. Video uploads are not supported.
- Page features: drag-and-drop the whole window to upload, per-file progress bars, search by filename, filter pills (All / Images / Documents), sort (newest / oldest / name / size), grid ↔ list toggle (preference saved per browser), per-asset action row (one-click Trash icon plus a "..." menu with Copy URL / Download / Open / Rename / Delete). The "..." menu renders as a portal so it's never clipped by surrounding cards or by the page edge, and closes automatically on scroll.
- **In-app preview**: clicking any asset opens a unified preview modal — full-bleed image viewer for images, native PDF viewer (iframe) for PDFs, Microsoft Office Online embedded viewer for Word / Excel / PowerPoint files, and an inline plain-text/CSV reader for txt/csv. Unsupported types fall back to a simple "preview not available" with a Download button. The modal toolbar always exposes Open in new tab + Download.
- **Download** streams through /api/venue-media/<id>/download so the browser receives a "Content-Disposition: attachment" header and saves the file to the user's computer (the previous direct cross-origin link was being opened in a new tab instead of downloaded).
- **Auto-population**: anything uploaded anywhere in the dashboard is automatically registered in the Media library — the brand logo (Settings → Branding), listing photos (Venue listing → Photos), and any image picked through the email or form builder's "Choose from media library" picker (Image / Button file-link blocks in emails, Image block in forms). Re-uploading the brand logo refreshes the existing library row instead of creating duplicates.
- **Used in** indicator: each file shows where its public URL is referenced — **Brand logo** (Settings → Branding), **Listing cover/gallery** (Venue listing → Photos), **Email templates and campaigns** (Marketing → Emails), **Lead capture forms** (Marketing → Forms). Deleting prompts a confirm modal that lists every place the URL is used so you can fix those references before breaking them. Deleting a file that's currently used as the brand logo, cover image, or in the gallery also clears that reference on the venue record so the dashboard doesn't render a broken image.
- Rename is **display-name only** — the public URL stays the same, so existing links don't break.
- Where it connects: **Listing photos** — "From media library" adds an image to the gallery. **Marketing → Emails** — Image / Button (file link) blocks → "Choose from media library". **Marketing → Forms** — Image block → "Choose from media library". **Settings → Branding** — "Choose from media library" for the logo.
- Database: venue_media_assets table (migration 030, expanded by 062 for files + 25 MB cap + display_name + soft-delete column, and by 063 for source_bucket so logo uploads can live alongside library files). Files stored in Supabase Storage: brand logos in bucket venue-assets (path venue-logos/{venueId}/...), everything else in venue-images (path {venueId}/media/...).

## Conversations (inbox) — iMessage-style two-way
- Path: /dashboard/conversations — unified inbox showing all threads by contact.
- Thread list: each row shows the contact name, last message preview, timestamp, and the contact's **current pipeline stage** as a colored pill.
- Open a thread to load the message history. **Mark read/unread**, **pin**, **star**, or **delete** a thread using the action icons that appear on hover or in the thread header.
- Composer: toggle **Team only** (internal note) vs **External** (visible to contact). When external, a per-message channel switcher picks **Email** or **SMS**. @mentions work inside team notes to notify a specific teammate. A thread can carry both channels at once — switching channels per message does not "convert" the thread.
- **Send confirmation badges**: every outbound message renders a green "Sent" check next to its bubble when the upstream API confirms delivery, or a red "Failed" badge plus the underlying error if the send was rejected. The email card UI also shows "Sent to: …" using the actual address the message was delivered to (column conversation_messages.email_to, migration 136), which is robust to later email-address changes on the contact.
- **Custom sending domain (optional)**: every venue can send email immediately using StoryVenue's verified default domain (RESEND_DEFAULT_FROM) — no DNS work required. If a venue verifies their own domain in Resend and adds it to RESEND_VERIFIED_DOMAINS, outbound emails go From: that domain. The venue's brand_email is always preserved as Reply-To so replies still come back to the venue's inbox.
- **Contact profile drawer**: click the Profile button inside any open thread to slide in the full contact profile. All the same tabs as the standalone profile (Overview, Notes, Activity, Payments, Tasks, Documents, Schedule). Includes a Schedule tab to book a new appointment from inside the thread.
- **Team filter / team directory**: filter threads by team member; compact directory card shows who's available.
- **Inbound replies are instant**. Same architecture as iMessage:
  - **Primary path (webhook)**: GHL POSTs InboundMessage to /api/webhooks/ghl for SMS; Resend POSTs email.received to /api/webhooks/inbound-email for email. Each handler inserts the row in conversation_messages and fires a Supabase Realtime broadcast on channel venue:{venueId}:thread:{threadId} (event "message"). The conversations page is subscribed via useBroadcastChannel and renders the new message instantly.
  - **Fallback (polling)**: while a thread is open, the page polls GET /api/conversations/threads/[threadId]/messages every 3 seconds. For threads that have any SMS message in history the server-side pull from GHL also runs on each tick (deduped by ghl_message_id). So even if a venue hasn't pasted the GHL/Resend webhook URLs into their sub-account, replies still land within ~3 seconds.
  - **Catch-up polls**: after a successful outbound SMS, the server schedules three delayed inbound pulls at 5s, 15s, 45s, so a quick reply lands even if the user navigates away.
- **Inbound SMS filter** (technical): GHL's /conversations/{id}/messages endpoint encodes SMS as type: 2 (numeric enum where 1=email, 2=sms, 3=call). The filter accepts both numeric and string forms across type, messageType, messageTypeId, plus the legacy SMS/TEXT strings.
- **Inbound email signing**: each outbound email's Reply-To is reply+{threadId}+{hmacSig}@{CONVERSATIONS_INBOUND_DOMAIN}. The HMAC sig is keyed by CONVERSATIONS_INBOUND_SECRET so we can verify a reply belongs to a real thread before ingesting. Inbound handler does not gate on thread channel — a valid sig is proof enough.
- **Reply-halt automation**: if a contact replies (email OR SMS), every active marketing automation enrollment for that contact is automatically halted (status halted_by_reply) and the venue owner gets a notification email.
- **Required env vars for full functionality** (Settings → Inbound Email Replies surfaces this as a live status panel):
  - RESEND_API_KEY — outbound email + fetch parsed inbound body
  - RESEND_DEFAULT_FROM — verified sender used when a venue hasn't set up a custom domain
  - CONVERSATIONS_INBOUND_DOMAIN — the inbound subdomain (e.g. reply.storypay.io)
  - CONVERSATIONS_INBOUND_SECRET — HMAC secret for per-thread reply tokens
  - RESEND_WEBHOOK_SECRET (or INBOUND_EMAIL_WEBHOOK_TOKEN) — verifies Resend's webhook calls
- Requires conversation tables applied (migration 022, plus 135 for ghl_sync_progress + 136 for email_to) and SUPABASE_SERVICE_ROLE_KEY set.

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
- **Google Calendar events display**: when Google Calendar is connected in Calendar Settings → Connections, events from your Google Calendar appear directly on the StoryVenue calendar as read-only chips, so you can see everything in one place. They do not create StoryVenue records — they're a visual overlay.
- **Conflict blocking**: in Calendar Settings → Connections, you can select which Google Calendars block your available booking slots. When a conflict calendar has an event, that time window becomes unavailable on your public booking page.
- Calendar Settings: go to Settings → Calendar for full configuration across 5 tabs (General, Connections, Availability, Booking Rules, Notifications). See the Calendar Settings section below for details.
- Automatic notifications fire when events are created (confirmation), cancelled, rescheduled, or nearing start (reminder) and after completion (follow-up). See the Calendar Notification System section for full details.

## Calendar Settings (Settings → Calendar)
Five tabs covering every aspect of how your calendar works:

### General tab
- **Timezone** — the timezone used for all appointment display and availability slots.
- **Privacy** — "Hide event details" toggle: when on, synced calendar events don't expose client names to people viewing your calendar.

### Connections tab (Google Calendar two-way sync)
- Connect your Google account via OAuth to enable two-way sync.
- Once connected, your Google Calendar appears in a dropdown; pick which calendar new StoryVenue events are written to (Linked Calendar).
- **Conflict Calendars** — check any of your Google Calendars to block those time windows from appearing as available on your public booking page. Personal appointments, team events, or any other calendar can be added as a conflict source.
- Google Calendar events from connected/conflict calendars appear as read-only chips on the StoryVenue calendar view so you see your full schedule in one place.
- Disconnect at any time — StoryVenue events already on Google are not deleted.

### Availability tab
- **Weekly Working Hours** — toggle each day on/off and set start/end times. These are the hours that appear as available on your public booking page.
- **Date Specific Hours** — add overrides for individual dates: block a day entirely (unavailable) or set custom hours for holidays, special events, etc. Each override can have an optional label (e.g. "Staff retreat").

### Booking Rules tab
- **Meeting Duration** — default length for bookable appointments (15 / 30 / 45 / 60 / 90 / 120 / 180 / 240 min).
- **Meeting Interval** — spacing between slot start times (e.g. 30 min = slots at :00 and :30).
- **Minimum Scheduling Notice** — how far ahead a booking must be made (0 hr to 72 hr). Prevents last-minute bookings.
- **Date Range** — how far into the future slots are shown (7 / 14 / 30 / 60 / 90 / 180 / 365 days).
- **Pre-buffer / Post-buffer** — blocks time before and after each appointment so you have prep/debrief time. Buffers don't show as bookable slots.
- **Max Bookings per Day / per Slot** — caps on simultaneous or daily bookings.

### Notifications tab
- Configure email and SMS templates for every appointment scenario. See the full Calendar Notification System section for details.

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

### Zapier + public REST API
- StoryVenue has a private/unlisted Zapier app that connects to 6,000+ other apps.
- Triggers (instant via REST Hooks, polling fallback): New Lead, New Contact, Tag Added, Proposal Signed, Payment Received, Appointment Booked, Appointment Cancelled.
- Actions: Create or Update Contact, Create Lead, Add Tag (fires Workflows!), Send SMS, Send Email, Find Contact by Email.
- To connect: Settings → Integrations → "Generate API key" → copy the sv_live_… secret → click "Connect with Zapier" (which opens the public invite link https://zapier.com/developer/public-invite/241169/4cb250d00c7d98a07f4e8d9a2a6adc8c/) → accept the app → paste the API key when Zapier asks.
- Self-serve invite: anyone with the public invite link above can add the StoryVenue Zapier app to their Zapier account without us manually inviting them. The app does NOT appear in Zapier's public marketplace yet — the invite link is the only entry point.
- API keys are SHA-256 hashed; the plaintext is only shown once at creation.
- Direct API: Authorization: Bearer sv_live_… on requests to /api/v1/*.
- Key endpoints: GET /api/v1/me, GET/POST /api/v1/contacts, POST /api/v1/leads, POST /api/v1/tags/apply, POST /api/v1/sms/send, POST /api/v1/email/send, GET /api/v1/{leads,contacts,proposals,payments,appointments}/recent (for polling), POST/DELETE /api/v1/webhooks (REST Hooks).
- Webhook subscriptions auto-disable after 5 consecutive delivery failures; venues can manage active keys and revoke any time from the Integrations page.
- Common Zapier patterns: "When a new lead arrives, send a Slack message"; "When a proposal is signed, add a row to a Google Sheet and post in Slack"; "When a payment is received over $X, post in Slack"; "When tag X is added, send a Mailchimp transactional"; "When a Typeform is submitted, create a StoryVenue lead and apply tag VIP".

### Calendly
- Connect at Settings → Integrations → Calendly → Connect.
- Requires a Personal Access Token from calendly.com/integrations/api_webhooks.
- Once connected: new bookings appear on StoryVenue calendar in real time; contact profiles auto-created; cancellations auto-update.
- Sync Now button imports all upcoming Calendly events on demand.

### Google Calendar / Outlook / Apple Calendar (iCal)
- One-way sync: StoryVenue events appear in your calendar app.
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

## Proposals & Invoices
- Go to Payments → New to create a proposal or invoice.
- Proposals include an e-signature step and a contract body; invoices are line-item-only (no contract, pre-signed).
- Payment types: Full Payment, Installment Plan, Subscription.
- **How will you collect payment?** When creating a proposal or invoice you choose Online (StoryPay card/ACH) or Manually (cash or check). Manual proposals suppress the online payment form on the client-facing page and show a "venue collects directly" message instead.
- **E-signature**: for manual proposals you can optionally uncheck "Require client e-signature" to skip the signing step when you'll get a wet signature in person.
- Clients receive a branded email/SMS with a link to review, sign (if required), and pay.
- **Proposal statuses**: Draft, Sent, Opened, Signed, Paid, Partially Paid, Refunded, Partial Refund, Expired, Cancelled, Declined. "Partially Paid" is set automatically when one or more manual payments cover part of the total but not all of it.
- **Sequential proposal/invoice numbers** (#1042 style): every proposal and invoice gets an auto-incrementing sequential number visible on the proposals list, the detail page, the client-facing page, invoices, and receipt emails. Numbers start at 1001 for new accounts and backfill existing records in creation order. The proposals list is searchable by number (type "#1042" or just "1042" in the search box).
- Resend a proposal from the Proposals list, the detail page, or the contact profile using the Resend button.

## Recording Manual Payments (Cash / Check)
- For proposals and invoices where you chose Manual collection, a "Record payment" button appears on the proposals list and on the proposal detail page.
- Click it to open the payment modal: enter the amount, choose Cash / Check / Other, optionally enter a check number and a note, then Save.
- Multiple partial payments are supported — click Record payment again for each installment.
- Every payment (manual or online) is assigned a sequential payment number (#2001, #2002 …).
- After each payment a branded receipt email is sent to the client. The receipt prominently states the remaining balance if any, or confirms "Your balance is now paid in full." The receipt includes a "View all payments" button linking to the downloadable invoice page.
- The proposal status auto-updates to Partially Paid or Paid based on the running total vs the proposal price.
- To delete a mistaken payment, open the Record Payment modal and click the trash icon on that row.

## Proposal Templates
- Go to Payments → Proposal Templates to create and manage templates.
- Use the WYSIWYG editor to write contract content. Click Generate with AI to draft a template.
- Add signing fields (Signature, Printed Name, Date) at the bottom.
- **Linking a template to a package**: in Offerings → edit a package → "Default contract template" dropdown. When you apply that package in the proposal builder the line items AND the contract body load automatically in one step. The contract is only auto-loaded if you haven't already written one — it never overwrites work you've already done.

## Proposal Detail Page
- Path: /dashboard/proposals/[id] — dedicated booking management page for each proposal/invoice.
- Click any client name in the Proposals list to open their detail page (not the edit form).
- Shows: sequential #number, money summary (Total / Paid / Balance), booking timeline (Created → Sent → Viewed → Signed → Deposit → Balance), numbered payment ledger, the full contract document, and all quick actions (copy link, view proposal, invoice & receipt, resend, record payment, edit).
- The "Edit" button on the detail page still goes to the edit form for drafts or updates.

## Invoices
- Go to Payments → New → Create Invoice for a one-off invoice without a contract.
- Add multiple line items; total auto-calculates.
- Clients receive it via email/SMS and pay online (or arrange manual payment if you chose Manual collection).

## Invoice & Receipt PDF (Downloadable)
- Path: /invoice/[proposalId] — public branded receipt page, shareable with clients.
- Shows: venue logo/colors, invoice/proposal number, bill-to details, line items, totals, Paid/Partially Paid/Balance Due status, and the full payment ledger with every numbered payment (method, date, amount).
- **Download PDF button** generates a branded PDF using your brand color — couples can download and forward to parents or keep for their records.
- **Print button** opens the browser's native print dialog.
- Receipt emails include a "View all payments" button that links here so clients always have access to the full history.

## Transactions
- Charges tab: All paid transactions. Click Refund to issue a refund.
- Payment Schedules tab: Installment plans.
- Subscriptions tab: Recurring payments.
- Transaction descriptions and invoice numbers now use the sequential proposal number (#1042) instead of a random token slice.

## Offerings / Packages Catalog
- Path: Payments → Packages (/dashboard/offerings) — your product and package catalog.
- **Items** (venue_products): individual products/services. Each has a name, description, price, unit (per person / per event / per hour / custom / none), recurrence (one-time / monthly / weekly), inventory mode (unlimited / limited quantity), customer portal visibility, and active toggle.
- **Bundles** (venue_packages): pre-built line-item collections representing your named packages (e.g. "Intimate Package," "Grand Estate"). Each bundle has a name, description, optional season label, valid from/to date range, minimum subtotal, line items (items + qty + optional price override), and a **Default contract template** dropdown.
- **Package → template linking**: the "Default contract template" dropdown on a bundle lets you select a proposal template. When a venue owner picks that bundle while building a proposal, both the line items AND the linked contract body auto-load in one step (only if no contract has been written yet — it never overwrites existing work).
- Quick-add item: while editing a bundle, use the inline quick-add shortcut to create a new product without leaving the bundle editor.
- Bundles outside their valid-from/to window are filtered out in the proposal line-item picker so expired packages don't appear.

## Reports
- 7 report types: Revenue, Proposals, Customer Summary, AR Aging, Payment Method Breakdown, Refunds, Bank Reconciliation.
- Filter by date range. Download as CSV, Excel, or PDF.

## Branding & Customization
- Go to Settings → Branding. The page is ordered top-to-bottom in setup flow: Contact Information → Brand Settings (logo) → Color Presets → Social Networks → Time zone → Applies to.
- Logo + colors + contact info appear on all emails, invoices, and proposals sent to clients.
- Logo upload accepts PNG/JPG/SVG (max 5MB). You can also pick from **Media library** (shared images: JPEG, PNG, WebP, AVIF, GIF — no video) via "Choose from media library".
- **Color Presets** (Default, Ivory & Gold, Sage & Stone, Black & Champagne, Blush & Cream, Coastal Blue, Warm Earth) — click any preset to apply Primary/Button + Background + Button Text colors all at once and save instantly. The previous "Custom Colors" section (with three hex inputs) was removed; presets cover the common cases and individual colors can be fine-tuned anywhere a color picker appears.
- Contact info (business name, email, phone, address, footer note) is used on invoices/proposals/email footers and powers the marketing email **Address block**.
- **Brand Colors palette** (per venue, max 50 hex colors): NO dedicated card on the branding page. Save / remove brand colors directly from any color picker in the app — email block inspector, form builder, etc. Saved colors appear in the palette row at the bottom of EVERY color picker across the entire app and stay in sync via a singleton cache (useBrandColors hook). Click the bookmark/save icon next to a color you've configured to add it; hover a saved swatch and click × to remove. DB column: venues.brand_colors (jsonb array of hex strings).
- **Social Networks** (Settings → Branding → Social Networks, anchored at #social-networks): per-venue social profile URLs used by the marketing email **Social block**. Supported platforms: Instagram, Facebook, TikTok, LinkedIn, YouTube, Twitter / X, Pinterest, Website. One URL per platform; up to 8 total. Auto-prefixes https:// when missing; auto-saves with debounce. Each row has Open link + Remove. Source of truth for which platforms exist and which URL each one points to. Inside any specific email, the Social block's Links tab has a per-row eye toggle so the user can hide one or more platforms from THAT email only (per-block field socialHiddenPlatforms on the EmailBlock; branding registry is unchanged). DB column: venues.brand_socials (jsonb array of {platform, url} objects, migration 059).

## Marketing email builder (Templates / Campaigns / Automations / Segments)
StoryVenue ships a Flodesk-style drag-and-drop email builder used in three places:
- Marketing → Email Templates (/dashboard/marketing/email/templates) — reusable design library; templates are not sent, they're starting points.
- Marketing → Email Campaigns (/dashboard/marketing/email/campaigns) — one-off broadcasts with three steps (Design → Recipients → Review). The campaigns list page uses the same brand-aligned layout as the Forms and Audiences list pages: centered content, consistent list-item style, a signature-black "New campaign" button, and a trash icon on each campaign row so you can delete any campaign (with a confirm prompt) without opening it.
- Marketing → Email Automations (/dashboard/marketing/email/automations) — multi-step drip sequences triggered by an event (new lead, tag, date, etc.). Each step is its own email with a delay.

There is also a fourth surface: **Marketing → Audiences** (/dashboard/marketing/email/audiences). Audiences are reusable named targeting groups that any campaign can point at — see the dedicated "Saved audiences" section further down.

Editor layout:
- Left: thin sidebar with Desktop / Mobile preview toggle + undo/redo bar.
- Center: live canvas. Click a block to select it (text and button blocks are inline-editable on the canvas). Hover any block to see a side toolbar (move up, move down, duplicate, delete — the heart "save block as template" button has been removed; save the whole email instead).
- Right panel: when nothing is selected, shows the Block Palette (drag tiles onto the canvas). When a block IS selected, shows that block's tabbed inspector.
- Header: Back arrow (literally labeled "Back"), step nav (Design / Recipients / Review) centered over the canvas with a right-panel offset, Preview button (eye icon labelled "Preview") + Send pinned far right.
- Drag-to-canvas drop indicator (#1b1b1b accent) shows exactly where a new block will land — including the very last position (a recent fix; previously you couldn't drop at the very bottom).
- SmartPointerSensor stops dnd-kit from activating when the user is interacting with inputs, buttons, or sliders inside the inspector.

Per-block inspectors all share a "Block" tab with: top padding, bottom padding, side gutters, background color, alignment (where applicable). The standard alignment selector is a single Flodesk-style icon-only group (Left / Center / Right / Full) with a rounded pill highlight on the active option, used identically across every alignable block.

Block types:
- Heading (H1/H2/H3) — the H1/H2/H3 buttons in the format toolbar set both the level AND the matching font size so the visual change is always immediate. Per-block font family (Google Fonts), weight, size, color, letter spacing, line-height.
- Text — paragraph copy with a rich-text format toolbar: bold/italic/underline/strikethrough, list buttons (toggle on/off), link popup with URL + open-in-new-tab, merge tag dropdown, **AI refine button (pencil icon)** that rewrites the selection. The link insertion uses Range.surroundContents (not deprecated execCommand) so links can be edited inline.
- Button — full Flodesk-style tabbed inspector (Style / Link / Block). Style tab: Presets (Solid, Outline, Pill, Underlined link, etc.), Saved styles (modal popup where you can save the current style or apply/delete an existing one), and full custom controls (Google font + weight + size + letter spacing, text color, background color, border color/width/radius, vertical and horizontal padding). Link tab: a compact link pill with two modes — URL (with "Open in new tab") OR File (pick from venue Media library; the button links to the file's public URL). Live edit: click the button on the canvas to edit its label inline.
- Image — single image with the shared VenueMediaPickerModal ("Choose from media library"); supports alignment, width slider, padding, link wrap, alt text. Multi-image grid (2/3/4 columns × multiple rows) renders with **even gutters between every row AND every column**.
- Video — 16:9 YouTube-style player with play-button overlay; auto-detects YouTube / Vimeo / Loom URLs. On the live canvas, clicking the block SELECTS it for editing (does NOT open the video). In the preview iframe and in sent emails the thumbnail links out to the video URL. Empty-state hint reads "Add a YouTube, Vimeo or Loom URL" and is positioned so it's never obscured by the play button.
- Divider — Flodesk-style settings: style (solid/dashed/dotted), thickness, color, width %, alignment, top/bottom padding, background.
- Spacer — two settings only: Background color + Height (slider).
- Social — row of social icons, links pulled from Settings → Branding → Social Networks (single source of truth; no per-email override). 3-tab inspector: **Icons** (style: outline / filled circle / solid circle, color via Flodesk color picker, size S/M/L, alignment, spacing slider), **Links** (read-only list of configured platforms + a "Manage in branding" CTA that deep-links to /dashboard/settings/branding#social-networks), **Block** (shared). Style swatches in the inspector are icon-only (no text labels) at identical 48×48 dimensions for visual consistency. Editor / preview / sent email all use the exact same SVG paths and chip dimensions so renders match pixel-for-pixel. Filled-circle glyph color auto-flips between black and white based on chip color. If Branding has zero social links, the block renders nothing in the actual email (no placeholder ever ships); in the editor it shows a hint pointing to Branding. **Glyph design** — icons are intentionally drawn in a Flodesk-style minimalist set (filled letterforms: f / in / P / d / X; stroked outlines: Instagram camera, Globe, YouTube play) rather than each platform's full multi-color brand mark. This is by design for a clean editorial newsletter aesthetic; the simplified marks are still universally recognized. Pinterest uses fill-rule=evenodd so its inner counter renders as a see-through eye.
- Address — pulls from Settings → Branding (Contact Information). 3-tab inspector: **Font** (typography), **Address** (preview + a "Manage my address" button with explicit #1b1b1b styling — never blue tint), **Block** (shared). Address copy is rendered compactly (typically two short lines).
- Columns — split a row into 2 or 3 columns and drop other blocks inside.
- HTML — raw HTML for power users.

Brand colors integration: every color picker inside the email builder is the same Flodesk-style picker. It's anchored to the viewport (so it never opens off-screen), exposes a hex input + HSL/RGB visualizer + eyedropper (when supported), and shows the venue's saved Brand Colors palette at the bottom for one-click application. Saving a color from any picker adds it to the venue palette across the entire app.

Fonts: every text-bearing block exposes a Google Fonts selector. The selected font loads in both the editor and the rendered email. Inline emphasis comes from the format toolbar (bold/italic/underline/strikethrough/link).

Live preview & send-test:
- Click the eye icon (header → Preview) to open the preview modal.
- Modal renders the email inside a real iframe so links open and embedded videos play.
- Header and backdrop are #1b1b1b for a calm, neutral preview.
- Send-test form inside the modal: type any email address → Send Test → fires through normal sending pipeline with real branding (logo, colors, social, address).
- Toggle the canvas to Mobile (left sidebar) — or the Mobile button at the top of the preview modal — to verify reflow on small screens.

Mobile responsiveness (renderMarketingEmailHtml):
- Every rendered email ships with a single tight media query targeting screens ≤480px wide. Inside that breakpoint:
  - Block side padding shrinks 24px → 16px on every block-level <td> (class eb-pad). Headings, addresses, button labels, and footer text all gain ~16px of horizontal room.
  - The email card goes edge-to-edge: border-radius:0 + border:0 (class eb-card). The page wrapper drops its 12px gutter (class eb-page). Mirrors how iPhone Mail / Gmail mobile render emails natively.
- Above 480px (Outlook desktop, full-width Gmail web, tablets) the full-fidelity 600px layout with the rounded card and 24px padding is preserved.
- Social Links use display:inline-block <a> chips inside a font-size:0/line-height:0 wrapper (NOT a single-row table), so when there isn't enough horizontal room for the full row the chips wrap onto a second line instead of getting clipped — critical for venues with 6–8 social platforms registered. Inline-block on <a> is supported in Outlook 2007+, Apple Mail, iOS Mail, Gmail, Outlook 365, Yahoo.
- Images already use width:100%;max-width:... so they always scale down with the viewport.

Compliance footer + public preference center:
- Every marketing email automatically includes a minimal footer with venue name, physical address (from Branding), an unsubscribe link, and a "manage your preferences" link.
- Both links use a signed per-recipient/per-venue token (lib/marketing-email-tokens) — single-purpose and unguessable.
- Public preference page lives at /u/[token]/manage on app.storyvenue.com (no login required). Recipients can unsubscribe (added to the marketing_email_suppressions table and skipped automatically by every campaign + automation) or opt back in.
- Suppression only blocks marketing emails. Transactional emails (proposals, invoices, payment confirmations) are exempt and always send.
- Visual styling of the footer (font, padding, background) is editable; the unsubscribe link, manage link, venue name, and physical address are mandatory.

Data flow / single source of truth:
- Brand colors → venues.brand_colors (jsonb array of hex strings). Loaded by the useBrandColors hook with a singleton cache.
- Brand socials → venues.brand_socials (jsonb array of platform+url objects, migration 059). Loaded by the useBrandSocials hook. PATCH /api/venues/me sanitizes input (known platforms only, valid URLs, https:// auto-prefix, max 8, no duplicates).
- Email definition is a JSON tree of blocks (MarketingEmailDefinition with blocks: EmailBlock[], schema in src/lib/marketing-email-schema.ts).
- At render time the helper injectVenueDataIntoDefinition (src/lib/marketing-email-injection.ts) copies venues.brand_socials onto every Social block's socialLinks field — preview, test sends, and bulk worker all go through this so social links are always live. Same helper drops any platform listed in the block's socialHiddenPlatforms array (the per-block eye toggle in the Links inspector tab) and any platform not in the current supported allow-list (legacy rows from retired platforms) so neither ever ships in a real send.
- Render output is produced by renderMarketingEmailHtml (src/lib/marketing-email-render.ts) — an inline-table-based HTML pipeline tested for Gmail / Apple Mail / Outlook web. Social icons use inline SVGs with line-height = chip-height + vertical-align: middle (more reliable than flex in email clients).

## Saved audiences — reusable targeting for marketing campaigns
Saved audiences live at Marketing → Audiences (/dashboard/marketing/email/audiences). They let venue owners build an audience once and reuse it across as many campaigns as they want, instead of rebuilding the same filters every time.

Audience types (same everywhere — campaigns, automations, and saved audiences share one picker):
- All leads — every contact with an email, excluding marketing unsubscribes and marketing_email_opt_in=false.
- Any of these tags — lead has at least one of the selected marketing tags.
- In any of these pipeline stages — lead is currently in one of the selected stages.

Behavior filters that compose on top of any audience type:
- Only leads with a wedding date on file (require_wedding_date).
- Exclude leads currently in specific stages (exclude_stage_ids).
- Exclude leads in booked / won stages (require_not_booked + booked_stage_ids).
- Only leads who clicked at least one of the selected trigger links, ever (clicked_trigger_link_ids).

Saved audience shape (internally stored as a "segment" in the DB/schema): a saved audience can ONLY hold an audience type of all_leads / tags_any / stages — never another saved audience. This is a hard constraint enforced at parse time (parseSavedSegmentDefinition coerces a stray saved_segment back to all_leads) so we can never build a recursion loop.

Campaign audience shape: a campaign's segment_json adds one more option: type='saved_segment' with saved_segment_id pointing at a marketing_segments row. At resolve time, resolveSavedSegment loads the saved audience and merges its filters with any inline behavior filters set on the campaign (de-duped union). The audience type always comes from the saved audience; the campaign can only add to or further narrow it, never replace its core type. If the saved audience is deleted or the wrong venue, recipients = 0 (campaign falls back to "All leads").

UI flows:
- Create an audience: Marketing → Audiences → "New audience" → name (required, unique per venue, max 200 chars) + optional description (max 500 chars) + audience filters. Live recipient-count chip updates with each tweak.
- Use a saved audience in a campaign: open a campaign → Audience → "Use a saved audience" → pick from dropdown. Inline behavior filters can still be added to narrow further.
- Edit an audience: changes propagate to every draft and scheduled campaign on the next send. Already-sent campaigns are unaffected (recipients are locked at send time).
- Delete an audience: any campaigns currently using it are auto-detached and fall back to type='all_leads' so they remain valid and sendable. The campaign owner can then re-pick.

API surface (routes use "segments" internally):
- GET /api/marketing/segments — list venue's saved audiences.
- POST /api/marketing/segments — create (body: { name, description, definition }). Returns 409 on duplicate name.
- GET /api/marketing/segments/[id] — single audience + usedByCampaigns count.
- PATCH /api/marketing/segments/[id] — update name / description / definition.
- DELETE /api/marketing/segments/[id] — delete + auto-detach any campaigns referencing it.
- POST /api/marketing/segments/preview — body: { segment: CampaignSegment } → returns { count }. Used by the live recipient-count chip in both the campaign picker and the audience editor.

Database: marketing_segments table (migration 061). Columns: id, venue_id, name (unique per venue, case-insensitive via lower(name)), description, definition_json (jsonb CampaignSegment shape constrained to non-saved_segment types), created_at, updated_at. FK to venues with ON DELETE CASCADE. updated_at maintained by set_updated_at() trigger.

Reusable component: src/components/marketing/AudiencePicker.tsx is the single picker UI used by both the campaign detail page and the audience editor. The audience editor passes hideSavedSegmentOption=true so the "Use a saved audience" radio is suppressed (no recursion).

When to use a saved audience vs an inline campaign audience:
- Saved audience: when the same group will be sent to twice or more, or when multiple team members will run sends and consistent targeting matters.
- Inline picker (Tags / Stages / All leads with filters): one-off sends that won't be reused.

Recommended evergreen audiences for most venues: "Active leads, no proposal", "Booked couples upcoming", "Past clients", "Newsletter subscribers". Build narrower one-offs inline.

## Marketing forms (lead capture)
- Path: Marketing → Forms (/dashboard/marketing/form-builder). One list page with a New form button + a row per existing form; each row has an inline pencil (edit) and a trash icon (delete with confirm). The page layout, list-item style, and primary button match the Email Campaigns and Audiences pages for site-wide consistency.
- Editor (/dashboard/marketing/form-builder/[id]): the entire UI was rebuilt to mirror the Flodesk-style email builder so the two surfaces feel identical.
  - Three-pane layout: thin left sidebar (Desktop / Mobile preview toggle + undo/redo), live canvas in the middle, right inspector panel.
  - Top bar: Back arrow, form title (used in dashboards only — it does NOT render on the public form), Settings / Embed / Live preview buttons on the right. The previous middle "Design / Settings / Embed" tab strip was removed because everything lives on the right side now.
  - Right panel: when nothing is selected it shows the Block Palette (drag any tile onto the canvas). When a block IS selected it shows that block's tabbed inspector. The "Settings / Theme / Inbox" navigation tabs that used to sit in the right panel were removed — selecting a block keeps the focus on its inspector, the same way the email builder does.
  - Drop indicator (#1b1b1b accent line) shows exactly where a new block will land. You can drop at any position including the very last slot.
  - Click a module on the canvas to select it; click the canvas background to deselect (the right panel returns to the block palette so you can drag in new modules).
- Block-level styling: every block's inspector has a shared **Block** tab with top padding, bottom padding, side gutters, and background color — same primitives as the email builder. Per-block style controls are per-tab (Heading typography, Text rich-text toolbar, Button presets, etc.).
- Default new form blocks: every newly created form is seeded with First name + Last name (both half-width on the same row), Phone, Email, and a Submit button. Owners can delete or rearrange these — but it gives the most common contact-capture form out of the box.
- Block types:
  - Heading / Text — typography, alignment, color, plus the Block tab.
  - Single-line / paragraph text inputs.
  - Email, Phone, Number, Date / time pickers.
  - Address — split into individual labelled fields (Street, City, State, ZIP code) instead of a single freeform textbox.
  - Dropdown, Radio, Checkbox group, Yes/No toggle.
  - File upload (when used in forms it stores via the same Media bucket).
  - Image — same uploader / picker UX as the email builder: drag and drop, "Choose from media library" (shared VenueMediaPickerModal), or paste a URL. Supports alignment, width slider, padding, link wrap, and alt text. Uploads auto-register in the Media library.
  - Button — full Flodesk-style tabbed inspector. Style tab: presets (Solid, Outline, Pill, Underlined link, etc.), saved styles modal (save/apply/delete), and full custom controls — Google font + weight + size, text color, background color, border color/width/radius, padding, full-width toggle. Default fill is the signature **#1b1b1b** so freshly placed buttons never look greyed out. Legacy buttons (forms saved before the Flodesk-style controls landed) auto-map their old buttonVariant onto the new presets so styling stays correct.
  - Submit / Divider / Spacer — same structure as the email builder.
- Form Settings modal (gear icon top-right): every form-level option lives here — public form name, success state (thank-you screen vs redirect URL), email notification recipients, embed CSS class, and a Delete form button. Module settings stay in the right inspector; the Settings modal handles everything that isn't a per-block control.
- Embed modal: copy-paste snippet (script + div) that drops the form into any external site; the embed inherits the form's theme.
- Live preview: opens the public-facing form inside a real iframe. The header centers the Desktop / Mobile toggle and removes the previous Reset / Open buttons. Submitting actually exercises the validation + post-submit configuration (thank-you screen or redirect) without persisting a real lead or firing notification emails — it's a true dry run.
- Theme controls (font family, accent color, button colors, background, etc.) live in the Settings modal and are applied site-wide on the form.
- Deleting a form: from the Forms list page click the trash icon next to the pencil, OR open a form → Settings modal → Delete form. Both routes confirm and remove the form (deletes its definition + suppresses leads from old embeds).
- Public submission endpoint and embed continue to work unchanged — the rebuild was visual + UX only; API contracts and the form definition JSON shape are backward compatible.

## Workflows (visual automation builder — fully integrated with system tags + 60+ merge variables)
StoryVenue ships a visual workflow builder at Marketing → Workflows (/dashboard/marketing/workflows). It's how venues build automated, multi-step contact journeys end-to-end without leaving the platform.

What a workflow is:
- One or more triggers (any-match / OR-style — when ANY trigger fires, the contact is enrolled) plus a linear sequence of steps (Wait, Send Email, Send SMS, Add Tag, Remove Tag, Change Stage, Open Conversation, Notify Venue Owner).
- Each workflow has a status: Draft (does not enroll new leads), Active (enrolls and runs), or Paused (existing enrollments freeze in place; no new ones).
- Enrolled leads run through the steps on the cron (1-minute resolution). Sends respect every existing suppression: marketing email opt-out, hard-bounced addresses, SMS DND, and the global Do-Not-Contact tag.

Smart Triggers (60+ across 10 categories — picker is searchable + categorized):
- **Lead Lifecycle**: New lead, Inquiry received, Lead qualified / unqualified, In negotiation, Closed won / lost, Follow-up needed.
- **Booking**: Appointment booked, Tour scheduled / completed / no-show / cancelled, Phone call scheduled / completed, Appointment confirmed / cancelled / rescheduled.
- **Proposal**: Proposal sent / viewed / signed / expired, Contract signed.
- **Payments**: Invoice sent / viewed, Deposit paid, Paid in full, Payment plan active, Payment failed, Refunded, Past due.
- **Marketing**: Email opened, Link clicked, Campaign enrolled / completed / unsubscribed, SMS opted in / out, Re-engaged.
- **Communication**: Contact replied, Hot lead, Cold lead, Do-not-contact set, VIP flagged.
- **Forms**: Any form submitted, Intake completed, Questionnaire completed.
- **Event / Wedding**: After wedding date (with day-offset), Date confirmed / held, Within 30 / 7 days of event, Event passed, Year-1 anniversary.
- **Integration**: Legacy contact synced, Legacy DND active.
- **Other / Native**: Custom tag added, Pipeline stage changed, Trigger link clicked, Proposal paid.

Most smart triggers resolve to a "tag added" trigger pre-configured with a system tag (e.g. picking "Deposit paid" listens for the deposit_paid system tag, which the platform applies automatically the moment a deposit clears). Tag-based triggers will fire for both auto-applied system tags and any custom tag you create.

Step types (categorized palette: Timing / Communication / Contact / Internal Alerts):
- **Wait** — pause for minutes / hours / days (1 minute to 7 days).
- **Send Email** — pick any saved Marketing Email Template. Templates render the full canonical merge-variable set, plus per-recipient unsubscribe footer.
- **Send SMS** — free-form body with a "Variables" button that opens a categorized, searchable popover of all 60+ system merge variables (Contact / Venue / Lead / Appointment / Proposal / Invoice / Subscription / Marketing / System). Click any variable to insert at cursor. Trigger-link inserter, character / segment counter, MMS media picker, and per-step Test SMS are also available.
- **Add Tag** / **Remove Tag** — apply or remove one or more marketing tags (system or custom).
- **Change Stage** — move the contact into a pipeline stage.
- **Open Conversation** — find or create a Conversations thread for the contact and stamp a system message; subsequent SMS / email steps auto-log to the same thread.
- **Notify Venue Owner** — sends an internal alert (email and/or SMS) to the venue's primary email and notification phone. Subject + body support full merge variables. SMS path uses StoryVenue Legacy messaging (works for any GHL-connected venue). Perfect for "{{contact.name}} just signed!" or "Hot lead {{contact.first_name}} viewed the proposal — call them" alerts.

The builder UI:
- Builder tab — visual canvas with a gridded background. Top row holds the trigger card(s) — click "+" on the trigger row to add additional OR-style triggers from the searchable smart-trigger picker. Each step renders below as its own card. Use the dashed "+" connector between cards to insert any step type at any position.
- Settings tab — workflow Status, Trigger configuration (lists of tags / stages / forms / etc.), and Delete workflow.
- Right rail — categorized palette (Timing / Communication / Contact / Internal Alerts) with drag-and-drop. Plus a "Smart Triggers" reference panel showing how many triggers exist in each category.
- Top bar: editable workflow name, status pill, Save button (saves name + status + trigger config + all steps in one PATCH).

Reply-halt + owner notification (the "if they reply, sequence ends + notify the team" piece):
- When a contact replies to any drip email through the platform's reply routing, the inbound webhook (POST /api/webhooks/inbound-email) ingests the reply into Conversations, then **automatically halts every active marketing automation enrollment for that contact** (status flips to "halted_by_reply", completed_at stamped).
- The venue owner (notification_email, falling back to venues.email) gets a transactional email titled "Reply received: <Contact name> — <Venue>" with the reply preview and how many sequences were stopped. Honors Settings → Notifications email-toggle.
- Halted enrollments don't restart automatically; the contact stays in the conversation thread and the team picks up from there.

Database (no need to expose this to end-users, but useful for "how does it work?" questions):
- marketing_automations — workflow row (name, status, trigger_type, trigger_config jsonb).
- marketing_automation_steps — ordered steps (step_type: delay / send_email / send_sms / add_tag / remove_tag / change_stage / create_conversation / notify_owner, config_json).
- marketing_automation_enrollments — one row per (workflow, lead). Status enum: active, completed, cancelled, failed, halted_by_reply (the reply-halt status added in migration 064). Updated by the cron worker.
- Cron: /api/cron/marketing-email runs every minute when MARKETING_CRON_ENABLED=1. It picks up enrollments whose next_run_at <= now and advances them one step.

Migration 064 (workflow_form_trigger_and_reply_halt) extends the enrollment status check constraint with the "halted_by_reply" value so the new reply-detection logic has a distinct status (separate from manual "cancelled").

How form_submitted enrollment actually works under the hood:
- POST /api/public/forms/[token]/submit ingests the submission, upserts venue_customers, optionally creates a lead in the configured pipeline stage.
- After the lead row is in place (newly created OR matched-by-email to an existing lead), it calls onMarketingFormSubmitted(venueId, leadId, formId) which scans every active form_submitted workflow whose form_ids list contains this form (or is empty), and inserts an enrollments row with next_run_at = now. The cron picks it up immediately on the next tick.

Setup checklist for a venue building their first speed-to-lead funnel:
1. Marketing → Forms → make sure the form is configured to route to a pipeline stage and is published.
2. Marketing → Workflows → New workflow → trigger = "Form submitted" → pick the form(s).
3. Add steps: Send email (welcome) → Wait 2 days → Send email (case study) → Wait 3 days → … (repeat as needed).
4. Set status to Active and Save.
5. Confirm MARKETING_CRON_ENABLED=1 is set so the cron actually runs.
6. Test: submit the form → check the enrollments table and the contact's inbox.

## Notifications & Email Templates (Settings → Notifications)
- Path: /dashboard/settings/notifications — this single page replaces the old separate "Email Templates" and "Notifications" settings pages.
- All transactional email templates live here, each with an on/off toggle in the left sidebar list and a full editor in the main panel.
- Template types (10 total):
  - Invoice — sent to the customer when an invoice is created
  - Proposal — sent to the customer when a proposal is sent
  - Payment Confirmation — receipt sent to the customer after a successful payment
  - Payment Notification — owner-only alert when a payment is received (shows amount, net, fee)
  - Subscription Confirmation — sent when a subscription is started
  - Subscription Cancelled — sent when a subscription is cancelled
  - Payment Failed — alert when a payment attempt fails
  - Payment Reminder — overdue reminders sent to customers after a payment due date (see below)
  - Proposal / Invoice Viewed — owner-only alert when a customer first opens their document
  - Proposal Signed — owner-only alert when a customer signs a proposal
- Each template has: Subject Line, Email Heading, Body Text, Button Text, Footer Text — all editable.
- Toggle switch in the sidebar list turns a template on or off. Off = that email will NOT send. State persists after page reload.
- Click Preview to see the rendered email. Click Send Test to fire a live test to any email address.
- Variable pills appear below the editor for each template. Click a pill to copy the tag, then paste it into the subject or body. Both flat tags ({{customer_name}}) and canonical dot-notation tags ({{contact.first_name}}, {{payment.amount}}) work — they resolve the same value.
- Payment Reminder specifics: When the Payment Reminder template is selected, a "Reminder schedule" panel appears below the editor. Configure up to 3 reminder send-times — each one is a number of days/hours AFTER the due date (overdue reminders, not advance reminders). Default offsets are 1 day, 3 days, and 7 days after the due date. Save changes to update the schedule for all future reminder queues.

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

## Authentication (Login / Signup)
- StoryVenue uses **email + password** authentication for venue owners, team members, and couples. There are no magic links or code-based logins.
- Venue owners sign up at app.storyvenue.com/signup with business name, email, and password.
- Team members accept email invites and set their own password on first login.
- Forgot password: click "Forgot password?" on the login page → enter your email → receive a reset link → set a new password.
- Venue owners can update their **email address** and **password** at any time from their profile — click the avatar/name in the sidebar → My Profile → update and save.
- The current password is **not** required to update email or password — just enter and save the new value.
- GHL / StoryVenue Legacy integration: if a venue has a connected GHL sub-account, their GHL contacts can be synced (Settings → Integrations → "Sync from StoryVenue Legacy"). This is separate from authentication.

## StoryVenue Legacy (GHL) integration — SaaS is the source of truth
- Path: Settings → Integrations → StoryVenue Legacy.
- **Connect**: paste your sub-account Location ID and a Private Integration Token (pit-...) or a Location API Key. The form auto-detects the token type. Once connected the venue gets a green "Connected" badge. If SMS or sync still fails after connecting, also paste the sub-account's **Legacy API Key** in the separate API Key field (GHL: Settings → Business Profile → API Keys → Location API Key). GHL stopped surfacing this key via the agency endpoint for some accounts, so it must be pasted manually.
- **Initial contact sync**: the "Sync from StoryVenue Legacy" button pulls every contact out of the GHL sub-account into StoryVenue's venue_customers table. A live progress bar shows fetched vs total (we run the sync in the background — there's no 524 timeout even for big contact lists). On Cloudflare's 75-second wall-clock budget we return a partial-progress state and the hourly cron job finishes the rest. The sync is **idempotent** — re-running it can't create duplicates because it matches by ghl_contact_id first, then by email, before inserting. Run it again any time you've added contacts directly in GHL and want them in StoryVenue.
- **One-time sync, two-way live**: after the initial pull, **StoryVenue is the system of record for contacts**. Venues do not need to keep using GHL day-to-day:
  - Editing a contact in StoryVenue (phone, name, email) auto-pushes the change back to GHL in the background via /api/venue-customers/[id] PATCH. The push uses a GET-then-merge-then-PUT pattern so other GHL fields are preserved.
  - Creating a new contact in StoryVenue does the same on /api/venue-customers POST.
  - SMS sending also does a synchronous pre-flight push immediately before calling GHL's send endpoint, so even a phone added in the SaaS seconds before sending shows up in GHL by the time the SMS request lands. All push attempts log [ghl-push:<reason>] lines in Railway with sent fields + verify-GET result.
  - **Duplicate phone handling**: if a venue has two SaaS contacts that share a phone number (e.g. one person, two profiles for testing), GHL's allowDuplicatePhone=false constraint means only one GHL contact can own that phone. When the PUT is silently rejected, pushVenueCustomerToGhl auto-searches GHL by phone, finds the owner, and re-links the SaaS contact's ghl_contact_id so subsequent sends go through the correct GHL contact.
- **Token classification**: the lib auto-detects three token kinds:
  - **PIT** (pit-...) — Location-scoped Private Integration Token. Use as-is on v2 endpoints.
  - **v1 Location API Key** — JWT-shaped but with no authClass / exp. Routed to rest.gohighlevel.com/v1/.
  - **v2 OAuth** — real OAuth JWT. May need /oauth/locationToken exchange.
  For legacy clients an Agency API Key can also be set; ensureLocationToken bootstraps a per-location v1 key via /v1/locations/{id} and caches it back on the venue row.
- **Webhook URL panel** (Settings → "Inbound Webhook"): shows the URL to paste into GHL's Settings → Integrations → Webhooks for instant push delivery of inbound replies. Recommended events: InboundMessage, ContactCreate, ContactUpdate, ContactDndUpdate. Without the webhook, the 3-second poll on the open thread already covers reply delivery — the webhook just makes it true real-time and works when no one has the thread open.
- **Diagnostic endpoint**: GET /api/integrations/ghl/diagnose-sms?contactId=<venue_customers.id> returns a per-step JSON blob (token classification, sub-account provisioned numbers, local phone vs GHL phone, DND flags) so SMS failures can be debugged without trawling Railway logs.
- **DND mirroring**: ContactDndUpdate webhooks from GHL are mirrored into venue_customers.sms_dnd and the flat conversation_dnd_* columns. Outbound sends respect these flags. STOP / START SMS keywords also bidirectionally sync between StoryVenue and GHL automatically.

## Venue Owner Profile (My Profile)
- Access: click your name/avatar in the sidebar or bottom-left → My Profile.
- Update your **first name**, **last name**, **email address**, and **password** from this page.
- No current-password re-entry required — enter the new value and save.
- Profile changes take effect immediately. If you update your email, use the new address on next login.

## Couples Portal (Client Accounts)
- Couples (clients) can create their own account on StoryVenue to view their proposals, invoices, and documents.
- Couple accounts are separate from venue team members — they only see their own records.
- **Couple signup**: couples sign up with first name, last name, email, and phone. They're signed in automatically after signup — no "check your email" step.
- **Couple login**: app.storyvenue.com/couple/login — email + password.
- **Forgot password**: couples use the same forgot-password flow — enter email → reset link → new password.
- **Couple profile**: couples can update their first name, last name, and phone from their profile page after login.
- **Super admin couples portal**: the admin dashboard has a Couples tab where admins can view, search, edit, and manage all couple accounts across all venues.

## StoryPay™ (Payment Processing Tier)
- StoryPay™ is the payment processing tier within StoryVenue. It runs on top of StoryPay's underlying merchant platform (our PCI-certified processor partner).
- Venues must **apply for StoryPay™** and complete merchant onboarding before they can accept payments (proposals/invoices with payment enabled).
- Until StoryPay™ is active, certain features are gated — a banner reminds owners to apply.
- **Apply**: Payments → Settings or click the "Apply for StoryPay™" prompt that appears in payment-related areas.
- The onboarding wizard collects business information, owner details, and banking info for StoryPay merchant processing. Card numbers from customers go directly to our PCI-certified processor (PCI SAQ-A compliant — StoryVenue never stores raw card numbers).
- Once approved: proposals and invoices can accept credit card payments, installments, and subscriptions online.
- If payment processing shows as unavailable: check that your StoryPay merchant onboarding is complete. Contact support if you believe it should be active.

### Client payment form — inline Fortis Elements
- When a client clicks Pay on a proposal or invoice, the payment form loads inline on the same page via a secure Fortis Elements iframe — no redirect to an external checkout page.
- Card numbers go directly to the PCI-certified processor (StoryVenue never sees raw card data; PCI SAQ-A compliant).
- If a processing fee is configured, the client sees the base amount and fee separately before confirming.
- For installment plans the card or bank account is vaulted on the first payment so future installments charge automatically. Pay-in-full proposals do not vault.
- If the form appears blank or won't load: the client should try a different browser, disable extensions, or use incognito mode.

### ACH (Bank Transfer / eCheck) — accepted alongside cards
- The inline payment form supports both credit/debit card AND ACH (bank account / eCheck). Customers see two tabs and pick the one they prefer.
- ACH is **enabled by default** for new venues. Toggle it on/off at Settings → Customer Payment Methods.
- Cards: clear instantly. ACH: returns "submitted" immediately, settles in 3–5 business days. The customer-facing success page tells them this; the proposal/invoice in StoryVenue is marked "paid" as soon as bank info is authorized.
- ACH only appears on checkout if BOTH (a) the venue's StoryVenue toggle is ON AND (b) their StoryPay merchant account also has ACH enabled. If you need ACH added to an existing merchant account, contact StoryVenue support.
- Use cases: lower fees on big deposits, alternative for customers who don't use cards, fewer card declines.
- ACH refunds work the same as card refunds (each leg takes 3–5 business days to settle).

## SMS Notifications
- SMS is sent automatically when proposals and invoices are created (if customer has a phone number).
- Phone numbers must be in US format — auto-formatted to E.164.
- SMS routes through your GHL sub-account's A2P approved phone number.

## Push Notifications (Browser Alerts)
- StoryVenue sends instant browser push notifications for important events — even when the dashboard is closed.
- **Setup**: your browser will prompt for notification permission on first visit. Accept it to receive pushes. Then go to Settings → Push Notifications to toggle each event type on/off.
- **Events**: new message, payment received, payment failed, proposal signed, new lead, AI Concierge handoff, invoice paid, subscription created/cancelled, refund issued, new customer.
- **Test**: click "Send test notification" on the Push Notifications settings page to verify delivery.
- **Troubleshooting**: check browser notification permission (lock icon in address bar), make sure the event toggle is ON at Settings → Push Notifications, and try the test button. Push subscriptions are per-device and per-browser.
- Push notifications are sent alongside existing email alerts — they don't replace them. Each event type can be independently enabled or disabled.
- Push uses the Web Push API with VAPID keys. Dead subscriptions (browser uninstalled, permission revoked) are auto-pruned.
- Path: /dashboard/settings/push.

## Installing StoryVenue as an App (PWA)
- StoryVenue is a Progressive Web App (PWA) — install it on phone, tablet, or desktop for a native-app experience.
- **iPhone/iPad**: Safari → Share button → "Add to Home Screen".
- **Android**: Chrome → three-dot menu → "Add to Home screen" or "Install app".
- **Desktop**: Chrome/Edge → install icon in the address bar → Install.
- Installed apps get: home screen icon, full-screen mode, push notifications when browser is closed, faster load times.
- The install prompt appears automatically after your first few visits. If dismissed, use the manual steps above.
- Offline: shows a friendly offline page with retry button when internet is lost.
- Path: /offline (the offline fallback page).

## Owner Notifications (Multi-Channel Alerts)
- StoryVenue can notify venue owners through three channels: **Email** (via Resend), **SMS** (via GHL/StoryVenue Legacy), and **Push** (browser push notifications).
- Each notification scenario can be independently enabled/disabled per channel at Settings → Notifications and Settings → Push Notifications.
- **Notification scenarios**: payment_received, payment_failed, high_value_payment, proposal_signed, document_viewed, subscription_created, subscription_cancelled, invoice_paid, refund_issued, new_customer, new_lead, new_message, ai_handoff.
- Email notifications use your branded email templates (Settings → Notifications). SMS uses your connected GHL A2P number. Push uses the Web Push API.
- All three channels fire simultaneously — disabling one doesn't affect the others.

## Two-Factor Authentication (2FA)
- 2FA adds a second verification step (a 6-digit code from an authenticator app) to your login.
- **Setup**: click your name in the sidebar → My Profile → Two-Factor Authentication → Enable 2FA → scan the QR code with Google Authenticator, Authy, or 1Password → enter the 6-digit code to confirm. Save your backup codes.
- **Login**: after entering email + password, you'll be prompted for the 6-digit code from your app.
- **Disable**: Profile → Two-Factor Authentication → Disable (requires code from your app).
- **Lost authenticator**: use a backup code. If lost, contact StoryVenue support for manual recovery.
- 2FA is per-user — each team member can enable it independently. Does not affect other users or couples.
- Feature flag: TWOFA_ENABLED=true must be set in the environment for 2FA to be available.

## Support
- Path: /dashboard/support — submit support tickets directly from the dashboard.
- Fill in subject, category, and describe your issue. Your Ask AI conversation history is included automatically for context.
- Alternatively, email clients@storyvenuemarketing.com directly.
- The floating sparkle button (Ask AI, bottom-right) can answer most how-to questions instantly.
- Check the Help Center (sidebar → Help Center) for searchable documentation.
- Check What's New (sidebar) for recent changes that may affect the feature you're asking about.

## Calendar Notification System
StoryVenue sends automatic email and SMS notifications for every stage of a calendar appointment lifecycle. All templates are fully editable and each channel can be independently enabled or disabled.

### Notification Scenarios
Five scenarios fire automatically:
1. **Appointment Booked (Confirmed)** — fires immediately when a new confirmed event is created.
2. **Cancellation** — fires when an event's status is changed to Cancelled.
3. **Reschedule** — fires when an event's start or end time is changed.
4. **Reminder** — fires X time before the appointment starts (per-channel timing, see below).
5. **Follow-Up** — fires 30 minutes after the event's end time.

### Per-Recipient Channels
Every scenario has four independent channels — each can be toggled on or off and has its own subject line and message body:
- **Email → Venue Owner** — email to the venue's registered email address
- **Email → Contact** — email to the booked contact/lead
- **SMS → Venue Owner** — SMS via GHL to the venue owner
- **SMS → Contact** — SMS via GHL to the contact

### Editing Templates
Go to Settings → Calendar → Notifications tab.
- Click a scenario (e.g. "Reminder") to expand it.
- Click any channel row (e.g. "Email → Contact") to expand the editor — the chevron on the left opens/closes; the toggle on the right enables/disables that channel independently.
- Edit the Subject (email only) and message body.
- Use merge tags like {{contact.name}}, {{appointment.title}}, {{appointment.start_time}}, {{appointment.timezone}}, {{appointment.meeting_location}}, {{venue.name}}, {{contact.email}}, {{contact.phone}}.
- Click "Reset to default" to restore the built-in template.
- Click "Save Changes" to persist all edits.

### Sending a Test
Each channel editor has a "Send test email" or "Send test SMS" button at the bottom:
- For email: enter any email address and click Send test email — a preview with sample values is delivered.
- For SMS: type a 10-digit US phone number (the +1 prefix is locked in). The test goes to the GHL contact matching that number. The phone must belong to a contact that exists in the SaaS database or GHL.
- All test messages include a "[TEST]" prefix and are sent to the address you enter, not to any real contacts.

### Per-Channel Reminder Timing
Reminders are the only scenario with configurable timing — and timing is set independently per channel. Inside the "Reminder" scenario, open any channel (e.g. "SMS → Contact") and you will see a "When to send" section:
- Add up to 3 send times per channel (e.g. 1 day before, 1 hour before, 10 minutes before).
- Each channel can have completely different timing — e.g. Email → Contact gets reminders at 1 day + 1 hour + 10 min, while SMS → Owner only gets 1 hour before.
- Default timing: email channels = 1 day + 1 hour + 10 min before; SMS channels = 1 hour + 10 min before.
- Save Changes applies the timing along with all other template edits.

### How Reminders Are Queued
When an event is created or updated, StoryVenue automatically schedules one reminder queue row per enabled channel per timing offset. Each row is tagged with the channel it targets. A background cron job checks every few minutes and fires each row at the right time, dispatching only the channel that row is for. Follow-ups are always queued for 30 minutes after the event ends and fire all enabled follow_up channels at once.

### Merge Tags Reference
| Tag | Value |
|-----|-------|
| {{contact.name}} | Contact's full name |
| {{contact.email}} | Contact's email |
| {{contact.phone}} | Contact's phone |
| {{appointment.title}} | Appointment/event title |
| {{appointment.start_time}} | Formatted start date & time |
| {{appointment.timezone}} | Timezone abbreviation (e.g. EST) |
| {{appointment.meeting_location}} | Meeting link or physical address |
| {{venue.name}} | Venue / business name |

### Troubleshooting
- Email not sending: confirm the channel is toggled On and the venue has an email address on file.
- SMS not sending: confirm GHL is connected (Settings → Integrations) and the contact has a valid phone number in the SaaS database.
- Reminders not arriving: check that the event has a contact email attached and that the reminder offsets are in the future relative to the event start time.
- Test SMS failing: the phone number must match an existing contact in the SaaS database or in GHL.

## Refunds
- Go to Transactions → Charges → find the charge → click Refund.
- Confirm the amount and click Issue Refund. Processes immediately through your StoryPay merchant account.

## Payment Processing
- StoryVenue uses StoryPay's merchant platform (our PCI-certified processor partner) for all payment processing.
- Account must complete merchant onboarding before accepting payments.
- Card numbers go directly to our processor — PCI SAQ-A compliant.

## Help Center
- Go to Help Center for searchable documentation.
- Use voice search (mic icon) to speak your question.
- Each article has related articles at the bottom.
- Rate articles with thumbs up/down to help improve documentation.

## Common Questions
- How do I create a proposal? Payments → New → select a template → fill in client details → Send.
- How do I see my revenue? Home dashboard (filter by date) or Reports → Revenue.
- How do I refund a payment? Transactions → Charges → click Refund.
- Why can't I accept payments? Your StoryPay merchant account may still be pending review. Check Payments → Settings.
- How do I add my logo? Settings → Branding → upload a logo file, or choose an image from Media (JPG/PNG/WebP/AVIF/GIF).
- How do I manage my email notification templates? Settings → Notifications. Each template has an on/off toggle and a full editor. Payment Reminder lets you configure overdue reminder timing (days after the due date, not before).
- How do I turn off a specific email notification? Settings → Notifications → click the template in the left list → toggle the switch off. Saved immediately.
- How do I set up payment overdue reminders? Settings → Notifications → click "Payment Reminder" → configure up to 3 offsets (e.g. 1 day after due, 3 days after, 7 days after) in the Reminder schedule panel.
- What are Verified and Sponsored listings? Add-ons you can enable for your storyvenue.com listing. Verified ($19/month) adds a trust badge; Sponsored ($99/month) boosts prominence in search results. Manage at Sidebar → Verified & Sponsored (or /dashboard/listing/directory).
- What plans include Verified or Sponsored? Highest paid plan: both included. Second-highest: Verified included. Free and first paid plan: available as add-ons.
- How do I see my subscription plan and upgrade? Go to Settings → Billing (/dashboard/directory-billing). Plans show as cards with full feature breakdowns. Bride Booking System Free and Bride Booking System™ have self-serve upgrade/downgrade buttons. All-Inclusive and All-Inclusive Concierge require scheduling a demo call.
- What is the 14-day free trial? New accounts that enter a credit card during onboarding get 14 days free on Bride Booking System™. If you don't downgrade to Free before the trial ends, you're automatically charged $97/month. You can downgrade at any time from Settings → Billing.
- Why is a menu item locked or greyed out? That feature isn't included in your current plan. Click the locked item to see an upgrade prompt. Upgrade at /dashboard/directory-billing. The Bride Booking System™ analytics page is blurred/overlaid for free-plan users.
- Why is AI Concierge greyed out? AI Concierge is only available on the All-Inclusive Concierge plan (and any plan the StoryVenue admin has specifically enabled it on). Click the greyed-out toggle to open the demo scheduling calendar.
- What is the Pricing & Availability Guide? A shareable guide for couples featuring your venue packages and pricing. Available on plans that include the pricing guide feature. Find it under Venue listing → Pricing Guide. AI can generate the copy for you.
- How do I use merge variables in my emails? Use {{contact.first_name}}, {{venue.name}}, {{payment.amount}}, etc. Full reference at Marketing → Trigger Links & Tags page. Variable pickers are available in the Workflow builder, email builder sidebar, and Notifications page (click any pill to copy).
- How do I upload images / files once and reuse them? Sidebar → **Media** — upload images or files (PDF, Word, Excel, PowerPoint, CSV, TXT — up to 25 MB each), copy the public URL, or pick from the library on Photos, email templates, forms, and Branding. Each row shows a "Used in" indicator so you know which pages a file is referenced from.
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
- What is Conversations? Sidebar → Conversations — unified inbox with team notes, outbound emails, and two-way SMS threads. iMessage-style: replies appear in real time via Supabase Realtime, with a 3-second poll fallback. Every outbound message shows a green "Sent" check or red "Failed" badge once the upstream API confirms.
- Why do I see an error about conversations migration? Apply 022_conversations.sql in Supabase and set SUPABASE_SERVICE_ROLE_KEY on the host. Also apply migration 135 (ghl_sync_progress on venues) and 136 (email_to on conversation_messages) for the latest features.
- My SMS won't send — "Missing phone number" / "GHL has no phone on file". 99% of the time the contact has a phone in the SaaS but it never made it onto the GHL contact record. Fix in two ways: (1) just hit Save on the contact in the SaaS — the PATCH push automatically writes the phone to GHL via a safe GET-then-merge-then-PUT. (2) For an immediate confirmation, hit GET /api/integrations/ghl/diagnose-sms?contactId=<vcId> in the browser — it returns a per-step JSON blob showing token classification, sub-account provisioned phone numbers, local vs GHL phone state, and DND flags. The pre-send push also re-runs synchronously every time you click Send.
- Two SaaS contacts share a phone — does that break SMS? No. GHL refuses to store the same phone on two contacts in a sub-account (allowDuplicatePhone=false by default). When the push detects the silent rejection, it searches GHL by phone, finds the owning contact, and re-links your SaaS contact's ghl_contact_id to that owner so the send still goes through. Both SaaS contacts effectively share one GHL twin.
- Why does the SMS reply not register in the thread? Three possible causes, in order: (1) the inbound SMS filter — fixed; it now recognizes GHL's numeric type:2 enum (was only catching string SMS). (2) inbound channel gating — fixed; the inbound SMS handler no longer requires the thread to be marked SMS, and email/SMS can coexist on one thread. (3) the GHL webhook isn't configured to call us — the 3-second poll fallback covers this until you paste the StoryVenue webhook URL into GHL → Settings → Integrations → Webhooks (Settings page shows the exact URL to copy).
- Why does the email reply not register in the thread? Same gist as SMS reply: inbound channel gating was rejecting email replies when a thread had been used for SMS. Fixed — the inbound email handler now accepts any thread whose HMAC reply token is valid, regardless of the thread's current channel. If replies still don't show, open Settings → Inbound Email Replies to see exactly which env var or webhook subscription is missing — the panel shows a green "Configured" or amber "Needs setup" badge with a per-item checklist.
- Inbound email needs which env vars to work? RESEND_API_KEY, CONVERSATIONS_INBOUND_DOMAIN, CONVERSATIONS_INBOUND_SECRET, plus one of RESEND_WEBHOOK_SECRET or INBOUND_EMAIL_WEBHOOK_TOKEN. DNS MX records on the inbound domain must point at Resend's MX, and Resend's "email.received" webhook must point at /api/webhooks/inbound-email. The Settings panel surfaces all of this with a Copy button for the webhook URL.
- Do I need to set up my own email sending domain to send email? No. Every venue can send email out of the box using StoryVenue's verified RESEND_DEFAULT_FROM. The venue's brand_email is preserved as Reply-To so replies still come back to them. Upgrading to a custom sending domain just means verifying it in Resend and adding it to RESEND_VERIFIED_DOMAINS — outbound emails then go From: the custom domain automatically.
- How do I re-sync contacts from GHL after the initial sync? Settings → "Sync from StoryVenue Legacy" — same button. The sync is idempotent (matches by ghl_contact_id, then email, then inserts) so re-running it can't create duplicates. There's also an hourly cron that runs the same logic for every connected venue, so newly added GHL contacts trickle in automatically.
- After the initial sync, do I need to keep using GHL? No. StoryVenue is the system of record for contacts post-sync. Every edit in StoryVenue (phone, name, email) auto-pushes back to GHL in the background. New contacts created in StoryVenue create GHL contacts automatically. Outbound SMS pushes the contact synchronously right before sending so GHL always has the latest info.
- How do I update my email or password? Click your name/avatar in the sidebar → My Profile. Enter your new email or password and save. No current-password re-entry required.
- How does client / couple login work? Couples use app.storyvenue.com/couple/login with the email and password they set at signup. They can view their proposals and documents.
- How do I apply for StoryPay™? Payments → Settings (or click the "Apply for StoryPay™" prompt). Complete the StoryPay merchant onboarding wizard to activate payment processing.
- How do I connect Google Calendar for two-way sync? Settings → Calendar → Connections tab → connect your Google account. Pick which calendar to write new events to, and select any personal/team calendars to use as conflict blockers.
- How do I set my available hours for bookings? Settings → Calendar → Availability tab. Toggle each weekday on/off and set start/end times. Add date-specific overrides for holidays or special days.
- How do I set minimum notice for bookings? Settings → Calendar → Booking Rules → Minimum Scheduling Notice. Set to 0 for same-day, up to 72 hours.
- How do I add a time buffer between appointments? Settings → Calendar → Booking Rules → Pre-buffer and Post-buffer. These block the calendar before/after each booking so you have prep or debrief time.
- Why do I see Google Calendar events on my StoryVenue calendar? If you've connected Google Calendar (Settings → Calendar → Connections), your Google events display as read-only chips on the StoryVenue calendar for full-schedule visibility.
- How do I call or text a lead without opening their full profile? From the Kanban board, hover the lead card — action buttons (Call, SMS, Email, Notes, Tags, Calendar) appear at the bottom of the card for quick access.
- How do I book an appointment from a lead card? Hover the lead card on the Kanban board → click the Calendar icon → the New Event modal opens pre-filled with the contact's info.
- How do I schedule an appointment from inside a conversation thread? Open the conversation thread → click the Profile button to open the contact's slide-over profile → go to the Schedule tab → book the appointment there.
- What's the difference between Email Templates, Campaigns, and Automations? Templates are reusable starting designs (never sent). Campaigns are one-off broadcasts (Design → Recipients → Review). Automations are multi-step drip sequences triggered by an event (new lead, tag added, etc.) where each step has its own delay. All three use the same Flodesk-style builder.
- How do I add a block to my email? Open any template/campaign/automation step → drag any tile from the right-panel block palette onto the canvas. A blue drop indicator shows where it will land. You can drop at any position including the very last slot.
- Why couldn't I drop a new block at the bottom of the email? That was a bug — it's been fixed. Dropping at the last position now works. If it still misbehaves, hard-refresh.
- How do I save a button style I like? Inside the Button block inspector → Style tab → click "Save current style". The saved styles modal lets you apply or delete any saved style later.
- How do I link a button to a PDF or file instead of a URL? Button → Link tab → switch the link pill to "File" → pick from your venue Media library. The button will link to that file's public URL.
- Why does clicking the video in my email take me to the video instead of letting me edit the block? On the LIVE canvas the video block is select-to-edit only — click it once and the right-panel inspector opens. The video only opens in the Preview modal (real iframe) and in the actual delivered email. This is intentional so you don't lose your editing context.
- How do I add my Instagram / TikTok / etc. to my marketing emails? Settings → Branding → Social Networks. Add your URLs there once (Instagram, Facebook, TikTok, LinkedIn, YouTube, Twitter / X, Pinterest, Website). Every Social block in every campaign automatically uses these. The Email builder Social inspector → Links tab → "Manage in branding" deep-links you straight there.
- I want to feature only Instagram and TikTok in this campaign without removing the others from my branding — how? Open the Social block in the email builder → Links tab. Every registered platform shows up with an eye icon. Click the eye next to anything you don't want in this email — it greys out + strikes through and won't render in the canvas, preview, or sent email. Your branding registry stays untouched, so other campaigns still show all of them. The header shows "X of Y visible" so you can see at a glance what will ship; a "Show all" button reveals everything again.
- Where do I edit social icon size or color in an email? Add a Social block → Icons tab in the inspector. Pick style (outline / filled circle / solid circle), color (Flodesk color picker — your saved Brand Colors are at the bottom), size (S / M / L), alignment, and spacing. Changes show pixel-for-pixel in the preview iframe and the sent email.
- How do I save a brand color so I can reuse it everywhere? From any color picker (email block inspector, form builder, etc.), configure the color you want and click the bookmark/save icon next to the swatch. The color is added to your venue's palette instantly and shows up in the saved-swatches row at the bottom of every other color picker in the app. There is no separate "Brand Colors" page in branding settings — manage the palette right where you're using it.
- Where does my address come from in the marketing email Address block? Settings → Branding → Contact Information. The Address block is read-only inside the builder. Click "Manage my address" on the Address inspector tab to jump to Branding and update it once.
- How do I send a test email of my campaign before I schedule it? Click the eye icon (Preview) in the email builder header. The preview modal renders inside a real iframe (links work, videos play). At the top of the modal there's a Send-test form — type any email address and click Send Test to fire a real send through the normal pipeline.
- How does the unsubscribe link work? Every marketing email automatically appends a minimal footer with venue name, physical address, an unsubscribe link, and a "manage your preferences" link. Both links use a signed per-recipient token. They land on a public page at app.storyvenue.com/u/[token]/manage where the recipient can unsubscribe (added to the suppression list) or opt back in. Transactional emails (proposals, invoices, receipts) are not affected.
- A contact unsubscribed by mistake — how do they get back on the list? They use the same "manage your preferences" link from any past marketing email, and click "Subscribe me again." Or they can resubmit their email through your lead capture form with marketing opt-in checked.
- Where do my brand colors get saved technically? They're stored on the venue row in venues.brand_colors (jsonb array of hex strings) and read by the useBrandColors hook (singleton cache). Up to 50 colors per venue.
- Where are the social links stored technically? venues.brand_socials (jsonb array of {platform, url} — migration 059). Read by the useBrandSocials hook. PATCH /api/venues/me validates platform, requires a valid URL, auto-prefixes https://, dedupes, and enforces a max of 8.
- Why does my Social block render nothing in the test email? Branding has no social links saved yet. Add at least one URL at Settings → Branding → Social Networks and resend the test. The block intentionally renders nothing rather than shipping a "[Add social links here]" placeholder to recipients.
- How do I undo a change in the email builder? The left sidebar of the editor has an undo/redo bar. Every block add, delete, move, style change, and text edit is captured.
- Why can't I see the social icons in the editor preview? Make sure (a) you've saved at least one social link in Settings → Branding → Social Networks and (b) the Social block's Icons tab has a non-transparent color set. Editor, preview iframe, and sent email use the exact same render path so what you see is what gets sent.
- Why does my Facebook icon look like just a letter "f" instead of the full Facebook logo? (Same applies to LinkedIn "in", Pinterest "P", TikTok "d", X.) That's the intended Flodesk-style minimalist icon set — filled letterforms for letter-based platforms and stroked outlines for shape-based ones (Instagram camera, Globe, YouTube). It gives every email a clean editorial look that matches modern newsletter design. The simplified marks are still universally recognized. There is no setting to swap to full multi-color brand logos; if you want richer artwork, drop an Image block instead and link it manually.
- Why does my Pinterest icon have a hole in the middle? That's a deliberate "see-through eye" — the bowl of the P uses fill-rule=evenodd so the counter shows the page (or chip) color through it, matching the reference design. It's not a rendering bug.
- How do I delete an email campaign? Marketing → Emails (campaigns list) → click the trash icon on the campaign row → confirm. Campaigns in any status (draft, sent, scheduled) can be deleted this way.
- How do I create a lead capture form? Marketing → Forms → "New form". Every new form starts with First name + Last name (half-width pair), Phone, Email, and a Submit button so you can edit the basics and publish in seconds. Drag tiles from the right panel for any extra fields, click each block to style it (typography, padding, background via the Block tab, etc.), then publish or copy the embed code from the Embed button. [Lead Capture Forms](/dashboard/marketing/form-builder)
- How do I delete a form? Two places: (1) Marketing → Forms list page — click the trash icon next to the pencil. (2) Inside the form editor — Settings (top-right) → Delete form. Both confirm before removing.
- Where do form-wide settings live in the form builder? Click the Settings button in the top-right (next to Embed and Live preview). The modal has the form name, thank-you screen / redirect, notification recipients, embed class, and Delete form. Per-block settings (typography, colors, padding, etc.) stay in the right inspector when a block is selected.
- Why do my form buttons look grey? They shouldn't anymore — every Submit button defaults to the signature #1b1b1b background with white text. If a legacy form looks washed out, click the button block → Style tab → pick the Solid preset or set the background colour explicitly. Older saved forms automatically map their previous buttonVariant onto the new presets.
- Why was the Address block a single textbox before — and now it's multiple fields? The block was rebuilt to capture clean data for your CRM. Address is now Street, City, State, and ZIP code as separate inputs instead of one freeform line, so leads land in your pipeline parseable.
- How does the form Live preview work? Click Live preview in the editor. The form opens inside a real iframe with its real validation and post-submit actions (thank-you screen or redirect) — but submissions don't write a lead and don't fire notifications. It's a clean dry run. The header centers the Desktop / Mobile toggle so you can verify both sizes.
- I uploaded a logo / image / file in another part of the app — where is it? It's automatically in your Media library at /dashboard/media. The brand logo from Settings → Branding, listing photos, and any image picked through "Choose from media library" in the email or form builder all auto-register so you can reuse them without re-uploading. [Media](/dashboard/media)
- How do I create a saved audience for marketing emails? Marketing → Audiences → "New audience". Give it a name, optional description, and pick the same audience options you'd pick on a campaign (All leads / Tags / Pipeline stages, plus optional behavior filters: require wedding date, exclude stages, exclude booked stages, clicked trigger links). A live recipient-count chip shows how many people match right now. Save it, then pick it from any campaign's Audience step.
- What's the difference between a saved audience and a campaign audience? A campaign audience is built once and lives only on that campaign. A saved audience is reusable — define it once and pick it from a dropdown in every future campaign. When you edit a saved audience, every draft and scheduled campaign using it picks up the new audience on the next send. Already-sent campaigns are unaffected (recipients are locked at send time).
- Can I narrow a saved audience further inside a specific campaign? Yes. Pick "Use a saved audience" in the campaign's Audience step, then layer additional behavior filters on top (e.g. start with "Booked couples 2026" but require a wedding date on file, or exclude one stage). Those filters compose with — they don't replace — the audience's own filters.
- Can a saved audience reference another saved audience? No. Saved audiences can only hold an audience type of All leads, Tags, or Pipeline stages — never another audience. This prevents loops and keeps the recipient count honest. The "Use a saved audience" radio is hidden inside the audience editor.
- What happens if I delete a saved audience that's being used by a campaign? Any draft or scheduled campaigns currently pointing at it auto-detach and fall back to "All leads" so they stay valid and sendable. The campaign owner can then re-pick a different audience. We never silently drop a recipient list.
- Where do saved audiences live in the database? marketing_segments table (migration 061): id, venue_id (FK to venues with ON DELETE CASCADE), name (unique per venue, case-insensitive), description, definition_json (CampaignSegment shape constrained to non-saved_segment types), created_at, updated_at. Recipients resolve through src/lib/marketing-email-audience.ts → resolveSavedSegment which loads the audience and merges its filters with any inline campaign filters.
- Why is my saved audience recipient count zero? Common causes: (1) zero leads with email addresses match the audience type, (2) every match is on the marketing suppression list, (3) every match has marketing_email_opt_in=false, (4) you required a wedding date but no matching lead has one set, (5) the audience was deleted (campaign falls back to "All leads"; if you want a non-zero audience, re-pick or build the audience inline). The live count chip in the Audiences editor and the Audience step refresh whenever you change a filter.

## Pricing & Availability Guide
- Some plans include a Venue Pricing & Availability Guide feature — a dedicated, shareable page that showcases your venue packages, pricing, and availability for prospective couples.
- Access: the Venue listing sidebar flyout → Pricing Guide (only visible if your plan includes it; the menu item is locked/greyed-out with an upgrade prompt if not included).
- Creating a guide: fill in the form with your packages, pricing ranges, and availability windows. Click "Generate with AI" to have Ask AI draft compelling, outcome-focused copy for each section based on your venue info. Each section can be individually regenerated for variations.
- Preview: a preview modal lets you see exactly what couples will see before publishing. Suggest changes and regenerate sections as needed.
- Images: listing photos and cover photo are automatically pre-populated so the guide looks polished immediately. Update photos under Venue listing → Photos.
- If your plan does not include the Pricing Guide, the lead form modal that allows couples to request the guide will be hidden from your public listing automatically — no broken links or placeholders.

## Subscription Plans, Add-ons & Trials (Directory Billing)
- Path: Settings → Billing (/dashboard/directory-billing) — manage your storyvenue.com directory subscription.
- **Four plans** (displayed in this order on the billing page):
  1. **Bride Booking System™ Free** — free tier; includes Venue Listing, Reviews, Pricing Guide, Speed to Lead System, Lead Inbox, Conversations, Booking Calendar, Proposals & Payments, Contact Management. Does NOT include Analytics.
  2. **Bride Booking System™** — $97/month; everything in Free plus Analytics dashboard.
  3. **All-Inclusive** — higher tier with additional features; price shown on demo call only (no price shown on billing page — contact sales).
  4. **All-Inclusive Concierge** — highest tier including AI Concierge; price shown on demo call only.
- Each plan is shown as a card with its included features. The Bride Booking System™ features are visually grouped together in a bordered box so venues can clearly see what the core product is.
- **Active plan** is identified with a colored "Active plan" pill.
- **Feature gating**: if a feature isn't in your current plan, its sidebar menu item shows a lock icon. Clicking it shows an upgrade prompt. Direct URL access to a gated feature shows an inline locked screen. The Bride Booking System™ analytics dashboard page is greyed out (blurred with an upgrade overlay) for free-plan users — they see it exists but need to upgrade to access it.
- **Add-ons** (Verified & Sponsored): available as monthly add-ons or included on higher plans — see Verified & Sponsored Listings section below.
- **Upgrading / downgrading**: change plans from Settings → Billing at any time. The All-Inclusive and All-Inclusive Concierge plans require scheduling a demo call — clicking their upgrade button opens the demo scheduling calendar.
- **AI Concierge gating**: AI Concierge is only available on plans where the admin has enabled a checkbox in the directory plan settings. If your plan doesn't include it, the AI Concierge toggle is greyed out with a tooltip directing you to schedule a demo. You cannot enable AI Concierge without being on an eligible plan.

## 14-Day Free Trial & CC Gate (New Account Onboarding)
- New venue accounts must complete a 4-step onboarding modal to go live: **Connect** (StoryPay merchant account) → **Details** (listing info) → **Go live** (publish listing + send test lead) → **Access** (enter credit card).
- **The credit card step is a hard gate** — you cannot access the full dashboard until a card is on file. The onboarding modal always re-opens until the card step is completed. There is no way to skip it.
- After entering a card, a **14-day free trial** begins. The venue's listing goes live, the test lead lands in the inbox, and full dashboard access is granted.
- **If the trial expires and the venue has not downgraded to Free**, the $97/month Bride Booking System™ charge is automatically applied. There is no auto-downgrade — venues must actively choose to downgrade before their trial ends if they want the free tier.
- A trial countdown ribbon appears at the top of the dashboard throughout the trial period, showing days remaining and an option to downgrade.
- **Grandfathered / pre-existing accounts** (signed up before June 25, 2026) are exempt from the CC gate. They can use the onboarding modal to build their listing/pricing guide without being forced to enter a card. If they are on a Legacy Plan, the modal popup is not shown at all.
- **Legacy Plan accounts** are fully exempt — no modal gate, no trial, no auto-charge. Billing is managed directly by StoryVenue.
- Billing statements read as "StoryVenue" (not StoryPay).

## Verified & Sponsored Listings
- Path: /dashboard/listing/directory — manage your Verified and Sponsored listing status.
- Verified listing ($19/month): displays a verified badge on your storyvenue.com listing, signaling to couples that your venue is confirmed legitimate. Price may change; current price is shown on the page.
- Sponsored listing ($99/month): promotes your listing more prominently in directory search results, increasing visibility. Price may change; current price is shown on the page.
- Plan inclusion:
  - Highest paid plan: Verified AND Sponsored are both included automatically at no extra cost.
  - Second-highest paid plan: Verified is included; Sponsored is available as an optional add-on.
  - Free plan and first paid plan: neither is included, but both are available as add-ons.
- Both add-ons can be enabled or disabled at any time regardless of plan. Monthly costs are charged alongside your subscription.
- Prices are displayed on the /dashboard/listing/directory page and on the plans accordion at /dashboard/directory-billing.

## AI Concierge (Automated SMS Lead Engagement)
- Path: Marketing → AI Concierge (sidebar flyout).
- AI Concierge is a venue-level, outbound-only SMS follow-up system powered by DeepSeek. It never auto-replies to messages — it only sends scheduled outbound messages and notifies human concierge when a lead replies.
- **Plan gating**: AI Concierge is only available on plans where the StoryVenue admin has enabled an "AI Concierge" checkbox in the directory plan configuration. On plans without this checkbox enabled, the AI Concierge toggle is greyed out and unclickable. Hovering shows a tooltip directing the user to schedule a demo call. Clicking the greyed-out toggle opens the demo scheduling calendar (GHL embed). Venues on the Bride Booking System Free or Bride Booking System™ plans cannot access AI Concierge — it is only available on All-Inclusive Concierge (and any plan explicitly enabled by admins).
- **Eligibility** (once the plan allows it): requires (1) a plan with AI Concierge checkbox enabled, (2) A2P 10-digit SMS verification completed, and (3) a connected GHL/StoryVenue Legacy sub-account for SMS delivery. If any blocker exists, the settings page shows what's missing.
- **How AI activates — workflow-only**: AI Concierge is NOT auto-activated on any lead. It activates ONLY when the "Activate AI Concierge" block in the Booking System sequence fires for that specific lead. This gives venues complete control over when AI takes over — you decide by placing the block in your sequence (e.g., after 3 days of no reply). Once activated, ai_state flips to ai_active and the send cron picks up the lead within 10 minutes.
- **Lead states**: dormant → ai_active → paused → exhausted → handoff → opted_out. The AI sends outbound messages only when a lead is in "ai_active" state. All state transitions are logged to an audit trail (ai_state_transitions table).
- **Outbound schedule**: once active, the AI sends personalized SMS messages on a randomized 1–2 day cadence. Messages are generated by DeepSeek using a configurable prompt template with all merge variables (contact name, venue name, wedding date, lead notes, inquiry date, etc.). A 60-day global expiry cap prevents indefinite outreach.
- **Stop on reply**: the moment a lead replies to any AI SMS, the system halts all outbound AI messages automatically (last_inbound_at is set). The lead moves to "Conversation Started" in the pipeline and the venue concierge team is notified immediately with the reply content.
- **Inbound classification**: inbound replies are classified by intent (question, objection, booking request, opt-out). Based on the classification, the lead is either flagged for human follow-up (handoff) or the AI continues the sequence if no action is needed.
- **Handoff rules**: 8 configurable rules define when the AI should hand off to a human (e.g., lead asks for pricing details, wants to book a tour, requests specific dates). When a handoff rule fires, the lead moves to "handoff" state and the venue owner is notified immediately.
- **Venue admin controls** (Marketing → AI Concierge):
  - Enable/disable the AI Concierge globally for the venue
  - Set a persona name (how the AI identifies itself in messages)
  - Configure concierge notification email addresses
  - View eligibility status and blockers
- **Per-contact controls** (Contacts → lead detail): each lead shows an AI status pill with contextual actions:
  - ai_active → green pill + Pause AI button
  - paused → amber pill + Re-enable AI button
  - handoff → red "Needs human" pill + Re-enable button
  - opted_out → gray pill + Re-enable button (red + locked if TCPA opt-out)
  - exhausted → orange pill + Re-enable button (locked if past 60 days)
  - dormant (never started) → info-only display
- **A2P verification**: SMS requires A2P 10-digit verification for compliance. The system can auto-submit verification and diagnose status. Without A2P, SMS delivery fails.
- **Spend caps**: per-venue monthly SMS spend limits to prevent runaway costs. When the cap is reached, the AI pauses all sequences until the next billing cycle.
- **Quiet hours**: SMS messages are only sent during business hours (configurable per venue timezone) to comply with TCPA regulations.
- **Team notifications**: when the AI takes action or a lead replies, all venue team members receive CC notifications (not just the owner).
- **Kill switch**: super admins have a global kill switch to disable AI Concierge across all venues instantly.
- **Super admin monitoring** (Admin → AI Concierge):
  - Live runs monitor showing recent AI executions with status
  - Handoff rules editor (configure when AI escalates to humans)
  - Prompt config editor (customize the AI's system prompt template)
  - Runtime settings and metrics
  - A2P verification diagnostics
- **Cron jobs**: two background crons power the system:
  - ai-activate: scans for new eligible leads and starts their sequence
  - ai-send: processes the next message in each active lead's sequence
- Database: ai_config, ai_handoff_rules, ai_runs, ai_state_transitions, plus ai_* columns on the leads table (migrations 098-104).

## Multi-Step Venue Onboarding (Signup Flow)
- New venue signup at app.storyvenue.com/signup follows a 3-step flow:
  1. **Plan picker**: choose from available directory plans. Plan cards show all features with a featured/highlighted middle card. Only public plans are shown (admin-only plans are hidden).
  2. **Add-ons**: select optional add-ons (Verified, Sponsored). Venue Concierge is restricted to plans that support it.
  3. **Payment**: enter card or bank details in a secure inline payment form (Fortis Elements) embedded directly on the signup page — no redirect to an external checkout. Free plans skip this step entirely. If a trial period is configured, the card is validated but the first charge is deferred until the trial ends.
- After signup, the venue is created and the owner lands in the dashboard where a **4-step onboarding modal** guides them to go live.

## Dashboard Onboarding Modal (4-Step Hard Gate)
- After signup, all new venues see a 4-step onboarding modal that must be completed to gain full dashboard access:
  1. **Connect** — complete StoryPay merchant account setup (payment processing).
  2. **Details** — fill in listing info (name, description, photos, etc.).
  3. **Go live** — publish the listing. A test inquiry is sent so the venue can see a lead land in their inbox in real time. The test lead is tagged with a "test" label so it's visible in the inbox but excluded from lead metrics.
  4. **Access** — enter credit card details to start the 14-day free trial of Bride Booking System™ ($97/mo). This is the hard gate.
- The modal always re-opens on login until all 4 steps are complete. There is no way to close or skip it.
- A "Back" button on every step lets users go back and edit previous steps before proceeding.
- **Grandfathered venues** (signed up before June 25, 2026) who are on the Free plan or an active trial are NOT shown the modal popup gate. They can still use the onboarding checklist / pill to complete setup at their own pace.
- **Legacy Plan venues** never see the modal gate.

## Default Sales Pipeline (Locked)
- Every venue has a default sales pipeline called "Bride Booking System™" (or equivalent) that cannot be edited or deleted.
- The default pipeline's stages are locked — they cannot be renamed, reordered, added to, or removed. This protects the platform's default automations and CRM setup.
- Venue owners can create additional custom pipelines and stages freely, but the default pipeline is read-only.
- Attempting to edit or delete default pipeline stages shows a lock message explaining that the default pipeline is protected.

## Test Leads (From Onboarding)
- During onboarding Step 3 (Go live), a test inquiry is automatically sent to the venue.
- Test leads are tagged with a "test" badge in the inbox and leads list so they are clearly identifiable.
- Test leads are excluded from lead count metrics and analytics — they don't inflate your lead numbers.
- Test leads appear in the inbox so you can see exactly what a real inquiry looks like when it lands.

## Legacy Plans
- Legacy plans are grandfathered subscription tiers that bypass all platform billing.
- Venues on a legacy plan automatically receive ALL add-ons (Verified, Sponsored, Venue Concierge) at no extra charge — no subscription or payment required.
- The billing page (/dashboard/directory-billing) shows a locked screen for legacy venues with: the plan name, a "Billing managed directly" banner, a full list of all included features and add-ons, and a note to contact their account manager for changes.
- Legacy plans are marked with an is_legacy flag in the database (migration 105). They are typically hidden from public plan pickers but remain visible to venues already subscribed.
- Only StoryVenue admins can assign or create legacy plans. Monthly platform charges compute to $0 for legacy venues.
- If a venue needs to change from a legacy plan, they contact their account manager — self-serve switching is not available for legacy plans.

## Subscription Management & Self-Serve Billing
- Path: Settings → Billing (/dashboard/directory-billing) — manage your StoryVenue subscription.
- **Plan order on billing page**: Bride Booking System™ Free → Bride Booking System™ → All-Inclusive → All-Inclusive Concierge.
- **Self-serve plan switching**: Bride Booking System Free and Bride Booking System™ have self-serve upgrade/downgrade buttons. All-Inclusive and All-Inclusive Concierge require a demo — their upgrade button opens the demo scheduling calendar.
- **Downgrading to Free**: you can downgrade to Bride Booking System™ Free at any time from the billing page. If you are in an active trial, the trial countdown ribbon stays visible after downgrading to Free until the trial period ends; after that the ribbon disappears. Automations switch off on the free plan.
- **No auto-downgrade after trial**: if your trial expires and you haven't downgraded, you are automatically charged $97/month. The system does not auto-downgrade to Free.
- **Add-on management**: toggle Verified and Sponsored add-ons independently. Add-on changes follow the rollover model.
- **Payment method**: update your card at any time from the billing page. The "Add/Update Card" option is always available.
- **Billing descriptor**: charges appear on bank/card statements as "StoryVenue."
- **Refunds**: subscription refunds are processed through StoryVenue. Contact your account manager. ACH refunds take 3–5 business days.
- **Cancellation**: cancel from the billing page. Access continues until the end of the current billing cycle.
- **Admin extend trial**: StoryVenue admins can extend trial periods for individual venues from the admin dashboard.
- **Trial ribbon / overlay behavior**: during an active free trial on the free plan, both the trial countdown ribbon AND the Bride Booking System™ analytics upgrade overlay are shown. Once the trial expires and the venue remains on free, only the greyed-out analytics overlay persists (no ribbon).

## Venue Concierge Add-on
- Price: $499/month (admin-configurable).
- The Venue Concierge add-on enables the AI Concierge system — an automated SMS-based lead engagement tool powered by DeepSeek.
- Only available on plans that support it (plan-restricted availability).
- When purchased, it unlocks the Marketing → AI Concierge settings page where you configure the automated lead outreach system.
- Without this add-on, the AI Concierge features are locked and the settings page shows an upgrade prompt.
- See the "AI Concierge" section above for full details on what the system does.

## Merge Variables (Merge Tags)
StoryVenue has a unified system of 60+ merge variables usable across every builder, notification, and payment template. All tags use canonical dot-notation: {{category.field}}.

Contact variables (marketing emails, SMS, workflows, AI Concierge):
- {{contact.first_name}} — first name only
- {{contact.last_name}} — last name only
- {{contact.full_name}} or {{contact.name}} — full name
- {{contact.email}} — email address
- {{contact.phone}} — phone number
- {{contact.notes}} — free-form notes / inquiry message from the lead
- {{contact.referral_source}} — how the lead found you (e.g. "Google search")

Venue variables:
- {{venue.name}} — your venue / business name
- {{venue.email}} — venue contact email
- {{venue.phone}} — venue phone number
- {{venue.address}} — full venue address
- {{venue.city}} / {{venue.state}} — city and state
- {{venue.website}} — venue website URL
- {{venue.owner_name}} — owner's full name
- {{venue.owner_first_name}} — owner's first name
- {{venue.description}} — short venue style description (used in AI Concierge prompts)
- {{venue.pricing_guide_url}} — live preview link for the venue's Pricing & Availability Guide PDF; always serves the most up-to-date version in a branded preview page with a download button. Alias: {{pricing_guide_url}}

Appointment variables (calendar notifications + workflows):
- {{appointment.title}}, {{appointment.date}}, {{appointment.time}}
- {{appointment.start_time}}, {{appointment.end_time}}, {{appointment.duration}}
- {{appointment.timezone}}, {{appointment.meeting_location}}, {{appointment.calendar_name}}
- {{appointment.type}} — appointment type (tour, call, etc.)
- {{appointment.notes}} — free-form notes on the event
- {{appointment.space_name}} — venue space assigned to this appointment
- {{appointment.status}} — confirmed / cancelled

Lead / event variables (marketing emails, SMS):
- {{lead.wedding_date}}, {{lead.wedding_month}}, {{lead.guest_count}}
- {{lead.created_at}} — formatted date the lead first inquired. Alias: {{initial_inquiry_date}}
- {{lead.time_since_inquiry}} — humanized time since inquiry (e.g. "14 days ago"). Alias: {{time_since_initial_inquiry}}
- {{lead.notes}} — same as {{contact.notes}}

Payment variables (transactional notifications):
- {{payment.amount}}, {{payment.net_amount}}, {{payment.fee}}
- {{payment.method}} — card/ACH
- {{payment.date}} — date of payment
- {{payment.reason}} — failure reason (for failed-payment emails)
- {{payment.overdue_by}} — how long overdue (for reminder emails)

Invoice / proposal / subscription variables:
- {{invoice.number}}, {{invoice.amount}}, {{invoice.due_date}}, {{invoice.date}}, {{invoice.payment_method}}
- {{proposal.title}}, {{proposal.amount}}
- {{subscription.amount}}, {{subscription.frequency}}, {{subscription.next_payment_date}}

Marketing variables (campaign / automation emails only):
- {{marketing.unsubscribe_url}}, {{marketing.resubscribe_url}}, {{marketing.preferences_url}}

System variables:
- {{system.date}} — today's date at send time
- {{system.year}} — current year
- {{system.workflow_name}} — name of the workflow automation (notify_owner steps only)

Legacy flat tags still work as aliases (e.g. {{first_name}} = {{contact.first_name}}, {{customer_name}} = {{contact.name}}, {{organization}} = {{venue.name}}, {{amount}} = {{payment.amount}}, {{wedding_date}} = {{lead.wedding_date}}, {{initial_inquiry_date}} = {{lead.created_at}}, {{referral_source}} = {{contact.referral_source}}). The system resolves both formats automatically — existing templates do not need to be updated.

Where to find variable pickers:
- Trigger Links & Tags page: full searchable reference of all 60+ variables grouped by category
- Workflow builder: Variables button on every email/SMS step — searchable, categorized
- Email/campaign builder: sidebar variable panel grouped by category, click to copy
- Notifications page: variable pills below each template editor, click to copy
- Calendar settings → Notifications: merge tag reference in each channel editor

## Speed to Lead System (6-Phase Automation)
- Path: Venue listing → Speed to Lead System (/dashboard/listing/booking-system). Visibility is controlled by a checkbox on the venue's directory plan.
- The Speed to Lead System fires the moment a bride submits your public listing inquiry form on storyvenue.com. It is completely independent of GHL; GHL is only used for A2P SMS delivery.
- **6 phases** — each has its own toggle so you enable only what you need:
  1. **Guide Delivery** (instant) — sends an email and/or SMS with a direct link to the Pricing & Availability Guide PDF. The PDF is generated live on every click — always the current version. Toggle email and SMS independently.
  2. **Follow-up Sequence** — customizable sequence of Send Email, Send SMS, Wait, and Activate AI Concierge steps. Fires on a cron. Stops the moment a bride replies. No fixed length — add as many steps as you want.
  3. **Nurture Sequence** — a 5-email educational sequence about picking and touring venues. No AI Concierge handoff.
  4. **Booked Tour** — a 5-email sequence that fires when a lead books a tour; sets expectations for the visit. No AI Concierge handoff.
  5. **Booked Wedding** — a 5-email sequence that fires when a lead books a wedding; celebrates the win. No AI Concierge handoff.
  6. **AI Concierge** — plan-gated (All-Inclusive only). An AI SMS follow-up for quiet leads. Locked on Bride Booking System Free and Bride Booking System™ plans; greyed toggle with tooltip and demo scheduling modal. See AI Concierge section for full details.
- Activate AI Concierge block (Phase 2 only): adding this block to the Follow-up Sequence hands the lead to the AI Concierge at that step. This is the ONLY way AI activates — no automatic timer.
- Stop on reply: if the bride replies to any message during any phase, the enrollment halts automatically and the venue is notified.
- Guide PDF merge variable: {{pricing_guide_url}} (alias {{venue.pricing_guide_url}}) — live link, always generates the current guide version.
- GHL is only used for A2P SMS. All email uses Resend and all templates/variables are native to StoryVenue.
- Common question — "will editing my pricing guide change what brides receive?" Yes — the PDF is generated live on each click from your current saved Pricing Guide content.

## Default Sales Pipeline (Locked)
- Every venue has a default pipeline (the "Bride Booking System™" pipeline) whose stages are locked and cannot be renamed, reordered, added to, or deleted.
- The pipeline itself cannot be deleted either.
- This protects the platform's built-in automations which reference these specific stage names.
- Venue owners can create additional custom pipelines freely. Only the default pipeline is read-only.
- When a venue owner tries to edit a default pipeline stage, they see a lock message.

## Venue Direct (Concierge-to-Venue Messaging)
- Venue Direct is a two-way messaging channel between the StoryVenue Concierge team and venue owners/subaccounts.
- From the super admin side: the Concierge sends messages to a venue through the Support Inbox Panel. Each venue has a contact thread. Messages appear in the venue owner's Conversations inbox.
- From the venue side: the owner sees Venue Direct messages in their Conversations inbox (/dashboard/conversations). They can reply directly from within the thread. Replies route back to the concierge inbox as inbound messages.
- Email notifications: when the concierge sends a Venue Direct message, a notification email goes to the venue owner's auth email address.
- Inbound email replies: when a venue owner replies to the notification email (Reply-To is set to a per-thread inbound address), the reply is automatically ingested into the thread via Resend's inbound webhook.
- Thread state: threads have a status (open / pending / closed). The concierge can mark a thread as "Read" (closes it, clears the alert) or "Mark unread" (reopens it and restores the alert dot). When the venue owner replies, a closed thread automatically reopens so the concierge sees it again.
- Collapsible email messages: long email replies in both the concierge view and the venue's Conversations view are collapsed by default showing a snippet. Click "Show full email" to expand inline.
- Read receipts and badge: the concierge's support inbox shows a count of unacknowledged Venue Direct messages and unread bride threads. The badge updates in real time via Supabase broadcast events.
- Auto-scroll: when opening a thread the view scrolls to the first unread message automatically.

## Contacts — deletion
- To delete a contact manually: Contacts page → find the contact → delete action.
- The delete endpoint (POST /api/contacts/delete) handles all three sources: native StoryVenue contacts, GHL-synced contacts (non-UUID IDs are resolved), and LunarPay contacts. It removes the record from venue_customers (cascading to related rows) and from leads, and if the contact originated from GHL it also calls the GHL API to delete it there.
- The UUID error that sometimes appeared for GHL contacts ("invalid input syntax for type uuid") is fixed — the endpoint now resolves the GHL contact ID to the internal venue_customers UUID before attempting the delete.

## Owner Notifications — multi-channel alerting
- StoryVenue sends alerts to venue owners through three independent channels: **email** (Resend), **SMS** (GHL/StoryVenue Legacy), and **push** (browser push notifications).
- Scenarios: payment_received, payment_failed, high_value_payment, proposal_signed, document_viewed, subscription_created, subscription_cancelled, invoice_paid, refund_issued, new_customer, new_lead, new_message, ai_handoff.
- Each channel is toggled independently at Settings → Notifications (email/SMS) and Settings → Push Notifications (push).
- Push and email fire simultaneously — disabling one does not affect the others.

## Two-Factor Authentication (2FA)
- 2FA adds a second verification step (6-digit code from an authenticator app) to your login.
- Setup: Profile → Two-Factor Authentication → Enable 2FA → scan QR code with Google Authenticator / Authy / 1Password → enter code to confirm → save backup codes.
- Login: email + password → then enter 6-digit code from authenticator app.
- Per-user: each team member can enable independently.
- Feature flag: TWOFA_ENABLED must be set in environment.
- Lost authenticator: use backup code. Lost backup codes: contact support.

## Push Notifications
- Instant browser alerts for important events — works even when the dashboard is closed.
- Setup: accept browser notification permission → go to Settings → Push Notifications → toggle each event type.
- Events: new message, payment received/failed, proposal signed, new lead, AI handoff, invoice paid, subscription created/cancelled, refund issued, new customer.
- Test: click "Send test notification" on the Push Notifications settings page.
- Per-device: each device/browser needs its own permission grant. Dead subscriptions auto-pruned.
- Push + email are independent channels — you can have both, either, or neither.
- Path: /dashboard/settings/push.

## PWA / Install as App
- StoryVenue is a Progressive Web App — installable on phone, tablet, or desktop.
- iPhone: Safari → Share → "Add to Home Screen". Android: Chrome → menu → "Add to Home screen". Desktop: install icon in address bar.
- Installed apps get: home screen icon, full-screen mode, push notifications when browser is closed, faster load.
- Install prompt appears automatically after first visits; manual install always available.
- Offline page at /offline with retry button.
`;

// Each message in the conversation history is capped at 2 000 chars
// (~500 tokens) to prevent a crafted history from inflating the prompt.
const MAX_MSG_CHARS = 2_000;
// Accept at most 20 history turns (already enforced by .slice(-20) below,
// but also validated on input so we don't parse a huge array).
const MAX_HISTORY_TURNS = 20;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = checkAiRateLimit(request, venueId, 'chat');
  if (limited) return limited;

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: 'AI not configured.' }, { status: 503 });
  }

  const { messages: rawMessages, pathname } = await request.json();
  if (!rawMessages || !Array.isArray(rawMessages)) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 });
  }

  // Sanitise each message: enforce role allowlist, cap content length.
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> =
    (rawMessages as unknown[])
      .slice(-MAX_HISTORY_TURNS)
      .filter((m): m is { role: string; content: string } =>
        typeof m === 'object' && m !== null &&
        typeof (m as Record<string, unknown>).content === 'string',
      )
      .map((m) => ({
        role:    (['user', 'assistant'].includes(m.role) ? m.role : 'user') as 'user' | 'assistant',
        content: m.content.slice(0, MAX_MSG_CHARS),
      }));

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

  const systemPrompt = `You are Ask AI, the intelligent support assistant built into StoryVenue — a proposal and payment platform for wedding venues.

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
  Examples: [Open Branding Settings](/dashboard/settings/branding) [Manage Social Networks](/dashboard/settings/branding#social-networks) [View Proposals](/dashboard/payments/proposals) [New Payment](/dashboard/payments/new) [Go to Reports](/dashboard/reports) [Manage Contacts](/dashboard/contacts) [View Transactions](/dashboard/transactions) [Open Calendar](/dashboard/calendar) [Open Integrations](/dashboard/settings/integrations) [Marketing analytics](/dashboard/marketing/analytics) [AI Concierge Settings](/dashboard/marketing/ai-concierge) [Email Templates](/dashboard/marketing/email/templates) [Email Campaigns](/dashboard/marketing/email/campaigns) [Email Automations](/dashboard/marketing/email/automations) [Audiences](/dashboard/marketing/email/audiences) [Trigger links](/dashboard/marketing/trigger-links) [Lead Capture Forms](/dashboard/marketing/form-builder) [Media](/dashboard/media) [Listing photos](/dashboard/listing/images) [Notifications](/dashboard/settings/notifications) [Plans & Billing](/dashboard/directory-billing) [Verified & Sponsored](/dashboard/listing/directory) [Payment Settings](/dashboard/payments/settings) [Payouts](/dashboard/payments/payouts) [Subscriptions](/dashboard/payments/subscriptions) [Packages](/dashboard/offerings) [Proposal Templates](/dashboard/proposals/templates) [Booking System](/dashboard/listing/booking-system) [Conversations](/dashboard/conversations)
- Only link to real dashboard paths. Valid paths: /dashboard, /dashboard/calendar, /dashboard/contacts, /dashboard/conversations, /dashboard/leads, /dashboard/media, /dashboard/listing, /dashboard/listing/booking-system, /dashboard/listing/images, /dashboard/listing/analytics, /dashboard/listing/reviews, /dashboard/listing/directory, /dashboard/marketing/analytics, /dashboard/marketing/ai-concierge, /dashboard/marketing/email/templates, /dashboard/marketing/email/campaigns, /dashboard/marketing/email/automations, /dashboard/marketing/email/audiences, /dashboard/marketing/email/preferences, /dashboard/marketing/workflows, /dashboard/marketing/trigger-links, /dashboard/marketing/form-builder, /dashboard/payments/proposals, /dashboard/payments/new, /dashboard/payments/settings, /dashboard/payments/payouts, /dashboard/payments/subscriptions, /dashboard/offerings, /dashboard/proposals/templates, /dashboard/transactions, /dashboard/reports, /dashboard/settings, /dashboard/settings/branding, /dashboard/settings/branding#social-networks, /dashboard/settings/integrations, /dashboard/settings/team, /dashboard/settings/notifications, /dashboard/settings/calendar, /dashboard/settings/calendar?tab=notifications, /dashboard/directory-billing, /dashboard/help
- Place the link on its own line at the end of the relevant sentence or step, not inline mid-sentence

=== TONE ===
Friendly, professional, calm, helpful, clear. Not robotic. Not salesy.

=== PUNCTUATION RULES ===
NEVER use em dashes (—) or en dashes (–). Use commas, periods, parentheses, or new sentences instead. This is non-negotiable.`;

  const deepseek = getDeepSeekClient();

  try {
    const completion = await deepseek.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: 600,
      temperature: 0.5,
    });

    const rawReply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response. Please try again.';
    const reply = stripEmDashes(rawReply);
    return NextResponse.json({ reply });
  } catch (err) {
    console.error('[ai/chat] DeepSeek error:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 500 });
  }
}
