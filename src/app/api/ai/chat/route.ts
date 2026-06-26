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
- Conversations: Unified inbox per contact — **Team only** internal notes (optional @mentions to teammates) vs **External** outbound messages with a channel toggle for **Email** or **SMS** per message. Path: /dashboard/conversations. Two-way by design: every outbound message shows a green "Sent" check or red "Failed" badge. Inbound replies arrive in real time — when a contact replies by email or SMS, the message appears in the thread within seconds. Threads can carry both SMS AND email simultaneously.
- Calendar: Book and track all venue events (tours, weddings, receptions, tastings, meetings, rehearsals, holds, blocked dates). Syncs with Calendly, Google Calendar, Outlook, and Apple Calendar. Event chips take their color from the assigned **venue space** (the old per-event-type color legend was removed). The New/Edit Event modal supports **inline Space management** (add/edit/remove without leaving the form), a **contact search** field that attaches the event to a venue customer, and an **Assigned team member** picker when team members are present.
- Venue listing (sidebar flyout, Store icon): **Bride Booking System™ Analytics** (/dashboard/listing) — the primary analytics hub showing the live visitor map, booking funnel (Leads → Conversations → Tours → Weddings), KPI cards, daily views chart, traffic sources, geography, lead insights, UTM builder, and QR code. **Free-plan users see this page blurred with an upgrade overlay.** **Venue Listing Editor** (/dashboard/listing/venue-listing) — edit how the venue appears on storyvenue.com (description, slug, capacity, publish toggle). **Photos** — cover + gallery for the directory listing. **Reviews** — StoryVenue reviews + Google reviews. **Speed to Lead System** — 6-phase automation. Paths: /dashboard/listing (analytics), /dashboard/listing/venue-listing (editor), /dashboard/listing/media, /dashboard/listing/images, /dashboard/listing/analytics, /dashboard/listing/reviews, /dashboard/listing/booking-system.
- Leads: Kanban and list views for inquiries — same configurable sales pipelines and stages as contact profiles. Includes pipeline intelligence (open pipeline vs weighted forecast, booked revenue vs listing spend), per-lead opportunity value on cards, assignable owners, marketing tags, trigger links, an audit trail (stage/value/owner changes and logged calls), and mobile-friendly actions (drag cards, log call, quick note). Every contact with an email address automatically appears in the pipeline. The **+ Add Lead** modal includes a **Space** picker with inline add/edit/remove. Pipeline stage colors use a popover color picker with a hex code input, color wheel, and preset swatches.
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
- Announcement ticker (top of every page, dark "News" bar): broadcasts platform-wide messages from the StoryVenue team (downtime, new features, billing/compliance updates). It is **intentionally NOT dismissible** from the venue side — there is no X / close button. Only the StoryVenue support team can deactivate a message, and they will when it's no longer relevant. Hovering pauses the scroll so you can read or click any embedded link.

## Venue listing, reviews, and storyvenue.com
- Your published listing is visible to couples at storyvenue.com/your-slug. Only published listings appear — unpublished listings are hidden from public search.
- The Reviews dashboard provides a copy-paste embed snippet so your StoryVenue reviews can be displayed on your own website.
- You can preview your public listing at any time from the Venue Listing dashboard.

## Google Reviews (listing)
- Venue listing → Reviews → Google tab lets you connect your Google Business Profile so your Google reviews appear on your storyvenue.com listing.
- **Search flow (primary)**: The tab auto-searches Google using your venue name and location as soon as it opens. If your business appears in results, click "Yes, that's us" to link it.
- **Google Maps URL paste (fallback)**: If the search doesn't return your business (common for service-area businesses with no storefront), expand "Can't find it? Paste a Google Maps link instead" and paste any Google Maps URL — share link (maps.app.goo.gl), full browser URL, or a link from your Google Business Profile. The system extracts the Place ID automatically.
- **Service-area businesses**: If your business has no fixed address (you travel to clients), the Google Places API cannot look it up by name. Use the Maps URL fallback instead. If that also fails, copy your Place ID from Google's Place ID Finder (linked in the UI) and paste it directly.
- Once connected, a green "Connected to Google Business" banner appears. StoryVenue caches your reviews and refreshes them periodically. You can force a refresh with the refresh icon.
- On the public storyvenue.com listing, up to 5 Google reviews are shown. A "See all Google reviews" button links directly to your Google Maps listing so couples can read every review.
- If your Google Business cannot be found by search, contact StoryVenue support for assistance connecting it.

