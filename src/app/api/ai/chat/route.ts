import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';

const PLATFORM_DOCS = `
# StoryVenue Platform Documentation

## Overview
StoryVenue is an all-in-one platform for wedding venues to manage proposals, invoices, payments, a booking calendar, contact CRM profiles, email templates, branding, integrations, and team members — all from one place.

## Navigation / Sections
- Home (Dashboard): Revenue overview, KPI cards, recent proposals and transactions, date range filter.
- Ask AI: Sidebar entry plus floating sparkle (bottom-right) — answers questions using live account data and this documentation (updated for Venue listing, Media library, Reviews, Conversations, public API/embed, and Help Center).
- Contacts: Full CRM — contact profiles with Overview, Notes, Activity timeline, Payments, Tasks, Documents; configurable sales pipeline and stages in the profile header (aligned with Leads when email matches).
- Conversations: Unified inbox per contact — **Team only** internal notes (optional @mentions to teammates) vs **Email contact** outbound messages. Threads use venue customers; external sends email when the contact has an email on file. Path: /dashboard/conversations. Related DB: conversation_threads, conversation_messages (migration 022). **Two-way** by design: outbound email uses a per-thread Reply-To on the inbound subdomain (e.g. inbound.storyvenue.com) and Resend's email.received webhook at /api/webhooks/inbound-email appends the customer's reply to the same thread. Outbound SMS goes through the connected GHL sub-account's A2P number; inbound SMS is posted back via GHL webhooks and threaded by phone number.
- Calendar: Book and track all venue events (tours, weddings, receptions, tastings, meetings, rehearsals, holds, blocked dates). Syncs with Calendly, Google Calendar, Outlook, and Apple Calendar. Event chips take their color from the assigned **venue space** (the old per-event-type color legend was removed). The New/Edit Event modal supports **inline Space management** (add/edit/remove without leaving the form), a **contact search** field that attaches the event to a venue customer, and an **Assigned team member** picker when team members are present.
- Venue listing (sidebar flyout, Store icon): **Dashboard** — edit how the venue appears on storyvenue.com (description, slug, capacity, publish toggle); autosaves. **Photos** — cover + gallery for the directory listing (upload directly or pick from Media). **Analytics** — (1) GA4 Measurement ID for full Google Analytics integration; (2) **Real-time visitor map** — interactive Leaflet world map showing live and recent visitors to your listing with pulsing markers, hover tooltips (city/region), and zoom controls. **Reviews** — (1) StoryVenue reviews: star ratings and testimonials; statuses published / pending / hidden; published reviews feed the public directory via API and embed; (2) **Google Reviews tab**: connect your Google Business Profile via auto-search or by pasting a Google Maps link to display your Google reviews on your storyvenue.com listing. Paths: /dashboard/listing, /dashboard/listing/media, /dashboard/listing/images, /dashboard/listing/analytics, /dashboard/listing/reviews.
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
- Payments (sidebar flyout): New, Proposals, Proposal Templates, Installments, Subscriptions, Transactions.
- Marketing (sidebar flyout): Analytics, Emails (campaigns), Audiences, Forms, Workflows, Trigger links & tags. All three email surfaces (Templates / Campaigns / Automations) use the Flodesk-style drag-and-drop builder — see "Marketing email builder" section below.
- Help Center: Searchable categories and articles (including Venue listing, Reviews, Conversations, Ask AI, Leads); contextual suggestions by page; voice search; article ratings.
- What's New: Changelog and Feature Requests board. The sidebar menu item shows a **red dot with unread count** whenever there are entries a user hasn't reviewed; visiting the page marks everything read for that user (per-user read state). Feature Requests submitted by venues can be **approved, edited, or removed** by super admins. When a super admin approves a request it's automatically converted into a **What's New** changelog entry with an outcome-based auto-generated headline + description, and the request is removed from the venue's own feature-request list.
- Settings (sidebar flyout): General (venue info, service fee), Branding, Email Templates, Integrations (Calendly, Google Calendar, QuickBooks, FreshBooks), Team (roles, invites, **Hide $** for team members — owners only), Notifications. Venues may also store **listing marketing monthly spend** on the account for Leads ROI — when that value exists, insights use it.
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
- Powered by Leaflet.js + OpenStreetMap (CartoDB Positron tiles). No Google Maps billing.
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

## Conversations (inbox)
- Path: /dashboard/conversations — unified inbox showing all threads by contact.
- Thread list: each row shows the contact name, last message preview, timestamp, and the contact's **current pipeline stage** as a colored pill so you know where they are in your funnel at a glance.
- Open a thread to load the message history. **Mark read/unread**, **pin**, **star**, or **delete** a thread using the action icons that appear on hover or in the thread header.
- Composer: toggle **Team only** (internal note) vs **Email contact** (outbound email) before sending. @mentions work inside team notes to notify a specific teammate.
- **Contact profile drawer**: click the Profile button inside any open conversation thread to slide in the full contact profile from the right side — without leaving Conversations. The drawer has all the same tabs as the standalone contact profile (Overview, Notes, Activity, Payments, Tasks, Documents, Schedule). This lets you book a call, log a note, or review payment history while reading the thread.
- **Schedule tab in profile drawer**: lets you book a new appointment for the contact directly from inside the conversation, without navigating away.
- **Team filter tab**: filter the thread list to only show threads where a specific team member is involved.
- **Team directory card**: compact team directory visible inside the conversations view — see who's online / available at a glance.
- Replies: two-way by design. Outbound email goes through Resend; the per-thread Reply-To address is on the inbound subdomain (e.g. inbound.storyvenue.com) so when the contact replies to the email it arrives back in the same thread automatically. Outbound SMS goes through the connected GHL A2P number; inbound SMS from the contact is threaded by phone number via GHL webhook.
- Auto-refresh: threads poll for new inbound SMS messages every 5 seconds so the conversation stays live without a manual reload.
- Reply-halt automation: if a contact replies to a drip automation email, that enrollment is automatically halted so a human can take over the conversation. The venue owner gets a notification email.
- Requires conversation tables applied (migration 022) and SUPABASE_SERVICE_ROLE_KEY set.

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

## Workflows (visual automation builder — fully integrated with system tags + 50 merge variables)
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
- **Send SMS** — free-form body with a "Variables" button that opens a categorized, searchable popover of all 50 system merge variables (Contact / Venue / Lead / Appointment / Proposal / Invoice / Subscription / Marketing / System). Click any variable to insert at cursor. Trigger-link inserter, character / segment counter, MMS media picker, and per-step Test SMS are also available.
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

## Authentication (Login / Signup)
- StoryVenue uses **email + password** authentication for venue owners, team members, and couples. There are no magic links or code-based logins.
- Venue owners sign up at app.storyvenue.com/signup with business name, email, and password.
- Team members accept email invites and set their own password on first login.
- Forgot password: click "Forgot password?" on the login page → enter your email → receive a reset link → set a new password.
- Venue owners can update their **email address** and **password** at any time from their profile — click the avatar/name in the sidebar → My Profile → update and save.
- The current password is **not** required to update email or password — just enter and save the new value.
- GHL / StoryVenue Legacy integration: if a venue has a connected GHL sub-account, their GHL contacts can be synced (Settings → Integrations → "Sync from StoryVenue Legacy"). This is separate from authentication.

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
- StoryPay™ is the payment processing tier within StoryVenue, powered by LunarPay (Fortis).
- Venues must **apply for StoryPay™** and complete merchant onboarding before they can accept payments (proposals/invoices with payment enabled).
- Until StoryPay™ is active, certain features are gated — a banner in Settings reminds owners to apply.
- **Apply**: Settings → StoryPay or click the "Apply for StoryPay™" prompt that appears in payment-related areas.
- The onboarding wizard collects business information, owner details, and banking info for Fortis processing. Card numbers from customers go directly to Fortis (PCI SAQ-A compliant — StoryVenue never stores raw card numbers).
- Once approved: proposals and invoices can accept credit card payments, installments, and subscriptions online.
- If payment processing shows as unavailable: check that your LunarPay/Fortis onboarding is complete. Contact support if you believe it should be active.

## SMS Notifications
- SMS is sent automatically when proposals and invoices are created (if customer has a phone number).
- Phone numbers must be in US format — auto-formatted to E.164.
- SMS routes through your GHL sub-account's A2P approved phone number.

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
- Confirm the amount and click Issue Refund. Processes immediately through LunarPay.

## Payment Processing
- StoryVenue uses LunarPay (powered by Fortis) for all payment processing.
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
- How do I add my logo? Settings → Branding → upload a logo file, or choose an image from **Media** (JPG/PNG/WebP/AVIF/GIF).
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
- What is Conversations? Sidebar → Conversations — unified inbox with team notes, outbound emails, and two-way SMS threads. See pipeline stage of each contact directly in the thread list. Click the Profile button inside a thread to open the contact's full profile in a slide-over without leaving the page.
- Why do I see an error about conversations migration? Apply 022_conversations.sql in Supabase and set SUPABASE_SERVICE_ROLE_KEY on the host.
- How do I update my email or password? Click your name/avatar in the sidebar → My Profile. Enter your new email or password and save. No current-password re-entry required.
- How does client / couple login work? Couples use app.storyvenue.com/couple/login with the email and password they set at signup. They can view their proposals and documents.
- How do I apply for StoryPay™? Settings → StoryPay (or click the "Apply for StoryPay™" prompt). Complete the LunarPay/Fortis merchant onboarding wizard to activate payment processing.
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
`;

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.DEEPSEEK_API_KEY) {
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
  Examples: [Open Branding Settings](/dashboard/settings/branding) [Manage Social Networks](/dashboard/settings/branding#social-networks) [View Proposals](/dashboard/payments/proposals) [Go to Reports](/dashboard/reports) [Manage Contacts](/dashboard/contacts) [View Transactions](/dashboard/transactions) [Open Calendar](/dashboard/calendar) [Open Integrations](/dashboard/settings/integrations) [Marketing analytics](/dashboard/marketing/analytics) [Email Templates](/dashboard/marketing/email/templates) [Email Campaigns](/dashboard/marketing/email/campaigns) [Email Automations](/dashboard/marketing/email/automations) [Audiences](/dashboard/marketing/email/audiences) [Trigger links](/dashboard/marketing/trigger-links) [Lead Capture Forms](/dashboard/marketing/form-builder) [Media](/dashboard/media) [Listing photos](/dashboard/listing/images)
- Only link to real dashboard paths. Valid paths: /dashboard, /dashboard/calendar, /dashboard/contacts, /dashboard/conversations, /dashboard/leads, /dashboard/media, /dashboard/listing, /dashboard/listing/images, /dashboard/listing/analytics, /dashboard/listing/reviews, /dashboard/marketing/analytics, /dashboard/marketing/email/templates, /dashboard/marketing/email/campaigns, /dashboard/marketing/email/automations, /dashboard/marketing/email/audiences, /dashboard/marketing/email/preferences, /dashboard/marketing/workflows, /dashboard/marketing/trigger-links, /dashboard/marketing/form-builder, /dashboard/payments/proposals, /dashboard/payments/new, /dashboard/transactions, /dashboard/reports, /dashboard/settings, /dashboard/settings/branding, /dashboard/settings/branding#social-networks, /dashboard/settings/integrations, /dashboard/settings/team, /dashboard/settings/notifications, /dashboard/settings/email-templates, /dashboard/settings/calendar, /dashboard/settings/calendar?tab=notifications, /dashboard/help
- Place the link on its own line at the end of the relevant sentence or step, not inline mid-sentence

=== TONE ===
Friendly, professional, calm, helpful, clear. Not robotic. Not salesy.`;

  const deepseek = getDeepSeekClient();

  try {
    const completion = await deepseek.chat.completions.create({
      model: DEEPSEEK_MODEL,
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
    console.error('[ai/chat] DeepSeek error:', err);
    return NextResponse.json({ error: 'AI request failed. Please try again.' }, { status: 500 });
  }
}
