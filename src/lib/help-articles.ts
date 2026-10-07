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
        body: `StoryVenue (at app.storyvenue.com) is the all-in-one command center for wedding venues. From one dashboard you manage your public listing on storyvenue.com, the leads it brings in, your conversations with couples, contacts, proposals, invoices, payments, a booking calendar, branding, and your team.

After logging in on desktop, you land on the Bride Booking System™ Dashboard: the live visitor map, the booking funnel, and where your leads come from. On the native mobile app, you land on a "Today" screen showing unread conversations and today's schedule instead.

Navigation lives in the left sidebar (or the hamburger menu on mobile). From top to bottom: Setup Guide (until you've finished it), Bride Booking System™, Lead Inbox, Conversations, Venue Concierge, Wedding Planner, Contacts, Calendar, Payments, Marketing, Settings, Reports, and Help Center. Bride Booking System™, Payments, Marketing, and Settings open to show the pages inside them. An item with a small lock isn't part of your plan. On desktop you can collapse the sidebar with the chevron next to the logo — it becomes a narrow icon rail with a compact mark; your choice is remembered in the browser.

The main areas:
- Bride Booking System™ — everything that brings brides in and follows up with them: Dashboard (your numbers), Venue Listing (how you appear on storyvenue.com), Pricing Guide, Reviews, Speed to Lead System (your follow-up), Web Form (the inquiry form for your own website), Lead Link (one link for your Instagram bio), Lead Finder (turns directory inquiry emails into leads), and Ad Tracking
- Lead Inbox — your pipeline of inquiries, as a board or a list, with stages you can edit
- Conversations — one inbox per contact: texts and emails with the couple, plus team-only notes
- Venue Concierge and Wedding Planner — messages with the StoryVenue concierge team, and the planning tools your booked couples use
- Contacts — a profile for every lead and customer, with tabs (Overview, Notes, Activity, Payments, Tasks, Documents) and a pipeline + stage control in the header
- Calendar — tours, weddings, and events
- Payments — New (a proposal or invoice), Packages, Coupons, Proposals & invoices, Proposal Templates, Payment plans, Transactions, and Payment settings
- Marketing — Analytics, Campaigns, Audiences, Forms, and Media (the images you reuse across your listing, emails, and forms)
- Settings — General, Email settings, Notifications, Branding, Integrations, Team, and Billing
- Reports — financial exports (owners and admins)
- Help Center — searchable guides, with Ask AI for questions about your own account

What you see depends on your role. Owners see everything. Admins see most areas. Members have a narrower set (e.g. proposals, customers, calendar, leads, listing — no Reports or most Settings).

How the two sites fit together:
- storyvenue.com is the public-facing directory browsed by couples looking for a venue
- app.storyvenue.com is the private admin dashboard where you run your business

Couples browse your listing on storyvenue.com → submit an inquiry → the lead lands in your Lead Inbox here → you reply, book a tour, send a proposal, and collect payment — all without leaving StoryVenue.

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
        tags: ['signup', 'register', 'create account', 'new venue', 'join', 'sign up', 'plan', 'add-ons', 'onboarding'],
        body: `New venues create an account themselves at app.storyvenue.com/signup.

Signing up takes three steps:
1. Pick a plan. Each plan card lists what's included.
2. Choose any add-ons you want. You can skip this step.
3. Add a card. Free plans skip this step.

After signing up you land in your dashboard, where a short 4-step setup gets your listing live:
1. Connect — find your venue on Google, and its details and photos are brought in for you.
2. Details — check your listing.
3. Go live — publish it. A test inquiry is sent so you can see a lead arrive. It's labelled "test" and doesn't count in your numbers.
4. Access — add a card to start your 14-day free trial of the Bride Booking System™.
A Back button on every step lets you change earlier answers.

Once setup is finished, the Setup Guide takes over with your next steps (see "The Setup Guide — your steps to your first leads").

Good things to do next:
- Go to Bride Booking System™ → Venue Listing in the sidebar and check your description, location, capacity, pricing, amenities, and photos
- Head to Settings → Branding to upload your logo and brand colors (these appear on proposals and outgoing emails)
- Invite team members at Settings → Team

One email address = one venue account. If you already have an account and try to sign up again with the same email, the system tells you and points you to the login page instead.`,
      },
      {
        id: 'gs-onboarding',
        title: 'The Setup Guide — your steps to your first leads',
        tags: ['setup guide', 'checklist', 'onboarding', 'setup', 'first steps', 'getting started', 'walkthrough', 'rocket'],
        body: `The Setup Guide is a short list of steps that gets your venue ready to capture every bride and follow up with her. It opens by itself each time you sign in, and a small bar at the top of every page keeps your place until you've finished. Once every step is ticked, the guide is finished and goes away.

Where to find it
- Sidebar → Setup Guide (the first item, with the rocket). The ring around it shows how many steps are done.
- The small bar at the top of every page. Press Continue setup to pick up where you left off. Or press the bar itself to drop down every step, scroll through them, and pick the one you want: the guide opens on that step.

The steps
1. Start here: watch the 3-minute walkthrough
2. Share your listing link
3. Check your pricing guide
4. Put your Lead Link in your Instagram bio
5. Add the inquiry form to your website
6. Forward your directory leads to Lead Finder
7. Make your follow-up sound like you
8. Want us to bring you qualified brides?
Setting up proposals and payments with StoryPay™ is on the list too, marked Optional.

How it works
- Open a step to see what to do. Each one has a button that takes you to the right page.
- A step turns green when it's really set up (for example, once your listing is live). You can also tick a step off yourself with Mark as done.
- If you ticked a step but it isn't set up yet, the guide says so.
- Any done step can be unticked again, including one that turned green by itself: open the step and press Not done yet, or press its tick in the list. It stays unticked until you tick it.
- The guide opens by itself each time you sign in, until you've ticked every step. Press the X to close it. To bring it back, press Setup Guide in the sidebar, or pick a step from the bar at the top of the page.
- The bar at the top stays small until you press it, and folds away again once you pick a step or go to another page.
- Nothing is locked behind the guide. Close it any time and keep working.

When you've finished
- Once every step is ticked, the Setup Guide is finished. It stops opening when you sign in, and the bar at the top of the page and the Setup Guide entry in the sidebar both go away.
- It doesn't come back, so work through any step you still want help with before you tick the last one.
- Everything the guide pointed to stays where it is: your listing, pricing guide, Lead Link, Web Form and Lead Finder are all under Bride Booking System™ in the sidebar.