## Listing analytics — Real-time visitor map
- Path: Venue listing → Bride Booking System™ Analytics — scroll to the "Live visitor map" section.
- The interactive world map shows real-time and recent visitors to your public storyvenue.com listing.
- **Live markers** (pulsing red dot): visitors active in the last 90 seconds.
- **Recent markers** (indigo dot): visitors seen in the last 30 minutes.
- Zoom in/out with + / − controls. Pan by dragging. Hover a marker to see the visitor's city, region, and country.
- The map always shows even with no visitors; an overlay reads "No visitors in the last 30 minutes" when empty.

## Listing analytics — historical retention & "Daily views" chart
- All visitor data is stored permanently — there is no expiration or auto-deletion.
- The date-range picker (1 / 7 / 14 / 30 / 60 / 90 days) is a query window, not a data limit. Switching to a longer window shows more history from the same permanent record.
- The "Daily views" chart always shows the full requested window, filling in zeros for days with no traffic. A sparse chart with a flat line means no real visitors came on those days — the data is correct.
- If a venue owner says "my view counts aren't saving": they ARE saved — the listing simply had no traffic on the empty days. Switching to 60 / 90 days will show more history. You can test by visiting your own public listing in incognito and watching the Live visitor map update within ~10 seconds.

## Media (shared images + files)
- Path: /dashboard/media (top-level sidebar → **Media**). One library for everything you reuse across the product. The legacy URL /dashboard/listing/media now redirects here.
- Supports **images AND files**. Allowed types: images (JPG/PNG/WEBP/AVIF/GIF), PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPT/PPTX), CSV, TXT. Max 25 MB per file. Video uploads are not supported.
- Page features: drag-and-drop the whole window to upload, per-file progress bars, search by filename, filter pills (All / Images / Documents), sort (newest / oldest / name / size), grid ↔ list toggle (preference saved per browser), per-asset action row (one-click Trash icon plus a "..." menu with Copy URL / Download / Open / Rename / Delete). The "..." menu renders as a portal so it's never clipped by surrounding cards or by the page edge, and closes automatically on scroll.
- **In-app preview**: clicking any asset opens a unified preview modal — full-bleed image viewer for images, native PDF viewer (iframe) for PDFs, Microsoft Office Online embedded viewer for Word / Excel / PowerPoint files, and an inline plain-text/CSV reader for txt/csv. Unsupported types fall back to a simple "preview not available" with a Download button. The modal toolbar always exposes Open in new tab + Download.
- **Download**: clicking the Download action saves the file directly to your computer.
- **Auto-population**: anything uploaded anywhere in the dashboard is automatically registered in the Media library — the brand logo (Settings → Branding), listing photos (Venue listing → Photos), and any image picked through the email or form builder's "Choose from media library" picker (Image / Button file-link blocks in emails, Image block in forms). Re-uploading the brand logo refreshes the existing library row instead of creating duplicates.
- **Used in** indicator: each file shows where its public URL is referenced — **Brand logo** (Settings → Branding), **Listing cover/gallery** (Venue listing → Photos), **Email templates and campaigns** (Marketing → Emails), **Lead capture forms** (Marketing → Forms). Deleting prompts a confirm modal that lists every place the URL is used so you can fix those references before breaking them. Deleting a file that's currently used as the brand logo, cover image, or in the gallery also clears that reference on the venue record so the dashboard doesn't render a broken image.
- Rename is **display-name only** — the public URL stays the same, so existing links don't break.
- Where it connects: **Listing photos** — "From media library" adds an image to the gallery. **Marketing → Emails** — Image / Button (file link) blocks → "Choose from media library". **Marketing → Forms** — Image block → "Choose from media library". **Settings → Branding** — "Choose from media library" for the logo.
- Files are stored securely in the cloud. Brand logos and media files are stored separately to keep your library organized.

