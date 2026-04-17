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
        tags: ['overview', 'intro', 'dashboard', 'what is', 'storypay', 'storyvenue'],
        body: `StoryPay (at app.storyvenue.com) is the all-in-one command center for wedding venues. From one dashboard you manage your public directory listing on storyvenue.com, the leads it generates, customer profiles, proposals, invoices, payments, a booking calendar, branding, email templates, and your team.

After logging in you land on the Home dashboard which shows your revenue, pipeline, recent proposals, and recent transactions at a glance.

Navigation lives in the left sidebar (or the hamburger menu on mobile). The main sections are:
- Home — your live snapshot
- Customers — manage contacts and full customer profiles
- Calendar — book and track tours, weddings, and events
- Directory Listing — manage how your venue appears on storyvenue.com (photos, description, capacity, pricing, amenities, publish on/off)
- Leads — inquiries submitted from your storyvenue.com listing
- Reports — 7 downloadable financial report types (owners and admins only)
- Payments — proposals, invoices, installments, subscriptions, transactions
- Help Center — searchable documentation with AI-powered answers
- Settings — branding, email templates, integrations (including Calendly, Google Calendar), team, notifications

What you see in the sidebar depends on your role. Owners see everything. Admins see most things. Members only see Payments, Customers, Calendar, Leads, and their directory listing.

How the two sites fit together:
- storyvenue.com is the public-facing directory browsed by couples looking for a venue
- app.storyvenue.com is the private admin dashboard where you run your business

Couples browse your listing on storyvenue.com → submit an inquiry → the lead lands in your Leads inbox here → you reply, book a tour, send a proposal, and collect payment — all without leaving StoryPay.

The floating sparkle button (bottom-right) opens Ask AI, which can answer questions about your account in real time.`,
      },
      {
        id: 'gs-signup',
        title: 'Signing up for a new venue account',
        tags: ['signup', 'register', 'create account', 'new venue', 'join', 'sign up'],
        body: `New venues create an account themselves at storyvenue.com/signup (or app.storyvenue.com/signup).

On the signup page:
1. Enter your venue name and the email address that will own the account
2. Pick a plan
3. Click Create Account

You'll see a "Check your inbox" confirmation. We email a magic login link to the address you entered — open it on the same device and you are logged straight into a brand-new dashboard with a blank directory listing ready to fill in.

First things to do after signing up:
- Go to Directory Listing in the sidebar and fill in your venue name, description, location, capacity, pricing, amenities, and photos
- Toggle the Publish switch on when you're ready for couples to find you on storyvenue.com
- Head to Settings → Branding to upload your logo and brand colors (these appear on proposals and outgoing emails)
- Invite team members at Settings → Team

If you didn't receive the login email: check spam, wait 30 seconds, or use the direct login URL shown on the success screen. You can also re-request a magic link from the main login page.

One email address = one venue account. If you already have an account and try to sign up again with the same email, the system tells you and points you to the login page instead.`,
      },
      {
        id: 'gs-onboarding',
        title: 'Get Started checklist',
        tags: ['checklist', 'onboarding', 'setup', 'first steps', 'restart'],
        body: `When you first access your dashboard as an owner you'll see a "Get Started" bubble near the top of the page.

Click the bubble to open the setup checklist. It tracks the core setup steps:

1. Publish your Directory Listing — fill in your venue details and flip Publish on (Sidebar → Directory Listing)
2. Create Your Profile and Branding — upload your logo and set brand colors (Settings → Branding)
3. Customize Email Templates — personalize the emails sent to clients (Settings → Email Templates)
4. Create Your First Proposal Template — build a reusable contract template (Payments → Proposal Templates)
5. Create Your First Proposal — use a template to create a proposal for a client
6. Send Your First Proposal — send it to a client so they can sign and pay
7. Invite a Team Member — add staff to your account (Settings → Team)

Check off each step manually as you complete it. When all steps are checked, click "I'm Ready — Start Using StoryPay" to dismiss the bubble permanently. You can also skip the wizard at any time and come straight to the dashboard — payment processing setup is optional and can be completed later.

To restart the checklist at any time, go to Settings → General → Restart Setup Guide. This only clears the checkmarks — it does not delete any data.

Note: The setup guide is only visible to account owners. Admins and Members do not see it.`,
      },
      {
        id: 'gs-login',
        title: 'Logging in and your login link',
        tags: ['login', 'link', 'access', 'sign in', 'token', 'magic link', 'forgot password'],
        body: `StoryPay uses magic-link login at app.storyvenue.com/login — no password needed.

Enter the email address on your account and click Send Login Link. We email a personalised login URL that signs you in with a single click. The link is valid for one hour.

Your session lasts 30 days on that device. If the session expires, just request a new magic link from the login page.

New venues can create an account themselves at storyvenue.com/signup (or app.storyvenue.com/signup). See the "Signing up for a new venue account" article for details.

To log out, click Logout at the bottom of the sidebar.

Troubleshooting:
- Didn't receive the email? Check spam, wait 30 seconds and try again, or contact support.
- "Account not found"? The email isn't registered yet — create an account via /signup.
- Team member who never received their invite? Have an owner resend it from Settings → Team → ⋯ → Resend Invite.`,
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
    id: 'calendar',
    label: 'Calendar',
    iconName: 'Calendar',
    color: '#ec4899',
    articles: [
      {
        id: 'cal-overview',
        title: 'Calendar overview',
        tags: ['calendar', 'events', 'booking', 'schedule', 'tour', 'wedding', 'views', 'month', 'week', 'day'],
        body: `The Calendar (sidebar → Calendar) is your central view for all venue events — tours, weddings, receptions, tastings, meetings, rehearsals, holds, and blocked dates.

Four views (top-right toggle):
- Month — traditional grid, best for scheduling at a glance
- Week — seven columns with an hour-by-hour timeline
- Day — single-column timeline for a chosen date
- Year — 12-month grid showing how many weddings and tours fall in each month; click any month to jump to it

Click any empty day (or hour slot in Week/Day view) to add a new event. Click any event chip to open its details where you can Edit or Delete it.

Event types are color-coded:
- Wedding (pink), Reception (purple), Tour (blue), Phone call (cyan), Tasting (amber)
- Meeting (green), Rehearsal (indigo), Hold/Tentative (gray), Blocked (dark gray)

Events can be single-day, multi-day (for wedding weekends), or recurring (for weekly tastings, monthly maintenance days, etc.). Multi-day events render on every day they span; continuation days in Week/Day view show small left/right arrows to indicate the event extends before or after.

The "Today" button snaps back to the current date. The Prev / Next arrows move forward or back by one month, week, or day depending on the active view.`,
      },
      {
        id: 'cal-spaces',
        title: 'Managing venue spaces',
        tags: ['spaces', 'barn', 'garden', 'ballroom', 'room', 'venue space'],
        body: `If your venue has multiple bookable spaces (e.g. Barn, Garden, Ballroom, Vineyard), set them up first so you can track bookings per space and prevent double-bookings.

To add a space:
1. Click "Manage Spaces" (top-right of the Calendar page)
2. Enter a name, choose a color (used for event chips on the calendar), and optionally set a capacity
3. Click Add Space

Spaces appear as filter pills above the calendar. Click a space pill to filter the calendar to that space only. Click "All Spaces" to show everything.

To remove a space, open Manage Spaces and click Remove next to it.`,
      },
      {
        id: 'cal-add-event',
        title: 'Adding, editing, and deleting events',
        tags: ['add event', 'new event', 'book', 'schedule', 'create event', 'edit event', 'update event', 'change event', 'delete event'],
        body: `To add an event, click the "+ Add Event" button or click directly on any day (or hour slot in Week/Day view) in the calendar grid.

Fill in:
- Event Title (e.g. "Smith & Johnson Wedding")
- Type — Wedding, Reception, Tour, Phone call, Tasting, Meeting, Rehearsal, Hold, Blocked, Other
- Status — Confirmed, Tentative/Hold, Cancelled
- Space — which bookable space this event uses (optional; enables conflict detection)
- Customer Email — links the event to a customer profile (optional)
- Start Date + End Date — End Date auto-fills to match Start Date for single-day events. Change it to a later date for a multi-day event (e.g. a three-day wedding weekend).
- Start Time + End Time (or check All Day)
- Repeats — keep at "Does not repeat" for a one-off event, or pick Daily / Weekly / Monthly / Yearly for a recurring event (see the dedicated recurring events article for details)
- Notes

Click Save Event.

To edit an event: click the event chip on the calendar to open the detail panel, then click Edit. The form re-opens pre-filled with all current values — change any field and click Save Changes. For recurring events, edits apply to the entire series (all past and future occurrences).

To delete an event: click the event chip, then click Delete Event. If the event is recurring, the button says Delete Series and will prompt for confirmation because deletion removes every occurrence — past and future.`,
      },
      {
        id: 'cal-multi-day',
        title: 'Multi-day events (wedding weekends)',
        tags: ['multi-day', 'multi day', 'multiday', 'wedding weekend', 'two day', 'three day', 'span days', 'spans', 'end date'],
        body: `Multi-day events are perfect for wedding weekends, festivals, corporate retreats, or any booking that occupies the venue across multiple consecutive dates.

To create a multi-day event:
1. Click "+ Add Event"
2. Pick the Start Date
3. Change the End Date to the last day of the event — End Date defaults to match Start Date, so you only adjust this when you want multi-day
4. Set Start Time (time of day on the first day) and End Time (time of day on the last day)
5. Fill in the rest normally (title, type, space, etc.)
6. Click Save Event

A small label confirms "Multi-day event spanning N days." below the date fields once End Date is after Start Date.

How multi-day events render:
- Month view: the same event chip appears on every day it occupies
- Week / Day view: the event bar runs from Start Time on the first day down through the end of each intermediate day, then stops at End Time on the last day. Continuation days show small arrows (← or →) indicating the event extends before or after that day.
- Conflict detection checks the full date-and-time window against every other event in the same space.

To shorten or extend a multi-day event later, click the chip → Edit → change Start Date or End Date → Save Changes.`,
      },
      {
        id: 'cal-recurring',
        title: 'Recurring events (weekly, monthly, yearly)',
        tags: ['recurring', 'repeat', 'repeating', 'weekly', 'daily', 'monthly', 'yearly', 'series', 'every week', 'every month', 'schedule', 'staff meeting', 'tasting'],
        body: `Recurring events are great for anything that happens on a schedule: a weekly staff meeting, a monthly maintenance block, a bi-weekly tasting, or an annual venue closure.

To create a recurring event:
1. Click "+ Add Event"
2. Fill in Title, Start Date, End Date (same as start for a single-day event), times, and other fields as normal
3. In the Repeats block, pick a frequency: Daily, Weekly, Monthly, or Yearly
4. Set the interval — "every 1 week" or "every 2 weeks", etc.
5. Pick when the series Ends:
   - On — the recurrence stops on a specific date (this is the default)
   - After — the recurrence stops after a specific number of occurrences
   - Never — the event repeats indefinitely (you will see an amber warning; we recommend always setting an end)
6. Click Save Event

The recurrence end date is pre-filled with a sensible default when you pick a frequency — three months out for Daily, a year out for Weekly or Monthly, five years out for Yearly. Adjust it to match your needs.

Important: the recurrence end date is SEPARATE from the event's End Date. The event End Date controls how many days one occurrence lasts (e.g. a weekend-long event); the recurrence end date controls when the series as a whole stops.

How recurring events render:
- Every occurrence appears on the calendar as a separate chip
- Clicking any occurrence opens the same detail panel — editing or deleting always operates on the whole series
- Occurrences are generated on the fly when the calendar loads, so changing the rule (e.g. switching from Weekly to Monthly, or moving the end date) instantly updates every future occurrence

To edit or stop a series: click any occurrence → Edit → change the Repeats options → Save Changes. To cancel the whole series, click Delete Series.`,
      },
      {
        id: 'cal-conflicts',
        title: 'Double-booking protection',
        tags: ['conflict', 'double booking', 'overlap', 'same date', 'protection'],
        body: `StoryPay checks for booking conflicts at the database level, not just in the UI. If you try to add an event to a space that already has another event during that time window, you will see a conflict warning.

The warning shows:
- The conflicting event name
- Its start and end time

You have two options:
1. Change the date, time, or space to avoid the conflict
2. Click "Override & Book Anyway" — this books despite the overlap (useful for back-to-back events with shared setup time, or if a space can handle simultaneous events)

Conflict detection only applies when you select a specific space. Events with no space assigned never trigger conflicts.`,
      },
      {
        id: 'cal-ical',
        title: 'Syncing with Google Calendar, Outlook, and Apple Calendar',
        tags: ['ical', 'google calendar', 'outlook', 'apple calendar', 'sync', 'subscribe', 'phone'],
        body: `StoryPay provides an iCal subscription feed so your events appear in any calendar app on your phone or computer.

To set it up: go to Settings → Integrations → scroll to the "Google Calendar, Outlook & Apple Calendar" card. Copy your iCal URL.

Google Calendar:
1. Open Google Calendar on desktop (not mobile)
2. Click + next to "Other calendars"
3. Choose "From URL"
4. Paste your iCal URL
5. Click Add calendar

Outlook / Microsoft 365:
1. Open Outlook Calendar
2. Click Add calendar → Subscribe from web
3. Paste your iCal URL
4. Click Import

Apple Calendar (Mac):
1. Open Calendar app
2. File → New Calendar Subscription
3. Paste your iCal URL
4. Set auto-refresh to Every Hour
5. Click OK

iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste the URL.

Note: This is a one-way sync — StoryPay events appear in your personal calendar. Events you add in Google/Outlook do NOT flow back into StoryPay. Updates may take up to 24 hours to appear depending on the calendar app.`,
      },
      {
        id: 'cal-calendly',
        title: 'Connecting Calendly',
        tags: ['calendly', 'sync', 'booking', 'tour booking', 'integration', 'connect calendly'],
        body: `Connect Calendly so that when someone books a tour (or any appointment) through your Calendly link, it automatically appears on your StoryPay calendar and creates a customer profile.

To connect:
1. Go to Settings → Integrations → Calendly card → click Connect
2. Go to calendly.com/integrations/api_webhooks → API & Webhooks → Personal Access Tokens → Generate New Token
3. Copy the token and paste it into StoryPay → click Connect

Once connected:
- New Calendly bookings appear on your StoryPay calendar instantly (real-time via webhook)
- A customer profile is created automatically for each booking
- Cancellations in Calendly automatically mark the event cancelled in StoryPay

Use Sync Now to import all upcoming Calendly events at any time (useful after first connecting).

To disconnect, click Disconnect on the Calendly card. Your existing calendar events are not deleted.`,
      },
      {
        id: 'cal-availability',
        title: 'Public availability page',
        tags: ['availability', 'public', 'share', 'open dates', 'prospects', 'widget'],
        body: `StoryPay generates a public availability page for your venue that shows which dates are open or booked — without revealing any customer names or details.

Find your availability URL at Settings → Integrations → Google Calendar / Outlook & Apple Calendar card → Public Availability Page.

Share this link on your venue website, social media, or with prospects so they can check date availability without calling you.

The page shows a month-by-month calendar with:
- Open dates (green)
- Booked / unavailable dates (red, labeled Booked or Tour)

Prospects can navigate forward and back through months. No customer information is ever shown on this page.`,
      },
    ],
  },
  {
    id: 'listing',
    label: 'Directory Listing',
    iconName: 'Store',
    color: '#0ea5e9',
    articles: [
      {
        id: 'listing-overview',
        title: 'Your storyvenue.com directory listing',
        tags: ['directory', 'listing', 'public page', 'storyvenue', 'venue page', 'seo'],
        body: `Your Directory Listing is your public venue profile on storyvenue.com. It's what couples see when they browse the directory or land on your page from a Google search.

Open it from the sidebar → Directory Listing. Everything on this page mirrors what appears at storyvenue.com/venue/<your-slug>.

The listing has these sections:

Basics
- Venue name — headline shown at the top of your page and in search results
- URL slug — the readable end of your public URL (e.g. "the-barn-at-new-albany" → storyvenue.com/venue/the-barn-at-new-albany). The slug is auto-generated from the name as you type. You can hand-edit it if needed; click "Reset from name" to re-sync it.
- Venue type — barn, ballroom, garden, winery, beach, estate, rustic, modern, historic, other
- Indoor / Outdoor / Both

Location
- Full location line (e.g. "New Albany, Ohio")
- City and State (used for search filters)

Capacity & Pricing
- Minimum and maximum guest capacity
- Starting and top price point (displayed as a range on your listing)

Description
- The long-form narrative describing your venue — this is the heart of the page. Talk about atmosphere, signature spaces, what sets you apart, and the couple's experience from arrival to send-off.

Amenities
- Check off the features your venue offers: Ceremony site, Reception site, Bridal suite, Groom's suite, On-site parking, Wheelchair accessible, In-house catering, BYO catering allowed, Bar service, Dance floor, Overnight accommodations, Pet friendly, Outdoor ceremony, Tented options, etc.

Photos — see the "Uploading photos" article.

Availability notes
- Free-form text shown on your listing (e.g. "Booking 2026-2027 now, limited Saturdays in fall").

Inquiry notifications
- Notification email — where new leads are sent (defaults to your account email)
- Email notifications toggle — turn off if you don't want an email for every inquiry (leads still appear in the dashboard)

Publish toggle — at the top of the page. Off = not visible to the public. On = live on storyvenue.com within seconds.`,
      },
      {
        id: 'listing-autosave',
        title: 'Autosave and how changes are saved',
        tags: ['save', 'autosave', 'draft', 'saving', 'unsaved'],
        body: `The Directory Listing page saves automatically as you edit — there is no "lose your work if you forget to click Save" moment.

How it works:
- Every change you make (typing, toggling a feature, uploading a photo) queues up an autosave
- After you stop typing for about a second, your changes are sent to the server
- The status indicator near the top of the page shows: Saved · a moment ago / Saving… / Unsaved changes / Save failed

The visible Save button is kept as a belt-and-braces backup. You can click it any time to force an immediate save (useful if you're about to close your laptop lid).

If you try to leave the page with unsaved changes, the browser will ask you to confirm.

If a save fails (e.g. you lose internet), the status shows "Save failed" and the change stays in the form — reconnect and click Save, or just keep editing; the autosave will retry.

Tip: this makes it safe to start the description, switch tabs to upload photos to a cloud service, come back, and paste them in — the description won't be lost.`,
      },
      {
        id: 'listing-photos',
        title: 'Uploading cover photo and gallery images',
        tags: ['photos', 'images', 'upload', 'gallery', 'cover image', 'hero', 'pictures'],
        body: `Your listing supports one cover photo (the hero at the top of the page) and an unlimited gallery below.

To upload:
1. Go to Directory Listing → scroll to the Photos section
2. Drag and drop an image into the upload area, or click to pick from your device
3. Images upload to secure cloud storage and appear on your listing immediately

Best practices:
- Cover photo: wide landscape, 1600–2400 px wide, showing your signature space
- Gallery: mix of ceremony, reception, details, outdoor, bridal suite
- Accepted formats: JPG, PNG, WebP (max 10MB each)

Manage existing images:
- Drag a gallery image to re-order it
- Click the trash icon on any image to remove it
- "Set as cover" promotes a gallery image to the cover slot

Troubleshooting:
- If uploads silently fail on the first try right after a fresh account, reload the page — the image bucket is auto-provisioned on first use, then works normally afterwards.
- Large files may take 15–30 seconds on slower connections. The status indicator shows "Saving…" while uploads are in flight.

Uploaded photos are public — they're served directly from a CDN so your listing stays fast.`,
      },
      {
        id: 'listing-publish',
        title: 'Publishing and unpublishing your listing',
        tags: ['publish', 'unpublish', 'live', 'visible', 'hidden', 'public'],
        body: `The Publish toggle (top of the Directory Listing page) controls whether couples can find your venue on storyvenue.com.

Off (default for new accounts)
- Your listing page returns "not found" to the public
- Your venue does not appear in directory search or browse
- You can continue to edit freely — nothing you save is visible until you flip Publish on

On
- Your page goes live at storyvenue.com/venue/<your-slug> within a few seconds
- Your venue appears in directory search results and browse filters
- The public contact form starts accepting leads

If your page doesn't appear after publishing:
- Confirm the Publish toggle is actually on (the status pill next to it reads "Live")
- Hard-refresh storyvenue.com
- Check the URL uses your exact slug (Directory Listing → URL slug field)
- If you recently changed the slug, the old URL now 404s — update any links you've shared

Unpublishing is immediate — flip the toggle off and your public page returns 404. Leads already in your inbox are unaffected.`,
      },
      {
        id: 'listing-slug',
        title: 'URL slug — pretty venue URLs',
        tags: ['slug', 'url', 'link', 'seo', 'permalink'],
        body: `Your slug is the end of your public URL — storyvenue.com/venue/<slug>. A clean slug like "the-barn-at-new-albany" is easier to remember, share on a business card, and ranks better in search.

How it works:
- The slug field is auto-populated from your venue name as you type (e.g. "The Barn at New Albany" becomes "the-barn-at-new-albany").
- Once you hand-edit the slug, auto-mode turns off so we don't overwrite your choice. Click "Reset from name" to re-sync it.
- Slugs are sanitized in real time: lowercased, spaces become hyphens, special characters stripped, max 80 chars.

Rules:
- Lowercase letters, numbers, and hyphens only
- Must be unique across all venues on storyvenue.com
- If the slug you want is already taken, the save will fail with a helpful message — pick a different one

Caution: changing the slug changes your public URL. Any links on your website, Instagram bio, or printed materials will break unless you update them. Do this rarely, and ideally before you share the URL widely.`,
      },
    ],
  },
  {
    id: 'leads',
    label: 'Leads',
    iconName: 'Inbox',
    color: '#7c3aed',
    articles: [
      {
        id: 'leads-overview',
        title: 'Leads and sales pipeline overview',
        tags: ['leads', 'pipeline', 'kanban', 'sales', 'inbox', 'directory leads', 'form'],
        body: `The Leads page is your sales pipeline. Open it from the sidebar → Leads.

Two ways leads arrive:
- Inquiries submitted through your storyvenue.com directory listing show up automatically.
- You can add leads by hand with the "+ Add Lead" button in the top-right (paste in contact info from a phone call, Instagram DM, referral, wedding show, etc.)

Two views:
- Kanban — your pipeline as columns. Each stage is a column; each lead is a card. Drag a card between columns to change its stage.
- List — a scannable table view. Use the Stage filter and the search box to narrow down.

Every lead shows:
- First and last name
- Email, phone
- Venue name and venue website URL (the couple's preferred venue or the venue you're pitching)
- Wedding date, guest count
- Opportunity value (your expected deal size)
- Date created
- Note count

Click any card (or list row) to open the full lead drawer — edit any field, add timestamped notes, schedule an appointment, create a customer from the lead, or delete it.

The pipeline picker (top-right) lets you switch between multiple pipelines. Everyone starts with a default "Sales Pipeline" with 8 stages: Lead, Conversations Started, Lead Contacted, Tour Booked, Proposal Sent, Wedding Booked, Follow up, Not Interested. You can rename, add, remove, and reorder stages — or create a brand-new pipeline — with the Edit button.`,
      },
      {
        id: 'leads-kanban',
        title: 'Using the Kanban board',
        tags: ['kanban', 'pipeline', 'drag and drop', 'stages', 'board', 'move leads'],
        body: `The Kanban view is the default on the Leads page. Each column is a stage in your pipeline.

To move a lead:
- Grab a card (click-and-hold anywhere on the card)
- Drag it over the target column — the column will highlight
- Drop to commit

The change saves instantly. There's no "undo" in the UI, but dragging the card back will fix it.

Each column shows at the top:
- Stage name and its color dot
- Lead count
- Total opportunity value of the cards in that column

Cards show the lead's name, venue, email, phone, wedding date, note count, opportunity value, and date created.

Scroll horizontally if you have many stages — the board always fits a single row of columns, even on wide pipelines.

If a lead has no stage assigned (e.g. a brand-new inquiry from the directory that hasn't been placed yet), it's automatically shown in the first column so nothing falls off the board.`,
      },
      {
        id: 'leads-edit-pipelines',
        title: 'Editing and creating pipelines',
        tags: ['edit pipeline', 'rename stage', 'add stage', 'delete stage', 'multiple pipelines', 'custom pipeline'],
        body: `Every account starts with a default pipeline: "Sales Pipeline" with 8 stages (Lead, Conversations Started, Lead Contacted, Tour Booked, Proposal Sent, Wedding Booked, Follow up, Not Interested). You can customize it or create additional pipelines for different brands, properties, or sales processes.

Open the editor:
- Top-right of the Leads page, pipeline dropdown → Edit button
- A modal opens with your pipelines listed on the left, stages on the right.

Editing stages (right panel):
- Rename — click a stage name and type a new one; it saves when you tab/click away.
- Change color — click the color swatch next to the stage name.
- Stage kind — each stage is classified as Active (open), Won, or Lost. Won stages count as booked revenue in stats; Lost stages are excluded. Change the dropdown next to each stage.
- Reorder — use the up/down arrow buttons.
- Delete — trash icon. Any leads in that stage become unassigned and show in the first column.
- Add — type a name in the "New stage" box and click Add stage.

Creating a new pipeline:
- Type a name in the "New pipeline name" box on the left panel → Add pipeline
- New pipelines start with the default 8-stage template — edit freely from there.

Making a pipeline default:
- The default pipeline is what new leads land in. Pick any pipeline → Make default.

Deleting a pipeline:
- You can't delete the default pipeline. Make another pipeline the default first, then delete the old one. Leads in the deleted pipeline aren't deleted — they just become unassigned.

Use "Use this pipeline" to make a pipeline the one you're viewing on the Leads page and close the editor in one click.`,
      },
      {
        id: 'leads-detail-notes',
        title: 'Lead details, editing fields, and timestamped notes',
        tags: ['notes', 'timestamped', 'edit lead', 'lead details', 'activity'],
        body: `Click any lead card or list row to open the lead drawer.

At the top you'll see the lead's name and the date they were added.

Stage picker
- Tap any stage chip to move this lead to that stage. The chip lights up in the stage's color.

Editable fields (click to edit, blur or press Enter to save)
- First name, Last name
- Email, Phone
- Opportunity value — expected deal size in dollars
- Venue name, Venue website (URL)
- Wedding date, Guest count

Inquiry message
- If the lead came from the directory, their original message is shown here as read-only context.

Timestamped notes
- Type in the "Add a note…" box and click Add note.
- Every note is stamped with the exact time it was created.
- Edit (pencil) or delete (trash) your own notes. System-generated notes (like "Appointment scheduled") can't be edited, but you can delete them.
- Notes are sorted newest-first.
- The Kanban cards show a small "3" badge next to the message icon when a lead has notes.

Quick actions
- Reply (opens your email client with the lead's email pre-filled)
- Call (tap-to-dial on mobile)
- Listing (jumps to the directory page the lead came from)
- Create customer (saves this lead as a customer in your CRM)
- Schedule appointment (see next article)
- Delete (permanent — requires confirmation)`,
      },
      {
        id: 'leads-schedule-appointment',
        title: 'Scheduling an appointment from a lead',
        tags: ['appointment', 'schedule', 'tour', 'calendar', 'meeting'],
        body: `You can book a tour, tasting, meeting, or any event directly from a lead — no copy-pasting into the Calendar page.

How to schedule:
1. Open the lead (click a card or list row)
2. Click "Schedule appointment"
3. Pick the event type (Tour is the default — it's what most lead interactions become)
4. Set the date and start/end time
5. Optionally pick a specific space (Barn, Garden, Ballroom, etc.) — we'll warn you if it conflicts with an existing event
6. Add notes (optional)
7. Click "Add to calendar"

What happens:
- A new event is created on your Calendar, stamped with the lead's email so it links up with any customer profile created from this lead.
- A timestamped system note is auto-added to the lead: "Appointment scheduled (tour) for …". It'll show in the notes thread so your team has an audit trail.
- If the event type is "Tour" and your pipeline has a "Tour Booked" stage, the lead is automatically moved to that stage. (Other event types don't auto-move the card — you stay in control.)

Conflict detection:
- If you picked a space and another event is already in it during that time, you'll see a conflict warning and the appointment won't be created. Pick a different time, a different space, or leave the space blank.

To edit the appointment later, open it from the Calendar page.`,
      },
      {
        id: 'leads-filter-search',
        title: 'Searching and filtering leads',
        tags: ['filter', 'search', 'stage filter', 'find lead', 'leads filter'],
        body: `The Leads page has two tools for finding a specific lead:

Search box (top)
- Type any part of: first/last name, email, phone number, venue name, venue website URL, inquiry message, or note content
- Results update as you type (a short debounce prevents flicker)
- Clear the box to restore the full list

Stage filter (List view only)
- A dropdown next to the search box lets you filter to a single stage
- In Kanban view, the stages are columns — no separate filter needed

The search also looks inside timestamped notes. That means you can find a lead by something you typed into a note — e.g. "referral from Sarah" — even if the word isn't in any other field.

Search and filter combine — e.g. "All leads in 'Tour Booked' whose email contains gmail".

If no leads match, you'll see an empty state. That's not an error — just widen your filters.`,
      },
      {
        id: 'leads-ask-ai',
        title: 'Asking AI about your leads',
        tags: ['ai', 'ask ai', 'stats', 'report', 'intelligence'],
        body: `The Ask AI widget (bottom-right of every page) knows about your leads when you're on the Leads page.

Things to ask:
- "How many leads do I have this month?"
- "How many leads were new last month?"
- "What's my total pipeline value?"
- "What are the top requested wedding months?"
- "Find the lead named Smith" — AI will repeat their email, phone, wedding date, and stage so you don't have to scroll.
- "Which leads haven't been contacted yet?"
- "Show me leads with wedding dates in June"
- "How many leads did I convert to Booked this month?"
- "What's the average opportunity value of my leads in Proposal Sent?"

AI only sees aggregate stats plus recent leads' details — it can't see financial data not already visible on your dashboard. It also doesn't edit leads for you; use the Kanban board or drawer for changes.

If AI gives a stale answer, refresh the page to reset the context.`,
      },
      {
        id: 'leads-notifications',
        title: 'Lead notification emails',
        tags: ['notification', 'email', 'lead email', 'alert', 'inquiry email', 'not receiving'],
        body: `When a new lead comes in, StoryPay emails you a formatted summary so you don't need to open the dashboard every hour.

The email includes the couple's name, contact info, wedding date (if given), estimated guest count, booking timeline, and their full message. A "View in dashboard" link jumps straight to the lead.

Configure the notification email:
- Sidebar → Directory Listing → Inquiry notifications section
- Notification email — defaults to your account email; change it to a shared inbox (e.g. bookings@yourvenue.com) so the whole team sees new leads
- Email notifications — toggle off if you only want leads to appear in the dashboard with no email

Not receiving emails?
- Check spam / promotions folder
- Confirm the notification email address is correct and receives mail
- Make sure Email notifications is toggled on
- Leads are still saved in the dashboard even if the email fails — open /dashboard/leads to see them

SMS for high-value leads is not currently on by default; contact support if you want to enable it.`,
      },
      {
        id: 'leads-to-proposal',
        title: 'Turning a lead into a customer and proposal',
        tags: ['convert', 'proposal', 'customer', 'lead to customer', 'book', 'quote'],
        body: `Leads are the top of your funnel. Once a lead is qualified, here's the recommended path through StoryPay:

1. Leads → open the inquiry, review details
2. Mark contacted once you've replied
3. Add them to Customers — Sidebar → Customers → + Add Customer — paste in their name, email, phone, and wedding date. Set the pipeline stage to "Tour Scheduled" or "Proposal Sent" as appropriate.
4. Book their tour on the Calendar — use Type: Tour, link to the customer's email
5. After the tour, go to Payments → New Proposal → pick them from the customer list → apply a proposal template → send
6. Back on the Leads page, mark the lead "Proposal sent"
7. When they sign and pay, mark the lead "Booked" and update the customer's pipeline stage to Booked

The lead stays in your Leads inbox as a permanent record of where this customer came from, even after they become a paying customer.

Note: auto-conversion of a lead into a customer profile with a single click is a planned enhancement — for now, create the customer manually. All the lead info is visible in the expanded view for easy copy/paste.`,
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
        title: 'Customer profile — overview and tabs',
        tags: ['customer profile', 'crm', 'profile', 'tabs', 'overview', 'history', 'edit note', 'edit notes', 'new proposal', 'new invoice'],
        body: `Click a customer's name to open their full profile. Customers you see on this list come from three sources — storyvenue.com signups, LunarPay integration, and GoHighLevel imports — all unified into one record per person. The profile has 5 tabs:

Overview
- Edit contact info inline (name, email, phone, address)
- Add and view a partner / second contact (important for wedding couples)
- Wedding Details block: wedding date, ceremony type (ceremony only / reception only / both), guest count, assigned venue space, rehearsal date, day-of coordinator name and phone, catering notes
- Notes: add timestamped internal notes on this customer. Each note has a pencil icon — click it to edit the note inline after it was created, with Save and Cancel buttons.

Activity
- Unified reverse-chronological timeline of every interaction: proposal sent, viewed, signed, payment made, note added, file uploaded, task created/completed, Calendly booking received

Payments
- All proposals and invoices linked to this customer
- Installment schedules with payment breakdown
- Copy link, resend, view invoice, issue refund
- Use the "New Proposal" and "New Invoice" buttons at the top of this tab to jump straight to the proposal/invoice builder with the customer's name and email pre-filled

Tasks
- Create tasks with optional due dates (e.g. "Collect final guest count")
- Check off completed tasks — they collapse but remain visible, and can be unchecked or reopened later
- Edit a task title or due date inline via the pencil icon
- Overdue tasks show in red

Documents
- Upload files: contracts, floor plans, vendor agreements, insurance certificates, photos, or other
- Each file has a type and a status (Pending / Received / Approved)
- Click a filename to download; update status inline; delete files

The header shows:
- Pipeline stage (Inquiry → Tour Scheduled → Proposal Sent → Booked → Event Complete → Post-Event Follow-up) — click any stage to update it
- Referral source badge (how this lead found you)
- KPI row: total proposals, total paid, pending amount, open tasks

On the Customers list page itself, each row also has "Create Proposal" and "Create Invoice" shortcut buttons that do the same thing — open the payment builder with the customer pre-selected.`,
      },
      {
        id: 'cust-pipeline',
        title: 'Pipeline stages and referral source',
        tags: ['pipeline', 'stage', 'lead', 'referral', 'source', 'funnel', 'crm'],
        body: `Each customer has a pipeline stage that tracks where they are in your booking funnel:

- Inquiry — first contact, not yet qualified
- Tour Scheduled — a tour has been booked
- Proposal Sent — a proposal or invoice has been sent
- Booked — proposal signed and paid
- Event Complete — the wedding or event has taken place
- Post-Event Follow-up — following up for reviews, referrals, etc.

Click any stage button on the customer profile header to update it. The stage is visible on the customer list as a colored badge.

Referral Source tracks how this couple found you: Instagram, Google, Wedding Wire, The Knot, Referral, Venue Website, Facebook, or Other. Set it in the Overview tab → partner/contact edit section.`,
      },
      {
        id: 'cust-tasks',
        title: 'Customer tasks — create, edit, reopen',
        tags: ['tasks', 'todo', 'checklist', 'follow up', 'reminder', 'edit task', 'reopen task', 'uncheck task', 'update task'],
        body: `The Tasks tab on a customer profile lets you create action items specific to that customer.

To add a task:
1. Open the customer profile → Tasks tab
2. Type the task title in the input box
3. Optionally set a due date
4. Press Enter or click the + button

Tasks show in order of creation. Overdue tasks (past due date) display the due date in red.

To mark a task done: click the checkbox next to the task. Completed tasks collapse into a "X completed tasks" section at the bottom of the list — click it to expand and review.

To reopen a completed task (move it back into the active list): expand the completed section, then either uncheck its checkbox or click the "Reopen" button on the task row.

To edit a task after it has been created: hover the task row and click the pencil icon. The title (and due date) become editable inline. Click Save to commit the change or Cancel to discard.

To permanently delete a task: open a completed task row and click the trash icon.

Tasks are visible only to your team — they are not shared with the customer.`,
      },
      {
        id: 'cust-documents',
        title: 'Customer documents and files',
        tags: ['documents', 'files', 'upload', 'contract', 'floor plan', 'insurance', 'attachment'],
        body: `The Documents tab lets you attach files to a customer profile: signed contracts, floor plans, vendor agreements, insurance certificates, photos, and more.

To upload a file:
1. Open the customer profile → Documents tab
2. Select the file type from the dropdown (Contract, Floor Plan, Vendor Agreement, Insurance, Photo, Other)
3. Click "Upload File" and select the file from your device
4. Accepted formats: PDF, Word, Excel, images (PNG, JPG) — max 10MB

Each file shows:
- Filename (click to download)
- File type
- Status: Pending, Received, or Approved — update inline by clicking the status dropdown
- Upload date and who uploaded it

Files are stored securely and are only accessible to your team. Delete a file by clicking the trash icon on its row.`,
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

Step 4 — Add line items. Type a product name (autocompletes from your saved products) or enter a custom item. Each line has a description, quantity, and price. A processing fee line is added automatically.

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
    color: '#f97316',
    articles: [
      {
        id: 'brand-setup',
        title: 'Setting up your brand',
        tags: ['branding', 'logo', 'colors', 'brand', 'customize', 'email colors'],
        body: `Go to Settings → Branding.

Upload your logo by clicking "Upload Logo" and selecting a PNG, JPG, or SVG file (max 5MB). The logo appears in all outgoing emails — it shows in a white header with a colored strip underneath.

Choose brand colors:
- Click a Color Preset (Default, Ivory & Gold, Sage & Stone, Blush & Cream, Coastal Blue, etc.) — saves automatically when clicked.
- Or use Custom Colors to set the Primary/Button color, Background color, and Button Text color precisely.

The live Preview panel on the right updates in real time as you change colors, showing exactly how invoices and emails will look.

Fill in Contact Information — your email, phone, website, address, and a footer note. These appear on documents and in email footers.

Changes save automatically when you click a color preset. For other fields, click "Save Branding Settings" at the top.

Note: Branding settings are visible to owners and admins only.`,
      },
    ],
  },
  {
    id: 'email-templates',
    label: 'Email Templates',
    iconName: 'Mail',
    color: '#14b8a6',
    articles: [
      {
        id: 'email-types',
        title: 'Email template types',
        tags: ['email', 'templates', 'automated', 'notification', 'test email', 'preview'],
        body: `StoryPay sends automated emails on your behalf. Customize each one at Settings → Email Templates.

The 7 template types are:
1. Invoice — sent when you send an invoice to a customer
2. Proposal — sent when you send a proposal
3. Payment Confirmation — receipt sent to the customer after a successful payment
4. Payment Notification — alert sent to you when you receive a payment
5. Subscription Confirmation — sent to the customer when a subscription starts
6. Subscription Cancelled — sent to the customer when a subscription ends
7. Payment Failed — sent when a payment attempt fails

Each template has:
- Subject Line
- Email Heading
- Body Text (supports merge variables like {{customer_name}} and {{amount}})
- Button Text (optional — the action button in the email)
- Footer Text (optional — e.g. your cancellation policy)
- Enable/Disable toggle

All emails use your venue branding — your logo appears in the email header, and your brand color is used for the accent strip and button.

To test a template: click "Send Test" and enter any email address. The test email shows exactly what clients receive, using sample data.

To preview: click "Preview" for a live mock-up inside the editor.

Tip: Send a test email to yourself before sending a real proposal to ensure everything looks correct.`,
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
    color: '#6366f1',
    articles: [
      {
        id: 'int-calendly',
        title: 'Connecting Calendly',
        tags: ['calendly', 'booking', 'sync', 'tour booking', 'integration', 'connect'],
        body: `Calendly integration automatically syncs bookings (tours, meetings, tastings) from Calendly into your StoryPay calendar and customer profiles.

To connect:
1. Go to Settings → Integrations → Calendly card → click Connect
2. Go to calendly.com/integrations/api_webhooks
3. Click API & Webhooks → Personal Access Tokens → Generate New Token
4. Copy the token and paste it into StoryPay → click Connect

After connecting:
- New Calendly bookings appear on your calendar automatically in real time
- A customer profile is auto-created for the invitee's email
- Cancellations in Calendly mark the event cancelled in StoryPay
- Use Sync Now to import all upcoming Calendly events at any time

To disconnect: click Disconnect on the Calendly card.`,
      },
      {
        id: 'int-google-cal',
        title: 'Google Calendar, Outlook & Apple Calendar sync',
        tags: ['google calendar', 'outlook', 'apple calendar', 'ical', 'sync', 'subscribe', 'phone calendar'],
        body: `Sync your StoryPay calendar to any calendar app using an iCal subscription feed. This is one-way: StoryPay events appear in your calendar app. Events added in Google/Outlook do not flow back into StoryPay.

Find your iCal URL: Settings → Integrations → Google Calendar / Outlook & Apple Calendar card.

Google Calendar:
1. Open Google Calendar on desktop
2. Click + next to "Other calendars" → From URL
3. Paste your iCal URL → Add calendar

Outlook / Microsoft 365:
1. Calendar → Add calendar → Subscribe from web
2. Paste your iCal URL → Import

Apple Calendar (Mac):
1. File → New Calendar Subscription
2. Paste your iCal URL → set refresh to Every Hour → OK

iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.

Updates may take up to 24 hours depending on the calendar app.`,
      },
      {
        id: 'int-quickbooks',
        title: 'Connecting QuickBooks Online',
        tags: ['quickbooks', 'accounting', 'integration', 'sync', 'qbo'],
        body: `Go to Settings → Integrations. Click Connect on the QuickBooks Online card.

You'll be redirected to Intuit to authorise the connection. After approving, you're returned to StoryPay and the integration shows as Connected.

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
        tags: ['team', 'invite', 'add member', 'staff', 'user', 'email invite'],
        body: `Go to Settings → Team. Click "+ Add Team Member".

Fill in:
- First Name (required)
- Last Name
- Email (required)
- Role: Owner, Admin, or Member

Click Add Member. The team member immediately receives a branded invitation email at the address you entered. The email includes an Accept Invitation button that logs them into your account.

Once they click the link they are taken straight to the dashboard with the correct access level for their role.

To manage a team member: click the three-dot (...) menu on their row to:
- Edit — update their name, email, or role
- Resend Invite — send the invitation email again
- Remove — remove them from the account

Team members can update their own name and email at any time by clicking their name in the sidebar footer → My Profile.

Note: Only owners and admins can manage team members.`,
      },
      {
        id: 'team-roles',
        title: 'Team roles and permissions',
        tags: ['roles', 'permissions', 'owner', 'admin', 'member', 'access', 'what can they see'],
        body: `There are three roles:

Owner
- Full access to everything
- Sees all sidebar items including Calendar, Reports, What's New, and all Settings
- Can manage branding, email templates, team, integrations, general settings
- Sees the Get Started onboarding checklist and can restart it
- Can manage billing and payment processing

Admin
- Access to proposals, customers, calendar, invoices, payments, and most settings
- Can manage branding and email templates
- Cannot access General settings, Team management, or Integrations
- Does not see the onboarding checklist

Member
- Can only view and manage proposals and customers
- Sees Home, Customers, Calendar, Payments, Help Center, and Ask AI
- Cannot access Settings, Reports, or What's New
- Does not see the onboarding checklist

To change a member's role: click the three-dot menu (...) on their row → Edit Member → change the Role field.

Team members can update their own profile (name, email) by clicking their name in the sidebar footer.`,
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
      {
        id: 'sms-notifications',
        title: 'SMS notifications for customers',
        tags: ['sms', 'text message', 'phone', 'messaging', 'ghl', 'notification'],
        body: `When you send a proposal or invoice to a customer with a phone number on file, StoryPay automatically sends them an SMS with a link.

For SMS to work:
1. The customer must have a phone number entered when creating the proposal or invoice.
2. Phone numbers are automatically formatted to US E.164 format (+1XXXXXXXXXX). Enter numbers in any format — StoryPay handles the rest.
3. Your account's GHL (Go High Level) sub-account must be connected. SMS routes through your A2P-approved phone number.

If SMS is not sending, check:
- Is the customer's phone number entered?
- Is the phone number a valid US number?
- Is messaging connected? (Settings → General → Messaging should show "Connected")

Note: SMS uses your GHL sub-account's verified A2P phone number automatically — no manual configuration needed once messaging is connected.`,
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
- "How do I connect Calendly?"
- "How do I sync my calendar with Google Calendar?"

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
  '/dashboard/customers': ['cust-add', 'cust-search', 'cust-profile', 'cust-tasks', 'cust-documents'],

  // Calendar
  '/dashboard/calendar': ['cal-overview', 'cal-spaces', 'cal-add-event', 'cal-conflicts'],

  // Directory Listing
  '/dashboard/listing/images': ['listing-photos', 'listing-overview', 'listing-publish'],
  '/dashboard/listing':        ['listing-overview', 'listing-autosave', 'listing-photos', 'listing-publish', 'listing-slug'],

  // Leads
  '/dashboard/leads': ['leads-overview', 'leads-filter-search', 'leads-manage', 'leads-notifications', 'leads-to-proposal'],

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
  '/dashboard/settings/integrations':    ['int-calendly', 'int-google-cal', 'int-quickbooks', 'int-freshbooks'],
  '/dashboard/settings/team':            ['team-invite', 'team-roles'],
  '/dashboard/settings/notifications':   ['notif-settings', 'sms-notifications'],
  '/dashboard/settings':                 ['gs-overview', 'gs-onboarding'],

  // What's New / Updates
  '/dashboard/updates': ['ai-overview', 'gs-overview'],

  // AI
  '/dashboard/ai':   ['ai-overview', 'ai-screenshot', 'ai-voice', 'ai-escalate'],
  '/dashboard/help': ['gs-overview', 'listing-overview', 'leads-overview', 'ai-overview'],

  // Signup / login (public pages — harmless if never hit via dashboard)
  '/signup': ['gs-signup', 'gs-login'],
  '/login':  ['gs-login', 'gs-signup'],
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
