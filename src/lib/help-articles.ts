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
        body: `StoryVenue (at app.storyvenue.com) is the all-in-one command center for wedding venues. From one dashboard you manage your public directory listing on storyvenue.com, the leads it generates, customer profiles, proposals, invoices, payments, a booking calendar, branding, email templates, and your team.

After logging in you land on the Home dashboard which shows your revenue, pipeline, recent proposals, and recent transactions at a glance.

Navigation lives in the left sidebar (or the hamburger menu on mobile). Top-level items include Home, Ask AI, Contacts, Conversations, Calendar, Leads, Reports, What's New, and Help Center. Venue listing (directory Dashboard, Media library, Photos, Analytics, Reviews), Payments, Marketing (analytics, lead capture forms, email tools, trigger links & tags), and Settings open as flyout submenus. On desktop you can collapse the sidebar with the chevron next to the logo — it becomes a narrow icon rail with a compact mark; your choice is remembered in the browser.

The main areas:
- Home — revenue snapshot and recent activity
- Contacts — CRM profiles with tabs (Overview, Notes, Activity, Payments, Tasks, Documents) and a pipeline + stage control in the header (same sales pipelines as Leads)
- Conversations — unified inbox per contact: Team only notes vs Email contact messages
- Calendar — tours, weddings, and events
- Venue listing — Dashboard for how you appear on storyvenue.com (description, publish); Media library for shared images you reuse across listing, emails, forms, and branding; Photos for cover and gallery on the directory page; Analytics for GA4 measurement ID and a real-time world map of live visitors to your listing; Reviews for StoryVenue testimonials (star ratings, published/pending/hidden statuses) and Google reviews (connect your Google Business Profile so your Google reviews appear on your storyvenue.com listing)
- Leads — Kanban/list pipeline for inquiries; editable stages and pipelines
- Reports — financial exports (owners and admins)
- Payments flyout — new proposal/invoice, proposals list, templates, installments, subscriptions, transactions
- Marketing flyout — analytics, lead capture forms, email tools, Trigger Links, Tags & Variables (system tags + canonical merge variables + trigger links)
- Help Center — searchable docs and Ask AI–style help
- Settings flyout — general, branding, email templates, integrations, team, notifications

What you see depends on your role. Owners see everything. Admins see most areas. Members have a narrower set (e.g. proposals, customers, calendar, leads, listing — no Reports or most Settings).

How the two sites fit together:
- storyvenue.com is the public-facing directory browsed by couples looking for a venue
- app.storyvenue.com is the private admin dashboard where you run your business

Couples browse your listing on storyvenue.com → submit an inquiry → the lead lands in your Leads inbox here → you reply, book a tour, send a proposal, and collect payment — all without leaving StoryVenue.

The floating sparkle button (bottom-right) opens Ask AI, which can answer questions about your account in real time.

The browser tab shows the StoryVenue icon. If it still looks wrong after an app update, try a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) or clear site data — browsers cache favicons aggressively.`,
      },
      {
        id: 'gs-sidebar-chrome',
        title: 'Sidebar collapse and browser tab icon',
        tags: ['sidebar', 'collapse', 'narrow', 'rail', 'favicon', 'tab icon', 'icon', 'chevron'],
        body: `On large screens, the left sidebar can be collapsed: click the chevron next to the StoryVenue logo (points left when expanded, right when collapsed). The sidebar shrinks to a narrow icon rail so you gain horizontal space for the main content. The logo switches to a compact mark instead of the full wordmark. Your preference is saved in this browser.

The browser tab uses the StoryVenue icon (favicon), not the full logo. Hosting platforms sometimes show a default icon until the app loads — if you still see an old icon after an update, hard-refresh the page or clear cached data for app.storyvenue.com.`,
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
- Go to Venue listing → Dashboard in the sidebar and fill in your venue name, description, location, capacity, pricing, amenities, and photos
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

1. Publish your listing — fill in your venue details and flip Publish on (Sidebar → Venue listing → Dashboard)
2. Create Your Profile and Branding — upload your logo and set brand colors (Settings → Branding)
3. Customize Email Templates — personalize the emails sent to clients (Settings → Email Templates)
4. Create Your First Proposal Template — build a reusable contract template (Payments → Proposal Templates)
5. Create Your First Proposal — use a template to create a proposal for a client
6. Send Your First Proposal — send it to a client so they can sign and pay
7. Invite a Team Member — add staff to your account (Settings → Team)

Check off each step manually as you complete it. When all steps are checked, click "I'm Ready — Start Using StoryVenue" to dismiss the bubble permanently. You can also skip the wizard at any time and come straight to the dashboard — payment processing setup is optional and can be completed later.

To restart the checklist at any time, go to Settings → General → Restart Setup Guide. This only clears the checkmarks — it does not delete any data.

Note: The setup guide is only visible to account owners. Admins and Members do not see it.`,
      },
      {
        id: 'gs-login',
        title: 'Logging in and your login link',
        tags: ['login', 'link', 'access', 'sign in', 'token', 'magic link', 'forgot password'],
        body: `StoryVenue uses magic-link login at app.storyvenue.com/login — no password needed.

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
      {
        id: 'dash-announcement-ticker',
        title: 'Announcement ticker — what it is and why you can\'t close it',
        tags: ['announcement', 'ticker', 'news', 'banner', 'top bar', 'broadcast', 'platform updates'],
        body: `The thin dark scrolling bar at the very top of every page (labelled "News") is the announcement ticker. It surfaces platform-wide messages from the StoryVenue team — things like:

- Scheduled maintenance windows and downtime notices
- New feature launches and big changes to existing tools
- Compliance / billing / legal updates that need every venue's attention
- Time-sensitive operational notices (deliverability issues, integrations being retired, etc.)

Why there's no "X" to close it
The ticker is intentionally non-dismissible from the venue side. When the StoryVenue team broadcasts something it's because every venue genuinely needs to see it, and a per-venue dismiss would mean important messages get hidden in the moments they matter most. There's no per-user "snooze" cookie — if you see it, every other user on your venue sees it too.

Who can turn it off
Only the StoryVenue team can hide an announcement. Each announcement has an Active / Inactive toggle on the super admin dashboard; the moment a message is deactivated it disappears from every venue ticker on the next page load. Announcements are also rotated and replaced regularly, so the bar will feel fresh rather than static.

Clicking the link in an announcement
If a message has a link, clicking it opens the destination in a new tab (or the same tab, for in-app routes). Hovering anywhere over the scrolling text pauses the animation so you can read or click without chasing the message.`,
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
- Week — seven-column timeline; always opens anchored to the current week in your timezone
- Day — single-column timeline; always opens on today in your timezone
- Year — 12-month grid showing how many weddings and tours fall in each month; click any month to jump to it

Click any empty day (or hour slot in Week/Day view) to add a new event. Click any event chip to open its details where you can Edit or Delete it.

Event colors come from your venue spaces — when you assign a space to an event, the event chip uses that space's color so the calendar reads at a glance by venue area. Events without a space use a neutral style.

Events can be single-day, multi-day (for wedding weekends), or recurring (for weekly tastings, monthly maintenance days, etc.). Multi-day events render on every day they span; continuation days in Week/Day view show small left/right arrows to indicate the event extends before or after.

The "Today" button snaps back to the current date. The Prev / Next arrows move forward or back by one month, week, or day depending on the active view.`,
      },
      {
        id: 'cal-spaces',
        title: 'Managing venue spaces',
        tags: ['spaces', 'barn', 'garden', 'ballroom', 'room', 'venue space', 'add space', 'edit space', 'remove space'],
        body: `If your venue has multiple bookable spaces (e.g. Barn, Garden, Ballroom, Vineyard), set them up first so you can track bookings per space, color-code the calendar, and prevent double-bookings.

Two places to manage spaces

1. Calendar page → "Manage Spaces" (top-right) — the main editor for all your spaces.
2. Inline from the New Event modal — when adding or editing a calendar event, open the Space dropdown and click Manage to add, rename, recolor, or remove spaces right there without leaving the event form. The same controls are available on the Leads page New Lead modal (Space field → Manage) and the Contacts New Contact modal.

To add a space
1. Open Manage Spaces (Calendar or New Event / New Lead / New Contact modal)
2. Enter a name and pick a color — the color is used for event chips on the calendar
3. Click Add

To edit a space
- Click the pencil next to a space, change the name or color, click Save.

To remove a space
- Click the trash icon. Events and leads that referenced it aren't deleted; their Space field just becomes empty.`,
      },
      {
        id: 'cal-add-event',
        title: 'Adding, editing, and deleting events',
        tags: ['add event', 'new event', 'book', 'schedule', 'create event', 'edit event', 'update event', 'change event', 'delete event', 'contact search', 'assign team member', 'team member'],
        body: `To add an event, click the "+ Add Event" button or click directly on any day (or hour slot in Week/Day view) in the calendar grid.

Fill in:
- Event Title (e.g. "Smith & Johnson Wedding")
- Type — Wedding, Reception, Tour, Phone call, Tasting, Meeting, Rehearsal, Hold, Blocked, Other
- Status — Confirmed, Tentative/Hold, Cancelled
- Space — pick from your saved venue spaces. Click Manage right in the modal to add, edit, or remove spaces without leaving the form (see the Spaces article). Assigning a space enables conflict detection and colors the event chip.
- Contact — start typing a name, email, or phone to search your contacts and attach the event to a customer profile with one click. The linked contact's email/phone come along for the ride, and the event shows up on their profile timeline. You can still leave it blank for internal holds/blocks.
- Assigned team member — if your venue has team members, pick the owner/coordinator responsible for the event. Their name shows on the event detail panel and keeps handoffs clear. Leave empty for unassigned.
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
        body: `StoryVenue checks for booking conflicts at the database level, not just in the UI. If you try to add an event to a space that already has another event during that time window, you will see a conflict warning.

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
        body: `StoryVenue provides an iCal subscription feed so your events appear in any calendar app on your phone or computer.

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

Note: This is a one-way sync — StoryVenue events appear in your personal calendar. Events you add in Google/Outlook do NOT flow back into StoryVenue. Updates may take up to 24 hours to appear depending on the calendar app.`,
      },
      {
        id: 'cal-calendly',
        title: 'Connecting Calendly',
        tags: ['calendly', 'sync', 'booking', 'tour booking', 'integration', 'connect calendly'],
        body: `Connect Calendly so that when someone books a tour (or any appointment) through your Calendly link, it automatically appears on your StoryVenue calendar and creates a customer profile.

To connect:
1. Go to Settings → Integrations → Calendly card → click Connect
2. Go to calendly.com/integrations/api_webhooks → API & Webhooks → Personal Access Tokens → Generate New Token
3. Copy the token and paste it into StoryVenue → click Connect

Once connected:
- New Calendly bookings appear on your StoryVenue calendar instantly (real-time via webhook)
- A customer profile is created automatically for each booking
- Cancellations in Calendly automatically mark the event cancelled in StoryVenue

Use Sync Now to import all upcoming Calendly events at any time (useful after first connecting).

To disconnect, click Disconnect on the Calendly card. Your existing calendar events are not deleted.`,
      },
      {
        id: 'cal-settings-overview',
        title: 'Calendar Settings — overview of all tabs',
        tags: ['calendar settings', 'settings', 'availability', 'booking rules', 'google calendar', 'connections', 'notifications', 'timezone'],
        body: `Settings → Calendar opens a five-tab configuration hub for everything related to how your calendar works and what happens when appointments are booked.

General tab
Set your calendar timezone (used for all slot display and availability hours) and a privacy option to hide client names from synced calendar events.

Connections tab
Connect your Google account for two-way sync:
- Link a specific Google Calendar to receive new StoryVenue events
- Choose Conflict Calendars — any Google Calendar whose events should block your availability (personal events, team meetings, etc.)
- Google Calendar events from connected/conflict calendars show as read-only chips on your StoryVenue calendar so your full schedule is visible in one place

Availability tab
Set your weekly working hours (which days and times show as bookable) and add date-specific overrides — block a day entirely or set custom hours for a holiday or special event.

Booking Rules tab
Control how bookings work:
- Meeting Duration and Interval — how long each slot is and how far apart they start
- Minimum Scheduling Notice — how far ahead someone must book (0 – 72 hours)
- Date Range — how far out slots are visible to bookers
- Pre-buffer / Post-buffer — blocked time before and after each appointment for prep or debrief
- Max bookings per day / slot

Calendars tab
Create and manage up to 5 named calendars (e.g. "Tour Calendar", "Phone Call Calendar"). Each calendar can have its own color, description, and — optionally — its own booking rules that override the venue-wide defaults. All calendars share the same unified calendar view; only their notification templates and booking rules differ. The default calendar cannot be deleted.

Notifications tab
Manage email and SMS notification templates for all appointment lifecycle events (confirmation, cancellation, reschedule, reminder, follow-up). Each calendar can have its own notification set — see the Calendar Appointment Notifications articles for full details.`,
      },
      {
        id: 'cal-settings-google-sync',
        title: 'Connecting Google Calendar for two-way sync',
        tags: ['google calendar', 'two way sync', 'connections', 'conflict calendar', 'block availability', 'google events', 'google account'],
        body: `Settings → Calendar → Connections lets you connect your Google account for a two-way sync between StoryVenue and Google Calendar.

Connecting your Google account
1. Go to Settings → Calendar → Connections tab
2. Click "Connect Google Calendar"
3. Sign in with your Google account and grant the requested permissions
4. Once connected, your Google Calendars appear in a dropdown — pick the one where new StoryVenue events should be written (Linked Calendar)

After connecting
- New StoryVenue events are automatically added to your selected Google Calendar
- When you update or cancel a StoryVenue event, it updates in Google Calendar as well
- Google Calendar events appear as read-only chips on your StoryVenue calendar view — you see your full personal and professional schedule in one place

Conflict Calendars
In the Connections tab, check any Google Calendars whose events should block your availability:
- When that calendar has an event at a given time, that slot becomes unavailable on your public booking page
- Use this for personal appointments, team-wide meetings, or any calendar you don't want double-booked over

Disconnecting
Click Disconnect in the Connections tab. StoryVenue events already written to Google Calendar are not automatically deleted.

If the connection stops working
Google OAuth tokens expire. Return to Settings → Calendar → Connections and reconnect. This is usually required after a Google account password change or permission revocation.`,
      },
      {
        id: 'cal-settings-availability',
        title: 'Setting your weekly availability and date overrides',
        tags: ['availability', 'working hours', 'schedule', 'days off', 'hours', 'holiday', 'override', 'blocked date'],
        body: `Settings → Calendar → Availability controls which days and hours appear as bookable on your public scheduling page.

Weekly working hours
- Toggle each day of the week on or off
- For enabled days, set a Start Time and End Time
- These become the bookable windows for that day every week

Example setup: Monday–Friday 9 AM – 5 PM, Saturday 10 AM – 2 PM, Sunday off.

Date-specific overrides
Add overrides for individual dates that differ from your weekly pattern:
- Block a day entirely (mark as unavailable) — useful for holidays, travel, staff events
- Set custom hours for a specific date — e.g. only 11 AM – 1 PM on a particular Friday
- Add an optional label like "Venue closed" or "Staff retreat" to remember why

To add an override:
1. Click "+ Add date override"
2. Pick the date
3. Choose "Unavailable all day" OR set custom start/end times
4. Add a label (optional) → Save

Overrides stack on top of your weekly hours — a day marked unavailable will show no slots even if the weekly schedule has that day enabled.

Changes take effect immediately for all future booking requests.`,
      },
      {
        id: 'cal-settings-booking-rules',
        title: 'Booking rules — duration, notice, buffers, and limits',
        tags: ['booking rules', 'meeting duration', 'notice', 'buffer', 'min notice', 'max bookings', 'slot interval', 'date range'],
        body: `Settings → Calendar → Booking Rules defines how appointment slots are structured and constrained for online bookings.

Meeting Duration
The default length of a bookable appointment. Options: 15, 30, 45, 60, 90, 120, 180, or 240 minutes. This is the block of time reserved when someone books.

Meeting Interval
How far apart slot start times are. If duration is 60 min and interval is 30 min, slots start at :00 and :30 — the second person can book starting half-way through the previous slot window. Use this to offer more time options without enabling true overlap.

Minimum Scheduling Notice
How far in advance a booking must be made. Set to 0 to allow same-day bookings, or up to 72 hours to require at least 3 days' notice. Any slots within this window are hidden from the booker.

Date Range
How many days into the future slots are visible. Options: 7, 14, 30, 60, 90, 180, or 365 days. Keeps bookers from scheduling a year in advance if your schedule changes frequently.

Pre-buffer
Blocks time BEFORE each appointment. For example, a 30-minute pre-buffer means no other slot can end within 30 minutes of your next booking — giving you prep time.

Post-buffer
Blocks time AFTER each appointment for debrief, cleanup, or travel. A 60-minute post-buffer means the next available slot starts 60 minutes after the previous booking ends.

Max Bookings per Day / per Slot
Caps on how many bookings are accepted. "Per slot" caps simultaneous bookings at the same time; "per day" caps the total for a calendar day. Leave at 0 for no limit.

Per-calendar overrides
Each individual calendar can override any of the rules above. Go to Settings → Calendar → Calendars tab → click a calendar → expand "Customize Booking Rules". Any field left at "Venue default" inherits the setting from this global Booking Rules tab. This means a 15-minute phone-call calendar and a 60-minute tour calendar can coexist without either compromising the other.`,
      },
      {
        id: 'cal-availability',
        title: 'Public availability page',
        tags: ['availability', 'public', 'share', 'open dates', 'prospects', 'widget'],
        body: `StoryVenue generates a public availability page for your venue that shows which dates are open or booked — without revealing any customer names or details.

Find your availability URL at Settings → Integrations → Google Calendar / Outlook & Apple Calendar card → Public Availability Page.

Share this link on your venue website, social media, or with prospects so they can check date availability without calling you.

The page shows a month-by-month calendar with:
- Open dates (green)
- Booked / unavailable dates (red, labeled Booked or Tour)

Prospects can navigate forward and back through months. No customer information is ever shown on this page.`,
      },
      {
      {
        id: 'cal-multi-calendar',
        title: 'Multiple calendars — create up to 5 per venue',
        tags: ['multiple calendars', 'calendars', 'calendar types', 'tour calendar', 'phone call calendar', 'calendar management', 'create calendar', 'delete calendar', 'venue calendars', 'calendar color'],
        body: `StoryVenue supports up to 5 named calendars per venue — for example, a "Tour Calendar", "Phone Call Calendar", and "Consultation Calendar". All calendars display together in the single unified calendar view; each one is color-coded so events are visually distinct at a glance.

Where to manage calendars
Settings → Calendar → Calendars tab.

Creating a calendar
1. Click "+ Add Calendar" (disabled once you've reached the 5-calendar limit).
2. Enter a name (e.g. "Tour Calendar") and pick a color.
3. Optionally add a description and customize booking rules for that calendar (see Per-Calendar Booking Rules).
4. Click Save.

What makes each calendar independent
- Color — events on the unified view are colored by calendar.
- Notification templates — each calendar can have its own confirmation, cancellation, reschedule, reminder, and follow-up templates. See "Calendar appointment notifications — overview" and select the calendar in the Notifications tab dropdown.
- Booking rules — each calendar can override duration, interval, minimum notice, date range, and buffers independently.

The default calendar
Every venue has one default calendar created automatically. It cannot be deleted. You can rename it and change its color.

Deleting a calendar
Click the trash icon on a calendar row in Settings → Calendar → Calendars. The default calendar has no delete option. Deleting a calendar removes its notification settings; existing events on that calendar are not deleted.

On the calendar page
Events show with a colored left border matching their calendar. If you create multiple calendars, the event creation modal lets you pick which calendar the event belongs to.`,
      },
      {
        id: 'cal-per-calendar-rules',
        title: 'Per-calendar booking rules — overrides per calendar type',
        tags: ['per calendar booking rules', 'booking rules override', 'calendar duration', 'calendar interval', 'custom booking', 'tour duration', 'phone call duration', 'calendar settings', 'override venue defaults'],
        body: `Every calendar can have its own booking rules that override the venue-wide defaults set in Settings → Calendar → Booking Rules. This means a phone-call calendar can use 15-minute slots while a tour calendar uses 60-minute slots — with no conflict.

How to set per-calendar rules
1. Go to Settings → Calendar → Calendars tab.
2. Click the pencil (edit) icon on a calendar row.
3. Expand the "Customize Booking Rules" section.
4. For each rule, choose a specific value OR leave it at "Venue default" to inherit from the global Booking Rules tab.

Rules you can override per calendar
- Meeting Duration — how long each appointment is (15 – 240 min)
- Meeting Interval — how far apart slot start times are
- Minimum Scheduling Notice — how far ahead a booking must be made
- Date Range — how many days into the future slots appear
- Pre-buffer — blocked time before each appointment
- Post-buffer — blocked time after each appointment

How inheritance works
Any field set to "Venue default" uses the value from Settings → Calendar → Booking Rules. Override only what differs for that calendar — everything else flows through automatically.

The public slots API respects per-calendar rules
When a calendar ID is included in the booking widget URL (or Calendly-style booking link), the slots engine applies that calendar's specific rules. If no calendar ID is specified, venue-wide defaults apply.`,
      },
      {
        id: 'cal-ai-search',
        title: 'AI calendar search & Q&A',
        tags: ['ai calendar', 'calendar ai', 'calendar search', 'ask ai calendar', 'sparkles', 'search events', 'calendar summary', 'upcoming events', 'calendar assistant', 'ai search'],
        body: `The calendar page has a built-in AI assistant that can answer natural-language questions about your upcoming events and give you instant summaries.

How to open it
Click the "Search & Ask AI" button (sparkle icon) in the calendar page header. A panel slides out from the right side.

Searching
Type a question or keyword in the input field and press Enter (or click Search). Quick-suggest prompts appear below the field to get you started — click one to auto-fill the query.

Example questions you can ask
- "What events do I have next week?"
- "How many tours are scheduled in June?"
- "Show me all confirmed appointments"
- "Do I have anything booked on May 15?"
- "What are the notes on the Johnson tour?"
- "Any cancellations in the last 30 days?"

What you see in the results
- AI Summary — a plain-language answer from the AI using your actual event data (past 30 days + next 90 days).
- Matching Events — a list of events whose title, contact email, calendar, space, notes, type, or status matched your keyword. Click any event in the list to open its full detail modal without closing the panel.

How it works
The AI has access to up to 200 of your events (past 30 days and next 90 days). It knows each event's title, type, status, start date, contact email, calendar name, space name, and notes. It answers based only on what's in your data — it won't make up events that don't exist.

If there's no AI answer
The panel still shows keyword-matched events even if the AI component is unavailable. You can always use the keyword results to find what you need.`,
      },
      {
        id: 'cal-event-actions',
        title: 'Cancelling, confirming, and rescheduling events',
        tags: ['cancel event', 'confirm event', 'cancellation', 'reschedule event', 'event status', 'delete event', 'cancelled appointment', 'confirmed appointment', 'appointment actions', 'status dropdown'],
        body: `From the event detail modal (click any event on the calendar), you have full control over the event's status — and the notification system responds automatically.

Status actions inside the modal
Open an event → the Status dropdown (top of modal) lets you change between:
- Confirmed — the appointment is locked in. If changed from another status, the "Appointment Confirmed" notification fires.
- Cancelled — marks the event as cancelled. The "Cancellation" notification fires automatically to all enabled channels (email/SMS to venue owner and contact).
- Pending — tentative, no automatic notification.

Deleting an event
Click the trash icon inside the event detail modal (or use the delete option from the event context menu on the calendar). Deleting an event also triggers the Cancellation notification, so the contact is always informed.

Rescheduling
Change the start or end date/time of an existing event and save. This triggers the "Reschedule" notification automatically.

The "Confirm" and "Cancel" buttons
In the event modal footer, quick action buttons let you confirm or cancel in one click without navigating through the status dropdown — useful for rapid triage of a busy calendar.

Follow-up timing
The Follow-Up notification fires a configurable time after the event ends. Set the delay in Settings → Calendar → Notifications → Follow-Up → expand a channel → "When to send" — choose minutes, hours, or days. Each of the four channels (Email → Owner, Email → Contact, SMS → Owner, SMS → Contact) can have a different follow-up delay.

Notifications fired per action
- Confirmed (new event): Appointment Booked (Confirmed) fires.
- Status → Confirmed: Appointment Confirmed notification fires.
- Status → Cancelled or event deleted: Cancellation notification fires.
- Start/end time changed: Reschedule notification fires.
- Reminder timing reached: Reminder fires (queued at event creation).
- After event ends: Follow-Up fires.`,
      },
      {
        id: 'cal-notification-overview',
        title: 'Calendar appointment notifications — overview',
        tags: ['calendar', 'notifications', 'email', 'sms', 'appointment', 'confirmation', 'reminder', 'cancellation', 'reschedule', 'follow up', 'automatic', 'templates'],
        body: `StoryVenue automatically sends email and SMS notifications when appointments are created, changed, or approaching. Every scenario and every channel is independently configurable.

Go to Settings → Calendar → Notifications tab to manage everything.

The five notification scenarios
1. Appointment Booked (Confirmed) — fires immediately when you create a confirmed calendar event.
2. Cancellation — fires when you change an event's status to Cancelled.
3. Reschedule — fires when you change an event's start or end time.
4. Reminder — fires before the appointment starts. Timing is fully configurable per channel.
5. Follow-Up — fires after the event ends. The timing is fully customizable: go to Settings → Calendar → Notifications → Follow-Up → any channel and set the delay in minutes, hours, or days after the event ends.

Multi-calendar support
If you have multiple calendars (see the Multiple Calendars article), each calendar can have its own independent set of notification templates. Select a calendar from the dropdown at the top of the Notifications tab to switch between calendar-specific settings and the venue-wide defaults.

The four channels per scenario
Each scenario has four channels, each independently toggled on or off:
- Email → Venue Owner — email to your venue's registered address
- Email → Contact — email to the booked contact/lead
- SMS → Venue Owner — SMS via StoryVenue Legacy to you
- SMS → Contact — SMS via StoryVenue Legacy to the contact

The channel editor
Click a scenario accordion to expand it. Inside you'll see the four channel rows. Click a channel row (or its chevron) to open the editor. The toggle on the right enables or disables that channel without losing your template.

Merge tags let you personalize every message:
- {{contact.name}} — contact's full name
- {{contact.email}} — contact's email
- {{contact.phone}} — contact's phone
- {{appointment.title}} — event title
- {{appointment.start_time}} — formatted date and time
- {{appointment.timezone}} — timezone abbreviation (e.g. EST)
- {{appointment.meeting_location}} — meeting link or address
- {{venue.name}} — your venue/business name

Click "Available merge tags" at the top of the Notifications tab to see the full reference list.

After editing, click Save Changes at the bottom. All templates and reminder timing are saved together.`,
      },
      {
        id: 'cal-notification-reminders',
        title: 'Configuring reminder timing per channel',
        tags: ['reminder', 'reminder timing', 'when to send', 'hours before', 'days before', 'minutes before', 'schedule', 'per channel', 'email reminder', 'sms reminder'],
        body: `Reminders are the only notification scenario where you control when each message is sent — and you can set completely different timing for each of the four channels.

Where to find it
Settings → Calendar → Notifications tab → click "Reminder" to expand → click any channel row (e.g. "SMS → Contact") → the "When to send" section appears at the top of the editor.

How timing works
- Each channel can have up to 3 send times.
- Enter a number and choose Minutes, Hours, or Days before the appointment starts.
- Example: Email → Contact could have 1 Day, 1 Hour, and 10 Minutes; SMS → Owner could have just 1 Hour.
- The send button stays disabled until the channel is added to the queue when the event is created or updated.

Default timing (applied automatically until you change it)
- Email → Owner: 1 day + 1 hour + 10 minutes before
- Email → Contact: 1 day + 1 hour + 10 minutes before
- SMS → Owner: 1 hour + 10 minutes before
- SMS → Contact: 1 hour + 10 minutes before

To add a send time: click "+ Add time" below the existing rows (up to 3 per channel).
To remove a send time: click the trash icon on that row (at least 1 row must remain).

Important: reminder rows are queued when an event is saved. If you change timing after an event is already booked, the existing queue rows are updated automatically for any upcoming (unsent) reminders.`,
      },
      {
        id: 'cal-notification-test',
        title: 'Sending a test notification',
        tags: ['test', 'send test', 'test email', 'test sms', 'preview', 'notification test', 'sample'],
        body: `Every channel editor has a built-in test sender so you can verify your template looks right before it reaches a real contact.

How to send a test
1. Settings → Calendar → Notifications tab → expand a scenario → expand a channel.
2. At the bottom of the editor you'll see a recipient field and a "Send test email" or "Send test SMS" button.
3. For email channels: type any email address and click Send test email. The button is disabled until an "@" is entered.
4. For SMS channels: type a 10-digit US phone number — the +1 country code is locked in and cannot be removed. Click Send test SMS. The button is disabled until 10 digits are entered.
5. The test fires immediately using your current template with sample placeholder values.

What the test sends
- All merge tags are replaced with realistic sample data (e.g. contact name = "Alex Johnson", appointment = "Strategy Call" on "Thursday, May 1 at 10:00 AM EST").
- A "[TEST – Owner]" or "[TEST – Contact]" prefix is added to the subject/message so you know it's a test.
- Email tests go to the address you type. SMS tests go to the Legacy contact whose phone number matches what you entered.

SMS test requirements
- The phone number you enter must belong to a contact that exists in the SaaS or Legacy messaging.
- StoryVenue looks up the contact in your database first (by the last 10 digits of the number), then falls back to a Legacy messaging search by phone, then by your venue email.
- If no matching contact is found, a red error message appears below the input explaining what to check.

If the test fails
- For email: check that your venue has a "From" domain configured via Resend and that the target email address is valid.
- For SMS: make sure Legacy messaging is connected (Settings → Integrations) and the phone number matches an existing contact.`,
      },
    ],
  },
  {
    id: 'conversations',
    label: 'Conversations',
    iconName: 'MessageCircle',
    color: '#0d9488',
    articles: [
      {
        id: 'conversations-profile-drawer',
        title: 'Opening a contact profile from inside a conversation',
        tags: ['conversations', 'contact profile', 'profile drawer', 'slide over', 'schedule', 'booking', 'contact details'],
        body: `You can view a contact's full profile — and book an appointment for them — without ever leaving the Conversations inbox.

How to open the profile drawer
1. Open a conversation thread (Conversations → pick a contact from the list).
2. Click the Profile button in the thread header (top-right area of the open thread).
3. The contact's full profile slides in from the right side of the screen.

What's inside the drawer
The drawer has all the same tabs as the standalone contact profile page:
- Overview — name, email, phone, pipeline stage, wedding details
- Notes — add or view notes for this contact
- Activity — full timeline of stage changes, calls logged, and messages
- Payments — any proposals or invoices linked to this contact
- Tasks — to-do items for this contact
- Documents — uploaded contracts and files
- Schedule — book a new appointment for this contact

Booking from the Schedule tab
Click the Schedule tab inside the drawer → click "Book appointment" → the New Event modal opens with the contact pre-filled. Save the event and it appears on your calendar immediately.

You can dismiss the drawer by clicking anywhere outside it or pressing Escape. It does not close your active thread.`,
      },
      {
        id: 'conversations-stage-badge',
        title: 'Pipeline stage badge in the conversations thread list',
        tags: ['conversations', 'pipeline', 'stage', 'badge', 'funnel', 'lead status'],
        body: `The thread list in Conversations shows a small colored stage pill next to each contact's name — the same stage pill you see on the Kanban board and in the contact profile.

What it tells you
The stage badge shows where the contact currently sits in your sales pipeline without leaving the inbox. If they've been moved from "Inquiry" to "Proposal Sent," the badge updates automatically the next time the thread list loads.

Why it matters
When you're working through your inbox, you can immediately spot which threads belong to hot leads (e.g. "Proposal Sent") vs. earlier-stage inquiries — and prioritize who to follow up with first.

Clicking the thread still opens the conversation normally. To change the stage, open the contact profile (Profile button in the thread) → Overview tab → click a stage pill.`,
      },
      {
        id: 'conversations-overview',
        title: 'Conversations — team notes vs email to contact',
        tags: ['conversations', 'inbox', 'messages', 'email', 'team', 'mentions'],
        body: `Conversations is the unified inbox for messages with each contact (sidebar → Conversations).

Pick a thread on the left to open it. The message composer at the bottom has three tabs — choose before typing:

- SMS — texts the contact via your connected Legacy messaging line. No @mentions. A character/segment counter shows in the toolbar.
- Email — sends an email to the contact's address from their profile. You can add a subject line, and the message is styled as a clean email in the thread.
- Team only — internal notes visible only to your team. Use @mentions to notify teammates.

The composer starts small and expands as you type. Icons for emoji, file attachment, and trigger links live inside the input bubble. Outgoing SMS shows grey bubbles; Email messages render as expandable email cards with From/To/Date details; Team notes appear in amber.

Tips:
- Use Team only for logistics and staff coordination.
- Use SMS or Email when the couple should receive the message.
- If something fails to send, check that the contact has an email address (for Email) or a valid phone number (for SMS) and that your Legacy messaging integration is connected.`,
      },
      {
        id: 'conversations-inbound',
        title: 'Replies from contacts land back in the thread',
        tags: ['inbound', 'reply', 'email reply', 'sms reply', 'resend', 'ghl', 'webhook', 'two way', 'threading'],
        body: `Conversations is two-way. When a couple replies to an email you sent from the thread — or texts back the number you use for SMS — their reply appears in the same thread on the contact's Conversations page. No copy-paste, no checking two inboxes.

Email replies (Resend inbound)
- Every outbound email from Conversations uses a Reply-To address on your inbound subdomain (for example \`reply+<thread>+<token>@inbound.storyvenue.com\`). When the couple hits Reply, their mail client sends back to that address.
- Resend receives the message through the \`email.received\` webhook wired at \`/api/webhooks/inbound-email\`, verifies the signed token, and appends the reply to the same thread. Quoted history is stripped so you only see what they typed.
- What you need in your workspace: a Resend inbound domain (MX records added in DNS), the \`email.received\` webhook pointed at \`<your-host>/api/webhooks/inbound-email\`, and the environment variables \`RESEND_API_KEY\`, \`CONVERSATIONS_INBOUND_DOMAIN\`, \`CONVERSATIONS_INBOUND_SECRET\` set on the host. (Optional \`INBOUND_EMAIL_WEBHOOK_TOKEN\` lets you reject unknown callers.)

SMS replies (Legacy inbound)
- Outbound SMS goes through your connected StoryVenue Legacy account's A2P-approved number. Inbound replies are forwarded to StoryVenue's inbound SMS webhook, and the message is attached to the matching thread by phone number.
- Troubleshooting: if SMS replies aren't appearing, confirm the contact's phone is on file in E.164 format, that Legacy messaging still shows "Connected" in Settings → Integrations.

If a reply doesn't show up
- For email: check that DNS MX records are still valid, the Resend inbound webhook is \`Active\`, and your Railway (or other host) logs show the \`/api/webhooks/inbound-email\` route receiving the event. "Address not found" bounces usually mean the reply-to domain isn't set up on Resend yet.
- For SMS: Legacy messaging must be connected and the sending number must match the contact. Messages to numbers not linked to any contact are dropped silently.`,
      },
    ],
  },
  {
    id: 'listing',
    label: 'Venue listing',
    iconName: 'Store',
    color: '#0ea5e9',
    articles: [
      {
        id: 'listing-overview',
        title: 'Your storyvenue.com directory listing',
        tags: ['directory', 'listing', 'public page', 'storyvenue', 'venue page', 'seo'],
        body: `Your public listing is your venue profile on storyvenue.com. It's what couples see when they browse the directory or land on your page from a Google search.

Open it from the sidebar → Venue listing → Dashboard (the listing editor). Everything on that page mirrors what appears at storyvenue.com/venue/<your-slug> when Publish is on.

A second item under the same flyout — Reviews — is where you collect star ratings and written testimonials. Reviews can be published, pending, or hidden. Only published reviews are included in the public read API and embed for the marketing site.

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

Photos — see the "Uploading photos" article. For images you want to reuse in multiple places (listing gallery, marketing emails, lead capture forms, logo), use Media library first — see the dedicated article.

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
        body: `The Venue listing → Dashboard page saves automatically as you edit — there is no "lose your work if you forget to click Save" moment.

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

Two ways to add images:
1. Venue listing → Photos (/dashboard/listing/images) — upload files from your computer, or click From media library to pick an image you already uploaded under Venue listing → Media library.
2. Venue listing → Dashboard — the Photos section links to the same photo tools; you can also open Media library from the listing overview.

Direct upload from Photos:
1. Go to Venue listing → Photos (or Dashboard → Photos section → Manage photos)
2. Click Upload photos and choose files, or From media library to reuse a shared image
3. Images upload to secure cloud storage and appear on your listing immediately

Best practices:
- Cover photo: wide landscape, 1600–2400 px wide, showing your signature space
- Gallery: mix of ceremony, reception, details, outdoor, bridal suite
- Accepted formats: JPG, PNG, WebP, AVIF, GIF (max 10MB each); Media library uses the same limits. Video is not supported in Media library.

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
        id: 'listing-media-library',
        title: 'Media — shared images and files for listing, email, forms, and branding',
        tags: ['media', 'media library', 'images', 'files', 'assets', 'upload', 'reuse', 'photos', 'cdn', 'logo', 'pdf', 'documents'],
        body: `Media is your venue-wide folder for everything you reuse across the product. Open it from the sidebar → Media (path: /dashboard/media). The old /dashboard/listing/media URL still works and redirects here.

What it is for:
- Upload an image or file once, then reuse it wherever StoryVenue needs an asset URL — directory Photos, marketing email templates (Image block, Button → File link), lead capture forms (Image block), and Settings → Branding (logo).
- Copy any asset's public URL from the library to paste elsewhere if needed.

What you can upload:
- Images: JPG, PNG, WebP, AVIF, GIF.
- Files: PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPT/PPTX), CSV, plain text.
- Max 25 MB per file.
- Video uploads are not supported.

Auto-populated:
- Anything you upload anywhere in the dashboard automatically lands in your Media library — no extra step needed. That includes:
  - The brand logo on Settings → Branding (re-uploading the logo refreshes the existing library row instead of creating a duplicate).
  - Cover and gallery photos on Venue listing → Photos.
  - Any image you upload through the email or form builder using "Choose from media library" → Upload from device, or via the Image / Button (File link) blocks.

Page features:
- Drag and drop files anywhere on the page to upload — or click Upload.
- Per-file progress bars during upload.
- Search by filename, filter pills (All / Images / Documents), sort (newest, oldest, name, size), and a grid ↔ list toggle (your view preference saves per browser).
- A trash icon on every card lets you delete in one click; the "..." menu adds Copy URL, Download, Open in new tab, and Rename. The menu renders as a portal so it never gets cut off by surrounding cards or by the page edge, and closes automatically when you scroll.
- Rename is display-name only — the public URL doesn't change, so existing links keep working everywhere they're already pasted.

Click any file to preview it
- Images open full-bleed in the preview modal.
- PDFs render in the browser's native PDF viewer.
- Word, Excel, and PowerPoint files render through Microsoft's Office Online embedded viewer (no plugin or download required — it just works).
- Plain text and CSV files render inline with monospaced formatting.
- Anything outside those types shows a friendly "preview not available" with the Download / Open in new tab buttons still accessible.
- The preview modal's toolbar always shows Open in new tab and Download, so you can grab the file regardless of the file type.

Download
- Click Download from the asset menu (or from the preview modal toolbar) and the file saves directly to your computer with its original name. The download streams through the StoryVenue app domain so browsers always trigger a real save instead of opening the file in a new tab.

Used in indicator:
- Each file shows where its URL is referenced today: Brand logo (Settings → Branding), Listing cover/gallery (Venue listing → Photos), Email templates and campaigns, Lead capture forms.
- The Delete confirm modal lists every place the file is used so you can replace those references first if you don't want them to break. If the file you delete is the brand logo, the listing cover image, or in the gallery, those references on the venue record are also cleared so the dashboard never renders a broken image.

Tip: On Venue listing → Photos and the marketing Email/Form Image blocks, use "Choose from media library" to attach an existing asset without re-uploading.`,
      },
      {
        id: 'listing-publish',
        title: 'Publishing and unpublishing your listing',
        tags: ['publish', 'unpublish', 'live', 'visible', 'hidden', 'public'],
        body: `The Publish toggle (top of the Venue listing → Dashboard page) controls whether couples can find your venue on storyvenue.com.

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
- Check the URL uses your exact slug (Venue listing → Dashboard → URL slug field)
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
      {
        id: 'listing-reviews',
        title: 'StoryVenue reviews — testimonials on your public listing',
        tags: ['reviews', 'testimonials', 'stars', 'storyvenue', 'embed', 'public api', 'published', 'rating'],
        body: `Under Venue listing → Reviews (StoryVenue tab) you manage testimonials that couples and clients leave for your venue.

Each review has:
- Star rating (1–5 stars)
- Optional title
- Review text
- Couple name
- Optional wedding date and email

Statuses:
- Published — included in the public JSON API and shown on storyvenue.com.
- Pending — held for moderation (useful if you later allow couples to submit reviews directly).
- Hidden — not shown publicly.

On storyvenue.com, published reviews appear in a single-column list on your venue page. Up to 4 are shown with a "Show all" button to expand the rest.

Showing reviews outside storyvenue.com:
- Paste the iframe snippet from the Reviews page — it points to app.storyvenue.com/embed/listing-reviews/<your-slug>.
- Or call the public JSON endpoint: GET https://app.storyvenue.com/api/public/venues/<slug> — returns published reviews only (your listing must be published).

Database: reviews live in listing_reviews (migration 024). An optional read-only view listing_reviews_public (migration 025) exposes published rows safely to Supabase anon for external sites that query Postgres directly.`,
      },
      {
        id: 'listing-google-reviews',
        title: 'Connecting your Google Business Profile for Google reviews',
        tags: ['google reviews', 'google business profile', 'place id', 'gbp', 'google maps', 'connect google', 'google rating', 'service area business'],
        body: `The Google tab under Venue listing → Reviews lets you connect your Google Business Profile so your Google reviews display on your storyvenue.com listing page.

How to connect:
1. Go to Venue listing → Reviews → Google tab.
2. The tab automatically searches Google for your business using your venue name and location. If your business appears, click "Yes, that's us." That's it — your Google reviews will start showing on your listing.
3. If the auto-search doesn't find your business (common for service-area businesses with no physical address), expand "Can't find it? Paste a Google Maps link instead."
4. In that section, paste any Google Maps URL for your business — a share link (maps.app.goo.gl/...), a full browser URL, or a link from your Google Business Profile. Click Resolve and the system extracts the Place ID automatically.

Service-area businesses (no fixed storefront):
Google's Places API cannot look up service-area businesses by name search. Use the Google Maps link method above. If that also fails, go to Google's Place ID Finder tool (the link appears in the fallback UI), search for your business there, and paste the Place ID directly.

Once connected:
- A green "Connected to Google Business" banner appears.
- StoryVenue fetches and caches your Google reviews.
- Use the refresh icon to force a cache refresh at any time.
- To switch to a different Google Business, click "Change business."

On storyvenue.com:
- Up to 5 Google reviews are shown in a single-column layout below your StoryVenue reviews.
- A "See all Google reviews" button links directly to your full Google Business listing on Google Maps so couples can read all your reviews.
- The footer shows "Showing X of Y Google reviews" so couples know more exist.

Requires GOOGLE_PLACES_API_KEY to be configured on the server. If it's missing, a fallback message appears instead of the search.`,
      },
      {
        id: 'listing-analytics-realtime',
        title: 'Real-time visitor map — see who\'s on your listing right now',
        tags: ['visitor map', 'real time', 'realtime', 'analytics', 'world map', 'live visitors', 'map', 'location', 'who is visiting', 'leaflet', 'geo'],
        body: `The Venue listing → Analytics page includes an interactive world map that shows visitors currently on your storyvenue.com listing in real time.

How to access:
1. Go to Venue listing → Analytics (path: /dashboard/listing/analytics).
2. Scroll down to the "Live visitor map" section.

What you see on the map:
- **Pulsing red dot**: visitors active in the last 90 seconds — they're on your listing right now.
- **Solid indigo dot**: visitors seen in the last 30 minutes — recently active but may have moved on.
- Hover any marker to see the visitor's city, region, country, and how many seconds or minutes ago they were last active.
- The map always shows even with no recent visitors. An overlay message appears when no one has visited in the last 30 minutes.

Navigation:
- **Zoom in / out**: use the + and − buttons (top-left of the map), or scroll with your mouse/trackpad.
- **Pan**: click and drag anywhere on the map.
- City-level detail is visible when zoomed in.

How it works:
- Visitors are tracked anonymously via a heartbeat signal on the listing page.
- Their city, region, country, latitude, and longitude are resolved from their IP address (no personal data is stored — only geographic location).
- Data refreshes automatically in the background while you have the analytics page open.

Privacy: only approximate location data (city-level) is captured. No names, emails, or device identifiers are linked to map markers.`,
      },
      {
        id: 'listing-analytics-retention',
        title: 'Daily views & analytics retention — does StoryVenue save historical traffic?',
        tags: ['analytics', 'history', 'historical', 'retention', 'daily views', 'data retention', 'page views', 'unique visitors', '30 days', '90 days', '365 days', 'archive', 'old data', 'last 30 days'],
        body: `Yes — every event on your storyvenue.com listing is saved permanently in the listing_events table. There is no auto-prune, no TTL, no cron job that deletes old rows. The Analytics dashboard's date-range picker (1 / 7 / 14 / 30 / 60 / 90 days) is purely a query window, not a retention boundary.

What's tracked
- Page views (every visit to your public listing)
- Listing impressions (every time your listing appears in directory search results)
- Unique sessions (per anonymous browser-tab session)
- Scroll depth (25% / 50% / 75% / 100%)
- Photo views, FAQ opens, social clicks
- Contact form opens & submissions
- Device type, referrer / UTM source, country / region / city / lat-lng (resolved from IP, never personal data)

How long we keep it
- Forever. There is no deletion policy. A 365-day lookback is supported today, and longer is technically possible — we just haven't added the UI for it yet.
- The only way historical data is ever removed is if the venue itself is deleted (ON DELETE CASCADE on the listing_events table).

Why the "Daily views" chart sometimes looks sparse
- The chart shows the full requested window (e.g. all 30 days for a 30-day query) with zeros backfilled for days that had no traffic. So a quiet venue will see a flat line at zero with a couple of spikes — that's NOT missing data, it's a faithful picture of "no one visited that day."
- If you see only one day of data on a 30-day chart, that just means your listing was visited on that one day in the last month. Switch to a longer window (60 / 90 days) to see more history.

Test that tracking is working
- Open your public listing in an incognito tab → wait ~5 seconds → return to the analytics page and refresh. You should see the unique-sessions counter go up and a new dot on today's column in the Daily views chart.
- The "Live visitor map" updates within ~10 seconds and is the fastest way to confirm the tracker is recording your visit.

If you're convinced data should be there but isn't
- Verify your listing is published (Venue listing → Dashboard → Published toggle). Tracking still records events for unpublished listings, but no real visitors can reach them.
- Make sure your tracker isn't blocked by an ad-blocker on your test browser (the tracker is first-party so most ad-blockers don't touch it, but some aggressive ones do).
- Open Ask AI and paste your venue slug — the assistant can pull your raw event count for the last 30 days from the database.`,
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
        tags: ['leads', 'pipeline', 'kanban', 'sales', 'inbox', 'directory leads', 'form', 'space', 'contact stage'],
        body: `The Leads page is your sales pipeline. Open it from the sidebar → Leads.

Every contact is always visible in some pipeline stage. When you open Leads, StoryVenue reconciles your leads and contacts so that every contact with a real email shows up in the pipeline, and every lead is snapped to the pipeline + stage stored on its matching contact profile. If you move a contact's stage on the Contacts page, the Leads Kanban reflects it — and vice versa. Leads pointing at a deleted pipeline/stage automatically heal to the default pipeline's first stage instead of disappearing from the board.

Two ways leads arrive:
- Inquiries submitted through your storyvenue.com directory listing show up automatically.
- You can add leads by hand with the "+ Add Lead" button in the top-right. The New Lead modal includes a Space picker and a Pipeline / Stage picker. Choose "None" as the stage to track a contact without placing them in an active pipeline column — they'll appear only on the Contacts page, not the Kanban.

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

The pipeline picker (top-right) lets you switch between multiple pipelines. Everyone starts with a default "Sales Pipeline" with 8 stages: Lead, Conversations Started, Lead Contacted, Tour Booked, Proposal Sent, Wedding Booked, Follow up, Not Interested. You can rename, add, remove, and reorder stages — or create a brand-new pipeline — with the Edit button.

When a customer profile exists with the same email as a lead, updating the stage on the customer profile or moving the card on the Kanban can keep both in sync (see the customer profile pipeline section).

Pipeline intelligence — Below the page header, an insights strip summarizes open pipeline (sum of opportunity values), weighted pipeline (deal value × each stage's win probability; see next articles), rough booked revenue by referral label vs directory-sourced leads (from paid proposals matched by email), and a simple ROI vs optional listing marketing monthly spend when that budget is stored on your venue. This is directional, not accounting-grade.

Tags & attribution — Leads support marketing tags and trigger links (Marketing) for attribution; the drawer can show personalized trigger URLs for this lead.`,
      },
      {
        id: 'leads-crm-intelligence',
        title: 'Pipeline intelligence, owners, audit trail, and revenue visibility',
        tags: ['weighted', 'forecast', 'roi', 'audit', 'owner', 'assign', 'hide revenue', 'permissions', 'log call', 'insights', 'listing spend'],
        body: `The Leads page includes tools for forecasting, accountability, and team permissions.

Weighted pipeline
- Each stage has a win probability (0–100%). If unset, StoryVenue uses sensible defaults from the stage kind (open vs won vs lost).
- Weighted amounts multiply opportunity value by that probability. You'll see wtd on Kanban column headers and on cards, plus a venue-wide weighted total in the insights strip.

Deal value
- Set Opportunity value on the lead (drawer or when adding a lead). Cards and list rows show the amount unless hidden by role (below).

Assigning an owner
- Open the lead drawer → Owner → choose an active team member or Unassigned. Initials can appear on Kanban cards.

Activity & audit
- The drawer includes Activity & audit — a chronological log when someone changes stage, opportunity value, or owner, and when someone uses Log a call (free-text summary). This is separate from the Timeline (notes, tasks, marketing events, etc.).

Who can see dollar amounts
- The venue owner can enable Hide $ per team member on Settings → Team (for active members who are not the Owner role). Those users see ••• instead of opportunity and weighted money lines in Leads.

Listing spend & ROI
- Venues can store an optional listing marketing monthly spend on the account. When present, the Leads insights strip compares rough directory-attributed booked revenue to that budget as a simple ROI hint.`,
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
- Total opportunity value for that column, and a weighted (wtd) line derived from each card's value × stage win probability (unless dollars are hidden for your role)

Cards show the lead's name, venue, email, phone, wedding date, note count, assignee initials when an owner is set, opportunity value with a wtd line under it, marketing tags, and date created.

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
- Change color — click the color swatch next to the stage name to open a color picker popover. Inside the popover you get the native color wheel, a Hex code field (type any color like #1b1b1b), and a grid of preset swatches. Press Enter or click outside to commit. The same popover is available when adding a new stage.
- Stage kind — each stage is classified as Active (open), Won, or Lost. Won stages count as booked revenue in stats; Lost stages are excluded. Change the dropdown next to each stage.
- Win probability — used for weighted pipeline totals on the board and in insights. Advanced accounts may set a 0–100% value per stage (API); otherwise defaults apply from the stage kind.
- Reorder — use the up/down arrow buttons.
- Delete — trash icon. Any leads in that stage become unassigned and show in the first column.
- Add — type a name in the "New stage" box, pick a color from the same popover, and click Add stage.

Creating a new pipeline:
- Type a name in the "New pipeline name" box on the left panel → Add pipeline
- New pipelines start with the default 8-stage template — edit freely from there.

The "None" stage
- Both the New Lead and New Contact forms include a "None" option in the Stage dropdown. Choosing None saves the contact without placing them in any pipeline column — they appear on the Contacts page but not on the Kanban board. Useful for contacts you want to track without actively working as a pipeline lead.

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
- Tap any stage chip to move this lead to that stage. The chip lights up in the stage's color. Stage changes are recorded under Activity & audit.

Owner
- Use the Owner dropdown to assign the lead to an active team member (or leave unassigned).

Editable fields (click to edit, blur or press Enter to save)
- First name, Last name
- Email, Phone
- Opportunity value — expected deal size in dollars (may show as hidden if your role has Hide $ enabled by the venue owner)
- Venue name, Venue website (URL)
- Wedding date, Guest count
- Referral / partner (free text)

Marketing tags
- Add or remove tags; create new tags from the lead or manage them under Marketing → Trigger Links & Tags.

Inquiry message
- If the lead came from the directory, their original message is shown here as read-only context.

Timestamped notes
- Type in the "Add a note…" box and click Add note.
- Every note is stamped with the exact time it was created.
- Edit (pencil) or delete (trash) your own notes.
- Notes are sorted newest-first.

Activity & audit (above the timeline)
- Lists who changed stage, opportunity value, or owner, plus Log a call entries you add here.
- Type a short summary and click Log a call — it appears in this feed and helps with handoffs.

Quick actions
- Reply (opens your email client with the lead's email pre-filled)
- Call (tap-to-dial on mobile)
- Listing (jumps to the directory page the lead came from)
- Create customer (saves this lead as a customer in your CRM)
- Schedule appointment (see next article)
- Delete — removes the lead permanently (requires confirmation). Deleting a lead also removes the matching contact record.`,
      },
      {
        id: 'leads-card-actions',
        title: 'Lead card quick action buttons',
        tags: ['lead card', 'quick actions', 'call', 'sms', 'email', 'notes', 'tags', 'calendar', 'kanban card'],
        body: `Every lead card on the Kanban board has a row of quick action buttons that let you take common actions without opening the full lead drawer.

How to access card actions
On desktop: hover over any lead card — the action buttons appear at the bottom of the card.
On mobile: tap the card once to reveal the action bar.

Available actions
- Call — opens the quick log-a-call input to record a phone conversation on this lead
- SMS — opens a quick SMS composer to text the contact via your connected Legacy messaging number
- Email — opens a quick email composer to send a message to the contact
- Notes — opens a quick note input so you can jot something without opening the drawer
- Tags — manage the contact's marketing tags directly from the card
- Calendar — opens the New Event modal with this contact pre-filled so you can book an appointment instantly

Why use card actions?
When you're scanning the Kanban board and need to take a quick action on several leads in a row, these buttons save you from opening and closing the full drawer for each one. They're designed for speed when you're in a workflow.

The full lead drawer (click the card title or name) still gives you access to everything — notes history, audit trail, full edit fields, and linked proposals.`,
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
- "Explain weighted pipeline vs open pipeline"
- "What's my directory vs referral booked revenue?" (insights strip uses your data; Ask AI also has leads context when you're on this page)

Ask AI uses server-side pipeline data when you're on the Leads page (totals, recent leads, notes snippets). It does not change leads for you — use the Kanban board or drawer. If your user session hides revenue in the UI, you may still get numeric answers in chat depending on backend context; treat the dashboard as the source of truth for what your role may view.

If AI gives a stale answer, refresh the page to reset the context.`,
      },
      {
        id: 'leads-notifications',
        title: 'Lead notification emails',
        tags: ['notification', 'email', 'lead email', 'alert', 'inquiry email', 'not receiving'],
        body: `When a new lead comes in, StoryVenue emails you a formatted summary so you don't need to open the dashboard every hour.

The email includes the couple's name, contact info, wedding date (if given), estimated guest count, booking timeline, and their full message. A "View in dashboard" link jumps straight to the lead.

Configure the notification email:
- Sidebar → Venue listing → Dashboard → Inquiry notifications section
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
        id: 'leads-space',
        title: 'Capturing a space on a new lead',
        tags: ['space', 'venue space', 'new lead', 'primary space', 'barn', 'garden', 'ballroom', 'add space', 'edit space'],
        body: `The + Add Lead modal on the Leads page includes a Space field so you can record which venue space the couple is most interested in at the moment the inquiry comes in — no extra step later.

How it works
- Open the Space dropdown and pick any saved space (Barn, Garden, Ballroom, etc.).
- Click Manage next to the field to add, rename, recolor, or remove spaces inline — you don't have to jump to the Calendar page. The exact same controls you already use when creating a calendar event are mirrored here.
- Leave it empty if the couple hasn't decided yet; you can fill it in later from the lead drawer.

Why it matters
- Space is carried through to calendar events and proposals, so when you book a tour or send a quote the correct space is already attached.
- Insights and reports can slice inquiry volume by space to help you see which areas are driving demand.

If the field looks missing
- This feature needs a one-time database migration (migrations/049_leads_space_id.sql). Until your workspace runs it, the API silently drops the space on new leads so nothing breaks — but the picker will look like it isn't saving. Apply the migration on Supabase and the field starts sticking.`,
      },
      {
        id: 'leads-to-proposal',
        title: 'Turning a lead into a customer and proposal',
        tags: ['convert', 'proposal', 'customer', 'lead to customer', 'book', 'quote'],
        body: `Leads are the top of your funnel. Once a lead is qualified, here's the recommended path through StoryVenue:

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
    id: 'contacts',
    label: 'Contacts',
    iconName: 'Users',
    color: '#10b981',
    articles: [
      {
        id: 'cust-add',
        title: 'Adding a contact',
        tags: ['add contact', 'new contact', 'create contact'],
        body: `Go to Contacts in the sidebar. Click the "+ Add contact" button (top right). You can also use Import CSV or Export CSV for bulk work.

The New Contact form is identical to the New Lead form and includes:
- First Name (required)
- Last Name (required)
- Email (required)
- Phone
- Pipeline and Stage (same pipelines used on the Leads page — pick "None" to track without placing them in an active pipeline stage)
- Address, City, State, Zip

Click Save. The contact appears in your list immediately.

To delete a contact: click the red trash / Delete button on the right side of the contact's row in the table. You'll be asked to confirm. Deleting a contact also removes their matching lead record.

Tip: You can also create a contact inline while building a new proposal or invoice — just type their name in the contact search field and select "Add new contact".`,
      },
      {
        id: 'cust-search',
        title: 'Searching and filtering contacts',
        tags: ['search', 'find contact', 'filter'],
        body: `On the Contacts page there is a search bar at the top. Type any part of a name, email, or phone number and results filter in real time.

Results are paginated (20 per page). Use the Previous / Next buttons at the bottom to navigate.`,
      },
      {
        id: 'cust-profile',
        title: 'Contact profile — overview and tabs',
        tags: ['contact profile', 'crm', 'profile', 'tabs', 'overview', 'history', 'edit note', 'edit notes', 'new proposal', 'new invoice'],
        body: `Click a contact's name to open their full profile. Contacts you see on this list come from three sources — storyvenue.com signups, LunarPay integration, and Legacy imports — all unified into one record per person. The profile has six tabs:

Overview
- Edit contact info inline (name, email, phone, address)
- Add and view a partner / second contact (important for wedding couples)
- Wedding Details block: wedding date, ceremony type (ceremony only / reception only / both), guest count, assigned venue space, rehearsal date, day-of coordinator name and phone, catering notes
- Referral source (how they found you)

Notes
- Timestamped internal notes. Each note can be edited inline (pencil icon) with Save / Cancel.

Activity
- Unified reverse-chronological timeline of every interaction: proposals, payments, notes, files, tasks, Calendly bookings, pipeline stage changes, and more.

Payments
- All proposals and invoices linked to this contact
- Installment schedules with payment breakdown
- Copy link, resend, view invoice, issue refund
- Use the "New Proposal" and "New Invoice" buttons at the top of this tab to jump straight to the proposal/invoice builder with the contact's name and email pre-filled

Tasks
- Create tasks with optional due dates (e.g. "Collect final guest count")
- Check off completed tasks — they collapse but remain visible, and can be unchecked or reopened later
- Edit a task title or due date inline via the pencil icon
- Overdue tasks show in red

Documents
- Upload files: contracts, floor plans, vendor agreements, insurance certificates, photos, or other
- Each file has a type and a status (Pending / Received / Approved)
- Click a filename to download; update status inline; delete files

Below the main header row, the Pipeline section lets you choose which sales pipeline applies (same pipelines you manage under Leads — e.g. default "Sales Pipeline") and shows stage pills for that pipeline. Click a pill to move the contact to that stage; the selection saves to the server and the UI updates right away. If a lead exists with the same email, you may see a note that the profile is linked to a lead and stages can stay in sync both ways.

The header also shows a stage badge, referral source when set, and KPIs: proposals count, total paid, pending amount, open tasks.

On the Contacts list page itself, each row also has "Create Proposal" and "Create Invoice" shortcut buttons that open the payment builder with the contact pre-selected.`,
      },
      {
        id: 'cust-pipeline',
        title: 'Sales pipeline, stages, and referral source',
        tags: ['pipeline', 'stage', 'lead', 'referral', 'source', 'funnel', 'crm', 'kanban', 'sales pipeline'],
        body: `Customer profiles use the same configurable sales pipelines as the Leads page (Kanban). Your venue can have one or more pipelines; each pipeline has ordered stages with names and colors (the default template often includes stages like Lead, Conversations Started, Lead Contacted, Tour Booked, Proposal Sent, Wedding Booked, Follow up, and Not Interested — you can rename, add, remove, or reorder them from Leads).

On the customer profile:
1. Choose the Pipeline from the dropdown (e.g. "Sales Pipeline").
2. Click a stage pill to move the customer to that stage. The UI updates immediately and the change is saved.

If a lead in your inbox shares the same email as this customer, the profile may show that it is linked to a lead — stage can sync both ways between Leads and the customer record.

Referral source (how the couple found you) is separate from pipeline: Instagram, Google, Wedding Wire, The Knot, Referral, Venue Website, Facebook, or Other. Set it from the Overview tab / contact area.

If pipeline or stage changes fail with a database-related error, your environment may need the latest database migration applied — contact whoever manages your StoryVenue database or support.`,
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
      {
        id: 'cust-dnd',
        title: 'Do Not Disturb (DND) — Legacy messaging sync',
        tags: ['dnd', 'do not disturb', 'opt out', 'compliance', 'sms opt out', 'legacy dnd', 'block messages', 'unsubscribe', 'channel dnd', 'messaging compliance'],
        body: `The Do Not Disturb (DND) section appears at the bottom of every contact's profile page and in the profile drawer (accessible from Conversations). It lets you see and control which messaging channels are blocked for that contact.

Where to find it
- Contact profile page (Contacts → click a name → scroll to the bottom)
- Profile drawer (Conversations → open a thread → click Profile → scroll to bottom)

The DND channels
For accounts connected to StoryVenue Legacy messaging, you can control DND per channel:
- All — master switch that blocks every channel
- Email — blocks outbound email to this contact
- Text / SMS — blocks outbound SMS
- Calls & Voicemail
- Google Business Profile (GBP)
- Inbound Calls & SMS — blocks inbound notifications as well

Enabling any DND channel
Toggle the switch on for the channel you want to block. The change is saved locally and synced to your StoryVenue Legacy sub-account automatically. If the sync fails (e.g. due to a temporary connection issue), a warning appears and the setting retries on the next contact refresh.

Compliance enforcement
This is a critical compliance feature. When SMS DND is enabled for a contact, StoryVenue will block all outbound SMS to that number — even if a notification template or workflow would otherwise send one. The contact will not receive the message. This applies to calendar reminder SMS, confirmation SMS, and any workflow SMS steps.

Legacy messaging vs. SaaS-only accounts
DND is currently available for venues using StoryVenue Legacy messaging. Venues on the native SaaS-only plan will have their own DND solution in a future release.

System tags auto-applied on DND changes
When you enable SMS DND: the "sms_opted_out" tag is added to the contact.
When you enable DND All: the "do_not_contact" and "legacy_dnd_active" tags are added.
These tags can be used in workflows to trigger follow-up sequences or remove the contact from campaigns.`,
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
        body: `Go to Settings → Branding. The page is ordered top-to-bottom in the natural setup flow:

1. Contact Information — business name, email, phone, website, address, and a footer note. These appear on every invoice, proposal, and email footer.
2. Brand Settings — upload your logo (PNG, JPG, or SVG, max 5MB). You can also pick from your media library (Venue listing → Media library — JPEG, PNG, WebP, AVIF, GIF; no video). Your logo shows in a white header with a colored strip underneath in every email.
3. Color Presets — click any preset (Default, Ivory & Gold, Sage & Stone, Blush & Cream, Coastal Blue, Black & Champagne, Warm Earth) to set the Primary/Button, Background, and Button Text colors all at once. Saves automatically when clicked.
4. Social Networks — paste your social profile URLs once. Every marketing-email Social block reads from this list automatically.
5. Time zone — used for scheduling, calendar, and appointment times.

The live Preview panel on the right updates in real time as you change colors and contact info.

Where did "Custom Colors" and the dedicated "Brand Colors" palette go?
- Custom hex inputs for the three brand colors were removed — Color Presets cover the common combinations, and you can fine-tune individual colors anywhere a color picker appears (email blocks, forms, etc.).
- The brand-color palette no longer has its own card on this page either. Save / remove brand colors directly from any color picker — they sync across every other picker in the app automatically.

Changes save automatically as you edit (presets, social URLs, timezone) or after a brief debounce (text fields). The "Save Branding Settings" button at the top forces an immediate save.

Note: Branding settings are visible to owners and admins only.`,
      },
      {
        id: 'brand-colors-saved',
        title: 'Saving brand colors — palette across the app',
        tags: ['brand colors', 'palette', 'saved colors', 'color picker', 'hex', 'venue colors', 'reusable colors'],
        body: `Your venue keeps a per-venue palette of saved brand colors. There is no dedicated "Brand Colors" page in settings — the palette lives inside every color picker, so you save and reuse colors right where you're working (email builder, form builder, etc.). Once a color is in the palette it appears in every other color picker across the app.

Adding a color
- Open any color picker (email block inspector, form field, etc.).
- Pick or type a hex code, then click the bookmark/save icon next to the swatch. The color is added to your palette instantly and shows up in every other picker right away.

Removing a color
- Inside any color picker, hover any saved swatch in the palette row and click the small × that appears. Removing a color does not change any email, form, or proposal that already uses it; it just stops showing up in pickers.

Limits
- Up to 50 colors per venue.

Where it shows up
- Flodesk-style color picker inside every email block inspector — your saved colors appear at the bottom of the picker so you can apply them in one click.
- Lead capture / form builder color pickers.
- Anywhere the app shows a color picker.`,
      },
      {
        id: 'brand-social-networks',
        title: 'Social network links — used by marketing emails',
        tags: ['social networks', 'social links', 'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'twitter', 'x', 'pinterest', 'website', 'branding', 'email social block'],
        body: `Settings → Branding → Social Networks is where you store your venue's social profile URLs once. Every marketing email Social block reads from this list automatically, so you never have to set them per email.

Supported platforms
Instagram, Facebook, TikTok, LinkedIn, YouTube, Twitter / X, Pinterest, Website.

Adding a link
1. Settings → Branding → Social Networks.
2. Pick a platform.
3. Paste the URL. If you forget the https:// prefix, the system adds it automatically.
4. The save is debounced — your changes auto-save after a brief pause.

Each row shows an "Open link" button (opens the URL in a new tab to verify) and a "Remove" button.

Limits
- One URL per platform.
- Up to 8 social links total per venue (one per supported platform — most venues use 3–5).

Where it's used
- Marketing email Social block — every campaign, template, and automation that includes a Social block automatically renders icons + links from this list. This is the single source of truth for which platforms exist and what URLs they point to.
- Per-block show / hide — inside the email builder, the Social block's Links tab has an eye toggle next to every platform. Hiding a platform there suppresses it for that one email only; the branding registry is unchanged. Use it when a particular campaign should only spotlight a subset of your social networks.
- The email builder Social inspector links straight to this section for one-click management.

Anchor / deep link
Settings → Branding → Social Networks is anchored at #social-networks, so the email builder's "Manage in branding" CTA jumps you directly to that card on the Branding page.

Empty state
If you don't have any social links saved yet, the Social block in your email shows a hint in the editor pointing you back to Branding. In the actual sent email the Social block renders nothing — it does not ship a placeholder to your recipients.`,
      },
    ],
  },
  {
    id: 'marketing-email',
    label: 'Marketing Emails',
    iconName: 'Send',
    color: '#0ea5e9',
    articles: [
      {
        id: 'me-overview',
        title: 'Marketing email overview — Templates, Campaigns, Automations',
        tags: ['marketing email', 'campaigns', 'broadcast', 'newsletter', 'flodesk', 'templates', 'automations', 'preferences', 'overview'],
        body: `The Marketing flyout in the sidebar groups every email-marketing tool into four pages:

1. Templates (Marketing → Email Templates) — your reusable design library. Build a template once with the drag-and-drop builder, then reuse it for any campaign.
2. Campaigns (Marketing → Email Campaigns) — one-off broadcasts you send to a segment of your contacts/leads. The campaigns list has a trash icon on every row so you can delete any campaign (with a confirm prompt) directly from the list.
3. Automations (Marketing → Email Automations) — multi-step drip sequences triggered by an event (new lead, tag added, date hit, etc.).
4. Preferences — recipients can self-manage their subscription via a public preference center linked from every email footer.

All four use the same Flodesk-style block editor so the experience is identical no matter where you are. Templates open at /dashboard/marketing/email/templates, campaigns at /dashboard/marketing/email/campaigns, automations at /dashboard/marketing/email/automations.

Marketing emails always pull your venue branding automatically — logo, brand colors, brand fonts, address, and social network links — so every send stays on-brand without touching settings.

Where things live:
- Brand colors saved palette → save and reuse colors directly from any color picker (email block inspector, form builder, etc.); the palette is shared across every picker in the app.
- Social network links → Settings → Branding → Social Networks. Power the Social block and footer.
- Address used in the Address block → Settings → Branding (Contact Information) or the venue's primary location.
- Compliance footer (unsubscribe + manage preferences) is appended automatically; recipients land on a public Preferences page hosted on app.storyvenue.com.`,
      },
      {
        id: 'me-builder',
        title: 'Using the email builder (Flodesk-style)',
        tags: ['email builder', 'editor', 'drag and drop', 'canvas', 'blocks', 'palette', 'inspector', 'preview', 'undo', 'redo'],
        body: `Open any template, campaign, or automation step and you land in the email builder — a three-pane Flodesk-style editor:

Left: a thin sidebar with view toggles (Desktop / Mobile preview) and undo/redo.
Center: the live canvas showing exactly how the email will render. Click any block to select it and edit inline (text blocks let you type directly on the canvas; buttons let you edit the label live).
Right panel: the inspector. When nothing is selected, the right panel shows the Block Palette — a grid of every block type you can add. When a block IS selected, the right panel switches to that block's inspector with tabs (Primary, Block, and any block-specific tabs like Icons / Links / Block for the social block).

Adding blocks
- Drag any block tile from the right-panel palette and drop it onto the canvas. A blue drop indicator line shows exactly where the block will land — you can drop at any position (including the very last slot).
- Or click the small "+" button between any two blocks to insert directly there.

Editing blocks
- Single-click a block to select it; the right panel becomes that block's inspector.
- Hover any block to see a side toolbar with Move up / Move down / Duplicate / Delete buttons. The "save as template" heart was removed — saving the entire email is what you want, not individual blocks.
- Drag a selected block to a new position by its drag handle.
- The drop indicator and selection border use a #1b1b1b / blue accent so it's clear what's about to move.

Right-panel inspector tabs
Every block has a Block tab with shared settings — background color, top/bottom padding, side gutters. Block-specific tabs (Font, Icons, Links, Address, etc.) appear before the Block tab.

Header bar
- Back arrow returns you to the Templates / Campaigns / Automations list (the label says "Back" rather than the form name to keep it tidy).
- The step nav (Design / Recipients / Review) is centered over the canvas, offset for the right panel so it stays visually balanced.
- The preview button (eye icon, labelled "Preview") and Send pin to the far right.

Live preview & send-test
Click the eye icon to open the preview modal. It renders inside an iframe so links and embedded videos actually work — exactly what your recipient will see in their inbox. There's a Send-test form right inside the modal: enter any email address and click Send Test to fire a real email through your normal pipeline. The preview header and backdrop use #1b1b1b for a neutral, distraction-free preview.

Undo / Redo
The left sidebar has an undo/redo bar. Every edit (block add, delete, move, style change, text edit) is captured.

Saving
Templates and campaigns autosave as you edit. The header shows the save state.`,
      },
      {
        id: 'me-blocks',
        title: 'Block types in the email builder',
        tags: ['blocks', 'block types', 'heading', 'text', 'button', 'image', 'video', 'divider', 'spacer', 'social', 'address', 'columns', 'html'],
        body: `The block palette in the right panel offers every supported block. Drag any tile onto the canvas to add it.

Available blocks:
- Heading (H1 / H2 / H3) — large headline text. Buttons in the format toolbar set both the level and the matching font size so it always takes visual effect.
- Text — paragraph copy with full rich-text formatting (bold, italic, underline, lists, links, alignment, font, color). The format toolbar includes an AI refine button (pencil icon) that rewrites your selection.
- Button — call-to-action button. Full Flodesk-style tabbed inspector with presets, saved styles, fonts, colors, padding, border radius, and a link pill that supports either a URL or a file from your media library (see the Button block article).
- Image — single image with media-library picker. Supports alignment, padding, link wrapping, and alt text.
- Image grid (multi-image) — 2-, 3-, or 4-column image rows with even gutters between rows and columns.
- Video — 16:9 YouTube-style player. Paste any YouTube, Vimeo, or Loom URL. The thumbnail + play button render on the canvas, and the actual video plays in preview and sent emails (see the Video block article).
- Divider — horizontal rule. Flodesk-style settings: thickness, style (solid/dashed/dotted), color, width %, alignment, top/bottom padding, background color.
- Spacer — vertical empty space. Two settings: Background color and Height (drag the slider).
- Social — row of social network icons. Pulls links from your branding settings; styling controlled by a 3-tab inspector (Icons / Links / Block). The Links tab has an eye toggle next to every platform so you can show or hide a specific platform from this email without touching your branding registry. See the Social block article.
- Address — your venue address block. 3-tab inspector (Font / Address / Block). Pulls address from your branding settings; the "Manage my address" button jumps to Settings → Branding.
- Columns — split a row into 2 or 3 columns and drop other blocks inside.
- HTML — raw HTML for power users.

Per-block settings — every block's right-panel inspector ends with a "Block" tab containing the shared settings: top padding, bottom padding, side gutters, and background color. This keeps spacing consistent across blocks and blocks the canvas from drifting visually.

Aligning content — every block that supports alignment (heading, text, button, image, video, social, address) uses the same Flodesk-style alignment selector: four icon buttons (Left, Center, Right, and Full) with a rounded pill highlight on the active option.`,
      },
      {
        id: 'me-block-button',
        title: 'Button block — presets, saved styles, link pill',
        tags: ['button', 'cta', 'call to action', 'preset', 'saved styles', 'link', 'file link', 'media library'],
        body: `The Button block uses a tabbed inspector with three sections:

Style — Presets, Saved styles, and full custom controls.
- Presets are pre-designed button looks (Solid, Outline, Pill, Underlined link, etc.). Click a preset to apply it instantly.
- Saved styles let you keep your venue's preferred buttons. After tweaking a button, click the "Save current style" pill to add it to a modal popup of saved styles. From the same modal you can apply or delete any saved style.
- Custom controls: font family (any Google Font), weight, size, letter spacing, text color, background color, border color, border width, border radius, vertical padding, horizontal padding.

Link — the link pill supports two link types:
- URL — paste any URL. Toggle "Open in new tab" if you want target=_blank.
- File — pick a file (PDF, image, etc.) from your venue Media library. The button then links straight to that file's public URL.
The link pill is compact and matches the Flodesk reference.

Block — shared block settings (alignment, top/bottom padding, side gutters, background color).

Live editing
Click the button on the canvas and you can edit the label inline — no need to open a separate dialog. The font, color, and other style changes update in real time as you adjust the inspector.`,
      },
      {
        id: 'me-block-image',
        title: 'Image block — media library + multi-image grid',
        tags: ['image', 'photo', 'media library', 'image grid', 'multi-image', 'columns', 'gutters', 'alignment'],
        body: `The Image block is unified across the entire builder around the shared VenueMediaPickerModal — the same picker used in branding, listing photos, and lead capture forms. Click "Choose from media library" to pick an image you already uploaded, or upload a new one in-place.

Single image
- Replace image — opens the media picker.
- Alignment — Left / Center / Right (matches the standard alignment selector).
- Width — slider for max width within the canvas.
- Padding — top, bottom, side gutters in the Block tab.
- Link — wrap the image in a link (URL).
- Alt text — for accessibility.

Multi-image grid
The Image block can also display a grid of images:
- 2, 3, or 4 columns.
- Multiple rows.
- Even gutters between every row AND every column so the spacing stays balanced.
- Each cell uses the media picker just like a single image.

Supported formats: JPEG, PNG, WebP, AVIF, GIF (no video). Max 10MB per image. Files live in the shared Media library so you can reuse them across emails, listing photos, branding logo, and lead capture forms.`,
      },
      {
        id: 'me-block-video',
        title: 'Video block — YouTube, Vimeo, Loom',
        tags: ['video', 'youtube', 'vimeo', 'loom', 'embed', 'player', '16:9', 'thumbnail'],
        body: `The Video block renders a 16:9 YouTube-style player with a play-button overlay. Paste any video URL into the inspector and the builder auto-detects the provider:
- YouTube — short links, watch links, and embed links all work.
- Vimeo — standard vimeo.com URLs.
- Loom — share links from loom.com.

What renders where:
- Live canvas — the thumbnail with a play button overlay. Clicking the block on the live canvas SELECTS it for editing; it does NOT open the video. This stops accidental navigation while you're laying out the email.
- Preview modal — the video plays inline because the preview is a real iframe.
- Sent emails — the thumbnail links out to the original video URL, so recipients click through and watch in their browser.

Empty state — when no URL is set, the canvas shows a small hint reading "Add a YouTube, Vimeo or Loom URL". The hint is positioned so the play button overlay never obscures it.

Settings:
- Video URL.
- Thumbnail override (paste a custom thumbnail URL or pick from media library).
- Alignment (Left / Center / Right / Full).
- Width and Block-tab padding.`,
      },
      {
        id: 'me-block-social',
        title: 'Social block — venue-managed social network links',
        tags: ['social', 'social links', 'social block', 'icons', 'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'website', 'branding', 'hide platform', 'show hide social'],
        body: `The Social block renders a row of social network icons in your email — pulled automatically from your venue Branding settings, so you set them once and every campaign stays in sync.

Where you register links — Settings → Branding → Social Networks. From the Social inspector inside the builder, click "Manage in branding" on the Links tab to deep-link straight there. The branding registry is the single source of truth for which platforms exist; the Social block can NOT add new platforms or change a URL — that's by design so newsletters never go out with stale URLs.

Per-block show / hide
The Links tab shows every platform you have registered, with an eye toggle next to each row. Click the eye to hide that platform from THIS email only — your branding registry stays untouched, and other emails / blocks continue to show it. Useful when one campaign should only highlight, say, Instagram and TikTok while a different newsletter shows everything. The header counter ("X of Y visible") reflects the current state at a glance, and a "Show all" link reappears any rows you've hidden. Hidden = greyed + struck-through in the inspector, dropped from the live canvas, dropped from the preview iframe, and dropped from the actual sent email.

Inspector tabs
- Icons — choose the look: outline (no chip), filled circle, or solid circle. Pick a color from the Flodesk color picker, a size (S / M / L), an alignment (Left / Center / Right / Full), and adjust spacing between icons. The size and style swatches are visual-only (no text labels) and are all rendered at the same dimensions for consistency.
- Links — list of your configured platforms (Instagram, Facebook, TikTok, LinkedIn, YouTube, Twitter/X, Pinterest, Website) with a "Manage in branding" CTA at the top and per-row eye toggles to hide/unhide each platform from this block.
- Block — shared block settings (background, padding).

Visual style — minimalist Flodesk glyphs (by design)
The social icons are intentionally drawn in a clean Flodesk-style minimalist set rather than each platform's full brand mark. Letter glyphs render as solid letterforms — Facebook is a lowercase "f", LinkedIn is a lowercase "in", Pinterest is a stylized "P" with a see-through eye, TikTok is a "d" with a small flag, Twitter/X is a thick angular "X". Shape glyphs use clean stroked outlines — Instagram is a camera silhouette, Globe (Website) is a circle with equator + meridian, YouTube is a rounded rectangle with a small filled play triangle. This gives every email a consistent editorial look that matches modern newsletter design conventions; if you wanted full multi-color brand logos they would clash with most email aesthetics and recipients still recognize the simplified marks.

Rendering parity
Editor canvas, preview iframe, and the actual delivered email all use the exact same SVG paths, chip dimensions, and stroke widths. Filled-circle icons use a glyph color that automatically flips between black and white based on the chip color so they always read clearly. Outline-only icons use a slightly thicker stroke at small sizes for better visibility.

Empty state
- In the editor canvas, when no social links are configured the block shows a hint pointing the user to Branding so they know what to do.
- In the actual sent email, if Branding has no social links the entire Social block renders nothing — no placeholder text ever ships to a recipient.`,
      },
      {
        id: 'me-block-address',
        title: 'Address block — pulled from branding',
        tags: ['address', 'physical address', 'location', 'mailing address', 'compliance', 'branding'],
        body: `The Address block displays your venue's physical address inside an email — useful for compliance with anti-spam laws (CAN-SPAM, CASL) which require a physical mailing address in every commercial email.

Source of truth
The address is pulled from your venue Branding settings (Settings → Branding → Contact Information). The Address block is read-only inside the builder; click "Manage my address" on the Address inspector tab to jump straight to the Branding page and update it once for every campaign.

3-tab inspector
- Font — typography for the address text: font family, size, weight, color, letter spacing.
- Address — the address preview with a single "Manage my address" button (background #1b1b1b for a clean neutral look). Copy renders compactly — typically two short lines instead of four.
- Block — shared block settings (alignment, top/bottom padding, side gutters, background color).

Compliance
You should keep an Address block in every marketing email. The same applies to the unsubscribe footer added automatically by StoryVenue (see the email compliance article).`,
      },
      {
        id: 'me-block-divider-spacer',
        title: 'Divider and Spacer blocks',
        tags: ['divider', 'spacer', 'separator', 'horizontal rule', 'whitespace', 'gap'],
        body: `Two utility blocks for breaking up content in your email.

Divider — a horizontal rule. Flodesk-style settings:
- Style — Solid, Dashed, or Dotted.
- Thickness — slider in pixels.
- Color — full color picker.
- Width — percentage of the email width (10–100%).
- Alignment — Left / Center / Right.
- Top + bottom padding.
- Background color (the surrounding strip, not the line itself).

Spacer — pure vertical whitespace.
- Height — slider for the empty gap (in pixels). Drag the slider to set the gap size visually.
- Background color — color the strip if you want a colored gap (e.g. matching a hero block above).

Both blocks live in the right-panel palette and drop in like any other block.`,
      },
      {
        id: 'me-brand-colors',
        title: 'Brand colors — saved palette across the app',
        tags: ['brand colors', 'palette', 'color picker', 'flodesk', 'saved colors', 'eyedropper', 'hex'],
        body: `Brand colors are a per-venue palette that lives inside every color picker. There's no dedicated palette-management page — you save and remove colors right where you're using them. Once a color is in your palette it appears in every color picker across the app: email builder (text, button, background, divider, social icons, etc.), form builder, anywhere a color is picked.

Adding a color
- From any color picker, configure a color (hex / picker / eyedropper) and click the bookmark/save icon next to the swatch. It's added to your palette instantly and shows up in every other picker right away.

Removing a color
- Hover any saved swatch in a picker's palette row and click the small × that appears. Removing a color doesn't change any email, form, or proposal that already uses it.

The Flodesk-style color picker
- Anchored to the viewport so it never opens off-screen on small panels.
- Includes a hex input, a HSL/RGB visualizer, an eyedropper (where the browser supports it), and a row of your saved brand colors at the bottom.
- The "Default" preset always includes a sensible fallback (#1b1b1b near-black for text, #ffffff for backgrounds).

Limits — you can save up to 50 brand colors per venue.`,
      },
      {
        id: 'me-fonts',
        title: 'Fonts in the email builder',
        tags: ['fonts', 'google fonts', 'typography', 'font family', 'weight', 'font selector'],
        body: `Every text-bearing block (heading, text, button, address) exposes a Google Fonts selector in its inspector. Pick from a curated list of email-safe Google fonts; the chosen font loads automatically in both the editor and the rendered email.

For inline emphasis (bold / italic / underline / strikethrough) use the format toolbar that appears when you select text inside a Heading or Text block.

Per-block overrides
- Font family — affects only that block.
- Font weight — Light, Regular, Medium, Semibold, Bold (depending on which weights the font ships).
- Font color — uses the brand-colors palette.
- Letter spacing — fine-tune tracking.
- Line height — set per text/heading block.

H1 / H2 / H3 buttons in the format toolbar set both the heading level and the matching font size, so the visual change is always immediate (no half-applied changes).`,
      },
      {
        id: 'me-preview-test',
        title: 'Live preview, send-test emails, and the preview modal',
        tags: ['preview', 'send test', 'test email', 'iframe', 'preview modal'],
        body: `Click the eye icon (top-right of the editor, labelled "Preview") to open the preview modal.

What you get:
- A real iframe rendering the email exactly as it will arrive — links work, embedded videos play, images load.
- A Send-test form: enter any email address, click Send Test, and a real email is fired through your normal sending pipeline (so you also test deliverability, footer rendering, and your branding/social pulls).
- Header and backdrop are #1b1b1b for a calm, neutral preview.
- Close the modal to drop straight back into the editor with everything where you left it.

Tips
- Always send a test to yourself before scheduling a campaign.
- Test on a phone too — switch the preview modal to Mobile (top toggle) or use the canvas Mobile toggle. Either matches the responsive layout your contacts will actually see on iPhone Mail, Gmail mobile, Outlook for iOS, etc.
- Test renders use real branding (logo, colors, social, address) so what you see is what your contacts get.

Mobile responsiveness — what changes automatically
Every email we render is mobile-optimized at the HTML level (no work for you):
- Block side padding shrinks from 24px to 16px on screens ≤480px wide so headings, addresses, and button labels have more room to breathe.
- The email card goes edge-to-edge on phones (no rounded corners or side gutter) — matches how Apple Mail and Gmail render emails natively.
- The Social Links row uses inline-block chips that wrap to a second line if a venue has many social links — so an 8-platform row on a 600px desktop becomes a clean 2-row stack on a 375px phone instead of getting clipped at the right edge.
- Images use width:100% so they always scale down with the viewport.
Desktop email clients (Outlook, full-screen Gmail web, etc.) get the full 600px-wide layout with the original padding and rounded card.`,
      },
      {
        id: 'me-compliance',
        title: 'Email compliance — minimal footer and preference center',
        tags: ['compliance', 'unsubscribe', 'opt out', 'preferences', 'preference center', 'can-spam', 'casl', 'gdpr', 'footer'],
        body: `Every marketing email sent through StoryVenue automatically includes a minimal compliance footer with:
- Your venue name (from Branding → venue name).
- Your physical address (from Branding → Contact Information).
- An unsubscribe link.
- A "manage your preferences" link.

The unsubscribe and manage links use a signed token unique to each recipient and venue, so each link is single-purpose and can't be guessed or reused.

Public preference center
Both links lead to a public preference page hosted on app.storyvenue.com (no login required) where the recipient can:
- Unsubscribe from all marketing emails (adds them to the marketing_email_suppressions list — they will never receive marketing emails from your venue again unless they opt back in).
- Manage their preferences (opt back in if they've previously unsubscribed).

Suppression
Recipients on the suppression list are skipped automatically by every campaign and automation. They still receive transactional emails (proposals, invoices, payment confirmations) — those are exempt from CAN-SPAM and never use marketing-email infrastructure.

Why this matters
- CAN-SPAM (US) and CASL (Canada) require a physical address and a one-click unsubscribe in every commercial email. StoryVenue's automatic footer covers both.
- GDPR-style consent is up to you — collect opt-ins via your lead capture forms (Marketing → Lead Capture Forms include a marketing-opt-in checkbox).

What you can edit
You can change the visual styling of the footer (font, padding, background) inside the email builder, but the unsubscribe link, manage link, venue name, and physical address are mandatory and always render.`,
      },
      {
        id: 'me-templates-vs-campaigns',
        title: 'Templates vs Campaigns vs Automations',
        tags: ['template', 'campaign', 'automation', 'difference', 'broadcast', 'drip', 'sequence', 'workflow'],
        body: `Three places in the Marketing flyout use the same builder but serve different purposes.

Templates — Marketing → Email Templates
- A reusable design library. Build once, use many times.
- Templates are not sent — they're starting points.
- When you create a campaign or automation step, you can start from a template and tweak it for that specific send.
- Edit at any time; existing campaigns/automations that copied a template are not affected by template edits (each copy is independent).

Campaigns — Marketing → Email Campaigns
- One-off broadcasts to a segment of your contacts/leads (e.g. "Spring tour open house").
- A campaign has three steps: Design (the email itself), Recipients (who gets it — filtered by stage, tag, marketing opt-in, etc.), Review (final check + schedule or send now).
- Once sent, a campaign reports opens, clicks, unsubscribes, and bounces in Marketing → Analytics.
- The campaigns list page uses the same brand-aligned layout as Forms and Audiences: centered content, consistent row style, and a trash icon on each row to delete any campaign (with a confirm prompt) without opening it.

Automations — Marketing → Email Automations
- Multi-step drip sequences triggered by an event (new lead via lead capture form, tag added, contact added, anniversary date hit, etc.).
- Each step is its own email with its own delay (immediate, 1 day later, 7 days later, etc.).
- Edit each step in the same builder you'd use for a campaign.
- Pause / resume an automation at any time without deleting it.

Tip — keep a small stable of well-tested templates (Inquiry follow-up, Tour reminder, Post-tour thank-you, Booking anniversary) and use them as the spine of every campaign and automation. Edits to a template don't propagate, so you control rollout.`,
      },
      {
        id: 'me-segments',
        title: 'Audiences — build a reusable audience once, send to it forever',
        tags: ['audience', 'audiences', 'segment', 'saved audience', 'reusable', 'targeting', 'list', 'group', 'recipients'],
        body: `Saved audiences live at Marketing → Audiences. They let you build an audience once and reuse it across as many campaigns as you want — instead of rebuilding the same filters every time you send a new email.

Why use audiences
- Stop rebuilding the same audience. Save "Booked couples 2026", "Tour requested no proposal", "Newsletter subscribers", "Past clients", etc. once and pick it from a dropdown when you create a campaign.
- Edits propagate. When you tweak a saved audience, every draft and scheduled campaign using it picks up the new audience on the next send. Already-sent campaigns are unaffected (their recipients are locked at send time).
- Stay consistent. Your team sends to the exact same audience every time without remembering which filters to combine.

How to create an audience
1. Go to Marketing → Audiences → New audience.
2. Give it a name (required, must be unique per venue) and an optional description for your team.
3. Pick the audience type — same options you already know:
   - All leads (every contact with email, excluding unsubscribes / opt-outs)
   - Any of these tags
   - In any of these pipeline stages
4. Layer on optional behavior filters:
   - Only leads with a wedding date on file
   - Exclude leads currently in specific stages
   - Exclude leads in booked / won stages
   - Only leads who clicked one of selected trigger links (ever)
5. Watch the live recipient-count chip update as you tweak the filters — that's exactly how many people would receive a campaign sent to this audience right now.
6. Save. The audience is immediately available in every campaign's Audience step.

Important — saved audiences cannot reference other saved audiences. The audience type inside a saved audience is always one of All leads / Tags / Stages, never another audience. (This prevents loops and keeps the count preview honest.)

Using a saved audience in a campaign
1. Open or create a campaign at Marketing → Emails.
2. In the Audience section, pick "Use a saved audience" and choose your audience from the dropdown.
3. You can still layer additional behavior filters on top (e.g. start with "Booked couples 2026" but require a wedding date on file). Those filters compose with — they don't replace — the audience's filters.
4. Save the campaign. When it sends, StoryVenue re-resolves the audience and delivers to whoever currently matches.

Editing an audience
- Edits show up automatically on the next send for any draft or scheduled campaigns using the audience.
- Recipient counts in the Audiences list and inside the campaign picker refresh whenever you reload the page.

Deleting an audience
- If any draft or scheduled campaigns are using the audience, deleting it detaches those campaigns and falls them back to "All leads" so they stay valid.
- The campaign owner can re-pick a different audience afterwards. We never silently drop a recipient list — we always make the fallback explicit.

Where to find audiences
- Marketing → Audiences (left sidebar) — manage them here.
- Inside any campaign's Audience step — pick one from the dropdown.

When to use a saved audience vs an inline campaign audience
- Use a saved audience when the same group is being sent to twice or more, or when multiple team members will run sends and you need consistent targeting.
- Use the inline picker (Tags / Stages / All leads with filters) when you're sending a one-off and won't reuse the audience.

Tip — start with 3-4 evergreen audiences ("Active leads, no proposal", "Booked couples upcoming", "Past clients", "Newsletter subscribers") and use them as the backbone of every recurring email. Build narrower one-offs inline.`,
      },
      {
        id: 'me-form-builder',
        title: 'Lead capture forms — drag-and-drop builder',
        tags: ['form', 'forms', 'form builder', 'lead capture', 'inquiry form', 'embed', 'submit', 'fields', 'first name', 'last name', 'email', 'phone', 'address'],
        body: `Marketing → Forms (path /dashboard/marketing/form-builder) is your lead capture form builder. The list page shows every form for the venue with an inline pencil (edit) and a trash icon (delete with confirm). Click "New form" to create one.

The form editor mirrors the marketing email builder so the two surfaces feel identical:
- Three-pane layout: thin left sidebar with Desktop / Mobile preview toggle and undo/redo, the live canvas in the middle, the right inspector panel.
- Top bar: Back arrow, the form's internal name (used in your dashboard only — it does not render to the public form), and Settings / Embed / Live preview buttons on the right.
- The right panel shows the Block Palette when nothing is selected (drag any tile onto the canvas) and switches to the selected block's tabbed inspector when you click a module.
- Click the canvas background to deselect — the right panel returns to the block palette so you can drop in new modules.
- A high-contrast drop indicator (#1b1b1b) shows exactly where a new block will land. You can drop at any position, including the very last slot.

Block-level styling: every block's inspector exposes a shared Block tab with top padding, bottom padding, side gutters, and background color (same primitives the email builder uses). Per-block style controls live on their own tab — typography for Heading, the rich-text format toolbar for Text, presets for Button, and so on.

Default new-form blocks: every newly created form is seeded with First name + Last name as a half-width pair, Phone, Email, and a Submit button. That's the most common contact-capture form out of the box; remove or rearrange whatever you don't need.

Available blocks:
- Heading and Text (with rich-text format toolbar — bold/italic/underline, lists, links).
- Single-line text and paragraph text inputs.
- Email, Phone, Number, Date, and Time pickers.
- Address — split into individual labelled inputs (Street, City, State, ZIP code) so contact records land cleanly in your CRM. (The previous freeform single-line address was replaced.)
- Dropdown, Radio, Checkbox group, Yes/No toggle.
- File upload (uses the same Media-library bucket).
- Image — same uploader as the email builder. Drag and drop from your computer, click Upload, or "Choose from media library" (shared picker). Supports alignment, width, padding, link wrap, and alt text. Anything uploaded here auto-registers in your Media library.
- Button — full Flodesk-style tabbed inspector. Style tab gives you presets (Solid, Outline, Pill, Underlined link, etc.), a saved-styles modal (save/apply/delete styles), and full custom controls — Google font + weight + size + letter spacing, text color, background color, border color/width/radius, padding, full-width toggle. Default fill is the signature #1b1b1b so freshly placed buttons look right immediately. Older saved forms automatically map their previous button style onto the new presets.
- Submit, Divider, and Spacer — same controls as the email builder.

Form Settings modal (top-right gear): every form-level option lives here so the canvas stays focused on layout.
- Public form name (the name that shows on the form itself).
- Success behavior — thank-you screen text or redirect URL.
- Notification recipients — email addresses that get a copy of every submission.
- Embed CSS class.
- Delete form — removes the form (also available next to the pencil on the Forms list page).

Embed modal: copy-paste a script + div snippet that drops the form into any external website. The embed inherits the form's theme automatically.

Live preview: opens the public-facing form inside a real iframe with real validation and real post-submit configuration (thank-you screen or redirect URL). Submissions don't write a lead and don't fire notification emails — it's a clean dry run so you can verify the experience end-to-end. The header centers the Desktop / Mobile toggle so you can verify both sizes.

The public submission endpoint and the existing embed code are unchanged — the rebuild was visual + UX only, so any embed snippets you've already pasted on external sites continue to work.`,
      },
      {
        id: 'me-workflows',
        title: 'Workflows — automated speed-to-lead funnels (email, SMS soon)',
        tags: ['workflow', 'workflows', 'automation', 'speed to lead', 'follow up', 'sequence', 'drip', 'funnel', 'auto-reply', 'reply halt', 'form submitted', 'trigger', 'cron'],
        body: `Marketing → Workflows is the visual builder for automated follow-up sequences. It's how venues turn a form submission into a multi-step drip funnel that runs by itself — the "speed-to-lead" engine.

What you can build today
- Trigger: Form submitted (a lead capture form), Tag added, Stage changed, Trigger link clicked, After wedding date, or Proposal paid.
- Steps (in any order, as many as you want): Wait (delay), Send email, Send SMS.
- Status: Draft (does nothing), Active (enrolls and runs), Paused (existing enrollments freeze, no new ones).

Every workflow has its own canvas. The trigger card sits at the top, then each step is its own card connected by dashed "+" buttons that let you insert Wait / Send email / Send SMS at any position. The Settings tab is where you set status and trigger configuration (which forms / tags / stages / etc.).

Building a "form-to-funnel" sequence (the most common use case)
1. Marketing → Forms → make sure your inquiry form is published and configured to route into a pipeline stage. The form must include an Email field — the email is what enrolls the lead in the workflow.
2. Marketing → Workflows → New workflow → trigger = "Form submitted (lead-capture form)". Pick the form(s) to listen to (or leave empty to enroll on any form).
3. On the canvas, click "+" to add Wait → Send email steps. Example: Send email (welcome) → Wait 2 days → Send email (case study) → Wait 3 days → Send email (testimonials) — repeat for as long as you want the drip to run.
4. Set the workflow Status to Active and click Save.
5. Submit the form yourself to test. The contact is dropped into the sequence within ~1 minute.

Reply detection — the drip stops when the contact replies
- When a contact replies to any drip email through the platform's reply routing, the platform automatically halts every active marketing automation enrollment for that contact (status → halted_by_reply, completed_at stamped).
- The venue owner gets a transactional email titled "Reply received: <Contact name> — <Venue>" with a preview of their reply and how many sequences were stopped. (Honors Settings → Notifications email-toggle and uses your venues.notification_email — falling back to your account email — as the destination.)
- Halted enrollments don't auto-restart. The contact stays in the conversation thread; the team picks it up from there.

Suppression — sequences respect every existing opt-out
- Marketing email opt-out (the unsubscribe footer in every drip email).
- Hard-bounced or suppressed addresses.
- SMS DND, when SMS steps go live.
- A workflow with status = Paused freezes all of its existing enrollments and refuses to enroll new ones.

Editing a workflow that's already running
- Step changes apply on each enrollment's NEXT step — leads currently waiting in step 3 won't replay step 1.
- Trigger configuration changes (e.g. which forms are watched) only affect future enrollments.
- Workflow trigger TYPE itself is fixed after creation — duplicate the workflow and pick a different trigger if you need to change it.
- Status changes are instant.

Where to delete
- Workflows list page → ... → Delete (or open the workflow → Settings tab → Delete workflow).
- Deleting a workflow also deletes its enrollments (CASCADE).

Behind the scenes
- A 1-minute cron worker (controlled by the MARKETING_CRON_ENABLED environment variable) advances every active enrollment one step. Drafts and paused workflows are skipped.
- Enrollment statuses: active (running), completed (finished all steps), cancelled (manually stopped), failed (an error left it stuck), halted_by_reply (the contact replied — see above).

Tip — keep your first sequence short and useful (3-5 emails over 14 days), make sure the first email arrives within minutes of the form submission, and trust the reply-halt to do its job. The fastest follow-up wins.`,
      },
      {
        id: 'mkt-trigger-tags-vars',
        title: 'Trigger Links, Tags & Variables — page overview',
        tags: ['trigger links', 'tags', 'variables', 'merge variables', 'system tags', 'marketing automation', 'triggers and tags', 'tag page', 'variable page'],
        body: `Marketing → Trigger Links, Tags & Variables is the central hub for three powerful automation tools: trigger links, lead tags, and merge variables.

The page has three accordion sections — each can be expanded or collapsed independently:

1. Trigger Links
Create trackable links that fire a workflow, add a tag, or change a lead stage when clicked. Each trigger link generates a unique URL you can embed in emails or SMS messages. When a recipient clicks it, the configured action fires instantly.

2. Lead Tags (accordion)
Click "Lead Tags" to expand the tags panel. You'll see two groups:
- System tags — 65 predefined non-deletable tags that are auto-applied by the platform (e.g. "Appointment Booked", "Invoice Sent", "Deposit Paid"). These have a lock icon and cannot be deleted. Many are applied automatically as contacts move through workflows.
- Custom tags — tags you've created yourself. These can be edited and deleted. Click "+ New Tag" to create one.

Use the search bar at the top of the tags panel to filter by name. Filter buttons let you narrow by category (Lifecycle, Payments, Marketing, Calendar, etc.).

3. Merge Variables (accordion)
Click "Merge Variables" to expand the variables panel. All 50 system merge variables are listed here, organized by category. These are read-only — you cannot create or delete variables, only use them in your templates.

Use the search bar to find a variable by name or key. Category filter buttons let you browse by Contact, Venue, Appointment, Proposal, System, and more.`,
      },
      {
        id: 'mkt-system-tags',
        title: 'System default tags — auto-applied and non-deletable',
        tags: ['system tags', 'default tags', 'auto-apply', 'non-deletable', 'lock icon', 'tags', 'lifecycle tags', 'appointment tags', 'payment tags', 'marketing tags', 'workflow tags'],
        body: `StoryVenue includes 65 system default tags that are pre-seeded for every venue. These tags power automation, segmentation, and workflow triggers throughout the platform.

What makes system tags special
- Non-deletable — system tags have a lock icon and cannot be removed. They will always exist in your venue.
- Auto-applied — many system tags are applied automatically when certain events happen (e.g. "appointment_booked" is added when a calendar event is created; "deposit_paid" is added when a deposit payment is received). You don't have to do anything.
- Searchable — find them in the Tags accordion on Marketing → Trigger Links, Tags & Variables.

Tag categories and examples
Lifecycle (lead journey):
- new_lead, inquiry_received, form_submitted, contacted, tour_scheduled, proposal_sent, closed_won, closed_lost, not_interested

Calendar & Appointments:
- appointment_booked, appointment_confirmed, appointment_cancelled, appointment_rescheduled, tour_complete, call_scheduled

Payments & Proposals:
- deposit_paid, paid_in_full, invoice_sent, payment_overdue, payment_failed, refund_issued

Marketing & Engagement:
- email_opened, email_clicked, link_clicked, campaign_unsubscribed, sms_opted_out, do_not_contact

Communications:
- contacted_by_email, contacted_by_sms, reply_received, sequence_completed, sequence_halted

Follow-up & Nurture:
- follow_up_needed, follow_up_sent, no_response_7d, no_response_14d, no_response_30d

Qualification:
- high_value_lead, warm_lead, cold_lead, budget_confirmed, date_confirmed

Legacy Integration:
- legacy_synced, legacy_dnd_active

Using tags in workflows
In Marketing → Workflows, you can use "Tag added" as a workflow trigger — so when "deposit_paid" is auto-applied, a thank-you email workflow can fire automatically.

Custom tags
You can still create custom tags for venue-specific needs (e.g. "VIP Client", "Referred by Smith Wedding"). Custom tags appear below system tags in the panel and can be edited or deleted.`,
      },
      {
        id: 'mkt-system-vars',
        title: 'System merge variables — 50 canonical variables',
        tags: ['merge variables', 'system variables', 'canonical variables', 'placeholders', 'template variables', 'contact variables', 'venue variables', 'appointment variables', 'proposal variables', 'dynamic content'],
        body: `StoryVenue has 50 canonical system merge variables that work consistently across every template type — email templates, calendar notifications, marketing emails, SMS messages, and workflows. All variables use dot-notation (e.g. {{contact.name}}).

Where to find them
Marketing → Trigger Links, Tags & Variables → expand the "Merge Variables" accordion. Search by name or filter by category.

Contact variables
{{contact.name}} — full name
{{contact.first_name}} — first name only
{{contact.last_name}} — last name only
{{contact.email}} — email address
{{contact.phone}} — phone number
{{contact.address}} — full street address
{{contact.city}} — city
{{contact.state}} — state / province
{{contact.zip}} — ZIP / postal code
{{contact.partner_name}} — partner/second contact name
{{contact.wedding_date}} — wedding date (formatted)
{{contact.ceremony_type}} — ceremony type
{{contact.guest_count}} — guest count
{{contact.referral_source}} — how they found you

Venue variables
{{venue.name}} — your venue / business name
{{venue.address}} — venue address
{{venue.city}} — venue city
{{venue.state}} — venue state
{{venue.zip}} — venue ZIP
{{venue.phone}} — venue phone
{{venue.email}} — venue contact email
{{venue.website}} — venue website URL
{{venue.owner_name}} — venue owner's name
{{venue.logo_url}} — venue logo URL

Appointment variables (calendar notifications only)
{{appointment.title}} — event title
{{appointment.type}} — event type (e.g. Tour, Call)
{{appointment.start_time}} — formatted start date & time
{{appointment.end_time}} — formatted end time
{{appointment.timezone}} — timezone abbreviation (e.g. EST)
{{appointment.meeting_location}} — meeting link or address
{{appointment.notes}} — event notes
{{appointment.calendar_name}} — which calendar the event belongs to
{{appointment.space_name}} — venue space assigned

Proposal & payment variables
{{proposal.title}} — proposal title
{{proposal.amount}} — total proposal amount
{{proposal.deposit_amount}} — deposit amount
{{proposal.balance_due}} — remaining balance
{{proposal.due_date}} — next payment due date
{{proposal.status}} — proposal status

System variables (auto-injected)
{{system.date}} — today's date (formatted)
{{system.year}} — current year (e.g. 2026)
{{system.unsubscribe_url}} — one-click unsubscribe link (auto-added to marketing emails)

Backwards compatibility
Older variable names like {{contact_name}}, {{customer_name}}, {{organization}}, {{appointment_title}}, etc. still work everywhere — they are automatically mapped to the canonical equivalents. You do not need to update existing templates unless you want to migrate to the new naming convention.`,
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
        body: `StoryVenue sends automated emails on your behalf. Customize each one at Settings → Email Templates.

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

Preview your template using the Preview button — it shows a sample email with dummy data filled in.

Canonical system variables
StoryVenue uses a unified, dot-notation variable system sitewide. The same variables work across calendar notifications, marketing emails, email templates, and workflows. See Marketing → Trigger Links, Tags & Variables → Merge Variables accordion for the full list of all 50 canonical variables.`,
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
        body: `Calendly integration automatically syncs bookings (tours, meetings, tastings) from Calendly into your StoryVenue calendar and customer profiles.

To connect:
1. Go to Settings → Integrations → Calendly card → click Connect
2. Go to calendly.com/integrations/api_webhooks
3. Click API & Webhooks → Personal Access Tokens → Generate New Token
4. Copy the token and paste it into StoryVenue → click Connect

After connecting:
- New Calendly bookings appear on your calendar automatically in real time
- A customer profile is auto-created for the invitee's email
- Cancellations in Calendly mark the event cancelled in StoryVenue
- Use Sync Now to import all upcoming Calendly events at any time

To disconnect: click Disconnect on the Calendly card.`,
      },
      {
        id: 'int-google-cal',
        title: 'Google Calendar, Outlook & Apple Calendar sync (iCal)',
        tags: ['google calendar', 'outlook', 'apple calendar', 'ical', 'sync', 'subscribe', 'phone calendar'],
        body: `There are two ways to sync StoryVenue with Google Calendar. The iCal method (described here) is a one-way read-only feed for any calendar app. For full two-way Google Calendar sync (including seeing your Google events inside StoryVenue and blocking availability), see Settings → Calendar → Connections — that is a separate, more powerful integration.

iCal subscription feed (one-way, works with Google, Outlook, and Apple Calendar)
Find your iCal URL: Settings → Integrations → Google Calendar / Outlook & Apple Calendar card.

This is one-way: StoryVenue events appear in your calendar app. Events added in Google/Outlook do not flow back into StoryVenue.

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

Updates may take up to 24 hours depending on the calendar app.

For two-way sync (Google Calendar only)
If you want StoryVenue events written to Google Calendar AND Google events visible inside StoryVenue, go to Settings → Calendar → Connections and connect your Google account there. See the "Connecting Google Calendar for two-way sync" article for details.`,
      },
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
    id: 'account',
    label: 'Account & Login',
    iconName: 'UserCircle',
    color: '#6366f1',
    articles: [
      {
        id: 'account-login',
        title: 'Logging in and resetting your password',
        tags: ['login', 'sign in', 'password', 'forgot password', 'reset', 'email password', 'authentication'],
        body: `StoryVenue uses email and password to sign in. There are no magic links or one-time codes.

Logging in
Go to app.storyvenue.com/login. Enter your email address and password, then click Sign In.

Forgot your password?
1. Click "Forgot password?" on the login page
2. Enter your registered email address
3. Check your inbox for a password reset link
4. Click the link and set a new password

The reset link expires after a short period. If it has expired, go through the forgot-password flow again.

First-time team member login
If you received an invitation email, click Accept Invitation in the email. You'll be prompted to set your password on first login.

If you're locked out
Make sure you're using the email address the account was created with. Check spam/junk for the reset email. If you still can't access the account, contact StoryVenue support.`,
      },
      {
        id: 'account-update-profile',
        title: 'Updating your email or password',
        tags: ['update email', 'change email', 'change password', 'update password', 'my profile', 'account settings'],
        body: `You can update your email address and password at any time from your profile page.

How to update
1. Click your name or avatar in the sidebar (bottom-left area)
2. Click "My Profile"
3. Update your first name, last name, email address, or password
4. Click Save

Important notes
- No current password re-entry is required — just enter the new value and save
- If you change your email address, use the new address the next time you log in
- Password changes take effect immediately — you stay logged in on your current device

Team members can also update their own profile (name and email) the same way. Changing a team member's email does not affect their role or permissions.`,
      },
      {
        id: 'account-couples-portal',
        title: 'Couples portal — client account access',
        tags: ['couples', 'client login', 'couple account', 'couple portal', 'client portal', 'client access', 'couple signup'],
        body: `Couples (your clients) can create their own StoryVenue account to view their proposals, invoices, and documents — no need to forward emails or log in as a team member.

Couple signup
Couples sign up at app.storyvenue.com/couple/signup with:
- First name and last name
- Email address
- Phone number
- Password

After signing up they are logged in automatically — no "check your email" step.

Couple login
app.storyvenue.com/couple/login — email and password.

Forgot password
Same as venue owners: click "Forgot password?" → receive a reset email → set a new password.

What couples can see
After logging in, couples see only their own records — the proposals and documents sent to them from your venue. They cannot see other contacts, your full calendar, or any internal data.

Updating couple profile
Couples can update their first name, last name, and phone by clicking their name in the header after logging in.

Admin management
Super admins can view, search, and manage all couple accounts from the admin Couples tab.`,
      },
    ],
  },
  {
    id: 'storypay',
    label: 'StoryPay™',
    iconName: 'CreditCard',
    color: '#10b981',
    articles: [
      {
        id: 'storypay-overview',
        title: 'What is StoryPay™ and how do I apply?',
        tags: ['storypay', 'payment processing', 'lunarpay', 'fortis', 'apply', 'merchant', 'onboarding', 'payments', 'accept payments'],
        body: `StoryPay™ is the payment processing layer inside StoryVenue, powered by LunarPay (Fortis). It enables you to accept credit card payments, installment plans, and subscriptions for your proposals and invoices.

Do I need StoryPay™?
To collect online payments from clients (proposals/invoices with payment enabled), you must apply for StoryPay™ and complete merchant onboarding. Until then, the proposals and invoices you send won't have an active payment button for your clients.

Applying for StoryPay™
1. Go to Settings → StoryPay (or click the "Apply for StoryPay™" prompt that appears in payment areas)
2. The LunarPay onboarding wizard walks you through:
   - Business information (legal name, address, industry)
   - Owner details (name, date of birth, SSN last 4)
   - Banking details (where payments are deposited)
3. Submit for review. Fortis processes the application — approval typically takes 1–3 business days.

Once approved
- The StoryPay™ banner disappears from Settings
- Proposals and invoices can accept live credit card payments
- Funds are deposited into the bank account you provided

Security note
Card numbers from clients go directly to Fortis servers — StoryVenue never sees or stores raw card data. The integration is PCI SAQ-A compliant.

If payments are showing as unavailable
Check that your LunarPay/Fortis onboarding status shows as approved in Settings → StoryPay. If you believe it should be active, contact StoryVenue support with your business name and application date.`,
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

Note: Only owners and admins can manage team members.

Hide pipeline dollars (CRM) — When you are logged in as the venue owner (not as an invited team member), each active team member who is not assigned the Owner role may show a Hide $ checkbox on their row. Turning it on hides opportunity amounts, weighted totals, and related money lines for that person in Leads.`,
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

Team members can update their own profile (name, email) by clicking their name in the sidebar footer.

Pipeline revenue visibility — The venue owner can enable Hide $ for individual team members (Settings → Team) so those users see masked amounts (•••) on Leads instead of dollar figures. Owners always see full amounts.`,
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
        body: `When you send a proposal or invoice to a customer with a phone number on file, StoryVenue automatically sends them an SMS with a link.

For SMS to work:
1. The customer must have a phone number entered when creating the proposal or invoice.
2. Phone numbers are automatically formatted to US E.164 format (+1XXXXXXXXXX). Enter numbers in any format — StoryVenue handles the rest.
3. Your StoryVenue Legacy messaging account must be connected. SMS routes through your A2P-approved phone number.

If SMS is not sending, check:
- Is the customer's phone number entered?
- Is the phone number a valid US number?
- Is messaging connected? (Settings → General → Messaging should show "Connected")

Note: SMS uses your StoryVenue Legacy account's verified A2P phone number automatically — no manual configuration needed once messaging is connected.`,
      },
      {
        id: 'notif-calendar-templates',
        title: 'Calendar appointment email & SMS templates',
        tags: ['calendar', 'appointment', 'notification', 'template', 'email template', 'sms template', 'merge tags', 'confirmation', 'reminder', 'cancellation', 'reschedule', 'follow up', 'venue owner', 'contact'],
        body: `Every calendar notification has four independently editable templates — one per channel. Manage them at Settings → Calendar → Notifications.

The four channels
- Email → Venue Owner: email sent to your venue's registered email address
- Email → Contact: email sent to the booked contact/lead
- SMS → Venue Owner: SMS delivered via StoryVenue Legacy to your number
- SMS → Contact: SMS delivered via StoryVenue Legacy to the contact's number

Each channel can be toggled on or off independently. Turning a channel off removes it from automatic dispatch without deleting your template.

Editing a template
1. Go to Settings → Calendar → Notifications.
2. Click a scenario (e.g. "Appointment Booked (Confirmed)") to expand it.
3. Click the channel row (e.g. "Email → Contact") — the chevron expands the editor.
4. Edit the Subject (email channels only) and message body.
5. Use merge tags anywhere in subject or body — they are replaced with real values at send time.
6. Click Save Changes.

Available merge tags
{{contact.name}} — contact's full name
{{contact.email}} — contact's email address
{{contact.phone}} — contact's phone number
{{appointment.title}} — the event title
{{appointment.start_time}} — formatted date and time (e.g. Monday, May 5 at 2:00 PM)
{{appointment.timezone}} — timezone abbreviation (e.g. EST)
{{appointment.meeting_location}} — meeting link or physical address
{{venue.name}} — your venue/business name

Resetting a template
Click "Reset to default" at the bottom of any channel editor to restore the built-in default template for that channel. This does not affect other channels.

SMS character count
SMS editors show a character counter (e.g. "114 / 160 chars"). Standard SMS segments are 160 characters. Messages over 160 chars are still sent but may count as 2 segments in your Legacy messaging account.`,
      },
      {
        id: 'notif-calendar-troubleshoot',
        title: 'Troubleshooting calendar notifications not sending',
        tags: ['notifications not sending', 'email not received', 'sms not received', 'reminder not sent', 'confirmation not sent', 'notification troubleshoot', 'debug notifications'],
        body: `If a calendar notification or reminder isn't arriving, work through these checks.

Email not arriving
1. Is the channel toggled On? Settings → Calendar → Notifications → expand the scenario → check the toggle on that channel row.
2. Does the event have a contact with an email address? Email → Contact only fires if the event is linked to a contact that has an email on file.
3. Is the venue email configured? Email → Owner needs a valid email in your venue profile (Settings → General).
4. Check spam/junk folders — transactional emails from Resend can land there for first-time recipients.

SMS not arriving
1. Is Legacy messaging connected? Settings → Integrations → Messaging should show "Connected".
2. Does the contact have a valid US phone number in the SaaS database?
3. Is the SMS channel toggled On for that scenario?
4. Is your A2P number approved? A2P rejection blocks all outgoing SMS.

Reminder not arriving
1. Was the event created after you saved your reminder settings? Reminder queue rows are created at event save time. Events booked before you set up reminders won't have queue rows — re-save the event to regenerate them.
2. Is the reminder offset in the future? A reminder set for "10 minutes before" that has already passed won't fire.
3. Is the reminder channel enabled? Each of the four reminder channels (Email→Owner, Email→Contact, SMS→Owner, SMS→Contact) can be on or off independently.

Follow-up not arriving
- Follow-up timing is fully configurable: Settings → Calendar → Notifications → Follow-Up → any channel → "When to send" (choose minutes, hours, or days after the event ends).
- If the event has no end time, no follow-up is queued.
- Make sure the follow_up scenario channels are toggled On.
- Follow-up queue rows are created when an event is saved. If you change the timing, re-save the event to regenerate the queue row.

Test before going live
Use the "Send test email" / "Send test SMS" button inside each channel editor to verify delivery before relying on automatic dispatch.`,
      },
    ],
  },
  {
    id: 'updates',
    label: "What's New",
    iconName: 'Bell',
    color: '#f97316',
    articles: [
      {
        id: 'updates-overview',
        title: "What's New — release notes and unread badge",
        tags: ["what's new", 'whats new', 'updates', 'release notes', 'changelog', 'red dot', 'unread', 'notifications'],
        body: `What's New (sidebar → What's New) is your running changelog for StoryVenue. Every time we ship a new feature, improvement, or fix, it lands here as an entry with a short outcome-focused headline and description so you can see at a glance what changed and why it matters to your venue.

The page has two tabs: What's New (changelog) and Feature Requests.

Unread indicator
- The sidebar shows a small red dot on the What's New menu item whenever there are updates you haven't reviewed yet. The dot carries a count of unread entries (1+).
- Click What's New to open the page. Visiting the page marks every entry as read — the red dot and count disappear automatically for your user. Each teammate has their own unread state.
- Entries stay on the page forever; the badge just tracks what's new to you since your last visit.

What you'll see on each changelog entry
- Category pill: New Feature, Improvement, or Fix (color-coded).
- Outcome-based description — written to explain the impact on you, not just the technical change.
- Date released.

If the red dot sticks around after you visit the page, refresh once. If it still persists, sign out and back in so the read timestamp is re-synced.`,
      },
      {
        id: 'updates-feature-requests',
        title: 'Submitting a feature request',
        tags: ['feature request', 'suggest', 'feedback', 'idea', 'roadmap', 'vote', "what's new"],
        body: `You can ask for new features directly inside StoryVenue — no external form.

How to submit
1. Open What's New (sidebar) and switch to the Feature Requests tab.
2. Click Submit Request.
3. Enter a short title and a description (explain the problem, how you'd use the feature, and the outcome you want).
4. Click Submit.

Voting
- Every venue account can vote once per request using the Vote button on each card.
- The vote count is shown as individual thumbs-up chips — one chip per venue that voted. Your own vote chip is filled black; others are outlined grey. When 3 venues have voted, you see 3 thumbs-up chips. Up to 8 are shown; beyond that a "+N more" badge appears.
- Click Vote again to remove your vote.
- Requests are sorted by most votes so the most popular ideas rise to the top.

What happens next
- A StoryVenue admin reviews every request and can approve, edit, or remove it.
- Approved: the request becomes a new What's New entry with an auto-generated outcome-based headline and description. It disappears from the active list because the feature is now live and tracked in the changelog.
- Removed: if the request is a duplicate, out of scope, or won't be built, it's removed. No action needed from you.

Completed section
- At the bottom of the Feature Requests tab is a collapsible Completed requests section.
- It shows any request you submitted or voted on that has since been approved and shipped. Each card shows a "Your request" or "You voted" tag plus the date it shipped.

Editing or deleting your own request
- You can edit the title/description or delete a request you submitted, as long as it hasn't been approved or removed by an admin yet.

Tip: write the description as an outcome — "I want to be able to X so that Y" — so the admin team can capture the right headline when the feature ships.`,
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
        body: `Ask AI is your built-in assistant, powered by your live account data and an internal summary of the StoryVenue product — navigation, CRM, Conversations inbox (SMS / Email / Team tabs, two-way replies), Venue listing (directory, Media library, photos, analytics, reviews), Leads pipelines and intelligence, calendar, payments, marketing tools, team permissions, settings, What's New / changelog, feature requests, and Help Center guidance. It knows your current revenue, recent proposals, and — when you're on the Leads page — a detailed snapshot of leads, stages, and notes.

Open it by clicking the sparkle button (bottom-right corner of any page) or by clicking Ask AI in the sidebar.

You can ask questions like:
- "How much revenue did I make last month?"
- "Show me my open proposals"
- "How do I issue a refund?"
- "What reports are available?"
- "How do I connect Calendly?"
- "How do I sync my calendar with Google Calendar?"
- "How do listing reviews show on storyvenue.com?"
- "What's the difference between SMS, Email, and Team only in Conversations?"
- "How do I delete a contact or lead?"
- "What is the None stage on leads?"
- On Leads: "What's my total pipeline value?", "Which leads have wedding dates in June?", "Explain weighted vs open pipeline"
- "What is the Media library?" or "How do I reuse photos in my emails and forms?"
- "What system tags are available?" or "How do merge variables work?"
- On the Calendar page: use the "Search & Ask AI" button (sparkle icon) for calendar-specific AI search — ask "What tours do I have next week?" or "Any cancellations this month?"

Ask AI answers in plain language. It uses your real account data to give accurate, personalised answers. If AI gives a stale answer, refresh the page to reset the context.`,
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
  '/dashboard': ['dash-kpis', 'dash-chart', 'gs-onboarding', 'gs-sidebar-chrome'],

  // Contacts
  '/dashboard/contacts': ['cust-add', 'cust-search', 'cust-profile', 'cust-pipeline', 'cust-tasks', 'cust-documents', 'cust-dnd'],

  // Conversations (unified inbox)
  '/dashboard/conversations': ['conversations-overview', 'conversations-inbound', 'cust-profile', 'gs-overview'],

  // Calendar
  '/dashboard/calendar': ['cal-overview', 'cal-add-event', 'cal-ai-search', 'cal-multi-calendar', 'cal-event-actions', 'cal-spaces', 'cal-conflicts', 'cal-multi-day', 'cal-recurring'],

  // Venue listing (directory + reviews + analytics)
  '/dashboard/listing/media': ['listing-media-library', 'listing-photos', 'listing-overview', 'brand-setup'],
  '/dashboard/media': ['listing-media-library', 'listing-photos', 'listing-overview', 'brand-setup'],
  '/dashboard/listing/images': ['listing-photos', 'listing-media-library', 'listing-overview', 'listing-publish'],
  '/dashboard/listing/reviews': ['listing-reviews', 'listing-google-reviews', 'listing-overview', 'listing-publish'],
  '/dashboard/listing/analytics': ['listing-analytics-realtime', 'listing-analytics-retention', 'listing-overview', 'listing-publish'],
  '/dashboard/listing':        ['listing-overview', 'listing-media-library', 'listing-reviews', 'listing-google-reviews', 'listing-analytics-realtime', 'listing-autosave', 'listing-photos', 'listing-publish', 'listing-slug'],

  // Leads
  '/dashboard/leads': ['leads-overview', 'leads-space', 'leads-edit-pipelines', 'leads-crm-intelligence', 'leads-kanban', 'leads-filter-search', 'leads-notifications', 'leads-to-proposal'],

  // Marketing — native email
  '/dashboard/marketing/analytics': ['me-overview', 'me-compliance', 'leads-overview', 'gs-overview'],
  '/dashboard/marketing/email/campaigns':  ['me-builder', 'me-blocks', 'me-preview-test', 'me-segments', 'me-templates-vs-campaigns', 'me-compliance', 'brand-social-networks', 'brand-colors-saved'],
  '/dashboard/marketing/email/audiences':  ['me-segments', 'me-templates-vs-campaigns', 'me-overview', 'me-compliance'],
  '/dashboard/marketing/email/templates':  ['me-builder', 'me-blocks', 'me-templates-vs-campaigns', 'me-block-button', 'me-block-image', 'me-block-video', 'me-block-social', 'me-block-address', 'me-brand-colors'],
  '/dashboard/marketing/email/automations':['me-workflows', 'me-templates-vs-campaigns', 'me-builder', 'me-blocks', 'me-compliance', 'me-preview-test'],
  '/dashboard/marketing/email/preferences':['me-compliance', 'me-overview'],
  '/dashboard/marketing/email':            ['me-overview', 'me-builder', 'me-blocks', 'me-segments', 'me-templates-vs-campaigns', 'me-compliance'],
  '/dashboard/marketing/trigger-links':    ['mkt-trigger-tags-vars', 'mkt-system-tags', 'mkt-system-vars', 'me-workflows', 'me-overview'],
  '/dashboard/marketing/form-builder':     ['me-form-builder', 'me-workflows', 'listing-media-library', 'leads-overview', 'gs-overview'],
  '/dashboard/marketing/workflows':        ['me-workflows', 'me-form-builder', 'me-templates-vs-campaigns', 'me-compliance', 'me-overview'],

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
  '/dashboard/settings/branding':        ['brand-setup', 'brand-colors-saved', 'brand-social-networks', 'listing-media-library', 'me-block-social', 'me-block-address'],
  '/dashboard/settings/email-templates': ['email-types', 'email-variables', 'me-overview'],
  '/dashboard/settings/calendar':        ['cal-settings-overview', 'cal-multi-calendar', 'cal-per-calendar-rules', 'cal-notification-overview', 'cal-notification-reminders', 'cal-settings-booking-rules', 'cal-settings-google-sync'],
  '/dashboard/settings/integrations':    ['int-calendly', 'int-google-cal', 'int-quickbooks', 'int-freshbooks'],
  '/dashboard/settings/team':            ['team-invite', 'team-roles'],
  '/dashboard/settings/notifications':   ['notif-settings', 'sms-notifications'],
  '/dashboard/settings':                 ['gs-overview', 'gs-onboarding'],

  // What's New / Updates
  '/dashboard/updates': ['updates-overview', 'updates-feature-requests', 'ai-overview', 'gs-overview'],

  // AI
  '/dashboard/ai':   ['ai-overview', 'listing-media-library', 'ai-screenshot', 'ai-voice', 'ai-escalate'],
  '/dashboard/help': ['gs-overview', 'gs-sidebar-chrome', 'listing-overview', 'listing-reviews', 'listing-google-reviews', 'listing-analytics-realtime', 'conversations-overview', 'leads-overview', 'leads-crm-intelligence', 'ai-overview', 'cust-pipeline'],

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