## Conversations (inbox) — two-way messaging
- Path: /dashboard/conversations — unified inbox showing all message threads by contact.
- Thread list: each row shows the contact name, last message preview, timestamp, and the contact's current pipeline stage as a colored pill.
- Open a thread to load message history. **Mark read/unread**, **pin**, **star**, or **delete** a thread using the action icons that appear on hover or in the thread header.
- Composer: toggle **Team only** (internal note) vs **External** (visible to contact). When External, choose **Email** or **SMS** per message. @mentions work inside team notes to notify a specific teammate. A single thread can carry both email and SMS.
- **Send confirmation**: every outbound message shows a green "Sent" check once delivered, or a red "Failed" badge if the send was rejected. The email card shows which address it was delivered to.
- **Custom sending domain (optional)**: email sends immediately using StoryVenue's verified sending domain — no DNS setup required. If you prefer to send from your own domain, contact StoryVenue support.
- **Contact profile drawer**: click the Profile button inside any open thread to view the full contact profile (Overview, Notes, Activity, Payments, Tasks, Documents, Schedule) without leaving the conversation.
- **Team filter**: filter threads by team member to see whose conversations need attention.
- **Inbound replies are near-instant**: when a contact replies to an email or SMS, the message appears in the thread within seconds.
- **Reply-halt**: when a contact replies to any marketing automation message, all active automation sequences for that contact are automatically paused and you receive a notification so you can take over personally.

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
- StoryVenue connects to 6,000+ apps via Zapier.
- **Triggers**: New Lead, New Contact, Tag Added, Proposal Signed, Payment Received, Appointment Booked, Appointment Cancelled.
- **Actions**: Create or Update Contact, Create Lead, Add Tag, Send SMS, Send Email, Find Contact by Email.
- To connect: Settings → Integrations → "Generate API key" → copy the key → click "Connect with Zapier" → accept the app → paste the API key when Zapier asks. The API key is shown only once at creation — copy it immediately.
- Webhook subscriptions auto-disable after repeated delivery failures. Manage and revoke active keys from the Integrations page at any time.
- Common uses: "When a new lead arrives, send a Slack message"; "When a proposal is signed, add a row to Google Sheets"; "When a payment is received, post in Slack"; "When a Typeform is submitted, create a StoryVenue lead."

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
- **Social Networks** (Settings → Branding → Social Networks): per-venue social profile URLs used by the marketing email **Social block**. Supported platforms: Instagram, Facebook, TikTok, LinkedIn, YouTube, Twitter / X, Pinterest, Website. Up to 8 platforms total. Each row has an Open link + Remove button. This is the single source of truth for all social links in your emails. Inside any specific email, the Social block's Links tab has a per-row eye toggle to hide a platform from that email only — your Branding settings are unchanged.

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
- Drop indicator shows exactly where a new block will land, including the very last position.

Per-block inspectors all share a "Block" tab with: top padding, bottom padding, side gutters, background color, alignment (where applicable). The standard alignment selector is a single Flodesk-style icon-only group (Left / Center / Right / Full) with a rounded pill highlight on the active option, used identically across every alignable block.

Block types:
- Heading (H1/H2/H3) — the H1/H2/H3 buttons in the format toolbar set both the level AND the matching font size so the visual change is always immediate. Per-block font family (Google Fonts), weight, size, color, letter spacing, line-height.
- Text — paragraph copy with a rich-text format toolbar: bold/italic/underline/strikethrough, lists, link insertion, merge tag dropdown, and an **AI refine button** that rewrites selected text.
- Button — full style controls (presets, saved styles, custom font/color/border/padding). Link tab: point to a URL or a file from your Media library. Click the button on the canvas to edit its label inline.
- Image — single image with the shared VenueMediaPickerModal ("Choose from media library"); supports alignment, width slider, padding, link wrap, alt text. Multi-image grid (2/3/4 columns × multiple rows) renders with **even gutters between every row AND every column**.
- Video — 16:9 YouTube-style player with play-button overlay; auto-detects YouTube / Vimeo / Loom URLs. On the live canvas, clicking the block SELECTS it for editing (does NOT open the video). In the preview iframe and in sent emails the thumbnail links out to the video URL. Empty-state hint reads "Add a YouTube, Vimeo or Loom URL" and is positioned so it's never obscured by the play button.
- Divider — Flodesk-style settings: style (solid/dashed/dotted), thickness, color, width %, alignment, top/bottom padding, background.
- Spacer — two settings only: Background color + Height (slider).
- Social — row of social icons. Links are pulled from Settings → Branding → Social Networks (set them there; no per-email override). Inspector controls: icon style (outline/filled/solid circle), color, size, alignment, and spacing. If no social links are configured in Branding, the block won't appear in the sent email — add your profiles in Settings → Branding first.
- Address — displays your venue address from Settings → Branding (Contact Information). Click "Manage my address" in the inspector to update it.
- Columns — split a row into 2 or 3 columns and drop other blocks inside.
- HTML — raw HTML for power users.