Who sees it
Account owners and admins. Team members don't see it. Which steps you see depends on what your plan includes.`,
      },
      {
        id: 'gs-login',
        title: 'Logging in, passwords, and forgot password',
        tags: ['login', 'password', 'access', 'sign in', 'forgot password', 'reset password', 'change password'],
        body: `You sign in to StoryVenue with your email and password at app.storyvenue.com/login.

To log in:
1. Go to app.storyvenue.com/login
2. Enter your email address and password
3. Click Sign in

Forgot your password:
1. Click "Forgot password?" on the login page
2. Enter your email address
3. You'll receive a password reset link by email
4. Click the link and set a new password

Changing your email or password:
- Click your name at the bottom of the sidebar → My Profile → Login & Security
- Use Change Email or Change Password. Each asks for your current password
- If you update your email, use the new address the next time you log in

Team members:
- Team members accept an email invitation and set their own password on first login
- If a team member never received their invite, have an owner go to Settings → Team → find the member → resend invite

Logging out:
- Click Logout at the bottom of the sidebar

Couples (clients):
- Couples log in at app.storyvenue.com/couple/login with the email and password they set at signup
- Forgot password works the same way for couples`,
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
        id: 'dash-announcement-ticker',
        title: 'The News bar at the top of the page',
        tags: ['announcement', 'ticker', 'news', 'banner', 'top bar', 'broadcast', 'platform updates'],
        body: `The thin dark scrolling bar at the very top of every page (labelled "News") is the announcement ticker. It carries messages from the StoryVenue team to every venue, such as:

- Planned maintenance
- New features and big changes to existing tools
- Billing or policy updates every venue should see
- Time-sensitive notices

Why there's no "X" to close it
These are messages every venue needs to see, so the bar can't be closed. It goes away when the StoryVenue team takes the announcement down.

Clicking the link in an announcement
If a message has a link, clicking it opens it. Hover over the scrolling text to pause it so you can read or click.`,
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

Where to manage spaces

When adding or editing a calendar event, find the Space field and click Manage to add, rename, recolor, or remove spaces right there without leaving the event form. The same controls are available in the Lead Inbox's New Lead form (Space field → Manage) and the Contacts New Contact form.

To add a space
1. Click Manage next to the Space field (on a new event, a new lead, or a new contact)
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
        body: `To add an event, click the "Create event" button or click directly on any day (or hour slot in Week/Day view) in the calendar grid.

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
1. Click "Create event"
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
1. Click "Create event"
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
        body: `StoryVenue checks for booking conflicts every time an event is saved. If you try to add an event to a space that already has another event during that time window, you will see a conflict warning.

The warning shows:
- The conflicting event name
- Its start and end time

You have two options:
1. Change the date, time, or space to avoid the conflict
2. Click "Override & Book Anyway" — this books despite the overlap (useful for back-to-back events with shared setup time, or if a space can handle simultaneous events)

Conflict detection only applies when you select a specific space. Events with no space assigned never trigger conflicts.`,
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
- New Calendly bookings appear on your StoryVenue calendar instantly (in real time)
- A customer profile is created automatically for each booking
- Cancellations in Calendly automatically mark the event cancelled in StoryVenue

Use Sync Now to import all upcoming Calendly events at any time (useful after first connecting).

To disconnect, click Disconnect on the Calendly card. Your existing calendar events are not deleted.`,
      },
      {
        id: 'cal-settings-overview',
        title: 'Calendar Settings — overview of all tabs',
        tags: ['calendar settings', 'settings', 'availability', 'booking rules', 'google calendar', 'connections', 'notifications', 'timezone'],
        body: `Calendar → Calendar Settings opens a five-tab configuration hub for everything related to how your calendar works and what happens when appointments are booked.

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
        body: `Calendar → Calendar Settings → Connections lets you connect your Google account for a two-way sync between StoryVenue and Google Calendar.

Connecting your Google account
1. Go to Calendar → Calendar Settings → Connections tab
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
Google's permission can expire. Return to Calendar → Calendar Settings → Connections and reconnect. This is usually required after a Google account password change or permission revocation.`,
      },
      {
        id: 'cal-settings-availability',
        title: 'Setting your weekly availability and date overrides',
        tags: ['availability', 'working hours', 'schedule', 'days off', 'hours', 'holiday', 'override', 'blocked date'],
        body: `Calendar → Calendar Settings → Availability controls which days and hours appear as bookable on your public scheduling page.

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
        body: `Calendar → Calendar Settings → Booking Rules defines how appointment slots are structured and constrained for online bookings.

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
Each individual calendar can override any of the rules above. Go to Calendar → Calendar Settings → Calendars tab → click a calendar → expand "Customize Booking Rules". Any field left at "Venue default" inherits the setting from this global Booking Rules tab. This means a 15-minute phone-call calendar and a 60-minute tour calendar can coexist without either compromising the other.`,
      },
      {
        id: 'cal-multi-calendar',
        title: 'Multiple calendars — create up to 5 per venue',
        tags: ['multiple calendars', 'calendars', 'calendar types', 'tour calendar', 'phone call calendar', 'calendar management', 'create calendar', 'delete calendar', 'venue calendars', 'calendar color'],
        body: `StoryVenue supports up to 5 named calendars per venue — for example, a "Tour Calendar", "Phone Call Calendar", and "Consultation Calendar". All calendars display together in the single unified calendar view; each one is color-coded so events are visually distinct at a glance.

Where to manage calendars
Calendar → Calendar Settings → Calendars tab.

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
Click the trash icon on a calendar row in Calendar → Calendar Settings → Calendars. The default calendar has no delete option. Deleting a calendar removes its notification settings; existing events on that calendar are not deleted.

On the calendar page
Events show with a colored left border matching their calendar. If you create multiple calendars, the event creation modal lets you pick which calendar the event belongs to.`,
      },
      {
        id: 'cal-per-calendar-rules',
        title: 'Per-calendar booking rules — overrides per calendar type',
        tags: ['per calendar booking rules', 'booking rules override', 'calendar duration', 'calendar interval', 'custom booking', 'tour duration', 'phone call duration', 'calendar settings', 'override venue defaults'],
        body: `Every calendar can have its own booking rules that override the venue-wide defaults set in Calendar → Calendar Settings → Booking Rules. This means a phone-call calendar can use 15-minute slots while a tour calendar uses 60-minute slots — with no conflict.

How to set per-calendar rules
1. Go to Calendar → Calendar Settings → Calendars tab.
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
Any field set to "Venue default" uses the value from Calendar → Calendar Settings → Booking Rules. Override only what differs for that calendar — everything else flows through automatically.

Online booking follows them too
A booking link for one calendar offers times by that calendar's rules. A general booking link uses your venue-wide defaults.`,
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

What it can see
Your events from the past 30 days and the next 90 days (up to 200 of them): each one's title, type, status, date, contact, calendar, space, and notes. It answers only from what's on your calendar.

If there's no AI answer
The panel still shows keyword-matched events even when the AI answer isn't available. You can always use the keyword results to find what you need.`,
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
The Follow-Up notification fires a configurable time after the event ends. Set the delay in Calendar → Calendar Settings → Notifications → Follow-Up → expand a channel → "When to send" — choose minutes, hours, or days. Each of the four channels (Email → Owner, Email → Contact, SMS → Owner, SMS → Contact) can have a different follow-up delay.

Notifications fired per action
- Confirmed (new event): Appointment Booked (Confirmed) fires.
- Status → Confirmed: Appointment Confirmed notification fires.
- Status → Cancelled or event deleted: Cancellation notification fires.
- Start/end time changed: Reschedule notification fires.
- Reminder timing reached: Reminder fires (it is scheduled when the event is saved).
- After event ends: Follow-Up fires.`,
      },
      {
        id: 'cal-notification-overview',
        title: 'Calendar appointment notifications — overview',
        tags: ['calendar', 'notifications', 'email', 'sms', 'appointment', 'confirmation', 'reminder', 'cancellation', 'reschedule', 'follow up', 'automatic', 'templates'],
        body: `StoryVenue automatically sends email and SMS notifications when appointments are created, changed, or approaching. Every scenario and every channel is independently configurable.

Go to Calendar → Calendar Settings → Notifications tab to manage everything.

The five notification scenarios
1. Appointment Booked (Confirmed) — fires immediately when you create a confirmed calendar event.
2. Cancellation — fires when you change an event's status to Cancelled.
3. Reschedule — fires when you change an event's start or end time.
4. Reminder — fires before the appointment starts. Timing is fully configurable per channel.
5. Follow-Up — fires after the event ends. The timing is fully customizable: go to Calendar → Calendar Settings → Notifications → Follow-Up → any channel and set the delay in minutes, hours, or days after the event ends.

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
Calendar → Calendar Settings → Notifications tab → click "Reminder" to expand → click any channel row (e.g. "SMS → Contact") → the "When to send" section appears at the top of the editor.

How timing works
- Each channel can have up to 3 send times.
- Enter a number and choose Minutes, Hours, or Days before the appointment starts.
- Example: Email → Contact could have 1 Day, 1 Hour, and 10 Minutes; SMS → Owner could have just 1 Hour.
- The send button stays disabled until that channel has been scheduled for the event, which happens when the event is created or updated.

Default timing (applied automatically until you change it)
- Email → Owner: 1 day + 1 hour + 10 minutes before
- Email → Contact: 1 day + 1 hour + 10 minutes before
- SMS → Owner: 1 hour + 10 minutes before
- SMS → Contact: 1 hour + 10 minutes before

To add a send time: click "+ Add time" below the existing rows (up to 3 per channel).
To remove a send time: click the trash icon on that row (at least 1 row must remain).

Important: reminders are scheduled when an event is saved. If you change timing after an event is already booked, upcoming (unsent) reminders are updated automatically.`,
      },
      {
        id: 'cal-notification-test',
        title: 'Sending a test notification',
        tags: ['test', 'send test', 'test email', 'test sms', 'preview', 'notification test', 'sample'],
        body: `Every channel editor has a built-in test sender so you can verify your template looks right before it reaches a real contact.

How to send a test
1. Calendar → Calendar Settings → Notifications tab → expand a scenario → expand a channel.
2. At the bottom of the editor you'll see a recipient field and a "Send test email" or "Send test SMS" button.
3. For email channels: type any email address and click Send test email. The button is disabled until an "@" is entered.
4. For SMS channels: type a 10-digit US phone number — the +1 country code is locked in and cannot be removed. Click Send test SMS. The button is disabled until 10 digits are entered.
5. The test fires immediately using your current template with sample placeholder values.

What the test sends
- All merge tags are replaced with realistic sample data (e.g. contact name = "Alex Johnson", appointment = "Strategy Call" on "Thursday, May 1 at 10:00 AM EST").
- A "[TEST – Owner]" or "[TEST – Contact]" prefix is added to the subject/message so you know it's a test.
- Email tests go to the address you type. SMS tests go to the Legacy contact whose phone number matches what you entered.

SMS test requirements
- The phone number you enter must belong to one of your contacts.
- If no matching contact is found, a red error message appears below the input explaining what to check.

If the test fails
- For email: check that the target email address is valid. If it is and the test still fails, contact StoryVenue support.
- For SMS: make sure Legacy messaging is connected (Settings → General) and the phone number matches an existing contact.`,
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

Clicking the thread still opens the conversation normally. To change the stage, open the contact profile (Profile button in the thread) → Overview tab → click a stage pill.

Stage moves in the conversation
Each time a couple is moved to another stage, the conversation shows a line saying which stage, when, and who moved her: you, a team member, the AI Concierge, an automation, or StoryVenue Support. Only your venue and StoryVenue Support see these lines. The couple never does.`,
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
        id: 'conversations-venue-direct',
        title: 'Venue Direct — messages from the StoryVenue Concierge team',
        tags: ['venue direct', 'concierge', 'support inbox', 'concierge message', 'storvenue team', 'two-way', 'mark read', 'unread', 'collapsible', 'reply'],
        body: `Venue Direct is the two-way channel between the StoryVenue Concierge team and your venue — typically used when a bride is ready for a call or tour and needs a warm handoff to you.

When the Concierge team sends you a message you will see it in your Conversations inbox (Conversations in the sidebar). You'll also be alerted by email and/or a text nudge with a direct link to that bride's contact page, based on your personal notification preferences (Settings → Notifications → "Alerts about your business" → Venue Direct message). Each person on your team chooses their own email/text combination independently.

Replying
- Open the thread in Conversations and type your reply in the composer. Your reply routes back to the Concierge team's support inbox automatically.
- You can also reply directly to the notification email — your reply lands in the thread (no need to log in).

Collapsible email messages
- Long email replies in the thread are collapsed by default. You see a short snippet with a "Show full email" link. Click it to expand the full message inline.

Read / unread status
- The Concierge team marks threads as read or unread to manage follow-up. When they mark a thread read (closed) the alert badge clears.
- If you send a new reply on a closed thread it reopens automatically so the Concierge team sees it again.`,
      },
      {
        id: 'conversations-concierge-inbox',
        title: 'Concierge Inbox — your dedicated Venue Direct thread list',
        tags: ['concierge inbox', 'venue direct', 'inbox', 'unread', 'mark read', 'needs reply', 'concierge messages', 'support', 'filter', 'resolved'],
        body: `The Concierge Inbox is a dedicated page that shows only your Venue Direct threads — messages between your venue and the StoryVenue Concierge team. It is separate from your main Conversations inbox (which shows all contact threads).

How to access it
Sidebar → Venue Concierge. A badge appears on it whenever you have unread Venue Direct messages.

What you see
- A list of all Venue Direct threads sorted by most recent activity
- Each thread shows the contact name, a message snippet, and the timestamp of the last message
- Unread threads are highlighted or badged so you can spot them immediately

Filtering threads
Three filter tabs let you focus on what matters:
- All — every thread, read and unread
- Unread — threads with messages you haven't read yet
- Resolved — threads that have been closed/marked read by the Concierge team

Marking as read / unread
- Open a thread and use the "Mark read" button (when a thread has unread messages) to clear the alert — or "Mark unread" to flag it for follow-up later
- Marking a thread read also clears the badge on the sidebar icon for that thread

Replying
- Open any thread and type in the reply composer at the bottom. Your reply goes directly to the Concierge team's support inbox.
- You can also reply by email — just reply to the notification email you received and it routes back into the thread automatically.

When a new Venue Direct message arrives
- A badge appears on Venue Concierge in the sidebar
- You're alerted by email and/or a text nudge, based on your personal notification preferences (Settings → Notifications → "Alerts about your business" → Venue Direct message)`,
      },
      {
        id: 'conversations-inbound',
        title: 'iMessage-style two-way replies — email & SMS land in the thread instantly',
        tags: ['inbound', 'reply', 'email reply', 'sms reply', 'two way', 'threading', 'realtime', 'imessage', 'instant', 'sent badge'],
        body: `Conversations is two-way. Replies — email or SMS — land back in the same thread within a second or two of arriving. No page refresh, no checking two inboxes.

How fast is "instant"?
- When a contact replies, the message appears in the thread within a second or two.
- While a thread is open, it also checks for new messages by itself every few seconds.

Send confirmation badges
- Every outbound message shows a green "Sent" check once delivery is confirmed, or a red "Failed" badge with an error if the send was rejected.
- The email card shows "Sent to: …" with the actual address the message was delivered to.

Per-message channel — one thread can carry both
- The composer has a Send via Email / Send via SMS toggle on each message. A single thread can carry both email and SMS at once without converting or splitting.

Sending email works out of the box
- Every venue can send email right away, with nothing to set up. Replies always come back to you. Contact StoryVenue support if you'd like to send from your own domain.

Texts sent from outside StoryVenue
If you or a teammate text a couple from your texting app instead of from StoryVenue, that text shows up in her conversation too, under the sender's name and marked as sent from your texting app. Automated texts from your other tools appear as well, marked as automated. So the conversation always shows both sides, whoever answered and from wherever. Older conversations fill in over time.

Reactions
When a couple reacts to one of your texts from their phone (for example "Liked …"), the reaction shows in her conversation on her side, marked Reaction. A reaction isn't counted as a reply: her follow-ups carry on, and you aren't alerted.

If a reply doesn't show up
- **Email replies missing**: give it a few seconds and refresh the conversation. If a reply never shows, contact StoryVenue support.
- **SMS replies missing**: confirm your StoryVenue Legacy integration is connected (Settings → General). Replies arrive in the thread within a few seconds, automatically.`,
      },
      {
        id: 'conversations-sms-troubleshooting',
        title: 'SMS won\'t send — diagnose and fix',
        tags: ['sms', 'sms not sending', 'missing phone number', 'storyvenue legacy', 'troubleshooting', 'phone number', 'diagnose'],
        body: `If outbound SMS fails with a "Missing phone number" message — even when you just added the phone — here's how to fix it.

The most common cause
The phone number in StoryVenue wasn't synced to your connected StoryVenue Legacy account yet.

The fastest fix
Open the contact profile in StoryVenue → make sure the phone number is entered → click Save. This passes the number on to your Legacy messaging account. Then retry the SMS.

If that doesn't work
1. Confirm your StoryVenue Legacy integration is connected at Settings → General — look for the green "Connected" badge.
2. Make sure your StoryVenue Legacy account has an approved texting number. Without one, texts can't be sent. Open your StoryVenue Legacy account → Settings → Phone Numbers to check or assign one.
3. If the issue persists, contact StoryVenue support.`,
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

Open it from the sidebar → Bride Booking System™ → Venue Listing (the listing editor). Everything on that page mirrors what appears at storyvenue.com/venue/<your-slug> when Publish is on.

A second item under the same flyout — Reviews — is where you collect star ratings and written testimonials. Reviews can be published, pending, or hidden. Only published reviews show on your public listing.

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
        body: `The Bride Booking System™ → Venue Listing page saves automatically as you edit — there is no "lose your work if you forget to click Save" moment.

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
1. the Photos section of Bride Booking System™ → Venue Listing (/dashboard/listing/images) — upload files from your computer, or click From media library to pick an image you already uploaded under Media in the sidebar.
2. Bride Booking System™ → Venue Listing — the Photos section links to the same photo tools; you can also open Media library from the listing overview.

Direct upload from Photos:
1. Go to the Photos section of Bride Booking System™ → Venue Listing (or Dashboard → Photos section → Manage photos)
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
- If uploads silently fail on the first try right after a fresh account, reload the page and try again; it works normally after that.
- Large files may take 15–30 seconds on slower connections. The status indicator shows "Saving…" while uploads are in flight.

Uploaded photos are public: anyone who opens your listing can see them.`,
      },
      {
        id: 'listing-media-library',
        title: 'Media — shared images and files for listing, email, forms, and branding',
        tags: ['media', 'media library', 'images', 'files', 'assets', 'upload', 'reuse', 'photos', 'cdn', 'logo', 'pdf', 'documents'],
        body: `Media is your venue-wide folder for everything you reuse across the product. Open it from the sidebar → Marketing → Media (path: /dashboard/media). The old /dashboard/listing/media URL still works and redirects here.

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
  - The brand logo on Settings → Branding (re-uploading the logo replaces it in the library rather than adding a copy).
  - Cover and gallery photos on the Photos section of Bride Booking System™ → Venue Listing.
  - Any image you upload through the email or form builder using "Choose from media library" → Upload from device, or via the Image / Button (File link) blocks.

Page features:
- Drag and drop files anywhere on the page to upload — or click Upload.
- Per-file progress bars during upload.
- Search by filename, filter pills (All / Images / Documents), sort (newest, oldest, name, size), and a grid ↔ list toggle (your view preference saves per browser).
- A trash icon on every card lets you delete in one click; the "..." menu adds Copy URL, Download, Open in new tab, and Rename. The menu closes by itself when you scroll.
- Rename is display-name only — the public URL doesn't change, so existing links keep working everywhere they're already pasted.

Click any file to preview it
- Images open full-bleed in the preview modal.
- PDFs render in the browser's native PDF viewer.
- Word, Excel, and PowerPoint files open in a built-in viewer (no plugin or download required).
- Plain text and CSV files render inline with monospaced formatting.
- Anything outside those types shows a friendly "preview not available" with the Download / Open in new tab buttons still accessible.
- The preview modal's toolbar always shows Open in new tab and Download, so you can grab the file regardless of the file type.

Download
- Click Download from the asset menu (or from the preview modal toolbar) and the file saves directly to your computer with its original name.

Used in indicator:
- Each file shows where its URL is referenced today: Brand logo (Settings → Branding), Listing cover/gallery (the Photos section of Bride Booking System™ → Venue Listing), Email templates and campaigns, Lead capture forms.
- The Delete confirm modal lists every place the file is used so you can replace those references first if you don't want them to break. If the file you delete is the brand logo, the listing cover image, or in the gallery, those are cleared too, so you never see a broken image.

Tip: On the Photos section of Bride Booking System™ → Venue Listing and the marketing Email/Form Image blocks, use "Choose from media library" to attach an existing asset without re-uploading.`,
      },
      {
        id: 'listing-publish',
        title: 'Publishing and unpublishing your listing',
        tags: ['publish', 'unpublish', 'live', 'visible', 'hidden', 'public'],
        body: `The Publish toggle (top of the Bride Booking System™ → Venue Listing page) controls whether couples can find your venue on storyvenue.com.

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
- Check the URL uses your exact slug (Bride Booking System™ → Venue Listing → URL slug field)
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
        tags: ['reviews', 'testimonials', 'stars', 'storyvenue', 'embed', 'published', 'rating'],
        body: `Under Bride Booking System™ → Reviews (StoryVenue tab) you manage testimonials that couples and clients leave for your venue.

Each review has:
- Star rating (1–5 stars)
- Optional title
- Review text
- Couple name
- Optional wedding date and email

Statuses:
- Published — shown on storyvenue.com.
- Pending — held for moderation (useful if you later allow couples to submit reviews directly).
- Hidden — not shown publicly.

On storyvenue.com, published reviews appear in a single-column list on your venue page. Up to 4 are shown with a "Show all" button to expand the rest.

Showing reviews outside storyvenue.com:
- Paste the code from the Reviews page into your own website — it's ready to use. Only published reviews are shown.
- Your listing must be published for reviews to appear publicly.`,
      },
      {
        id: 'listing-google-reviews',
        title: 'Connecting your Google Business Profile for Google reviews',
        tags: ['google reviews', 'google business profile', 'place id', 'gbp', 'google maps', 'connect google', 'google rating', 'service area business'],
        body: `The Google tab under Bride Booking System™ → Reviews lets you connect your Google Business Profile so your Google reviews display on your storyvenue.com listing page.

How to connect:
1. Go to Bride Booking System™ → Reviews → Google tab.
2. The tab automatically searches Google for your business using your venue name and location. If your business appears, click "Yes, that's us." That's it — your Google reviews will start showing on your listing.
3. If the auto-search doesn't find your business (common for service-area businesses with no physical address), expand "Can't find it? Paste a Google Maps link instead."
4. In that section, paste any Google Maps URL for your business — a share link (maps.app.goo.gl/...), a full browser URL, or a link from your Google Business Profile. Click Resolve and the system extracts the Place ID automatically.

Service-area businesses (no fixed storefront):
Google can't find service-area businesses by a name search. Use the Google Maps link method above. If that also fails, go to Google's Place ID Finder tool (the link appears in the fallback UI), search for your business there, and paste the Place ID directly.

Once connected:
- A green "Connected to Google Business" banner appears.
- StoryVenue brings in your Google reviews.
- Use the refresh icon to bring in the latest at any time.
- To switch to a different Google Business, click "Change business."

On storyvenue.com:
- Up to 5 Google reviews are shown in a single-column layout below your StoryVenue reviews.
- A "See all Google reviews" button links directly to your full Google Business listing on Google Maps so couples can read all your reviews.
- The footer shows "Showing X of Y Google reviews" so couples know more exist.

If Google Business search isn't working, contact StoryVenue support.`,
      },
      {
        id: 'listing-analytics-realtime',
        title: 'Real-time visitor map — see who\'s on your listing right now',
        tags: ['visitor map', 'real time', 'realtime', 'analytics', 'world map', 'live visitors', 'map', 'location', 'who is visiting', 'geo'],
        body: `The Bride Booking System™ → Dashboard page includes an interactive world map that shows visitors currently on your storyvenue.com listing in real time.

How to access:
1. Go to Bride Booking System™ → Dashboard.
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

Good to know:
- Visitors are counted anonymously while they're on your listing.
- The map refreshes by itself while you have the page open.

Privacy: only an approximate location (city level) is kept. No names, emails, or devices are linked to the markers.`,
      },
      {
        id: 'listing-booking-system',
        title: 'Speed to Lead System — 5-phase automated follow-up',
        tags: ['booking system', 'speed to lead', 'guide delivery', 'pricing guide', 'pdf', 'sms guide', 'email guide', '14-day sequence', 'booked tour', 'booked wedding', 'automation', 'bride', 'lead form', 'public listing', 'pricing_guide_url', 'merge variable', 'ai concierge trigger', 'phase', 'appointment_date', 'appointment_time', 'venue_address', 'owner_name'],
        body: `The Speed to Lead System (Bride Booking System™ → Speed to Lead System) automates everything from the moment a bride submits your listing inquiry form to when she books her wedding.

Path: Bride Booking System™ → Speed to Lead System (sidebar)

The system has 5 phases, each with its own toggle so you can enable only what you need. By default, only Phase 1 (Guide Delivery) and Phase 2 (14-Day Sequence) are on — Phases 3 and 4 (Booked Tour, Booked Wedding) start off so venues can review/customize the pre-filled copy before turning them on.

Phase 1 — Inquiry → Guide Delivered (instant)
Triggered immediately when a bride submits your inquiry form. Sends her an email and/or SMS with a direct link to your Pricing & Availability Guide PDF.
- Toggle "Email" and/or "SMS" on independently.
- Write the message body. Use {{pricing_guide_url}} to insert the guide link, {{first_name}} for her name, {{venue_name}} for your venue, {{owner_name}} for the venue owner's name.
- The PDF link is always live — every click generates the current version of your guide. Edit your Pricing Guide and the next click delivers the updated version automatically. No re-upload needed.

Phase 2 — Guide Delivered → 14-Day Sequence
A 7-touch SMS nurture sequence (Day 1, 2, 3, 5, 7, 10, 14) that fires after guide delivery until the bride replies. Comes pre-loaded with proven default copy — fully editable.
- Add steps with the "+" button: Send Email, Send SMS, Wait, or Activate AI Concierge.
- Drag steps to reorder.
- The sequence stops automatically the moment a bride replies to any message.
- You can see how many leads are currently active in this sequence in the phase subtitle.
- "Activate AI Concierge" block: hands the lead off to the AI Concierge at that point in the sequence. Once added, the AI takes over follow-up from there.
- For extra educational emails beyond this sequence, build an Email Campaign (Marketing → Campaigns).

Phase 3 — Booked Tour → Toured
Fires the moment a lead is moved to the "Tour Booked" pipeline stage. 3 touches (SMS immediate, email immediate, email +2 days) with everything the bride needs before her visit. Supports {{appointment_date}}, {{appointment_time}}, and {{venue_address}} merge variables (sourced from the calendar event tied to her tour). No AI Concierge handoff.

Phase 4 — Booked Wedding → Welcomed
Fires the moment a lead is moved to the "Wedding Booked" pipeline stage. 5 touches (SMS, email, email +3 days, email +7 days, SMS +1 day) celebrating the booking and setting next steps. No AI Concierge handoff.

Phase 5 — AI Concierge (All-Inclusive plan only)
An AI-powered SMS follow-up system that contacts quiet leads on a 1–2 day cadence until they reply or 60 days pass.
- Phase 5 is locked on the Bride Booking System™ Free and Bride Booking System™ plans. The toggle is greyed out with an "All-Inclusive" badge.
- Hovering the locked toggle shows a tooltip: "AI Concierge is on our All-Inclusive plan, not Free or the Bride Booking System™. Schedule a demo to learn more."
- Clicking the greyed toggle opens the demo scheduling calendar.
- Once on an eligible plan, enabling Phase 5 embeds the full AI Concierge settings inline — persona name, concierge notification email, and eligibility status.

Stop on reply (all phases)
The moment a bride replies (email or SMS) during any active sequence, every follow-up to her stops and you are notified. The lead moves to "Conversations Started" in the pipeline.

SMS delivery note
The Speed to Lead System email delivery does not require a StoryVenue Legacy connection. StoryVenue Legacy is only needed for SMS steps. All email delivery and merge variables are handled natively by StoryVenue — you can use email-only phases even without a Legacy connection.`,
      },
      {
        id: 'listing-analytics-retention',
        title: 'Daily views & analytics retention — does StoryVenue save historical traffic?',
        tags: ['analytics', 'history', 'historical', 'retention', 'daily views', 'data retention', 'page views', 'unique visitors', '30 days', '90 days', '365 days', 'archive', 'old data', 'last 30 days'],
        body: `Yes — every event on your storyvenue.com listing is saved permanently. There is no expiration or auto-deletion. The date-range picker (1 / 7 / 14 / 30 / 60 / 90 days) only chooses how far back the charts look.

What's tracked
- Page views (every visit to your public listing)
- Listing impressions (every time your listing appears in directory search results)
- Unique sessions (per anonymous browser-tab session)
- Scroll depth (25% / 50% / 75% / 100%)
- Photo views, FAQ opens, social clicks
- Contact form opens & submissions
- Device type, where the visitor came from, and approximate location (country, region, city)

How long we keep it
- Visitor data is stored permanently — there is no expiration or auto-deletion. A 365-day lookback is available today.

Why the "Daily views" chart sometimes looks sparse
- The chart shows the full requested window (e.g. all 30 days for a 30-day query) with zeros backfilled for days that had no traffic. So a quiet venue will see a flat line at zero with a couple of spikes — that's NOT missing data, it's a faithful picture of "no one visited that day."
- If you see only one day of data on a 30-day chart, that just means your listing was visited on that one day in the last month. Switch to a longer window (60 / 90 days) to see more history.

Test that tracking is working
- Open your public listing in an incognito tab → wait ~5 seconds → return to the analytics page and refresh. You should see the unique-sessions counter go up and a new dot on today's column in the Daily views chart.
- The "Live visitor map" updates within ~10 seconds and is the fastest way to confirm the tracker is recording your visit.

If you're convinced data should be there but isn't
- Verify your listing is published (Bride Booking System™ → Venue Listing → Published toggle). Tracking still records events for unpublished listings, but no real visitors can reach them.
- Make sure your tracker isn't blocked by an ad-blocker on your test browser (most ad-blockers don't affect it, but some aggressive ones do).
- Ask AI can help you check your event counts — just describe what you're looking for.`,
      },
      {
        id: 'listing-web-form',
        title: 'Web Form — put your inquiry form on your own website',
        tags: ['web form', 'website form', 'embed', 'embed code', 'inquiry form', 'contact form', 'wordpress', 'squarespace', 'wix', 'webflow', 'website leads', 'form code'],
        body: `Web Form gives you your inquiry form as a small piece of code to paste into your own website. A bride who fills it in lands in your Lead Inbox, gets your pricing guide right away, and is followed up by your Speed to Lead System, exactly like a bride who inquires from your StoryVenue listing.

Where to find it
Bride Booking System™ → Web Form. The code is on the left and a preview of your form is on the right. (The same code is also on the Pricing Guide page: Get Embed Code.)

Add the form to your website
1. Press Copy code.
2. Open the page on your website where the form should go. Your contact page or your pricing page works best.
3. Add a block for custom code. It's called Custom HTML in WordPress, Code in Squarespace, Embed HTML in Wix and Embed in Webflow.
4. Paste the code, save, and publish the page.
5. Fill in the form on your website once as a test. Your inquiry shows up in your Lead Inbox.

If someone else looks after your website, send the code to them.

Good to know
- The preview shows the form exactly as brides see it on your website.
- The form uses your colors from Settings → Branding. Change them there and the form on your website updates by itself.
- Leads from this form show as Web Form on your Bride Booking System™ dashboard, so you can see how many your website brings in.`,
      },
      {
        id: 'listing-lead-link',
        title: 'Lead Link — your link-in-bio landing page',
        tags: ['lead link', 'link in bio', 'link tree', 'linktree', 'instagram', 'tiktok', 'facebook', 'social', 'bio link', 'social media', 'landing page', 'links page'],
        body: `Lead Link is a ready-made "link in bio" landing page that turns your social media followers into leads. Instead of posting your website in your Instagram, TikTok, or Facebook bio, you post one Lead Link — a clean landing page that guides brides straight to booking.

Where to find it
Path: Bride Booking System™ → Lead Link (sidebar).

Your Lead Link address
Your Lead Link is a short address of your own, like storyvenue.com/v/your-venue. Press Copy on the Lead Link page and paste it into your social profiles' "link in bio" field. Under Customize your link you can change the ending to something short and memorable (letters, numbers, and dashes).

It builds itself from your listing
Lead Link automatically pulls in:
- Your venue name and photo
- The social handles you've already added to your listing (so brides can find all your profiles in one place)

Two built-in buttons (always shown)
- Venue listing — opens your public storyvenue.com listing
- Download Pricing & Availability — opens a quick lead-capture form right on the page. When a bride fills it out, a real lead is created and your Speed to Lead follow-up begins automatically — just like your listing's inquiry form.

Live preview
An iPhone-style preview on the page shows exactly what brides see on their phone. It refreshes after you save changes.

Why it helps
- One simple link for every social profile
- Captures leads from organic social traffic that would otherwise bounce
- Every button click and lead is tracked (see the companion article on custom links, QR codes, and tracking)`,
      },
      {
        id: 'listing-lead-link-custom',
        title: 'Lead Link — custom buttons, QR code, and click tracking',
        tags: ['lead link', 'custom links', 'buttons', 'icons', 'icon pack', 'qr code', 'print', 'table card', 'tracking', 'clicks', 'booking funnel', 'source', 'analytics'],
        body: `Beyond the two built-in buttons, your Lead Link page can be customized and fully tracked.

Add your own buttons (up to 3)
On the Lead Link page, use "Your own links" to add up to 3 custom buttons — for example Book a Tour, Video Tour, Menu, or a Google review link. For each one:
1. Click Add link
2. Pick an icon from the icon pack
3. Enter a label (e.g. "Book a Tour") and the URL
4. Click Save links

Custom links always open in a new tab so brides never lose your Lead Link page.

Generate a QR code
The Lead Link page includes a QR code generator. Download the QR image and print it on table cards, signage, brochures, or flyers so people can scan straight to your Lead Link in person — great for open houses and bridal shows.

Track every click
Your analytics dashboard shows how your Lead Link is performing:
- How many times the page was viewed
- How many times each button was clicked

These numbers respect the date filters on your dashboard, so you can compare periods.

Leads get their own source
Leads captured through the "Download Pricing & Availability" form on your Lead Link show up under their own "Lead Link" source in your Booking Funnel — so you can see exactly how much business your social bio link is driving, instead of it being lumped into "Other".`,
      },
    ],
  },
  {
    id: 'leads',
    label: 'Lead Inbox',
    iconName: 'Inbox',
    color: '#7c3aed',
    articles: [
      {
        id: 'leads-overview',
        title: 'Leads and sales pipeline overview',
        tags: ['leads', 'pipeline', 'kanban', 'sales', 'inbox', 'directory leads', 'form', 'space', 'contact stage'],
        body: `The Lead Inbox is your sales pipeline. Open it from the sidebar → Lead Inbox.

Every contact with an email shows up in the pipeline, and a lead always shows the stage on its contact profile. Move a contact's stage on the Contacts page and the Lead Inbox shows it — and the other way round. A lead whose stage was deleted moves to the first stage of the default pipeline, so nothing drops off the board.

How leads arrive:
- By themselves, from every door you've opened: the inquiry form on your storyvenue.com listing, the Web Form on your own website, your Lead Link, and Lead Finder (inquiry emails from other directories).
- You can add leads by hand with the "Add lead" button in the top-right. The New Lead modal includes a Space picker and a Pipeline / Stage picker. Choose "None" as the stage to track a contact without placing them in an active pipeline column — they'll appear only on the Contacts page, not the Kanban.

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

The pipeline picker (top-right) lets you switch between multiple pipelines. Everyone starts with the default Bride Booking System™ pipeline and its 8 stages: Lead, Conversations Started, Qualified, Tour Booked, Proposal Sent, Wedding Booked, Follow up, Not Interested. That pipeline is locked. To work with stages of your own, create a pipeline with the Edit button.

When a customer profile exists with the same email as a lead, updating the stage on the customer profile or moving the card on the Kanban can keep both in sync (see the customer profile pipeline section).

Pipeline intelligence — Below the page header, an insights strip summarizes open pipeline (sum of opportunity values), weighted pipeline (deal value × each stage's win probability; see next articles), rough booked revenue by referral label vs directory-sourced leads (from paid proposals matched by email), and a simple ROI vs optional listing marketing monthly spend when that budget is stored on your venue. This is directional, not accounting-grade.

Tags — leads can carry tags. Add or remove them in the lead drawer.`,
      },
      {
        id: 'leads-crm-intelligence',
        title: 'Pipeline intelligence, owners, audit trail, and revenue visibility',
        tags: ['weighted', 'forecast', 'roi', 'audit', 'owner', 'assign', 'hide revenue', 'permissions', 'log call', 'insights', 'listing spend'],
        body: `The Lead Inbox includes tools for forecasting, accountability, and team permissions.

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
        body: `The Kanban view is the default in the Lead Inbox. Each column is a stage in your pipeline.

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
        tags: ['edit pipeline', 'rename stage', 'add stage', 'delete stage', 'multiple pipelines', 'custom pipeline', 'default pipeline', 'locked pipeline', 'protected pipeline'],
        body: `Every account has a default pipeline (the "Bride Booking System™" pipeline) that comes pre-built with 8 stages: Lead, Conversations Started, Qualified, Tour Booked, Proposal Sent, Wedding Booked, Follow up, Not Interested. You can also create additional custom pipelines for different brands, properties, or sales processes.

Open the editor:
- Top-right of the Lead Inbox, pipeline dropdown → Edit button
- A modal opens with your pipelines listed on the left, stages on the right.

Default pipeline — locked (read-only)
The default pipeline and its stages are locked and cannot be edited or deleted. Your follow-up and your reports rely on these stages.
- You cannot rename, recolor, reorder, add, or delete stages in the default pipeline.
- You cannot delete the default pipeline itself.
- A lock badge appears on locked stage rows. If you try to edit them you'll see a message explaining they are protected.
- If you need a different stage structure, create a new custom pipeline — you can make it the active view without making it the default.

Editing stages in custom pipelines (right panel):
- Rename — click a stage name and type a new one; it saves when you tab/click away.
- Change color — click the color swatch to open a color picker popover with the color wheel, a hex code field, and preset swatches.
- Stage kind — Active (open), Won, or Lost. Won stages count as booked revenue in stats.
- Win probability — 0–100% per stage for weighted pipeline totals.
- Reorder — use the up/down arrow buttons.
- Delete — trash icon. Any leads in that stage become unassigned.
- Add — type a name in the "New stage" box and click Add stage.

Creating a new pipeline:
- Type a name in the "New pipeline name" box on the left panel → Add pipeline
- New pipelines start with the default 8-stage template — edit freely from there.

The "None" stage
- Both the New Lead and New Contact forms include a "None" option. Choosing None saves the contact without placing them in any pipeline column — they appear on Contacts but not on Kanban.

Deleting a pipeline:
- You can delete a pipeline you created. The default pipeline can't be deleted, and new leads always land in it.

Use "Use this pipeline" to make a pipeline the active view in the Lead Inbox and close the editor in one click.`,
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
- Add or remove tags, and create new tags right from the lead.

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
- Calendar — opens the New Event modal with this contact pre-filled so you can book an appointment instantly

Why use card actions?
When you're scanning the Kanban board and need to take a quick action on several leads in a row, these buttons save you from opening and closing the full drawer for each one. They're built for speed when you're working through a list.

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
        body: `The Lead Inbox has two tools for finding a specific lead:

Search box (top)
- Type any part of: first/last name, email, phone number, venue name, venue website URL, inquiry message, or note content
- Results update as you type
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
        body: `The Ask AI widget (bottom-right of every page) knows about your leads when you're in the Lead Inbox.

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

Ask AI uses your live pipeline data when you're in the Lead Inbox (totals, recent leads, notes snippets). It does not change leads for you — use the Kanban board or drawer to make edits. Treat the dashboard as the source of truth for exactly what your role can view.

If an answer looks out of date, refresh the page and ask again.`,
      },
      {
        id: 'leads-notifications',
        title: 'Lead notification emails',
        tags: ['notification', 'email', 'lead email', 'alert', 'inquiry email', 'not receiving'],
        body: `Every new lead sends you ONE email, whatever it came from: your StoryVenue listing, your Lead Link, your website form, a form you built (including forms behind Meta ads), Lead Finder, a connected tool, or a lead you add yourself.

The email lists where the lead came from first, then everything they gave you: name, email, phone, wedding date, guest count, every form answer and their message. Hit Reply to write back to them, or View Lead to open them in StoryVenue. Lead Finder leads also include the original directory email (unless you've turned Lead Finder's inbox copies off).

Who gets it:
- You and each team member, with your own New lead switches (email, text, push) in Settings → Notifications
- Your copy goes to your notification email, which defaults to your account email
- A form you built can also send the same email to extra addresses (the form's Notification recipients)

Not receiving emails?
- Check spam / promotions folder
- Settings → Notifications: make sure New lead email is on for you
- Confirm the notification email address is correct and receives mail
- Leads are still saved in the dashboard even if the email fails — open /dashboard/leads to see them

SMS for high-value leads is not currently on by default; contact support if you want to enable it.`,
      },
      {
        id: 'leads-space',
        title: 'Capturing a space on a new lead',
        tags: ['space', 'venue space', 'new lead', 'primary space', 'barn', 'garden', 'ballroom', 'add space', 'edit space'],
        body: `The Add lead form in the Lead Inbox includes a Space field so you can record which venue space the couple is most interested in at the moment the inquiry comes in — no extra step later.

How it works
- Open the Space dropdown and pick any saved space (Barn, Garden, Ballroom, etc.).
- Click Manage next to the field to add, rename, recolor, or remove spaces inline — you don't have to jump to the Calendar page. The exact same controls you already use when creating a calendar event are mirrored here.
- Leave it empty if the couple hasn't decided yet; you can fill it in later from the lead drawer.

Why it matters
- Space is carried through to calendar events and proposals, so when you book a tour or send a quote the correct space is already attached.
- Insights and reports can slice inquiry volume by space to help you see which areas are driving demand.

If the Space field isn't saving
- Contact StoryVenue support — this may require a configuration update on our end.`,
      },
      {
        id: 'leads-to-proposal',
        title: 'Turning a lead into a customer and proposal',
        tags: ['convert', 'proposal', 'customer', 'lead to customer', 'book', 'quote'],
        body: `Leads are the top of your funnel. Once a lead is worth pursuing, here's the path through StoryVenue:

1. Lead Inbox → open the lead and review the details
2. Reply to her from Conversations, or with the quick actions on her card
3. Book her tour: open the lead → Schedule appointment (Type: Tour). The lead moves to Tour Booked by itself
4. After the tour, go to Payments → New → pick her from your contacts → apply a proposal template → send. Move the lead to Proposal Sent
5. When she signs and pays, move the lead to Wedding Booked

The lead stays in your Lead Inbox as a permanent record of where this customer came from, linked to her contact profile, so you always have the full history in one place.`,
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
- Pipeline and Stage (same pipelines used in the Lead Inbox — pick "None" to track without placing them in an active pipeline stage)
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

Results are paginated (20 per page). Use the page navigation bar at the bottom to jump directly to any page (displayed as "Page X of Y") or step through with the Previous / Next arrows.`,
      },
      {
        id: 'cust-profile',
        title: 'Contact profile — overview and tabs',
        tags: ['contact profile', 'crm', 'profile', 'tabs', 'overview', 'history', 'edit note', 'edit notes', 'new proposal', 'new invoice'],
        body: `Click a contact's name to open their full profile. Contacts you see on this list come from three sources — storyvenue.com signups, StoryPay™ payments, and Legacy imports — all unified into one record per person. The profile has seven tabs:

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

Schedule
- Book a new appointment for this contact directly from their profile — no need to navigate to the Calendar
- See all upcoming and past appointments linked to this contact's email in one view
- Click any appointment to open the event detail and edit or cancel it

Below the main header row, the Pipeline section lets you choose which sales pipeline applies (the same pipelines as the Lead Inbox) and shows stage pills for that pipeline. Click a pill to move the contact to that stage; it saves right away. If a lead exists with the same email, you may see a note that the profile is linked to a lead and stages can stay in sync both ways.

The header also shows a stage badge, referral source when set, and KPIs: proposals count, total paid, pending amount, open tasks.

On the Contacts list page itself, each row also has "Create Proposal" and "Create Invoice" shortcut buttons that open the payment builder with the contact pre-selected.`,
      },
      {
        id: 'cust-pipeline',
        title: 'Sales pipeline, stages, and referral source',
        tags: ['pipeline', 'stage', 'lead', 'referral', 'source', 'funnel', 'crm', 'kanban', 'sales pipeline'],
        body: `Contact profiles use the same sales pipelines as the Lead Inbox. Your venue can have one or more pipelines; each has ordered stages with names and colors. The default Bride Booking System™ pipeline has Lead, Conversations Started, Qualified, Tour Booked, Proposal Sent, Wedding Booked, Follow up, and Not Interested, and is locked; pipelines you create can have any stages you like.

On the contact profile:
1. Choose the Pipeline from the dropdown.
2. Click a stage pill to move the contact to that stage. It saves right away.

If a lead in your Lead Inbox has the same email as this contact, the profile shows that it is linked to a lead, and the stage stays the same in both places.

Referral source (how the couple found you) is separate from pipeline: Instagram, Google, Wedding Wire, The Knot, Referral, Venue Website, Facebook, or Other. Set it from the Overview tab / contact area.

If pipeline or stage changes aren't saving, contact StoryVenue support.`,
      },
      {
        id: 'cust-tasks',
        title: 'Contact tasks — create, edit, reopen',
        tags: ['tasks', 'todo', 'checklist', 'follow up', 'reminder', 'edit task', 'reopen task', 'uncheck task', 'update task'],
        body: `The Tasks tab on a contact profile lets you create action items for that contact.

To add a task:
1. Open the contact profile → Tasks tab
2. Type the task title in the input box
3. Optionally set a due date
4. Press Enter or click the + button

Tasks show in order of creation. Overdue tasks (past due date) display the due date in red.

To mark a task done: click the checkbox next to the task. Completed tasks collapse into a "X completed tasks" section at the bottom of the list — click it to expand and review.

To reopen a completed task (move it back into the active list): expand the completed section, then either uncheck its checkbox or click the "Reopen" button on the task row.

To edit a task after it has been created: hover the task row and click the pencil icon. The title (and due date) become editable inline. Click Save to commit the change or Cancel to discard.

To permanently delete a task: open a completed task row and click the trash icon.

Tasks are visible only to your team — they are not shared with the contact.`,
      },
      {
        id: 'cust-documents',
        title: 'Contact documents and files',
        tags: ['documents', 'files', 'upload', 'contract', 'floor plan', 'insurance', 'attachment'],
        body: `The Documents tab lets you attach files to a contact profile: signed contracts, floor plans, vendor agreements, insurance certificates, photos, and more.

To upload a file:
1. Open the contact profile → Documents tab
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
Toggle the switch on for the channel you want to block. The change saves and is passed on to your Legacy messaging account. If that can't be reached at that moment, a warning appears and it is tried again later.

Compliance enforcement
This is a critical compliance feature. When SMS DND is enabled for a contact, StoryVenue will block all outbound SMS to that number, automatic ones included. The contact will not receive the message. This applies to calendar reminder texts, confirmation texts, and your automated follow-up.

Who has it
DND is available for venues using StoryVenue Legacy messaging.

Tags added when DND changes
When you enable SMS DND, the contact is tagged as opted out of texts. When you enable DND All, the contact is tagged do-not-contact. You can use these tags to build audiences, or to leave the contact out of a campaign.`,
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
        id: 'offerings-overview',
        title: 'Packages & Items (Offerings catalog)',
        tags: ['offerings', 'packages', 'items', 'products', 'bundles', 'catalog', 'line items', 'price list', 'venue packages', 'venue products', 'contract template link', 'season', 'inventory', 'portal'],
        body: `Path: Payments → Packages.

The Packages page is your product and package catalog — everything you sell. It has two types:

Items
Individual products or services you sell (e.g. "Rehearsal Dinner Add-on," "Upgraded Florals," "Videography Package").
- Name and description
- Price (USD)
- Unit — "per person," "per event," "per hour," custom, or none
- Recurrence — One-time, Monthly, or Weekly (for subscription-style charges)
- Inventory mode — Unlimited or Limited quantity (set a cap; the item becomes unavailable once sold out)
- Show on customer portal — toggle to control whether couples can see and select this item in the client portal
- Active toggle — deactivated items don't appear in the proposal line-item picker

Bundles (Packages)
Pre-built line-item collections — great for your named packages ("Intimate Package," "All-Day Ballroom," "Grand Estate").
- Name, description, and an optional season label (e.g. "Spring/Summer 2026")
- Valid from / Valid to dates — bundles outside their validity window are filtered out in the proposal builder
- Minimum subtotal — a floor price for the package
- Line items — select items from your catalog plus per-line quantity and optional price override
- Default contract template (optional) — link this bundle to a proposal template. When you pick this package while building a proposal, the line items AND the linked contract body both load automatically in one step (only if no contract is already written)
- Active toggle

How line items work in proposals
When you create a proposal or invoice (Payments → New), type in the line item box or click the package icon to browse your bundles and items. Selecting a bundle applies all its line items at once. If the bundle has a linked contract template and the contract field is currently empty, the template loads automatically.

Quick-add item from inside a bundle
While editing a bundle, if you need an item that doesn't exist yet, there's an inline "Quick add item" shortcut — create a new backing item without leaving the bundle editor.`,
      },
      {
        id: 'pay-new',
        title: 'Creating a new proposal or invoice',
        tags: ['new proposal', 'new invoice', 'create', 'send', 'draft', 'manual payment', 'cash', 'check', 'collect'],
        body: `Go to Payments → New in the sidebar.

Step 1 — Choose mode: Proposal (includes a signable contract) or Invoice (line items only, no contract).

Step 2 — Find or create the customer. Type their name or email in the search box. If they're new, fill in the manual fields.

Step 3 — For proposals, choose a template (or start from scratch) and edit the contract text. The AI Proposal Generator can draft contract language for you — click "Generate with AI". If you pick a package that has a default contract template linked, the line items AND the contract load automatically.

Step 4 — Add line items. Type a product name (autocompletes from saved products) or enter a custom item.

Step 5 — Choose how they pay:
- Pay in full — one payment. Optionally set when it's due (on receipt, 7, 14 or 30 days, or a date); if it isn't paid by then, your client gets a reminder email.
- Payment plan — a deposit, then payments on set dates. See "Payment plans" for the options.

Step 6 — Choose how you'll collect payment:
- Online — client pays by card or bank transfer (ACH) through StoryPay™ (powered by Stripe), right on the proposal or invoice
- Manually — you collect cash or check directly. The client-facing page shows a "venue collects directly" message instead of a payment form. For manual proposals, you can also uncheck "Require client e-signature" if you'll get a wet signature in person.

Step 7 — Click Send to email the proposal/invoice to the customer, or Save Draft to keep it for later.

The customer receives a branded email with a link to view, sign (if required), and pay.`,
      },
      {
        id: 'pay-templates',
        title: 'Proposal templates',
        tags: ['template', 'contract', 'reuse', 'edit template', 'package', 'auto-fill', 'auto load'],
        body: `Templates save your standard contract text so you don't re-type it every time.

To create a template: Payments → Proposal Templates → New Template.
- Give it a name
- Write or paste the contract body in the rich-text editor
- Add signing fields: Signature, Printed Name, Date (drag to reorder)
- Optionally set default pricing and payment type
- Click Save Template

To use a template: when creating a new proposal, choose the template from the dropdown. All the text and signing fields load automatically.

To edit an existing template: Payments → Proposal Templates → click Edit on any template card.

Linking a template to a package: go to Payments → Packages → edit a package → "Default contract template" dropdown. Now when you pick that package while building a proposal, it auto-fills both the line items AND the contract body in one step — no manual template selection needed.`,
      },
      {
        id: 'pay-status',
        title: 'Proposal statuses explained',
        tags: ['status', 'draft', 'sent', 'signed', 'paid', 'partially paid', 'cancelled', 'refunded', 'partial refund', 'expired', 'declined', 'opened'],
        body: `Each proposal moves through these statuses:

- Draft — saved but not yet sent to the customer
- Sent — emailed to the customer
- Opened — the customer has opened the proposal link
- Signed — the customer completed the e-signature
- Paid — the full payment has been received
- Partially Paid — one or more manual payments have been recorded but the full balance is not yet paid (manual collection only)
- Refunded — a full refund has been processed
- Partial Refund — a partial refund has been issued (some payment retained)
- Expired — the proposal passed its due date without being signed
- Cancelled — manually cancelled by the venue
- Declined — the customer declined the proposal

You can resend the proposal email at any status by clicking Resend on the proposals list, the detail page, or the contact profile.

Refund tracking: when a proposal is refunded (full or partial), the refund date is recorded in Reports.`,
      },
      {
        id: 'pay-numbers',
        title: 'Proposal and invoice numbers',
        tags: ['invoice number', 'proposal number', '#1042', 'sequential', 'number', 'search by number', 'reference'],
        body: `Every proposal and invoice gets an auto-incrementing sequential number (like #1042) so you and your couples can refer to a specific booking easily.

Where numbers appear:
- Proposals list — displayed under each client name
- Proposal detail page — shown in the header next to the client name
- Client-facing proposal page — shown as "Proposal #1042" or "Invoice #1042"
- Invoice & receipt page — shown in the header and in the PDF
- Receipt emails — included in the subject line and body
- Transactions page — shown as the invoice number

Searching by number: on the Proposals list, type a number (e.g. "1042" or "#1042") in the search box to jump to that booking instantly.

Numbers start at 1001 and go up in the order proposals are created.`,
      },
      {
        id: 'pay-manual',
        title: 'Recording cash and check payments manually',
        tags: ['cash', 'check', 'manual payment', 'record payment', 'partial payment', 'payment ledger', 'collect manually', 'receipt'],
        body: `When creating a proposal or invoice, choose "Manually" for how you'll collect payment. This is ideal for couples paying by cash or check.

How the client experience works:
- The client's proposal page shows contract text and (optionally) a signature step, but no online payment form.
- Instead it shows a message that the venue will collect payment directly.

Recording a payment:
1. Go to Payments → Proposals & invoices and find the booking.
2. Click "Record payment" (visible on manual proposals in the Actions column, or at the top of the proposal detail page).
3. Enter the amount, choose Cash / Check / Other, optionally enter a check number and a note.
4. Click Save.

You can record multiple partial payments — each one updates the running total and the proposal status (Partially Paid → Paid once the balance reaches zero).

Every recorded payment gets a sequential payment number (#2001, #2002…) so it's easy to reference in conversations or receipt emails.

After each payment, a branded receipt email is automatically sent to the client. The receipt shows the payment amount, method, and remaining balance prominently. If the balance is fully paid, it says "Your balance is now paid in full." The receipt includes a "View all payments" button that links to the downloadable invoice page.

To delete a mistaken payment: open the Record Payment modal and click the trash icon on that payment row.`,
      },
      {
        id: 'pay-detail',
        title: 'Proposal detail page (booking overview)',
        tags: ['detail page', 'booking', 'timeline', 'ledger', 'payment history', 'proposal overview', 'all actions'],
        body: `Every proposal and invoice has its own detail page.

To open it: click any client name in the Payments → Proposals & invoices list. (The pencil/edit icon still goes to the edit form.)

What the detail page shows:
- Header: client name, sequential #number (e.g. #1042), status badge
- Money summary: Total / Paid to date / Balance — three cards at a glance
- Booking timeline: a horizontal step-by-step view showing Created → Sent → Viewed → Signed → Deposit/Paid → Balance, with checkmarks and dates as each step completes
- Payment ledger: every payment recorded against this booking — numbered (#2001, #2002…), with method, date, and amount
- Document: the full contract/invoice body
- Quick actions: Copy link, View proposal, Invoice & receipt, Resend, Record payment (manual proposals), Edit

The timeline gives you a bird's-eye view of where in the process a couple is. Instead of opening the edit form to check if someone has signed, you can open the detail page and see the full history at once.`,
      },
      {
        id: 'pay-pdf',
        title: 'Downloading a branded invoice or receipt PDF',
        tags: ['PDF', 'download', 'invoice PDF', 'receipt PDF', 'print', 'branded', 'parents', 'forward'],
        body: `Every proposal and invoice has a receipt page your client can open without signing in. The "Invoice & receipt" button on the proposal detail page and the link in receipt emails both point here.

What the page shows:
- Venue logo, brand color, and contact info
- Invoice/proposal number (e.g. #1042)
- Bill-to details (client name and email)
- Line items and total
- Status badge: Paid in full / Partially paid / Balance due
- Paid to date and remaining balance if applicable
- Full payment ledger — every payment with its number, method, and date

Downloading the PDF:
Click the "Download PDF" button at the top of the page. The PDF uses your venue's brand color and includes the full payment ledger and balance summary.

Printing:
Click the "Print" button to use the browser's native print dialog. The printed page is clean: white background, just the invoice.

This page is public and shareable — couples can forward the link to parents or anyone helping pay. No login is required to view it.`,
      },
      {
        id: 'pay-installments',
        title: 'Payment plans',
        tags: ['installment', 'payment plan', 'deposit', 'schedule', 'monthly', 'final payment', 'wedding date', 'charge now', 'reschedule', 'update card'],
        body: `A payment plan lets a couple pay over time. When creating a proposal or invoice, choose "Payment plan" and pick how it runs:
- Monthly payments — a deposit due at signing (a dollar amount or a % of the total), then monthly payments from the date you choose. The plan can end a set number of days before the wedding (the lead's wedding date fills in automatically), on a date, or after a number of payments.
- Deposit + final payment — the deposit at signing and the rest on one date, for example 30 days before the wedding.
- Custom — set each payment's amount and date yourself.

StoryVenue works out the payments from the total, so they always add up: regular payments are whole dollars and the last one takes the difference. Click "Edit amounts and dates" to adjust any of them.

How it's collected online (StoryPay™, powered by Stripe):
- Payment 1 is paid when your client signs (or opens an invoice).
- The rest are charged automatically on their dates to the same card or bank account.
- Your client gets an email 3 days before each payment, with a link to update their card.
- If a payment fails, it's retried after 2, 4 and 7 days, and your client gets a link to update their card.
- Nothing is ever charged beyond the balance.

Managing a plan: open the booking from Payments → Payment plans. From there you can change a payment's date, move all remaining payments a month later, charge a payment now, send a card update link, record a check or cash payment (the next payments go down to match), or cancel the remaining payments.

Cash/check plans: you record each payment as it comes in. If one is overdue, your client gets a reminder email (set the timing under Settings → Notifications → Payment Reminder).`,
      },
      {
        id: 'pay-subscriptions',
        title: 'Recurring payments',
        tags: ['subscription', 'recurring', 'weekly', 'monthly'],
        body: `Open-ended recurring subscriptions aren't offered for proposals and invoices. To have a couple pay monthly, use a payment plan: a deposit, then monthly payments charged automatically until the balance is paid, ending on the date you choose (for example 30 days before the wedding).

See "Payment plans" for how to set one up and manage it from Payments → Payment plans.`,
      },
      {
        id: 'pay-transactions',
        title: 'Viewing transactions and issuing refunds',
        tags: ['transactions', 'charges', 'refund', 'history', 'partial refund', 'payment plan'],
        body: `Go to Payments → Transactions.

Transactions lists every payment received, one line each: every payment of a payment plan, and cash or check payments you recorded. Each shows the method, amount, date, any amount refunded, and a link to the booking.

To refund a payment (card or bank, paid online):
1. Click Refund next to the payment, here or in the booking's payment list.
2. Refund all of it or part of it.
3. On a payment plan, choose whether to also cancel the remaining automatic payments (for a booking that's off). Leave it unchecked and the plan keeps running.
4. Confirm. The money goes back to your client's card or bank account, usually within 5–10 business days.

A refund is a credit: your client is never charged that amount again. The booking shows "Partly refunded" until everything paid has been refunded; then it shows "Refunded" and any remaining automatic payments stop.

Refunds you make in your own Stripe dashboard are picked up automatically, whichever payment they're on. StoryVenue's fee on a refunded payment is refunded in proportion; Stripe keeps its own processing fee.

Cash and check payments aren't refunded through StoryPay™: give the money back directly and remove the record from the booking.

Payment plans are listed under Payments → Payment plans.`,
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
2. Brand Settings — upload your logo (PNG, JPG, or SVG, max 5MB). You can also pick from your media library (Marketing → Media — JPEG, PNG, WebP, AVIF, GIF; no video). Your logo shows in a white header with a colored strip underneath in every email.
3. Color Presets — click any preset (Default, Ivory & Gold, Sage & Stone, Blush & Cream, Coastal Blue, Black & Champagne, Warm Earth) to set the Primary/Button, Background, and Button Text colors all at once. Saves automatically when clicked.
4. Social Networks — paste your social profile URLs once. Every marketing-email Social block reads from this list automatically.
5. Time zone — used for scheduling, calendar, and appointment times.

The live Preview panel on the right updates in real time as you change colors and contact info.

Fine-tuning colors
- Color Presets cover the common combinations. You can fine-tune individual colors anywhere a color picker appears (email blocks, forms, etc.).
- Save or remove brand colors from any color picker — they show up in every other picker in the app.

Changes save by themselves as you edit. The "Save Branding Settings" button at the top saves at once.

Note: Branding settings are visible to owners and admins only.`,
      },
      {
        id: 'brand-colors-saved',
        title: 'Saving brand colors — palette across the app',
        tags: ['brand colors', 'palette', 'saved colors', 'color picker', 'hex', 'venue colors', 'reusable colors'],
        body: `Your venue keeps a palette of saved brand colors. The palette lives inside every color picker, so you save and reuse colors right where you're working (email builder, form builder, etc.). Once a color is in the palette it appears in every other color picker across the app.

Adding a color
- Open any color picker (email block inspector, form field, etc.).
- Pick or type a hex code, then click the bookmark/save icon next to the swatch. The color is added to your palette instantly and shows up in every other picker right away.

Removing a color
- Inside any color picker, hover any saved swatch in the palette row and click the small × that appears. Removing a color does not change any email, form, or proposal that already uses it; it just stops showing up in pickers.

Limits
- Up to 50 colors per venue.

Where it shows up
- The color picker in every email block — your saved colors appear at the bottom of the picker so you can apply them in one click.
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
4. Your changes save by themselves after a brief pause.

Each row shows an "Open link" button (opens the URL in a new tab to verify) and a "Remove" button.

Limits
- One URL per platform.
- Up to 8 social links total per venue (one per supported platform — most venues use 3–5).

Where it's used
- Marketing email Social block — every campaign that includes a Social block shows icons and links from this list.
- Per-block show / hide — inside the email builder, the Social block's Links tab has an eye toggle next to every platform. Hiding a platform there hides it for that one email only; your saved links are unchanged. Use it when a particular campaign should only spotlight a subset of your social networks.
- The email builder Social inspector links straight to this section for one-click management.

Empty state
If you don't have any social links saved yet, the Social block in your email shows a hint in the editor pointing you back to Branding. In the email that's sent, the Social block shows nothing to your recipients.`,
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
        title: 'Marketing overview — Campaigns, Audiences, Forms',
        tags: ['marketing email', 'campaigns', 'broadcast', 'newsletter', 'audiences', 'forms', 'preferences', 'overview'],
        body: `Marketing in the sidebar holds your email-marketing tools:

1. Analytics (Marketing → Analytics) — opens, clicks, unsubscribes, and bounces for what you've sent.
2. Campaigns (Marketing → Campaigns) — emails you send to a group of your contacts and leads. The campaigns list has a trash icon on every row so you can delete any campaign (with a confirm prompt) directly from the list.
3. Audiences (Marketing → Audiences) — reusable groups of contacts to send to.
4. Forms (Marketing → Forms) — lead capture forms.
5. Media (Marketing → Media) — the images and files you reuse across emails, forms, your listing, and branding.

Recipients can manage their own subscription on the preferences page linked from every email's footer.

Campaign emails are built in a drag-and-drop block editor, and they always pull in your venue branding — logo, brand colors, brand fonts, address, and social network links — so every send stays on-brand without touching settings.

Where things live:
- Brand colors saved palette → save and reuse colors directly from any color picker (email block inspector, form builder, etc.); the palette is shared across every picker in the app.
- Social network links → Settings → Branding → Social Networks. Power the Social block and footer.
- Address used in the Address block → Settings → Branding (Contact Information) or the venue's primary location.
- The footer with unsubscribe and manage-preferences links is added automatically.`,
      },
      {
        id: 'me-builder',
        title: 'Using the email builder',
        tags: ['email builder', 'editor', 'drag and drop', 'canvas', 'blocks', 'palette', 'inspector', 'preview', 'undo', 'redo'],
        body: `Open any campaign and you land in the email builder — an editor with three panes:

Left: a thin sidebar with view toggles (Desktop / Mobile preview) and undo/redo.
Center: the live canvas showing exactly how the email will render. Click any block to select it and edit inline (text blocks let you type directly on the canvas; buttons let you edit the label live).
Right panel: the inspector. When nothing is selected, the right panel shows the Block Palette — a grid of every block type you can add. When a block IS selected, the right panel switches to that block's inspector with tabs (Primary, Block, and any block-specific tabs like Icons / Links / Block for the social block).

Adding blocks
- Drag any block tile from the right-panel palette and drop it onto the canvas. A blue drop indicator line shows exactly where the block will land — you can drop at any position (including the very last slot).
- Or click the small "+" button between any two blocks to insert directly there.

Editing blocks
- Single-click a block to select it; the right panel becomes that block's inspector.
- Hover any block to see a side toolbar with Move up / Move down / Duplicate / Delete buttons.
- Drag a selected block to a new position by its drag handle.

Right-panel inspector tabs
Every block has a Block tab with shared settings — background color, top/bottom padding, side gutters. Block-specific tabs (Font, Icons, Links, Address, etc.) appear before the Block tab.

Header bar
- The Back arrow returns you to the campaigns list.
- The steps (Design / Recipients / Review) sit above the canvas.
- Preview (the eye icon) and Send are at the far right.

Live preview & send-test
Click the eye icon to open the preview. Links and videos work in it, so it's exactly what your recipient will see in their inbox. There's a Send-test form right there: enter any email address and click Send Test to get a real email.

Undo / Redo
The left sidebar has an undo/redo bar. Every edit (block add, delete, move, style change, text edit) is captured.

Saving
Campaigns save by themselves as you edit. The header shows the save state.`,
      },
      {
        id: 'me-blocks',
        title: 'Block types in the email builder',
        tags: ['blocks', 'block types', 'heading', 'text', 'button', 'image', 'video', 'divider', 'spacer', 'social', 'address', 'columns', 'html'],
        body: `The block palette in the right panel offers every supported block. Drag any tile onto the canvas to add it.

Available blocks:
- Heading (H1 / H2 / H3) — large headline text. Buttons in the format toolbar set the level and its font size.
- Text — paragraph copy with full rich-text formatting (bold, italic, underline, lists, links, alignment, font, color). The format toolbar includes an AI refine button (pencil icon) that rewrites your selection.
- Button — call-to-action button. A tabbed inspector with presets, saved styles, fonts, colors, padding, border radius, and a link pill that supports either a URL or a file from your media library (see the Button block article).
- Image — single image with media-library picker. Supports alignment, padding, link wrapping, and alt text.
- Image grid (multi-image) — 2-, 3-, or 4-column image rows with even gutters between rows and columns.
- Video — 16:9 YouTube-style player. Paste any YouTube, Vimeo, or Loom URL. The thumbnail + play button render on the canvas, and the actual video plays in preview and sent emails (see the Video block article).
- Divider — horizontal rule. Settings: thickness, style (solid/dashed/dotted), color, width %, alignment, top/bottom padding, background color.
- Spacer — vertical empty space. Two settings: Background color and Height (drag the slider).
- Social — row of social network icons. Pulls links from your branding settings; styling controlled by a 3-tab inspector (Icons / Links / Block). The Links tab has an eye toggle next to every platform so you can show or hide a specific platform in this email without changing your saved links. See the Social block article.
- Address — your venue address block. 3-tab inspector (Font / Address / Block). Pulls address from your branding settings; the "Manage my address" button jumps to Settings → Branding.
- Columns — split a row into 2 or 3 columns and drop other blocks inside.
- HTML — your own HTML, for advanced users.

Per-block settings — every block's right-panel inspector ends with a "Block" tab containing the shared settings: top padding, bottom padding, side gutters, and background color. This keeps spacing consistent across blocks.

Aligning content — every block that supports alignment (heading, text, button, image, video, social, address) uses the same alignment selector: four icon buttons (Left, Center, Right, and Full) with a rounded pill highlight on the active option.`,
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
- URL — paste any URL. Toggle "Open in new tab" if you want it to open in a new tab.
- File — pick a file (PDF, image, etc.) from your venue Media library. The button then links straight to that file.

Block — shared block settings (alignment, top/bottom padding, side gutters, background color).

Live editing
Click the button on the canvas and you can edit the label inline — no need to open a separate dialog. The font, color, and other style changes update in real time as you adjust the inspector.`,
      },
      {
        id: 'me-block-image',
        title: 'Image block — media library + multi-image grid',
        tags: ['image', 'photo', 'media library', 'image grid', 'multi-image', 'columns', 'gutters', 'alignment'],
        body: `The Image block uses the same media picker as branding, listing photos, and lead capture forms. Click "Choose from media library" to pick an image you already uploaded, or upload a new one in-place.

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
- Preview — the video plays right in the preview.
- Sent emails — the thumbnail links out to the original video URL, so recipients click through and watch in their browser.

Empty state — when no URL is set, the canvas shows a small hint reading "Add a YouTube, Vimeo or Loom URL".

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
        body: `The Social block shows a row of social network icons in your email. The links come from your Branding settings, so you set them once and every campaign uses them.

Where the links come from
Settings → Branding → Social Networks. From the block's Links tab, click "Manage in branding" to go straight there. You add or change a link there, not inside the email.

Show or hide per email
The Links tab lists every platform you've saved, with an eye toggle next to each. Click the eye to hide that platform in THIS email only — your saved links stay as they are, and other emails still show it. Useful when one campaign should only highlight, say, Instagram and TikTok. The counter ("X of Y visible") shows where you stand, and "Show all" brings back anything you've hidden.

Tabs
- Icons — choose the look: outline, filled circle, or solid circle. Pick a color, a size (S / M / L), an alignment (Left / Center / Right / Full), and the spacing between icons.
- Links — your saved platforms (Instagram, Facebook, TikTok, LinkedIn, YouTube, Twitter/X, Pinterest, Website), with "Manage in branding" at the top and the eye toggles.
- Block — shared block settings (background, padding).

The icons are simple, clean versions of each platform's mark, so every email has a consistent look.

If you have no social links saved
- In the editor, the block shows a hint pointing you to Branding.
- In the email that's sent, the block shows nothing.`,
      },
      {
        id: 'me-block-address',
        title: 'Address block — pulled from branding',
        tags: ['address', 'physical address', 'location', 'mailing address', 'compliance', 'branding'],
        body: `The Address block displays your venue's physical address inside an email — useful for compliance with anti-spam laws (CAN-SPAM, CASL) which require a physical mailing address in every commercial email.

Where the address comes from
Your venue Branding settings (Settings → Branding → Contact Information). You can't edit the address inside the builder; click "Manage my address" on the Address inspector tab to jump straight to the Branding page and update it once for every campaign.

3-tab inspector
- Font — typography for the address text: font family, size, weight, color, letter spacing.
- Address — the address preview with a "Manage my address" button.
- Block — shared block settings (alignment, top/bottom padding, side gutters, background color).

Compliance
You should keep an Address block in every marketing email. The same applies to the unsubscribe footer added automatically by StoryVenue (see the email compliance article).`,
      },
      {
        id: 'me-block-divider-spacer',
        title: 'Divider and Spacer blocks',
        tags: ['divider', 'spacer', 'separator', 'horizontal rule', 'whitespace', 'gap'],
        body: `Two utility blocks for breaking up content in your email.

Divider — a horizontal rule. Settings:
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
        tags: ['brand colors', 'palette', 'color picker', 'saved colors', 'eyedropper', 'hex'],
        body: `Brand colors are your venue's saved palette, and it lives inside every color picker. You save and remove colors right where you're using them. Once a color is in your palette it appears in every color picker across the app: the email builder (text, button, background, divider, social icons, etc.), the form builder, anywhere a color is picked.

Adding a color
- From any color picker, choose a color (hex code, picker, or eyedropper) and click the bookmark/save icon next to the swatch. It's added to your palette and shows up in every other picker right away.

Removing a color
- Hover any saved swatch in a picker's palette row and click the small × that appears. Removing a color doesn't change any email, form, or proposal that already uses it.

The color picker
- Has a hex field, a color square, an eyedropper (where the browser supports it), and a row of your saved brand colors at the bottom.

Limits — you can save up to 50 brand colors per venue.`,
      },
      {
        id: 'me-fonts',
        title: 'Fonts in the email builder',
        tags: ['fonts', 'google fonts', 'typography', 'font family', 'weight', 'font selector'],
        body: `Every block with text (heading, text, button, address) has a font selector. Pick from a list of Google fonts that work well in email; the font you choose shows in both the editor and the sent email.

For inline emphasis (bold / italic / underline / strikethrough) use the format toolbar that appears when you select text inside a Heading or Text block.

Per-block overrides
- Font family — affects only that block.
- Font weight — Light, Regular, Medium, Semibold, Bold (depending on which weights the font ships).
- Font color — uses the brand-colors palette.
- Letter spacing — fine-tune tracking.
- Line height — set per text/heading block.

H1 / H2 / H3 buttons in the format toolbar set both the heading level and the matching font size, so the change shows right away.`,
      },
      {
        id: 'me-preview-test',
        title: 'Previewing an email and sending a test',
        tags: ['preview', 'send test', 'test email', 'mobile preview'],
        body: `Click the eye icon (top-right of the editor, labelled "Preview") to open the preview.

What you get:
- The email exactly as it will arrive — links work, videos play, images load.
- A Send-test form: enter any email address, click Send Test, and you get a real email, with your real branding, footer, and social links.
- Close the preview to drop straight back into the editor with everything where you left it.

Tips
- Always send a test to yourself before scheduling a campaign.
- Check it on a phone too — switch the preview to Mobile (top toggle) or use the canvas Mobile toggle. Either shows the layout your contacts will see in their phone's mail app.

On phones
Your emails adjust to small screens by themselves: less side padding, an edge-to-edge layout, social icons that wrap onto a second line instead of being cut off, and images that scale down. Desktop mail apps get the full-width layout.`,
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

The unsubscribe and manage links are unique to each recipient.

Public preference center
Both links lead to a public preference page hosted on app.storyvenue.com (no login required) where the recipient can:
- Unsubscribe from all marketing emails (they will never receive marketing emails from your venue again unless they opt back in).
- Manage their preferences (opt back in if they've previously unsubscribed).

People who unsubscribe
They are skipped by every campaign automatically. They still receive emails about their own booking (proposals, invoices, payment confirmations).

Why this matters
- CAN-SPAM (US) and CASL (Canada) require a physical address and a one-click unsubscribe in every commercial email. StoryVenue's automatic footer covers both.
- GDPR-style consent is up to you — collect opt-ins via your lead capture forms (Marketing → Forms include a marketing-opt-in checkbox).

What you can edit
You can change the visual styling of the footer (font, padding, background) inside the email builder, but the unsubscribe link, manage link, venue name, and physical address are required and always included.`,
      },
      {
        id: 'me-campaigns',
        title: 'Campaigns — how a send works',
        tags: ['campaign', 'broadcast', 'newsletter', 'send', 'recipients', 'schedule', 'email'],
        body: `A campaign is an email you send once to a group of your contacts and leads (for example, "Spring tour open house"). Find them at Marketing → Campaigns.

A campaign has three steps:
1. Design — the email itself, built in the drag-and-drop editor.
2. Recipients — who gets it: pick a saved audience, or filter by stage, tag, marketing opt-in, and more.
3. Review — a final check, then schedule it or send now.

After it's sent, Marketing → Analytics shows its opens, clicks, unsubscribes, and bounces.

To delete a campaign, press the trash icon on its row in the campaigns list and confirm. You don't need to open it first.`,
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

Important — saved audiences cannot reference other saved audiences. The audience type inside a saved audience is always one of All leads / Tags / Stages, never another audience.

Using a saved audience in a campaign
1. Open or create a campaign at Marketing → Campaigns.
2. In the Audience section, pick "Use a saved audience" and choose your audience from the dropdown.
3. You can still layer additional behavior filters on top (e.g. start with "Booked couples 2026" but require a wedding date on file). Those filters are added to the audience's own.
4. Save the campaign. When it sends, it goes to whoever matches the audience at that moment.

Editing an audience
- Edits show up automatically on the next send for any draft or scheduled campaigns using the audience.
- Recipient counts in the Audiences list and inside the campaign picker refresh whenever you reload the page.

Deleting an audience
- If any draft or scheduled campaigns are using the audience, they switch to "All leads" when you delete it. Pick a different audience for them afterwards if you want.

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
        body: `Marketing → Forms is your lead capture form builder. The list shows every form, each with a pencil (edit) and a trash icon (delete, with a confirm). Click "New form" to create one.

The form editor works like the email builder:
- Three-pane layout: thin left sidebar with Desktop / Mobile preview toggle and undo/redo, the live canvas in the middle, the right inspector panel.
- Top bar: Back arrow, the form's internal name (only you see it), and Settings / Embed / Live preview buttons on the right.
- The right panel shows the Block Palette when nothing is selected (drag any tile onto the canvas) and switches to the selected block's tabbed inspector when you click a module.
- Click the canvas background to deselect — the right panel returns to the block palette so you can drop in new modules.
- A line shows exactly where a new block will land. You can drop at any position, including the very last slot.

Block styling: every block has a Block tab with top padding, bottom padding, side gutters, and background color (the same as the email builder). Per-block style controls live on their own tab — typography for Heading, the rich-text format toolbar for Text, presets for Button, and so on.

A new form starts with First name and Last name side by side, Phone, Email, and a Submit button. Remove or rearrange whatever you don't need.

Available blocks:
- Heading and Text (with rich-text format toolbar — bold/italic/underline, lists, links).
- Single-line text and paragraph text inputs.
- Email, Phone, Number, Date, and Time pickers.
- Address — split into individual labelled inputs (Street, City, State, ZIP code) so each part is saved in its own field.
- Dropdown, Radio, Checkbox group, Yes/No toggle.
- File upload (files land in your Media library).
- Image — same uploader as the email builder. Drag and drop from your computer, click Upload, or "Choose from media library" (shared picker). Supports alignment, width, padding, link wrap, and alt text. Anything uploaded here is added to your Media library.
- Button — a tabbed inspector. The Style tab gives you presets (Solid, Outline, Pill, Underlined link, etc.), saved styles (save, apply, delete), and full custom controls: font, weight, size, letter spacing, text color, background color, border, padding, and a full-width toggle.
- Submit, Divider, and Spacer — same controls as the email builder.

Form Settings modal (top-right gear): every form-level option lives here so the canvas stays focused on layout.
- Public form name (the name that shows on the form itself).
- Success behavior — thank-you screen text or redirect URL.
- Notification recipients — extra email addresses that also get the new-lead email for every submission (you and your team already get it, per Settings → Notifications).
- Embed CSS class.
- Delete form — removes the form (also available next to the pencil on the Forms list page).

Embed: copy the code and paste it into any website. The form keeps its look there.

Live preview: opens the form as visitors will see it, with its real checks and your thank-you screen or redirect. Nothing you submit there creates a lead or sends an email. Switch between Desktop and Mobile at the top.

Forms you've already added to other websites keep working.`,
      },
      {
        id: 'mkt-system-vars',
        title: 'Merge variables — the full list',
        tags: ['merge variables', 'system variables', 'placeholders', 'template variables', 'contact variables', 'venue variables', 'appointment variables', 'proposal variables', 'dynamic content'],
        body: `StoryVenue has 60+ merge variables that work the same way everywhere you write a message: email templates, calendar notifications, marketing emails, and texts. Type one into a message and it is replaced with the real value when the message is sent. They are written with a dot (e.g. {{contact.name}}).

Contact variables (available in marketing emails and texts)
{{contact.name}} — full name
{{contact.first_name}} — first name only
{{contact.last_name}} — last name only
{{contact.email}} — email address
{{contact.phone}} — phone number
{{contact.notes}} — free-form notes / inquiry message from the lead
{{contact.referral_source}} — how they found you (e.g. "Google search")

Lead / event variables (available in marketing)
{{lead.wedding_date}} — wedding date (formatted, e.g. "October 15, 2027")
{{lead.wedding_month}} — wedding month name only (e.g. "October")
{{lead.guest_count}} — estimated guest count
{{lead.created_at}} — date the lead first inquired (e.g. "April 16, 2026"). Short name: {{initial_inquiry_date}}
{{lead.time_since_inquiry}} — time since she inquired (e.g. "14 days ago"). Short name: {{time_since_initial_inquiry}}

Venue variables
{{venue.name}} — your venue / business name
{{venue.address}} — venue full address
{{venue.city}} — venue city
{{venue.state}} — venue state
{{venue.phone}} — venue phone
{{venue.email}} — venue contact email
{{venue.website}} — venue website URL
{{venue.owner_name}} — venue owner's full name
{{venue.owner_first_name}} — owner's first name only
{{venue.description}} — short venue style description
{{venue.pricing_guide_url}} — link to your Pricing & Availability Guide (always the latest version). Short name: {{pricing_guide_url}}. Use it in your Speed to Lead emails and texts.

Appointment variables (calendar notifications only)
{{appointment.title}} — event title
{{appointment.type}} — appointment type (e.g. tour, call)
{{appointment.start_time}} — formatted start date & time
{{appointment.end_time}} — formatted end date & time
{{appointment.date}} — date only (e.g. "Monday, May 5, 2026")
{{appointment.time}} — time only (e.g. "2:00 PM")
{{appointment.timezone}} — timezone abbreviation (e.g. EST)
{{appointment.duration}} — duration (e.g. "1 hour")
{{appointment.meeting_location}} — meeting link or physical address
{{appointment.notes}} — free-form notes added to the event
{{appointment.calendar_name}} — which calendar the event belongs to
{{appointment.space_name}} — venue space assigned to this appointment
{{appointment.status}} — status (confirmed / cancelled)

Payment & invoice variables (payment emails only)
{{payment.amount}} — payment amount
{{payment.method}} — payment method (e.g. Visa ••••4242)
{{payment.date}} — payment date
{{payment.reason}} — failure reason (failed-payment emails)
{{invoice.number}} — invoice number
{{invoice.amount}} — invoice total
{{invoice.due_date}} — invoice due date
{{invoice.payment_method}} — payment method on this invoice
{{proposal.title}} — proposal title
{{proposal.amount}} — proposal total

System variables (filled in when the message is sent)
{{system.date}} — today's date (formatted, e.g. "April 30, 2026")
{{system.year}} — current year (e.g. 2026)
{{marketing.unsubscribe_url}} — one-click unsubscribe link (added to marketing emails for you). Short name: {{unsubscribe_url}}
{{marketing.resubscribe_url}} — re-subscribe link
{{marketing.preferences_url}} — manage email preferences link

Older names still work
Shorter names like {{first_name}}, {{customer_name}}, {{organization}}, {{venue_name}}, {{wedding_date}}, and {{initial_inquiry_date}} still work everywhere. You don't need to change templates that use them.`,
      },
      {
        id: 'mkt-ai-concierge',
        title: 'AI Concierge — text follow-up with your leads',
        tags: ['ai concierge', 'concierge', 'sms', 'automation', 'leads', 'ai', 'text messages', 'outreach', 'handoff', 'a2p', 'spend cap'],
        body: `The AI Concierge follows up with your leads by text for you. It keeps in touch until she replies, then hands her to you — so no lead falls through the cracks.

Path: Bride Booking System™ → Speed to Lead System → the AI Concierge card.

What you need:
- A plan that includes the AI Concierge (All-Inclusive Concierge, or a plan StoryVenue has added it to)
- An approved texting number
- StoryVenue Legacy messaging connected (Settings → General)
If anything is missing, the AI Concierge card tells you what.

Getting started:
1. Go to Bride Booking System™ → Speed to Lead System and open the AI Concierge card
2. Set a persona name (how the AI identifies itself in messages, e.g. "Sarah from The Grand Ballroom")
3. Add concierge notification email addresses (who gets notified when leads reply)
4. Toggle the master Enable switch
The AI Concierge starts on a lead when she reaches the "Activate AI Concierge" step in your 14-day sequence (on the same page). Put that step where you want the AI to take over; without it, the AI doesn't start on anyone.

How it follows up:
- Once it has started on a lead, it texts her every day or two until she replies, for up to 60 days
- Messages are written for your venue: they use your venue's name, packages, pricing, and availability
- Texts only go out during daytime hours

When she replies:
- Her reply stops the AI for her. She moves to the "Conversations Started" stage in your pipeline, and you and your team are notified straight away so a person can take it from there
- If she replies STOP, she is opted out and gets no more texts

Per-contact controls (Contacts → lead detail):
Each lead shows an AI status pill with contextual actions:
- Green "AI Active" pill — Pause AI button
- Amber "Paused" pill — Re-enable AI button
- Red "Needs Human" pill — the AI has handed her to you (she asked for something a person should answer); Re-enable button
- Gray "Opted Out" pill — Re-enable button (locked if she replied STOP)
- Orange "Exhausted" pill — the AI finished its follow-up without a reply; Re-enable button (locked once 60 days have passed)
- No buttons for a lead the AI hasn't started on yet

Monthly texting limit:
Each venue has a monthly limit on AI texts. If it's reached, the AI pauses until the next month. StoryVenue support can tell you where you stand.

When it stops
- The AI keeps following up until the bride replies. Her reply is what stops it: she moves to Conversations Started and you're notified, so a person can take it from there.
- Messages you or your team send her don't stop it. You and the AI are working the same lead.
- To stop it yourself for one couple, press Pause AI on her conversation or contact.

Troubleshooting:
- The AI Concierge card tells you what's missing (your plan, an approved texting number, or the StoryVenue Legacy connection)
- Texting number not approved yet: the card shows where it stands
- Lead not getting messages: check that her pill says "AI Active" and that the Enable switch is on
- Messages not sending: check the StoryVenue Legacy connection (Settings → General) and your texting number`,
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
        body: `StoryVenue emails your customers for you (invoices, proposals, receipts). Customize those emails at Settings → Notifications, under "Emails to your customers."

The 6 customer-facing template types:
1. Invoice — sent to the customer when you send them an invoice
2. Proposal — sent to the customer when you send them a proposal
3. Payment Confirmation — receipt sent to the customer after a successful payment
4. Subscription Confirmation — sent to the customer when a recurring subscription starts
5. Payment Failed — sent to the customer when their payment attempt is declined
6. Payment Reminder — sent automatically after a payment due date passes (overdue reminders)

Each template has:
- Subject Line
- Email Heading
- Body Text (supports merge variables like {{contact.first_name}}, {{venue.name}}, {{payment.amount}}, {{invoice.number}})
- Button Text (optional — the action button in the email)
- Footer Text (optional — e.g. your cancellation policy)
- Enable/Disable toggle

All emails use your venue branding — your logo appears in the email header, and your brand color is used for the accent strip and button.

To test a template: click "Send Test" and enter any email address. The test email shows exactly what clients receive, using sample data.

To preview: click "Preview" for a live mock-up inside the editor.

Tip: Send a test email to yourself before sending a real proposal to ensure the template looks correct with your branding.

Looking for your own alerts (new lead, payment received, a bride needs you, etc.)? Those live in the "Alerts about your business" section of the same Notifications page — see the "Owner notifications" article for details.`,
      },
      {
        id: 'email-variables',
        title: 'Using merge variables in email templates',
        tags: ['variables', 'merge', 'dynamic', 'placeholders', 'template', 'first name', 'contact name', 'canonical', 'dot notation'],
        body: `Each email template supports merge variables — placeholders that get replaced with real data when the email sends.

They are written with a dot, like {{contact.first_name}}, and work the same way in your customer emails, calendar notifications, marketing emails, and texts.

Common variables for customer emails:
- {{contact.first_name}} — the recipient's first name
- {{contact.full_name}} — the recipient's full name
- {{venue.name}} — your venue name
- {{payment.amount}} — the payment or invoice amount
- {{invoice.number}} — the invoice ID
- {{invoice.due_date}} — the payment due date
- {{payment.method}} — how the customer paid (card / ACH)
- {{payment.net_amount}} — amount after processing fees
- {{proposal.title}} — the proposal title
- {{proposal.amount}} — the proposal total amount
- {{subscription.amount}} — the subscription charge amount
- {{subscription.frequency}} — billing cycle (weekly / monthly)
- {{system.date}} — today's date at send time
- {{system.year}} — current year

Older short names still work: {{customer_name}}, {{organization}}, {{amount}}, {{invoice_number}}, {{due_date}}, {{payment_method}}.

The variable list is shown with each email's editor. Click a variable to copy it, then paste it anywhere in the subject, heading, or body.

Use the Preview button to see a sample email with example details filled in.

Full list
See the article "Merge variables — the full list".`,
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
        id: 'int-zapier',
        title: 'Connecting Zapier',
        tags: ['zapier', 'api key', 'integration', 'automation', 'connect', 'apps'],
        body: `StoryVenue has an official Zapier integration. Use it to connect StoryVenue to thousands of other apps without writing code.

What you can do with Zapier
Triggers (something happens in StoryVenue, and Zapier acts on it):
- New Lead — a lead arrives (form, directory, added by hand)
- New Contact — a contact is added
- Tag Added to Contact — a tag is applied (by you or automatically)
- Proposal Signed — a customer e-signs
- Payment Received — a deposit, full payment, or installment is paid
- Appointment Booked — a tour, call, or other event is scheduled
- Appointment Cancelled — an event is cancelled or deleted

Actions (Zapier does something in StoryVenue):
- Create or Update Contact (matched by email)
- Create Lead
- Add Tag to Contact
- Send SMS
- Send Email
- Find Contact by Email

Connecting Zapier
1. In StoryVenue: Settings → Integrations → click Generate API key
2. Copy the key. It is shown only once, so paste it somewhere safe.
3. Click Open Zapier on the same page
4. Sign into Zapier (if needed) and accept the StoryVenue app. It now appears in your Zap editor.
5. When Zapier asks for an API key, paste the key you copied
6. Pick a trigger and connect it to any other app

Managing API keys
- Settings → Integrations lists every active key with its creation date and when it was last used
- Revoke a key any time. Anything using it stops working right away.
- You can have more than one key. One per connected app is a good habit.
- Treat a key like a password: don't share it or post it anywhere.

Building your own connection
If a developer is connecting another system for you, contact StoryVenue support and we'll point them to what they need.`,
      },
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
- A contact is created for the person who booked, and a matching lead moves to "Booked Tours"
- Cancellations in Calendly mark the event cancelled in StoryVenue
- Use Sync Now to import all upcoming Calendly events at any time

To disconnect: click Disconnect on the Calendly card.`,
      },
      {
        id: 'int-legacy',
        title: 'StoryVenue Legacy messaging — connect it and sync your contacts',
        tags: ['legacy', 'storyvenue legacy', 'connect', 'location id', 'private integration token', 'sms', 'texting', 'contact sync', 'integrations', 'resync', 'two-way sync'],
        body: `StoryVenue Legacy messaging is what lets you text couples from StoryVenue and bring your existing contacts in. Once it's connected, StoryVenue is where you manage your contacts day to day.

Connect it
1. Open Settings → General → StoryVenue Legacy.
2. Paste your Location ID.
3. Paste your Private Integration Token.
4. Save. A green "Connected" badge appears.

If texting or contact sync still doesn't work after that, the page may ask for one more key. If you're not sure where to find any of these, contact StoryVenue support and we'll set it up with you.

Bring your contacts in
- Click "Sync from StoryVenue Legacy". A progress bar shows how far along it is.
- It's safe to run more than once. It won't create duplicates.

After that
- Edit a contact in StoryVenue and the change carries over by itself.
- Add a new contact in StoryVenue and it's added there too.
- When a couple replies STOP to a text, they're marked Do Not Contact everywhere. You don't have to manage it in two places.

Texts won't send?
- Check for the green "Connected" badge on Settings → General.
- Open the contact, make sure the phone number is right, and click Save. Then try again.
- Your account needs an approved texting number. If you're not sure you have one, contact StoryVenue support.

Disconnecting
Clear the fields and Save. The "Connected" badge turns gray and texting stops. The contacts already in StoryVenue stay.`,
      },
      {
        id: 'int-leadfinder',
        title: 'Lead Finder — turn directory emails into leads',
        tags: ['leadfinder', 'lead finder', 'the knot', 'weddingwire', 'zola', 'directory', 'marketplace', 'inquiry email', 'email leads', 'forward', 'forwarding', 'gmail filter', 'gmail confirmation code', 'capture leads', 'review queue'],
        body: `Lead Finder gives your venue its own private email address. Any wedding inquiry emailed to it — from The Knot, WeddingWire, Zola, Here Comes The Guide, your website form, or a couple writing to you directly — becomes a lead in StoryVenue automatically, with the same alerts, pricing guide and follow-up as every other lead.

Where to find your address
Bride Booking System™ → Lead Finder → Copy. The address is unique to your venue, so keep it private.

Two ways to connect it
1. Easiest: paste the address into a directory's lead-notification email field (The Knot, WeddingWire, Zola and so on). One paste per site.
2. If a site won't let you change that email, use Gmail forwarding:
- Gmail → Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address → paste your Lead Finder address.
- Gmail sends a confirmation code to that address. Within a minute it appears on the Lead Finder card (and in your inbox copy). Enter it in Gmail under Verify.
- Create a filter (for example from:theknot.com OR from:weddingwire.com) and choose "Forward it to" your Lead Finder address.
Tip: forward only directory emails with a filter rather than your whole inbox.

Test your address
On the card, click Send a test inquiry. We email a sample inquiry to your Lead Finder address and, within a minute, show you what we read from it. It's a dry run: no lead is created and nobody is emailed (a copy still lands in your inbox, marked as a test).

What happens when an inquiry arrives
- A lead is created with the couple's name, email, phone, wedding date, guest count and message — whatever the email includes. If the couple is already a lead, that record is updated instead: only empty fields are filled, so your own edits are never overwritten.
- You're alerted exactly as for any new lead (email, text or push, per your notification settings). The alert shows which directory it came from and everything the couple sent.
- The couple gets an email from you with one button: Send me my guide. Tapping it confirms their mobile number and email, sends your guide by text and email, and counts as their permission to text — so they join your full Bride Booking System™ (guide, 14-day follow-up, then AI outreach if you have it on), exactly like a couple who filled in your listing form.
- A phone number read from a directory email isn't permission to text, so nothing is texted until they tap. If they haven't tapped within an hour, the guide goes to them by email anyway and your follow-up starts without texts; tapping the button later still turns texts on. Replying by email doesn't count as permission to text.
- Venues without texting get the guide by email straight away, as before.
- For a new lead you get one email: the standard new-lead email, with the original directory email included. For anything else Lead Finder handles (an update to a couple you already have, or a message it skipped) you get a copy in your inbox with a short note on what it did. Times are in your venue's local time, based on your venue's ZIP code. Turn the copies off on the card.

The review queue
When we can't read an inquiry confidently, or it doesn't include the couple's own email address, the lead is still created and you're still alerted, but the automatic guide is held. The card shows how many arrivals need review. Open Review, compare what we read with the original email, correct anything we got wrong, then Confirm & send guide. If it isn't a real inquiry, choose Dismiss to keep the lead, or Dismiss & delete lead to remove the junk lead (and the contact Lead Finder created for it).

Activity and sources
The card lists recent messages and whether each became a lead or was skipped, and why. Sources compares each directory with its own previous 30 days, so you'll notice if a directory changes its email format.

Not seeing leads?
- Check Activity on the card. If nothing has arrived, the directory or your Gmail filter isn't sending to the address yet.
- "Not enabled yet" means Lead Finder hasn't been switched on for your account. Contact StoryVenue support.
- Skipped messages show the reason — for example an account notice, an automatic reply, or no email address for the couple.`,
      },
      {
        id: 'int-tripleseat',
        title: 'Connecting Tripleseat',
        tags: ['tripleseat', 'crm', 'venue crm', 'lead', 'integration', 'sync', 'connect', 'catering', 'events'],
        body: `The Tripleseat integration automatically sends every new StoryVenue lead into your Tripleseat account, so your team can work all your inquiries from one place.

To connect
1. Go to Settings → Integrations → Tripleseat card → Connect.
2. In Tripleseat, find your Public Key (Tripleseat: Settings → API).
3. Paste the key into StoryVenue and click Connect.
4. If your Tripleseat account has more than one location, choose which location new leads should be created under.

What gets sent
When a new lead comes in (from your listing form, Lead Link, directory, or a marketing form), StoryVenue sends Tripleseat:
- First and last name, email, and phone
- Wedding/event date and guest count (when provided)
- The bride's message
- Where the lead came from

Every lead is labeled with the source "StoryVenue - Bride Booking System™" so it's easy to spot and report on inside Tripleseat.

Test and manage
- Click Send test lead to push a sample lead and confirm everything's working.
- The connection is one-way (StoryVenue → Tripleseat).
- Update the selected location or Disconnect at any time from the same card.`,
      },
      {
        id: 'int-eventtemple',
        title: 'Connecting Event Temple',
        tags: ['event temple', 'eventtemple', 'crm', 'venue crm', 'lead', 'booking', 'integration', 'sync', 'connect', 'api key', 'org'],
        body: `The Event Temple integration automatically sends every new StoryVenue lead into Event Temple as a lead booking, so your sales team can pick it up right away.

To connect
1. Go to Settings → Integrations → Event Temple card → Connect.
2. In Event Temple, get your API key (Settings → Developers → API) and your API-ORG identifier (Settings → Overview).
3. Paste both into StoryVenue and click Connect. StoryVenue checks them before saving.

What gets sent
When a new lead comes in, StoryVenue creates in Event Temple:
- A contact with the bride's name, email, and phone
- A booking marked as a lead, with the wedding/event date

The bride's message, guest count, booking timeline, what matters most to her, and where the lead came from are added as a note on that booking.

Choose which pipeline leads land in
On the Event Temple card you can pick a Pipeline (and a starting Stage within it) for new lead bookings. Leads are created on that stage so they land at the top of the pipeline you choose. Leave it on "Event Temple default" to let Event Temple decide.

Referral source and booking type
StoryVenue also fills two Event Temple fields on every booking:
- Referral Source — we automatically use a source named "StoryVenue - Bride Booking System" when it exists in your account. Create that referral source once in Event Temple (Settings) and it fills in going forward. You can also pick a different source on the card.
- Booking Type — we automatically use "Wedding" when it exists. You can pick a different type on the card.

These names have to exist in Event Temple already for us to pick them. If they don't, the field is left blank and the details stay in the note. Once they're set, you can build automations in Event Temple that act on your StoryVenue leads.

Test and manage
- Click Send test lead to push a sample lead and confirm the connection.
- The connection is one-way (StoryVenue → Event Temple).
- Disconnect at any time from the same card.`,
      },
      {
        id: 'int-honeybook',
        title: 'Connecting HoneyBook (via Zapier)',
        tags: ['honeybook', 'zapier', 'crm', 'lead', 'integration', 'connect', 'automation'],
        body: `Send new StoryVenue leads straight into HoneyBook using Zapier. No coding required.

Why Zapier rather than a direct connection
HoneyBook doesn't offer a direct connection you can set up yourself, so Zapier is the quickest way to link the two. There is nothing to apply for or wait on.

How to connect
1. In StoryVenue, go to Settings → Integrations → Zapier section and generate an API key (copy it — it's shown only once).
2. In Zapier, create a new Zap using the StoryVenue app and choose the "New Lead" trigger.
3. Add a HoneyBook action — "Create Client" or "Create Project".
4. Map the lead's name, email, and phone into the HoneyBook fields, then turn the Zap on.

New StoryVenue leads will now appear in HoneyBook automatically.

Good to know
- HoneyBook's Zapier connection requires their Essential or Premium plan.
- HoneyBook custom fields aren't supported over Zapier, so any extra details map into the project's notes/details field.
- The HoneyBook card on the Integrations page links straight to Zapier and to HoneyBook's own Zapier guide.`,
      },
    ],
  },
  {
    id: 'wedding-planner',
    label: 'Wedding Planner',
    iconName: 'Heart',
    color: '#f43f5e',
    articles: [
      {
        id: 'wedding-planner-overview',
        title: 'Wedding Planner — one shared place for you and your couples',
        tags: ['wedding planner', 'wedding hub', 'bride portal', 'couple portal', 'portal', 'shared', 'connect couple', 'booked couple', 'planning', 'invite couple', 'link couple'],
        body: `Wedding Planner is one shared place for you and each booked couple to plan the wedding together — guest list, RSVPs, seating, meal selections, and messaging, all in one spot. The couple sees the same "Wedding Planner" inside their own StoryVenue login, so both sides always know where to go.

Where to find it
Sidebar → Wedding Planner (heart icon). It's a top-level menu item, right after Venue Concierge.

Connecting a couple (works both ways)
- You invite them: open Wedding Planner, enter the couple's email, and send an invite. They get a link to connect.
- They request you: a couple can find your venue and request to connect.
Either way, you approve the link from your Wedding Planner. One couple links to one venue.

What you get once connected
- A live guest-list rollup: total invited, attending / declined / awaiting, headcount, and meal tallies for your BEO.
- The shared room layout — see exactly who is seated at each table, add tables and decor, and print a named floor plan for day-of room setup.
- A shared message thread with the couple, so wedding-day details don't get lost across email and texts.

Your couples get their own guidance
Each couple has a Help & how-to section inside their own login (account menu on desktop, the More tab on a phone). If a couple asks how to add guests, send RSVP links, or build their seating plan, point them there rather than walking them through it.

What the couple sees in Messages
In their own Wedding Planner, a couple sees only the messages between you: what they wrote, and what you, your team or your concierge wrote back. Automated texts and emails, AI follow-ups, your notes and stage moves stay on your side.

You decide what's shared
On the Wedding Planner page you can toggle which wedding details the couple sees — wedding date, guest count, space / room, and coordinator.

Availability
Wedding Planner is included on private-client plans. On other plans, if it's locked you'll see a short overview and a "Schedule a demo" button.`,
      },
      {
        id: 'wedding-planner-guests-seating',
        title: 'Wedding Planner — guest lists, RSVPs, and seating',
        tags: ['wedding planner', 'wedding hub', 'guest list', 'rsvp', 'meal', 'dietary', 'headcount', 'seating', 'tables', 'seating chart', 'room layout', 'floor plan', 'chairs', 'table shapes', 'who is seated', 'invitations', 'beo'],
        body: `Inside a connected Wedding Planner, the couple manages the wedding-day details and you get exactly the planning information you need — without handling their guests' personal contact info.

Guest list & RSVPs (couple-owned)
The couple builds their own guest list — names, party size, meal choice, dietary notes, and groups — and can email self-service RSVP links to their guests. Guests RSVP on a simple mobile page and pick their meal.

What you see
On your Wedding Planner, expand a connected couple to see a live rollup: attending / declined / awaiting counts, total headcount, and a meal-by-meal tally for your catering and BEO. You do not see guest emails, phone numbers, or addresses — those stay with the couple.

Seating chart
The couple creates reception tables (name + number of seats) and seats each guest party from their seating list. Seats fill by party size, with an over-capacity warning if a table is oversubscribed. On your side, you see the table layout with seated / capacity counts — handy for planning the room on the day.

Room layout (shared floor plan)
Tables are created in the seating list, then placed on a shared drag-and-drop floor plan that you and the couple both edit. The canvas opens in View mode: tap or click any table and a panel shows exactly who is seated there, grouped by party, with party size, RSVP status, meal choice, and group. On a computer, hovering a table shows a quick preview of the names. Edit mode is where items are moved, resized, rotated, or deleted, and where tables and decor are added.

Decor includes the dance floor, head table, bar, DJ, gift table, cake, stage, and a text label, plus rows of chairs you can size from 1 to 10 — handy for ceremony seating. Tables come in three shapes: round, square, and long.

Named floor plan for day-of setup
Print or download the floor plan as a PNG. With "Include guest names" switched on, every table is labelled with its name, its seated count, and the parties seated there, so your team gets a named seating chart for setting the room rather than just a shape on a page.

Unsaved changes are protected: leaving the canvas or collapsing the couple prompts before discarding edits, so a floor plan is never lost silently.

Sharing controls
You choose which wedding details the couple sees (wedding date, guest count, space / room, coordinator) from the toggles on the Wedding Planner page.`,
      },
      {
        id: 'wedding-planner-website',
        title: 'Wedding Planner — the free couple wedding website',
        tags: ['wedding website', 'wedding site', 'minisite', 'link in bio', 'linktree', 'couple website', 'rsvp online', 'guestbook', 'countdown', 'registry link', 'share with guests', 'the knot', 'zola'],
        body: `Every couple in Wedding Planner can build a free, mobile-first wedding website right inside their StoryVenue login — no separate account anywhere else. It lives at storyvenue.com/their-custom-link, so they have one link to share on invitations, texts, and social profiles. It's a simple one-page site: quick to set up, beautiful on a phone.

Why it matters for you
It keeps your booked couples inside StoryVenue instead of scattering across other tools, and — when they turn on the "Our Venue" card — their wedding website links straight back to your public venue listing. That's extra exposure to every guest who visits their page. It's a genuine differentiator you can mention in tours and packages: "book with us and you get a free wedding website."

What the couple can add
- Their own custom link (e.g. storyvenue.com/jenny-and-mike), checked for availability as they type
- A main photo, an optional cover banner, their names, a headline, and their story
- A live countdown to the big day
- Their Instagram, Facebook, TikTok, and Pinterest
- Up to six custom link buttons (registry, hotel block, travel, livestream, schedule — anything), each with an icon, all opening in a new tab
- An "Our Venue" card that links guests to your listing
- Online RSVP — guests find their invitation by name and reply with headcount, meal choice, and dietary notes
- A guestbook where guests can leave well-wishes (the couple can approve posts before they show)

How a couple sets it up
1. They log in at app.storyvenue.com and open Wedding website in their menu
2. They pick their link, add a photo and a few details, and choose which sections to show
3. They click Publish — and can copy the link or download a QR code for save-the-dates and table cards

How to point a couple to it
Once you're connected in Wedding Planner, just tell them to log in and open Wedding website. If they RSVP through Wedding Planner's guest list, those responses flow into the same live rollup you already see (attending / declined / headcount / meal tallies) — no extra work for you.`,
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
        body: `You sign in to StoryVenue with your email and password.

Logging in
Go to app.storyvenue.com/login. Enter your email address and password, then click Sign In.

Forgot your password?
1. Click "Forgot password?" on the login page
2. Enter your registered email address
3. Check your inbox for a password reset link
4. Click the link and set a new password

The reset link works for a short time. If it has expired, ask for a new one the same way.

First-time team member login
If you received an invitation email, click Accept Invitation in the email and follow the steps.

If you're locked out
Make sure you're using the email address the account was created with. Check spam/junk for the reset email. If you still can't access the account, contact StoryVenue support.`,
      },
      {
        id: 'account-update-profile',
        title: 'Updating your email or password',
        tags: ['update email', 'change email', 'change password', 'update password', 'my profile', 'account settings'],
        body: `You can update your name, phone, sign-in email and password from your profile page.

How to get there
1. Click your name at the bottom of the sidebar
2. Open My Profile

Name and phone
Change them under Personal Information and click Save.

Sign-in email
Under Login & Security → Change Email, enter the new address and your current password, then click Update Email. Use the new address the next time you sign in.

Password
Under Login & Security → Change Password, enter your current password, then the new one twice, and click Update Password. The new password works straight away.

Forgot your current password?
Sign out and use "Forgot your password?" on the sign-in page.

Team members
Team members update their own name, email and password the same way.`,
      },
      {
        id: 'account-couples-portal',
        title: 'Couple accounts — what your couples sign in to',
        tags: ['couples', 'client login', 'couple account', 'couple portal', 'client portal', 'client access', 'couple signup'],
        body: `Your couples can have their own StoryVenue account. It's where they use Wedding Planner: their guest list and RSVPs, seating, day-of timeline, checklist, budget, vendors, inspiration, their wedding website, and messages with you.

Creating an account
- Couples sign up at app.storyvenue.com/signup and choose to create a couple account. They enter their name, email, phone and a password.
- Or invite them from your Wedding Planner page. The invitation email takes them straight there.

Signing in
At app.storyvenue.com/login they choose "Wedding couple" and enter their email and password. "Forgot your password?" on the same page sends a reset email.

What couples can see
Only their own wedding. They can't see your other contacts, your calendar, or anything else in your account.

Proposals and invoices
Couples don't need an account to sign or pay. They open the link in the email or text you send them.

Their own help
Couples have a Help & how-to section inside their login, so you can point them there for questions about their side.`,
      },
      {
        id: 'account-2fa',
        title: 'Two-factor authentication (2FA)',
        tags: ['2fa', 'two-factor', 'totp', 'security', 'authenticator', 'login security', 'mfa'],
        body: `Two-factor authentication adds a second step when you sign in, for extra protection.

What is 2FA?
Two-factor authentication requires a second verification step (a 6-digit code from an authenticator app) in addition to your password when logging in.

Setting up 2FA
1. Go to your Profile (click your name in the sidebar → My Profile)
2. Look for the Two-Factor Authentication section
3. Click Enable 2FA
4. Scan the QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
5. Enter the 6-digit code from your app to confirm
6. Save your backup codes somewhere safe — you'll need these if you lose access to your authenticator app

Logging in with 2FA
After entering your email and password, you'll be prompted for the 6-digit code from your authenticator app. Open your app, read the current code, and enter it.

Disabling 2FA
Go to your Profile → Two-Factor Authentication → Disable 2FA. You'll confirm with your password and a code from your authenticator app.

Lost your authenticator app?
Use one of the backup codes you saved during setup. If you've lost those too, contact StoryVenue support.

Note: 2FA is per-user — each team member can enable it independently on their own profile. It does not affect other team members or couples.

If you don't see the Two-Factor Authentication section on your Profile page, it isn't switched on for your account yet. Contact StoryVenue support.`,
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
        title: 'What is StoryPay™ and how do I set it up?',
        tags: ['storypay', 'stripe', 'payment processing', 'set up payments', 'connect', 'merchant', 'onboarding', 'payments', 'accept payments', 'fees', 'payouts'],
        body: `StoryPay™, powered by Stripe, lets your clients pay deposits, installments and balances online (by card, Apple Pay, Google Pay or bank transfer) right from the proposal or invoice you send.

Setting up StoryPay™
1. Go to Payments → Payment settings and click Connect with Stripe.
2. Stripe's secure signup takes about 10 minutes. Have ready: your business's legal name and EIN (or your SSN if you're a sole proprietor), business address, the owner's date of birth and last 4 of their SSN, and the bank account you want payouts sent to.
3. You come back to StoryVenue when you're done. Stripe usually approves within minutes, occasionally a business day or two, and online payments turn on automatically.

You get your own Stripe account and dashboard for payouts, refunds and reports. Payment settings always shows where your setup stands.

What it costs
StoryPay™ fees are taken from each payout; your clients never pay them directly.
- Paid plans: 3.4% + 30¢ on any card, 1% on bank transfers
- Free plan: 3.9% + 30¢ on any card, 1.5% on bank transfers

The service fee (clients help cover the cost)
Every new invoice and proposal includes a "Service fee" line, 3.5% by default, so your clients help cover processing. On paid plans, 3.5% covers nearly all of the card fee and more than covers bank transfers. You can change the % on any invoice to split the cost, or remove it. Clients pay the service fee however they pay (card, bank transfer or check), and it's always shown as its own line before they pay.

Payouts
Stripe sends your money to your bank automatically, usually within 2 business days. Your Stripe dashboard lists every payout.

Refunds
Issue refunds from Transactions. The client gets their money back on the card or bank account they used. StoryVenue's share of the fee is refunded too; Stripe keeps its processing fee.

Security
Card and bank details go straight to Stripe. StoryVenue never sees or stores them.

If payments show as unavailable
Open Payments → Payment settings. If Stripe still needs details, click Continue setup; if Stripe is reviewing your account, payments turn on as soon as it approves. Contact StoryVenue support if it's taking longer than a couple of business days.`,
      },
      {
        id: 'storypay-inline-checkout',
        title: 'How the client payment form works',
        tags: ['storypay', 'stripe', 'checkout', 'payment form', 'inline', 'pay now', 'client pays', 'credit card form', 'card form', 'pay button', 'installments', 'apple pay'],
        body: `When your client opens a proposal (after signing) or an invoice, Stripe's secure payment form appears right on the same page. They never leave your proposal or get sent to another site.

What your client sees
- The amount due, with your service fee shown as its own line in the total
- A Card tab (credit or debit, plus Apple Pay or Google Pay on supported devices)
- A US bank account tab, if you accept bank transfers (Payments → Payment settings)

Some banks ask the client to confirm the payment in a pop-up (3D Secure). That's normal; the payment finishes as soon as they approve it.

After they pay
- Card payments are confirmed instantly, the proposal or invoice is marked paid, and your client gets a receipt by email.
- You get a "payment received" notification.

Installment plans
- The client's card or bank account is saved when they pay the first installment.
- Each remaining installment is charged automatically on its due date. They don't need to do anything.
- If an automatic payment fails, it's retried on day 2, 4 and 7. Your client gets an email with a link to update their card, and you're notified.

If the payment form doesn't load
- Ask the client to use an up-to-date browser (Chrome, Safari, Firefox or Edge) and turn off ad blockers, or try a private/incognito window.
- The form only loads over a secure connection; StoryVenue links always use one.`,
      },
      {
        id: 'storypay-ach',
        title: 'Accepting bank transfer (ACH) payments',
        tags: ['storypay', 'stripe', 'ach', 'echeck', 'bank transfer', 'bank account', 'payment methods'],
        body: `StoryPay™ lets clients pay directly from their US bank account alongside cards. It's much cheaper for large wedding payments: 1% on paid plans (1.5% on Free) instead of the card rate.

How clients pay by bank
On the payment form they choose "US bank account" and connect their bank in seconds through Stripe (or enter their routing and account numbers). They can use it for one-time payments and installment plans.

Settlement timing
- Bank payments take 3–5 business days to clear.
- Until then the proposal shows "Your bank payment is processing". When it clears, it's marked paid and the client gets their receipt.
- If a bank payment bounces (for example, insufficient funds), you and the client are both notified and the client can pay again.

Turning bank transfers on or off
Go to Payments → Payment settings → Customer Payment Methods and use the ACH / Bank Transfer toggle. It's on by default; cards are always on.

Refunds
Bank refunds work like card refunds, but take 3–5 business days to reach the client.

Common questions
- Can I require bank transfer only? Not currently. When it's on, clients choose between card and bank.
- Does the service fee change for bank payments? No. It's the same % whichever way the client pays.`,
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
        body: `Go to Settings → Team. Click "Add Team Member".

Fill in:
- First Name (required)
- Last Name
- Email (required)
- Role: Owner, Admin, or Member

Click Add Member. The team member is emailed an invitation at the address you entered, with an Accept Invitation button. Once they accept, they land in the dashboard with the access their role allows.

To manage a team member: click the three-dot (...) menu on their row to:
- Edit — update their name, email, or role
- Resend Invite — send the invitation email again
- Remove — remove them from the account

Team members can update their own name and email at any time by clicking their name in the sidebar footer → My Profile.

The owner's own sign-in email and password aren't changed from the team list. The owner changes them in My Profile, under Login & Security.

Note: Only owners and admins can manage team members.

Hide dollar amounts — As the venue owner, you'll see a Hide $ checkbox next to each team member who isn't an Owner. Turning it on hides dollar amounts in the Lead Inbox for that person.`,
      },
      {
        id: 'team-roles',
        title: 'Team roles and permissions',
        tags: ['roles', 'permissions', 'owner', 'admin', 'member', 'access', 'what can they see'],
        body: `There are three roles.

Owner
- Full access to everything
- The only role that can open Settings → General, Team, Integrations and Billing

Admin
- Sees everything an Owner sees in the menu, except Settings → General, Team, Integrations and Billing
- That includes Marketing, Reports, and the other Settings pages (Email settings, Notifications, Branding)

Member
- Day-to-day work: Lead Inbox, Conversations, Contacts, Calendar, Payments, Bride Booking System™ and the Help Center
- Doesn't see Marketing, Settings, or Reports

To change someone's role: click the three-dot menu (...) on their row → Edit → change the Role field.

Everyone can update their own name and email from My Profile at the bottom of the sidebar.

Hide dollar amounts — The venue owner can turn on Hide $ for individual team members (Settings → Team) so they see masked amounts (•••) in the Lead Inbox instead of dollar figures. Owners always see full amounts.`,
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
        title: 'Notifications (Settings → Notifications)',
        tags: ['notifications', 'email alerts', 'sms alerts', 'email templates', 'alerts about your business', 'owner notifications', 'venue direct', 'ai concierge handoff', 'payment reminder', 'proposal signed', 'toggle', 'on off', 'per person'],
        body: `Settings → Notifications is the single page for everything notification-related — what you and your team get alerted about, and what your customers receive by email. It's split into two sections.

Section 1 — Alerts about your business
This is personal: every person on your team (you, and each teammate) sets their own Email and Text toggles for each alert type. Nobody's choices affect anyone else's.

Alert types:
- New lead — someone enquires about your venue
- Contact replied — a contact sends a reply to an ongoing conversation
- Venue Direct message — our concierge team sends you a direct message about a specific bride
- Payment received — any successful payment comes in
- Payment failed — a charge attempt fails
- Proposal signed — a customer signs a proposal
- Document opened — a customer opens a proposal or invoice you sent
- Refund issued — a refund is processed

Each row has an Email toggle and a Text toggle. The Text toggle is locked with a small lock icon until your StoryVenue Legacy (SMS) integration is connected under Settings → General — connect it to unlock text alerts.

Section 2 — Emails to your customers
This is for the whole account (not per person). It's where you edit the emails your customers receive: Invoice, Proposal, Payment Confirmation, Subscription Confirmation, Payment Failed, and Payment Reminder. See the "Email template types" article for the full list and how to edit them.

Editing a customer email template:
1. Click the template name in the left list to open it
2. Edit the Subject, Heading, Body, Button Text, or Footer
3. Click Save

Toggling a customer email on/off:
- Use the toggle switch next to the template name in the left list
- Off = that email is no longer sent

Variable pills:
- Below the editor, click any variable pill (e.g. {{contact.first_name}}, {{payment.amount}}) to copy it
- Paste it anywhere in the Subject or Body
- Older short names like {{customer_name}} still work

Payment Reminder — overdue schedule:
- Select the Payment Reminder template to see the Reminder schedule panel
- Set up to 3 reminders: each one goes out a number of days or hours AFTER the due date
- Default: 1 day after, 3 days after, 7 days after
- Remove an offset by clicking X; add one with "Add reminder"

Test any customer email template:
- Click the Preview button to see the rendered email
- Click Send Test to send a real email to any address, with example details filled in`,
      },
      {
        id: 'sms-notifications',
        title: 'SMS notifications for customers',
        tags: ['sms', 'text message', 'phone', 'messaging', 'notification'],
        body: `When you send a proposal or invoice to a customer who has a phone number on file, StoryVenue also texts them a link to it.

For the text to go out
1. The customer needs a US phone number on the proposal or invoice. Type it in any format.
2. StoryVenue Legacy messaging must be connected (Settings → General → StoryVenue Legacy shows "Connected").
3. Your account needs an approved texting number.

If a text didn't arrive, check those three things. If it still doesn't send, contact StoryVenue support.`,
      },
      {
        id: 'notif-calendar-templates',
        title: 'Calendar appointment email & SMS templates',
        tags: ['calendar', 'appointment', 'notification', 'template', 'email template', 'sms template', 'merge tags', 'confirmation', 'reminder', 'cancellation', 'reschedule', 'follow up', 'venue owner', 'contact'],
        body: `Every calendar notification has four independently editable templates — one per channel. Manage them at Calendar → Calendar Settings → Notifications.

The four channels
- Email → Venue Owner: email sent to your venue's registered email address
- Email → Contact: email sent to the booked contact/lead
- SMS → Venue Owner: SMS delivered via StoryVenue Legacy to your number
- SMS → Contact: SMS delivered via StoryVenue Legacy to the contact's number

Each channel can be toggled on or off independently. Turning a channel off removes it from automatic dispatch without deleting your template.

Editing a template
1. Go to Calendar → Calendar Settings → Notifications.
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
SMS editors show a character counter (e.g. "114 / 160 chars"). Standard SMS segments are 160 characters. Messages over 160 characters are still sent, but may count as two texts.`,
      },
      {
        id: 'notif-calendar-troubleshoot',
        title: 'Troubleshooting calendar notifications not sending',
        tags: ['notifications not sending', 'email not received', 'sms not received', 'reminder not sent', 'confirmation not sent', 'notification troubleshoot', 'debug notifications'],
        body: `If a calendar notification or reminder isn't arriving, work through these checks.

Email not arriving
1. Is the channel toggled On? Calendar → Calendar Settings → Notifications → expand the scenario → check the toggle on that channel row.
2. Does the event have a contact with an email address? Email → Contact only fires if the event is linked to a contact that has an email on file.
3. Is the venue email configured? Email → Owner needs a valid email in your venue profile (Settings → General).
4. Check spam/junk folders — our emails can land there for first-time recipients.

SMS not arriving
1. Is Legacy messaging connected? Settings → General → StoryVenue Legacy should show "Connected".
2. Does the contact have a valid US phone number in your contacts?
3. Is the SMS channel toggled On for that scenario?
4. Is your texting number approved? Texts can't go out until it is.

Reminder not arriving
1. Was the event created after you saved your reminder settings? Reminders are scheduled when an event is saved. Events booked before you set up reminders won't have any: re-save the event to schedule them.
2. Is the reminder offset in the future? A reminder set for "10 minutes before" that has already passed won't fire.
3. Is the reminder channel enabled? Each of the four reminder channels (Email→Owner, Email→Contact, SMS→Owner, SMS→Contact) can be on or off independently.

Follow-up not arriving
- Follow-up timing is fully configurable: Calendar → Calendar Settings → Notifications → Follow-Up → any channel → "When to send" (choose minutes, hours, or days after the event ends).
- If the event has no end time, no follow-up is sent.
- Make sure the Follow-Up channels are toggled On.
- Follow-ups are scheduled when an event is saved. If you change the timing, re-save the event to reschedule it.

Test before going live
Use the "Send test email" / "Send test SMS" button inside each channel editor to verify delivery before relying on automatic dispatch.`,
      },
    ],
  },
  {
    id: 'billing-plans',
    label: 'Plans, Billing & Add-ons',
    iconName: 'CreditCard',
    color: '#10b981',
    articles: [
      {
        id: 'billing-plans-overview',
        title: 'Understanding your subscription plans',
        tags: ['plans', 'billing', 'subscription', 'upgrade', 'downgrade', 'free', 'paid', 'directory billing', 'pricing', 'trial', '14 day', '$97', 'bride booking system', 'all-inclusive', 'self-serve', 'payment method', 'card', 'cancel', 'refund', 'settings billing'],
        body: `Your StoryVenue plan is managed at Settings → Billing.

The four plans (shown in this order)
1. Bride Booking System™ Free — free forever
2. Bride Booking System™ — $97/month
3. All-Inclusive — price shared on a demo call
4. All-Inclusive Concierge — includes the AI Concierge; price shared on a demo call

Each plan card on the page lists what it includes, and your current plan has an "Active plan" badge.

Changing plans
- Between Bride Booking System™ and Free: use the upgrade or downgrade button on the billing page
- All-Inclusive and All-Inclusive Concierge: click the button to schedule a demo call with the StoryVenue team

14-day free trial (new accounts)
- When you finish setup and enter your card, a 14-day free trial of Bride Booking System™ begins
- In the last 3 days of the trial, a notice at the top of your dashboard shows the date of your first charge and a link to manage your subscription. An email goes out a few days before, too
- After 14 days, if you haven't moved to Free, your card is charged $97/month. The trial doesn't switch you to Free by itself
- You can move to Free at any time from the billing page before the trial ends

What's locked
- Features that aren't in your plan show a lock icon in the sidebar
- The AI Concierge is only available on plans that include it. Its switch is greyed out on the others

Your card
- Update your card at any time from the billing page. Your trial and renewal dates don't change when you do
- Charges appear on your statement as "StoryVenue"

Cancelling
- Cancel from the billing page at any time
- You keep your plan until the end of the time you've paid for, then your account moves to the Free plan

Plans managed by StoryVenue
- If your billing page says "Billing managed directly", your plan is looked after by the StoryVenue team. Contact them for any changes`,
      },
      {
        id: 'billing-verified-sponsored',
        title: 'Verified, Sponsored, and AI Concierge',
        tags: ['verified', 'sponsored', 'concierge', 'badge', 'listing', 'add-on', 'addon', 'promote', 'visibility', 'ai', 'sms', 'automation', 'greyed out', 'demo', 'all-inclusive concierge'],
        body: `StoryVenue has extras that lift your listing and your follow-up.

Verified
- Shows a verified badge on your storyvenue.com listing
- Tells couples your venue is confirmed as real

Sponsored
- Shows your listing more prominently in directory search results
- Helps more couples browsing storyvenue.com find you

AI Concierge
- Follows up with your leads by text for you (see the AI Concierge article)
- Included with the All-Inclusive Concierge plan, and any plan the StoryVenue team has added it to
- On other plans its switch is greyed out. Pressing it lets you schedule a demo

What your plan includes
Settings → Billing shows which of these are part of your plan, which you can add, and today's prices. Changes to add-ons take effect at your next renewal.`,
      },
      {
        id: 'billing-trial',
        title: '14-day free trial and adding your card',
        tags: ['trial', '14 day', 'credit card', 'card', 'onboarding', 'go live', 'access', '$97', 'first charge', 'downgrade', 'cancel trial', 'free plan'],
        body: `New StoryVenue accounts finish a short 4-step setup to go live.

The 4 steps
1. Connect — find and import your venue from Google
2. Details — fill in your listing information
3. Go live — publish your listing (a test lead is sent to your inbox so you can see how it works)
4. Access — add your card to start your 14-day free trial of the Bride Booking System™

A card is needed to finish setup and open the full dashboard.

After you add your card
- Your 14-day free trial begins right away, with full access to the Bride Booking System™
- If you do nothing, your card is charged $97/month when the trial ends
- You'll get an email a few days before the first charge. In the last 3 days of your trial, a notice at the top of your dashboard shows the charge date and a link to manage your subscription.
- Billing notices come by email, never by text

To stay on the Free plan
- Go to Settings → Billing before the trial ends
- Click the downgrade button on the Bride Booking System™ Free plan
- The Free plan card on that page shows what you keep

Good to know
- The trial doesn't switch you to Free by itself. Choose Free before it ends if that's what you want.
- If your billing page says "Billing managed directly", your plan is looked after by StoryVenue and none of this applies to you.
- Charges appear on your statement as "StoryVenue"`,
      },
      {
        id: 'billing-pricing-guide',
        title: 'Pricing & Availability Guide',
        tags: ['pricing guide', 'availability guide', 'venue guide', 'packages', 'shareable', 'ai generate', 'lead form'],
        body: `The Pricing & Availability Guide is a shareable page that showcases your venue packages, pricing ranges, and availability to prospective couples. It's a polished, branded resource you can link to from your storyvenue.com listing.

Availability:
- Only available on plans that include the Pricing Guide feature
- If your plan doesn't include it, the sidebar menu item shows a lock icon, and the guide's form is left off your public listing

Creating your guide:
1. Go to Bride Booking System™ → Pricing Guide
2. Fill in your packages, pricing ranges, and availability windows
3. Click "Generate with AI" to have Ask AI draft compelling, outcome-focused copy for each section based on your venue info and listing details
4. Each section can be individually regenerated for variations

Images:
- Your listing cover photo and gallery images are automatically pre-populated in the guide so it looks polished immediately
- Update photos under the Photos section of Bride Booking System™ → Venue Listing to refresh the guide

Preview:
- A preview modal shows exactly what couples will see before you publish
- Make changes and regenerate sections as needed until you're happy with the result`,
      },
    ],
  },
  {
    id: 'merge-variables',
    label: 'Merge Variables',
    iconName: 'Braces',
    color: '#6366f1',
    articles: [
      {
        id: 'merge-vars-overview',
        title: 'Using merge variables (merge tags)',
        tags: ['merge variables', 'merge tags', 'variables', 'personalization', 'first name', 'contact name', 'email variables'],
        body: `Merge variables let you personalize your emails, SMS messages, and notifications with real data — contact name, payment amount, appointment time, venue name, and more.

How to use them:
1. While editing a template, email, or SMS, click the variable picker (or copy a pill from the Notifications page)
2. The tag is copied to your clipboard — paste it into your subject line or message body
3. At send time, the tag is replaced with the real value for that specific recipient or event

How they're written:
With a dot, like {{category.field}}
- {{contact.first_name}} — the contact's first name
- {{venue.name}} — your venue / business name
- {{payment.amount}} — the payment amount
Older short names (like {{customer_name}}, {{organization}}, {{amount}}) still work.

Contact variables:
- {{contact.first_name}} / {{contact.last_name}} / {{contact.full_name}} / {{contact.name}}
- {{contact.email}} — contact's email
- {{contact.phone}} — contact's phone number

Venue variables:
- {{venue.name}} — your business name
- {{venue.email}} / {{venue.phone}} — venue contact info
- {{venue.address}} / {{venue.city}} / {{venue.state}} / {{venue.website}}
- {{venue.owner_name}} / {{venue.owner_first_name}}

Payment variables (payment emails):
- {{payment.amount}} — total payment amount
- {{payment.net_amount}} — after fees
- {{payment.fee}} — processing fee
- {{payment.method}} — card or ACH
- {{payment.date}} — date paid
- {{payment.reason}} — failure reason (failed-payment emails)
- {{payment.overdue_by}} — how long overdue (reminder emails)

Invoice / proposal variables:
- {{invoice.number}} / {{invoice.amount}} / {{invoice.due_date}}
- {{proposal.title}} / {{proposal.amount}}

Appointment variables (calendar notifications):
- {{appointment.title}} / {{appointment.date}} / {{appointment.time}}
- {{appointment.start_time}} / {{appointment.end_time}} / {{appointment.duration}}
- {{appointment.timezone}} / {{appointment.meeting_location}} / {{appointment.calendar_name}}

Lead / event variables:
- {{lead.wedding_date}} / {{lead.wedding_month}} / {{lead.guest_count}}

Subscription variables:
- {{subscription.amount}} / {{subscription.frequency}} / {{subscription.next_payment_date}}

Marketing-only variables (campaign emails):
- {{marketing.unsubscribe_url}} / {{marketing.resubscribe_url}} / {{marketing.preferences_url}}

System variables:
- {{system.date}} — today's date at send time
- {{system.year}} — current year

Where to find variable pickers:
- Campaign builder: the variable panel — grouped by category, click to copy
- Notifications page: variable pills below the template editor — click any pill to copy
- Calendar settings → Notifications: merge tag reference in each channel editor`,
      },
    ],
  },
  {
    id: 'push-notifications',
    label: 'Push Notifications',
    iconName: 'BellRing',
    color: '#8b5cf6',
    articles: [
      {
        id: 'push-overview',
        title: 'Push notifications overview',
        tags: ['push notifications', 'push alerts', 'browser notifications', 'real-time alerts', 'pwa', 'native app'],
        body: `Push notifications (an instant alert banner on your phone) come from the StoryVenue app for iPhone and Android.

In the app
Install the StoryVenue app from the App Store or Play Store and sign in. Then open Settings → Push Notifications inside the app and choose which events (a new lead, a new message, and so on) send you an alert.

On the web
The web dashboard doesn't send push alerts. Use Settings → Notifications instead: under "Alerts about your business", you and each teammate choose, per alert, whether to get an email, a text, both, or neither.`,
      },
      {
        id: 'push-settings',
        title: 'Choosing your push alerts (in the app)',
        tags: ['push settings', 'notification settings', 'toggle', 'enable push', 'disable push', 'test push', 'native app', 'mobile app'],
        body: `Push alerts are set inside the StoryVenue app for iPhone and Android.

In the app
1. Open Settings → Push Notifications.
2. Turn on push. Your phone asks for permission the first time.
3. Switch individual alerts (a new lead, a new message, and so on) on or off.

On the web dashboard, manage your alerts at Settings → Notifications instead: choose email and/or text for each alert, separately for you and every teammate.`,
      },
      {
        id: 'push-install-app',
        title: 'Installing StoryVenue on your phone or computer',
        tags: ['install app', 'pwa', 'progressive web app', 'add to home screen', 'mobile app', 'desktop app', 'app install'],
        body: `You can install StoryVenue's web dashboard on your phone, tablet, or computer so it opens like an app, separate from your browser.

What you get when you install:
- A home screen / desktop icon for one-tap access
- Full-screen mode without browser address bar
- Faster load times after the first visit

Note: installed this way, StoryVenue doesn't send push alerts. Alerts about your business arrive by email and text (Settings → Notifications). For push alerts, install the StoryVenue app from the App Store or Play Store.

How to install on iPhone / iPad (Safari):
1. Open app.storyvenue.com in Safari
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Tap Add — the StoryVenue icon appears on your home screen

How to install on Android (Chrome):
1. Open app.storyvenue.com in Chrome
2. Tap the three-dot menu (top-right)
3. Tap "Add to Home screen" or "Install app"
4. Tap Install — the app appears in your app drawer

How to install on Desktop (Chrome, Edge):
1. Open app.storyvenue.com in your browser
2. Click the install icon in the address bar (a plus or monitor icon)
3. Click Install — the app opens in its own window and appears in your taskbar / dock

The install prompt appears automatically after your first few visits. If you dismissed it, you can always install manually using the steps above.

Offline: if you lose internet connection, StoryVenue shows a friendly offline page with a retry button. Your data is safe — just reconnect and try again.`,
      },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    iconName: 'LifeBuoy',
    color: '#0ea5e9',
    articles: [
      {
        id: 'support-contact',
        title: 'Contacting StoryVenue support',
        tags: ['support', 'help', 'contact', 'ticket', 'email support', 'issue', 'bug', 'problem'],
        body: `Need help beyond the Help Center and Ask AI? Contact the StoryVenue support team.

From the dashboard
1. Open Ask AI (the sparkle button, bottom-right of any page)
2. Choose Contact support
3. Describe what you need and send it

You'll get a reply by email. What you asked Ask AI is included, so you don't have to repeat yourself.

By email
You can also email clients@storyvenuemarketing.com at any time.

Before you write
- Ask AI can answer most how-to questions straight away
- The Help Center (sidebar → Help Center) is searchable`,
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
        body: `Ask AI is your built-in assistant. It knows how to use StoryVenue and can see your own account: your revenue, recent proposals, and — when you're in the Lead Inbox — your leads, stages, and notes.

Open it by clicking the sparkle button (bottom-right corner of any page), or choose Ask AI in the Help Center.

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
- In the Lead Inbox: "What's my total pipeline value?", "Which leads have wedding dates in June?", "Explain weighted vs open pipeline"
- "What is the Media library?" or "How do I reuse photos in my emails and forms?"
- "How do merge variables work?"
- On the Calendar page: use the "Search & Ask AI" button (sparkle icon) for calendar-specific AI search — ask "What tours do I have next week?" or "Any cancellations this month?"

Ask AI answers in plain language. It uses your real account data to give accurate, personalised answers. If an answer looks out of date, refresh the page and ask again.`,
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
  '/dashboard': ['gs-onboarding', 'gs-overview', 'gs-sidebar-chrome', 'dash-announcement-ticker'],

  // Contacts
  '/dashboard/contacts': ['cust-add', 'cust-search', 'cust-profile', 'cust-pipeline', 'cust-tasks', 'cust-documents', 'cust-dnd'],

  // Conversations (unified inbox)
  '/dashboard/conversations': ['conversations-overview', 'conversations-venue-direct', 'conversations-inbound', 'conversations-sms-troubleshooting', 'conversations-profile-drawer', 'cust-profile'],
  '/dashboard/concierge':     ['conversations-concierge-inbox', 'conversations-venue-direct', 'conversations-overview'],

  // Calendar
  '/dashboard/calendar': ['cal-overview', 'cal-add-event', 'cal-ai-search', 'cal-multi-calendar', 'cal-event-actions', 'cal-spaces', 'cal-conflicts', 'cal-multi-day', 'cal-recurring'],

  // Venue listing (directory + reviews + analytics)
  '/dashboard/listing/media': ['listing-media-library', 'listing-photos', 'listing-overview', 'brand-setup'],
  '/dashboard/media': ['listing-media-library', 'listing-photos', 'listing-overview', 'brand-setup'],
  '/dashboard/listing/images': ['listing-photos', 'listing-media-library', 'listing-overview', 'listing-publish'],
  '/dashboard/listing/reviews': ['listing-reviews', 'listing-google-reviews', 'listing-overview', 'listing-publish'],
  '/dashboard/listing/booking-system': ['listing-booking-system', 'int-leadfinder', 'billing-verified-sponsored', 'mkt-system-vars', 'billing-pricing-guide', 'mkt-ai-concierge'],
  // /dashboard/listing IS the Bride Booking System™ analytics page (not the listing editor)
  '/dashboard/listing':        ['listing-analytics-realtime', 'listing-analytics-retention', 'billing-plans-overview', 'billing-trial', 'listing-overview'],
  '/dashboard/listing/venue-listing': ['listing-overview', 'listing-autosave', 'listing-publish', 'listing-slug'],

  // Leads
  '/dashboard/leads': ['leads-overview', 'leads-space', 'leads-edit-pipelines', 'leads-crm-intelligence', 'leads-kanban', 'leads-filter-search', 'leads-notifications', 'leads-to-proposal'],

  // Marketing — native email
  '/dashboard/marketing/analytics': ['me-overview', 'me-compliance', 'leads-overview', 'gs-overview'],
  '/dashboard/marketing/email/campaigns':  ['me-builder', 'me-blocks', 'me-preview-test', 'me-segments', 'me-campaigns', 'me-compliance', 'brand-social-networks', 'brand-colors-saved'],
  '/dashboard/marketing/email/audiences':  ['me-segments', 'me-campaigns', 'me-overview', 'me-compliance'],
  '/dashboard/marketing/email/preferences':['me-compliance', 'me-overview'],
  '/dashboard/marketing/email':            ['me-overview', 'me-builder', 'me-blocks', 'me-segments', 'me-campaigns', 'me-compliance'],
  '/dashboard/marketing/form-builder':     ['me-form-builder', 'listing-media-library', 'leads-overview', 'gs-overview'],
  '/dashboard/marketing/ai-concierge':    ['mkt-ai-concierge', 'mkt-system-vars', 'conversations-overview'],

  // Offerings / Packages catalog
  '/dashboard/offerings': ['offerings-overview', 'pay-templates', 'pay-new'],

  // Payments — new proposal / invoice
  '/dashboard/payments/new':        ['pay-new', 'pay-manual', 'offerings-overview', 'pay-templates', 'pay-installments'],
  '/dashboard/invoices/new':        ['pay-new', 'pay-manual', 'offerings-overview', 'pay-installments', 'pay-subscriptions'],

  // Proposals list + edit + detail
  '/dashboard/payments/proposals':  ['pay-status', 'pay-numbers', 'pay-manual', 'pay-new', 'pay-detail'],
  '/dashboard/payments/invoices':   ['pay-status', 'pay-numbers', 'pay-new', 'pay-manual'],
  '/dashboard/proposals/templates': ['pay-templates', 'pay-new', 'offerings-overview'],
  '/dashboard/proposals':           ['pay-detail', 'pay-templates', 'pay-manual', 'pay-numbers', 'pay-status'],

  // Payment schedules
  '/dashboard/payments/installments':  ['pay-installments', 'pay-new'],
  '/dashboard/payments/subscriptions': ['pay-subscriptions', 'pay-new'],

  // Transactions
  '/dashboard/transactions': ['pay-transactions', 'pay-numbers', 'pay-status'],

  // Other payment sub-pages
  '/dashboard/payments/payouts':       ['pay-transactions', 'rep-overview'],
  '/dashboard/payments/accounting':    ['rep-overview', 'rep-download', 'pay-transactions'],
  '/dashboard/payments/coupons':       ['pay-new', 'offerings-overview'],
  '/dashboard/payments/settings':      ['storypay-overview', 'storypay-ach', 'storypay-inline-checkout'],

  // Reports
  '/dashboard/reports': ['rep-overview', 'rep-download'],

  // Settings
  '/dashboard/settings/branding':        ['brand-setup', 'brand-colors-saved', 'brand-social-networks', 'listing-media-library', 'me-block-social', 'me-block-address'],
  '/dashboard/settings/email-templates': ['notif-settings', 'email-types', 'email-variables', 'me-overview'],
  '/dashboard/settings/calendar':        ['cal-settings-overview', 'cal-multi-calendar', 'cal-per-calendar-rules', 'cal-notification-overview', 'cal-notification-reminders', 'cal-settings-booking-rules', 'cal-settings-google-sync'],
  '/dashboard/settings/integrations':    ['int-zapier', 'int-calendly', 'int-tripleseat', 'int-eventtemple', 'int-honeybook'],
  '/dashboard/settings/team':            ['team-invite', 'team-roles'],
  '/dashboard/settings/notifications':   ['notif-settings', 'email-types', 'email-variables', 'sms-notifications', 'merge-vars-overview'],
  '/dashboard/settings/push':            ['push-settings', 'push-overview', 'push-install-app'],
  '/dashboard/directory-billing':        ['billing-plans-overview', 'billing-trial', 'billing-verified-sponsored', 'gs-overview'],
  '/dashboard/listing/directory':        ['billing-verified-sponsored', 'billing-plans-overview', 'billing-trial', 'listing-overview'],
  '/dashboard/listing/pricing-guide':    ['billing-pricing-guide', 'listing-web-form', 'listing-overview', 'listing-photos'],
  '/dashboard/listing/web-form':         ['listing-web-form', 'billing-pricing-guide', 'brand-setup', 'leads-overview'],
  '/dashboard/listing/lead-finder':      ['int-leadfinder', 'leads-overview', 'listing-booking-system'],
  '/dashboard/settings':                 ['gs-overview', 'gs-onboarding', 'int-legacy'],

  // Support
  '/dashboard/support': ['support-contact', 'ai-overview', 'ai-escalate'],

  // Profile / 2FA
  '/dashboard/profile': ['account-update-profile', 'account-2fa', 'account-login'],

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