Brand colors integration: every color picker inside the email builder is the same Flodesk-style picker. It's anchored to the viewport (so it never opens off-screen), exposes a hex input + HSL/RGB visualizer + eyedropper (when supported), and shows the venue's saved Brand Colors palette at the bottom for one-click application. Saving a color from any picker adds it to the venue palette across the entire app.

Fonts: every text-bearing block exposes a Google Fonts selector. The selected font loads in both the editor and the rendered email. Inline emphasis comes from the format toolbar (bold/italic/underline/strikethrough/link).

Live preview & send-test:
- Click the eye icon (header → Preview) to open the preview modal.
- Modal renders the email inside a real iframe so links open and embedded videos play.
- Header and backdrop are #1b1b1b for a calm, neutral preview.
- Send-test form inside the modal: enter any email address → Send Test → fires a real preview email with your branding (logo, colors, social, address).
- Toggle to Mobile view (left sidebar) to verify how the email looks on small screens.

Compliance footer:
- Every marketing email automatically includes a footer with your venue name, physical address (from Branding), an unsubscribe link, and a manage preferences link.
- Recipients who unsubscribe are automatically excluded from all future marketing sends. Transactional emails (proposals, invoices, payment confirmations) are always sent regardless of unsubscribe status.

## Saved audiences — reusable targeting for marketing campaigns
Saved audiences live at Marketing → Audiences (/dashboard/marketing/email/audiences). They let venue owners build an audience once and reuse it across as many campaigns as they want, instead of rebuilding the same filters every time.

Audience types (shared across campaigns, automations, and saved audiences):
- All leads — every contact with an email (excluding unsubscribes).
- Any of these tags — lead has at least one of the selected marketing tags.
- In any of these pipeline stages — lead is currently in one of the selected stages.

Behavior filters:
- Only leads with a wedding date on file.
- Exclude leads in specific stages.
- Exclude leads already in booked/won stages.
- Only leads who clicked at least one of the selected trigger links.

UI flows:
- Create an audience: Marketing → Audiences → "New audience" → name (required, unique per venue, max 200 chars) + optional description (max 500 chars) + audience filters. Live recipient-count chip updates with each tweak.
- Use a saved audience in a campaign: open a campaign → Audience → "Use a saved audience" → pick from dropdown. Inline behavior filters can still be added to narrow further.
- Edit an audience: changes apply to all future campaigns using it. Already-sent campaigns are unaffected.
- Delete an audience: campaigns using it automatically fall back to "All leads" so they remain valid. You can then re-select a different audience.


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
  - Drop indicator shows exactly where a new block will land. You can drop at any position including the very last slot.
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
  - Button — full style controls: presets (Solid, Outline, Pill, Underlined link), saved styles, and custom controls (font, size, colors, border, padding, full-width toggle).
  - Submit / Divider / Spacer — same structure as the email builder.
- Form Settings modal (gear icon top-right): every form-level option lives here — public form name, success state (thank-you screen vs redirect URL), email notification recipients, embed CSS class, and a Delete form button. Module settings stay in the right inspector; the Settings modal handles everything that isn't a per-block control.
- Embed modal: copy-paste snippet (script + div) that drops the form into any external site; the embed inherits the form's theme.
- Live preview: opens the public-facing form inside a real iframe. The header centers the Desktop / Mobile toggle and removes the previous Reset / Open buttons. Submitting actually exercises the validation + post-submit configuration (thank-you screen or redirect) without persisting a real lead or firing notification emails — it's a true dry run.
- Theme controls (font family, accent color, button colors, background, etc.) live in the Settings modal and are applied site-wide on the form.
- Deleting a form: from the Forms list page click the trash icon next to the pencil, OR open a form → Settings modal → Delete form. Both routes confirm and remove the form (deletes its definition + suppresses leads from old embeds).

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

Most smart triggers work by listening for a system tag that the platform applies automatically when the event occurs. Tag-based triggers also fire for any custom tag you create.

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

Reply-halt + owner notification:
- When a contact replies to any automated email or SMS, all active automation sequences for that contact are automatically paused.
- You receive an email notification with the reply preview and how many sequences were stopped.
- Paused enrollments don't restart automatically — the contact stays in your Conversations thread for you to follow up personally.

Setup checklist for a speed-to-lead funnel:
1. Marketing → Forms — create a form that routes submissions to a pipeline stage and set it to Published.
2. Marketing → Workflows → New workflow → set trigger to "Form submitted" → pick the form(s).
3. Add steps: Send email (welcome) → Wait 2 days → Send email (follow-up) → Wait 3 days → repeat as needed.
4. Set workflow status to Active and Save.

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
- StoryVenue uses **email + password** authentication. There are no magic links or code-based logins.
- Venue owners sign up at app.storyvenue.com/signup with business name, email, and password.
- Team members accept email invites and set their own password on first login.
- Forgot password: click "Forgot password?" on the login page → enter your email → receive a reset link → set a new password.
- Venue owners can update their **email address** and **password** at any time from their profile — click the avatar/name in the sidebar → My Profile → update and save. No current password is required.

## StoryVenue Legacy (GHL) Integration
- Path: Settings → Integrations → StoryVenue Legacy.
- **Connect**: enter your sub-account Location ID and Integration Token. Once connected, a green "Connected" badge appears. If SMS or sync still fails after connecting, also enter your Legacy API Key found in your GHL sub-account settings.
- **Import contacts**: click "Sync from StoryVenue Legacy" to pull all your GHL contacts into StoryVenue. A progress bar shows how many have been imported. The sync is safe to run multiple times — it won't create duplicates.
- **Two-way sync**: after the initial import, StoryVenue becomes the source of truth for contacts. Editing a contact in StoryVenue (name, phone, email) automatically updates it in your GHL sub-account in the background. Creating a new contact in StoryVenue adds it to GHL automatically as well.
- **Inbound reply setup**: the Integrations page shows a webhook URL you can paste into your GHL sub-account's webhook settings for instant delivery of inbound SMS replies. Without this, replies still arrive within a few seconds via polling — the webhook just makes delivery instant even when the inbox isn't open.
- **Do Not Contact (DNC)**: when a contact opts out of SMS (by replying STOP), the opt-out is automatically synced between StoryVenue and GHL so they won't be messaged from either system.

## Venue Owner Profile (My Profile)
- Access: click your name/avatar in the sidebar or bottom-left → My Profile.
- Update your **first name**, **last name**, **email address**, and **password** from this page.
- No current-password re-entry required — enter the new value and save.
- Profile changes take effect immediately. If you update your email, use the new address on next login.

## Couples Portal (Client Accounts)
- Couples can create their own account on StoryVenue to view their proposals, invoices, and documents.
- Couple accounts are separate from venue team members — they only see their own records.
- **Couple signup**: couples sign up with first name, last name, email, and phone. They're signed in automatically after signup.
- **Couple login**: app.storyvenue.com/couple/login — email + password.
- **Forgot password**: enter email → receive reset link → set new password.
- **Couple profile**: couples can update their name and phone from their profile page after login.

## StoryPay™ (Payment Processing)
- StoryPay™ is the payment processing tier built into StoryVenue. Venues must complete merchant onboarding before they can accept online payments.
- Until StoryPay™ is active, a banner reminds owners to apply. **Apply**: Payments → Settings or click the "Apply for StoryPay™" prompt.
- The onboarding wizard collects business information, owner details, and banking info. StoryVenue never stores raw card numbers — all card data goes directly to our secure payment processor.
- Once approved: proposals and invoices can accept credit card payments, installments, and subscriptions online.
- If payment processing shows as unavailable: check that your StoryPay merchant onboarding is complete. Contact support if you believe it should be active.

### Client payment form
- When a client clicks Pay on a proposal or invoice, a secure payment form loads inline on the same page — no redirect to an external checkout.
- If a processing fee is configured, the client sees the base amount and fee separately before confirming.
- For installment plans, the card or bank account is saved on the first payment so future installments charge automatically.
- If the form appears blank or won't load: the client should try a different browser, disable browser extensions, or use incognito mode.

### ACH (Bank Transfer) — accepted alongside cards
- The payment form supports both credit/debit card AND ACH bank transfer. Customers choose whichever they prefer.
- ACH is enabled by default. Toggle it on/off at Settings → Customer Payment Methods.
- Cards clear immediately. ACH settles in 3–5 business days. The client's success screen explains this.
- If you need ACH enabled on an existing merchant account, contact StoryVenue support.
- ACH refunds take the same 3–5 business days as card refunds.

## SMS Notifications
- SMS is sent automatically when proposals and invoices are created (if the customer has a phone number on file).
- SMS requires a connected StoryVenue Legacy (GHL) sub-account with an approved A2P phone number. If SMS isn't sending, check your integration status at Settings → Integrations.

## Push Notifications (Browser Alerts)
- StoryVenue sends instant browser push notifications for important events — even when the dashboard is closed.
- **Setup**: your browser will prompt for notification permission on first visit. Accept it to receive pushes. Then go to Settings → Push Notifications to toggle each event type on/off.
- **Events**: new message, payment received, payment failed, proposal signed, new lead, AI Concierge handoff, invoice paid, subscription created/cancelled, refund issued, new customer.
- **Test**: click "Send test notification" on the Push Notifications settings page to verify delivery.
- **Troubleshooting**: check browser notification permission (lock icon in address bar), make sure the event toggle is ON at Settings → Push Notifications, and try the test button. Push subscriptions are per-device and per-browser.
- Push notifications are sent alongside existing email alerts — they don't replace them. Each event type can be independently enabled or disabled.
- Path: Settings → Push Notifications.

## Installing StoryVenue as an App (PWA)
- StoryVenue is a Progressive Web App (PWA) — install it on phone, tablet, or desktop for a native-app experience.
- **iPhone/iPad**: Safari → Share button → "Add to Home Screen".
- **Android**: Chrome → three-dot menu → "Add to Home screen" or "Install app".
- **Desktop**: Chrome/Edge → install icon in the address bar → Install.
- Installed apps get: home screen icon, full-screen mode, push notifications when browser is closed, faster load times.
- The install prompt appears automatically after your first few visits. If dismissed, use the manual steps above.
- Offline: shows a friendly offline page with retry button when internet is lost.

## Owner Notifications (Multi-Channel Alerts)
- StoryVenue notifies venue owners through three channels: **Email**, **SMS**, and **Browser Push notifications**.
- Each notification type can be independently enabled or disabled at Settings → Notifications and Settings → Push Notifications.
- **Notification events**: payment received, payment failed, high-value payment, proposal signed, document viewed, subscription created/cancelled, invoice paid, refund issued, new customer, new lead, new message, AI handoff.
- All three channels fire simultaneously — disabling one doesn't affect the others.

## Two-Factor Authentication (2FA)
- 2FA adds a second verification step (a 6-digit code from an authenticator app) to your login.
- **Setup**: click your name in the sidebar → My Profile → Two-Factor Authentication → Enable 2FA → scan the QR code with Google Authenticator, Authy, or 1Password → enter the 6-digit code to confirm. Save your backup codes.
- **Login**: after entering email + password, you'll be prompted for the 6-digit code from your app.
- **Disable**: Profile → Two-Factor Authentication → Disable (requires code from your app).
- **Lost authenticator**: use a backup code. If lost, contact StoryVenue support for manual recovery.
- 2FA is per-user — each team member can enable it independently. Does not affect other users or couples.
- If 2FA is unavailable on your account, contact StoryVenue support to have it enabled.

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
4. **Reminder** — fires before the appointment starts (configurable timing per channel).
5. **Follow-Up** — fires 30 minutes after the event ends.

### Per-Recipient Channels
Every scenario has four independent channels — each can be toggled on or off with its own subject line and message body:
- **Email → Venue Owner**
- **Email → Contact**
- **SMS → Venue Owner**
- **SMS → Contact**

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
When an event is created or updated, StoryVenue automatically schedules reminders for each enabled channel at the configured timing. Follow-ups are always queued for 30 minutes after the event ends.

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
- Email not sending: confirm the channel is toggled On and the contact has an email on file.
- SMS not sending: confirm StoryVenue Legacy is connected (Settings → Integrations) and the contact has a valid phone number.
- Reminders not arriving: check that the event has a contact attached and that the reminder timing is set to a future point relative to the event.
- Test SMS failing: the phone number must match an existing contact.

## Refunds
- Go to Transactions → Charges → find the charge → click Refund.
- Confirm the amount and click Issue Refund. Processes immediately through your StoryPay merchant account.

## Payment Processing
- StoryVenue uses a PCI-compliant payment processor for all payment processing. Card numbers go directly to the processor — StoryVenue never stores raw card data.
- Merchant onboarding must be completed before accepting payments online.

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
- Where do inbound email and SMS replies go? Into the same Conversations thread. Email replies and SMS replies both appear automatically in the thread in real time.
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
- Why don't reviews show on storyvenue.com? Make sure the review is marked as Published in your Reviews dashboard. For Google reviews to appear, you must connect your Google Business Profile on the Reviews → Google tab. If reviews still don't appear after that, contact StoryVenue support.
- What is Conversations? Sidebar → Conversations — unified inbox with team notes, outbound emails, and two-way SMS threads. Replies appear in real time. Every outbound message shows a green "Sent" check or red "Failed" badge.
- Why are Conversations not working? Contact StoryVenue support — this typically requires a configuration step on our end.
- My SMS won't send — "Missing phone number" / "GHL has no phone on file". Open the contact profile, make sure they have a phone number, and click Save. This syncs the phone to your connected sub-account automatically. If the issue persists, contact StoryVenue support.
- Two contacts share the same phone number — will SMS break? No. StoryVenue handles this automatically and routes the SMS correctly. If you see unexpected behavior, contact StoryVenue support.
- Why does an SMS reply not appear in the thread? The most common cause is that the GHL inbound webhook isn't configured. Go to Settings → Integrations → StoryVenue Legacy — the page shows you a webhook URL to paste into your GHL sub-account's webhook settings. Replies arrive within a few seconds via automatic polling even without the webhook; the webhook just makes delivery instant.
- Why does an email reply not appear in the thread? Check Settings → Inbound Email Replies — the panel shows a green "Configured" or amber "Needs setup" status for each required item. If something is marked as needing setup, follow the instructions shown or contact StoryVenue support.
- What's required for inbound email replies? See Settings → Inbound Email Replies for a full status checklist. Each item shows green (configured) or amber (needs setup). Contact StoryVenue support if any item cannot be resolved from the settings panel.
- Do I need to set up my own email sending domain to send email? No. Every venue can send email immediately using StoryVenue's verified sending domain — no DNS setup needed. Replies still come back to your venue email address. If you'd like to send from your own domain, contact StoryVenue support.
- How do I re-sync contacts from GHL? Settings → Integrations → StoryVenue Legacy → "Sync from StoryVenue Legacy" — safe to run as many times as needed, it won't create duplicates. Newly added GHL contacts also sync automatically over time.
- After the initial sync, do I need to keep using GHL for contacts? No. Manage contacts in StoryVenue — changes sync back to GHL automatically. New contacts created in StoryVenue are also added to GHL.
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
- How many brand colors can I save? Up to 50 colors per venue, managed directly from any color picker in the app.
- How many social links can I add? Up to 8 social platforms.
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
- Why is my saved audience recipient count zero? Common causes: (1) no leads match the audience type, (2) all matching leads are on the unsubscribe list, (3) you required a wedding date but no matching lead has one set, (4) the audience was deleted (campaign falls back to "All leads" — re-pick an audience or build one inline). The live count chip updates whenever you adjust a filter.

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
- AI Concierge is an automated, outbound-only SMS follow-up system. It sends personalized messages to leads on your behalf and notifies your team the moment a lead replies — so you can step in for a personal conversation.
- **Plan gating**: AI Concierge is only available on the All-Inclusive Concierge plan (and any plan where StoryVenue has specifically enabled it). On all other plans, the AI Concierge toggle is greyed out. Hovering shows a tooltip to schedule a demo. Clicking the greyed-out toggle opens the demo scheduling calendar.
- **Eligibility** (once your plan includes it): requires (1) A2P 10-digit SMS verification completed and (2) a connected StoryVenue Legacy sub-account for SMS delivery. The settings page shows what's missing if either requirement hasn't been met.
- **How AI activates**: AI Concierge is NOT automatically activated on every lead. It activates only when you add the "Activate AI Concierge" step in a workflow sequence for a specific lead. This gives you complete control over which leads receive AI outreach and when.
- **Outbound schedule**: once active for a lead, the AI sends personalized SMS messages on a spaced cadence. Outreach stops automatically after 60 days if no booking occurs.
- **Stop on reply**: the moment a lead replies, all AI outbound messages are halted automatically. The lead is flagged for human follow-up and your team is notified immediately with the reply content.
- **Handoff rules**: configurable rules define when the AI should hand off to a human (e.g., the lead asks for pricing details or wants to book a tour). When a handoff fires, you are notified immediately.
- **Venue controls** (Marketing → AI Concierge):
  - Enable/disable AI Concierge for your venue
  - Set a persona name (how the AI identifies itself in messages)
  - Configure notification email addresses for your team
  - View eligibility status
- **Per-contact status** (contact lead profile): each lead shows an AI status pill (Active, Paused, Needs human, Opted out, etc.) with action buttons to pause or re-enable.
- **Quiet hours**: messages are only sent during configurable business hours to comply with TCPA regulations.
- **A2P verification**: required for SMS delivery compliance. The settings page guides you through A2P setup. Without A2P, SMS messages cannot be delivered.

## Multi-Step Venue Onboarding (Signup Flow)
- New venue signup at app.storyvenue.com/signup follows a 3-step flow:
  1. **Plan picker**: choose from available directory plans. Plan cards show all features.
  2. **Add-ons**: select optional add-ons (Verified, Sponsored). Venue Concierge is only available on plans that support it.
  3. **Payment**: enter card details in a secure inline payment form — no redirect to an external checkout. Free plans skip this step. If a trial is configured, the card is validated but the first charge is deferred until the trial ends.
- After signup, the owner lands in the dashboard where a **4-step onboarding modal** guides them to go live.

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
- Legacy plans are grandfathered subscription tiers managed directly by StoryVenue.
- Venues on a legacy plan receive all features and add-ons at no extra charge.
- The billing page shows a "Billing managed directly" banner for legacy venues. Changes to a legacy plan require contacting your account manager — self-serve switching is not available.
- Legacy plan venues are not shown the onboarding modal gate and are not subject to the trial/CC requirement.

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
- **Extend trial**: Contact StoryVenue support if you need a trial extension.
- **Trial ribbon / overlay behavior**: during an active free trial on the free plan, both the trial countdown ribbon AND the Bride Booking System™ analytics upgrade overlay are shown. Once the trial expires and the venue remains on free, only the greyed-out analytics overlay persists (no ribbon).

## Venue Concierge Add-on
- The Venue Concierge add-on enables the AI Concierge system — an automated SMS-based lead engagement tool.
- Only available on plans that support it. Pricing is communicated during a demo call.
- When included on your plan, it unlocks Marketing → AI Concierge where you configure the automated outreach system.
- Without this add-on, AI Concierge features are locked and clicking the greyed-out toggle opens the demo scheduling calendar.
- See the "AI Concierge" section above for full details.

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
  2. **Follow-up Sequence** — customizable sequence of Send Email, Send SMS, Wait, and Activate AI Concierge steps. Stops the moment a bride replies. No fixed length — add as many steps as you want.
  3. **Nurture Sequence** — a 5-email educational sequence about picking and touring venues. No AI Concierge handoff.
  4. **Booked Tour** — a 5-email sequence that fires when a lead books a tour; sets expectations for the visit. No AI Concierge handoff.
  5. **Booked Wedding** — a 5-email sequence that fires when a lead books a wedding; celebrates the win. No AI Concierge handoff.
  6. **AI Concierge** — plan-gated (All-Inclusive only). An AI SMS follow-up for quiet leads. Locked on Bride Booking System Free and Bride Booking System™ plans; greyed toggle with tooltip and demo scheduling modal. See AI Concierge section for full details.
- Activate AI Concierge block (Phase 2 only): adding this block to the Follow-up Sequence hands the lead to the AI Concierge at that step. This is the ONLY way AI activates — no automatic timer.
- Stop on reply: if the bride replies to any message during any phase, the enrollment halts automatically and the venue is notified.
- Guide PDF merge variable: {{pricing_guide_url}} (alias {{venue.pricing_guide_url}}) — live link, always generates the current guide version.
- SMS delivery requires a connected StoryVenue Legacy (GHL) sub-account with A2P verification. All email and template variables are native to StoryVenue.
- Common question — "will editing my pricing guide change what brides receive?" Yes — the PDF is generated live on each click from your current saved Pricing Guide content.

## Default Sales Pipeline (Locked)
- Every venue has a default pipeline (the "Bride Booking System™" pipeline) whose stages are locked and cannot be renamed, reordered, added to, or deleted.
- The pipeline itself cannot be deleted either.
- This protects the platform's built-in automations which reference these specific stage names.
- Venue owners can create additional custom pipelines freely. Only the default pipeline is read-only.
- When a venue owner tries to edit a default pipeline stage, they see a lock message.

## Contacts — Deleting a Contact
- To delete a contact: Contacts page → find the contact → delete action.
- Deleting a contact removes them from your CRM, leads pipeline, and if connected, from your GHL sub-account as well.

## PWA / Install as App
- StoryVenue is a Progressive Web App — installable on phone, tablet, or desktop.
- iPhone: Safari → Share → "Add to Home Screen". Android: Chrome → menu → "Add to Home screen". Desktop: install icon in address bar.
- Installed apps get: home screen icon, full-screen mode, push notifications when browser is closed, faster load.
- Install prompt appears automatically after first visits; manual install always available.
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
