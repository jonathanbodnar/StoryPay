// Couple ("bride") help content — the Wedding Planner side of StoryVenue.
//
// Kept deliberately separate from src/lib/help-articles.ts (the venue owner's
// Help Center) so a couple never sees venue-only material and vice versa.
//
// PUBLIC-SAFE BY POLICY: these articles describe how to USE the wedding side of
// the product only. No architecture, no database or field names, no API routes,
// no third-party provider names, no internal tooling, no costs or margins.
// Write for a couple planning a wedding, not for an engineer.

export interface CoupleHelpArticle {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface CoupleHelpCategory {
  id: string;
  label: string;
  color: string;
  // icon name string — components import lucide icons themselves
  iconName: string;
  articles: CoupleHelpArticle[];
}

export const COUPLE_HELP_CATEGORIES: CoupleHelpCategory[] = [
  {
    id: 'couple-getting-started',
    label: 'Getting Started',
    iconName: 'Heart',
    color: '#f43f5e',
    articles: [
      {
        id: 'couple-overview',
        title: 'Welcome to your Wedding Planner',
        tags: ['overview', 'intro', 'start', 'wedding planner', 'tools', 'where', 'navigation'],
        body: `Your Wedding Planner is the private home for everything about your wedding. It is the same planning space your venue sees (minus your guests' personal contact details), so you always know where to look and you never have to email a spreadsheet back and forth.

Open it any time at app.storyvenue.com and log in. You land on your Wedding Planner home, which shows:
- A live countdown to your wedding day
- Your wedding summary (date, guest counts, and any details you and your venue have shared)
- A grid of planning tools: Guests & RSVPs, Seating, Day-of timeline, Checklist, Budget, Vendors, Inspiration, Wedding website, and Messages
- Anyone you have invited to help you plan

On a phone you get a bottom tab bar with Home, Guests, Messages, Checklist, and More. The More tab opens the rest of your tools in a single list.

Your planning is private. Your venue sees the planning details they need to prepare for your day (guest counts, meal tallies, seating) but never your guests' email addresses, phone numbers, or mailing addresses.`,
      },
      {
        id: 'couple-connect-venue',
        title: 'Connecting your venue',
        tags: ['venue', 'connect', 'link', 'request', 'invite', 'approve'],
        body: `Your Wedding Planner works on its own, but once you connect with your venue you both see the same live plan: your venue gets your guest and meal counts automatically, and you can message them directly.

Two ways it happens:
- Your venue invites you: you get an email with a link. Open it and follow the prompt to connect.
- You request them: find your venue and request to connect.

Either way, the venue confirms the connection. One wedding links to one venue.

If you are not connected yet, your Wedding Planner still works for your own planning. Open it and look for the option to connect your venue.

You are in control of what you share. Your venue can toggle which details you see from their side, and they never see your guests' contact details.`,
      },
      {
        id: 'couple-collaborators',
        title: 'Inviting your partner or a planner to help',
        tags: ['collaborator', 'partner', 'fiance', 'planner', 'invite', 'help', 'team', 'access'],
        body: `You do not have to plan alone. You can invite your partner, a family member, or a wedding planner to share your Wedding Planner.

Invited people get their own login. They can see and work on the shared planning tools, like the guest list, seating, checklist, and timeline.

One thing to know: Budget is private to the account that owns the wedding. Collaborators do not see your budget, and the same goes for the option to email your wedding website to guests. Everything else is shared.

To invite someone, open your Wedding Planner and look for the collaborators section, then send them an invite by email. You can remove someone's access at any time.`,
      },
      {
        id: 'couple-privacy',
        title: 'What your venue can and cannot see',
        tags: ['privacy', 'venue', 'see', 'share', 'data', 'contact', 'personal', 'pii'],
        body: `Your guest list is yours. When your wedding is connected to a venue, they see the planning information they need to prepare for your day:

What your venue sees
- Guest names, party sizes, and groups
- RSVP status (attending, awaiting, declined)
- Meal choices and dietary notes
- Your seating chart and room layout, with seated counts per table
- Totals: headcount and meal tallies

What your venue never sees
- Your guests' email addresses
- Your guests' phone numbers
- Your guests' mailing addresses

Your venue also chooses which wedding details to show you, such as your wedding date, guest count, space, and coordinator. If something you expect to see is missing, it is usually a sharing toggle on their side, and a quick message to your venue sorts it out.`,
      },
    ],
  },
  {
    id: 'couple-guests',
    label: 'Guests & RSVPs',
    iconName: 'Users',
    color: '#0ea5e9',
    articles: [
      {
        id: 'couple-guests-add',
        title: 'Adding guests to your list',
        tags: ['guests', 'add', 'list', 'invite', 'name', 'party'],
        body: `Open Guests from your Wedding Planner. Add each invitation as one entry, even when it covers more than one person.

For each entry you can record:
- The name you want to see on your list
- How many people are in that party
- A group, such as Family, College friends, or Work
- Meal choice and any dietary notes, once you know them

A party of four is one entry with a party size of four. That keeps your list readable and makes sure your seating chart reserves the right number of seats.

Use groups to keep a long list tidy. You can filter and sort by group, and groups also show up when you are seating people so you can seat a group together easily.`,
      },
      {
        id: 'couple-guests-party-size',
        title: 'Party size, and why it matters',
        tags: ['party size', 'seats', 'count', 'headcount', 'plus one', 'seating'],
        body: `Every entry has a party size: how many people that invitation covers. It is the single most important number on your list, because it drives everything downstream:

- Your headcount and your venue's meal tallies
- How many seats a party takes at a table on your seating chart
- Whether a table is over capacity

A party of four seated at a table for eight uses four of those eight seats.

If you are not sure yet, it is fine to start with one and update it when your guest replies. Just remember to update the party size if a guest asks to bring someone, otherwise your seating chart and your venue's counts will be short.`,
      },
      {
        id: 'couple-guests-groups',
        title: 'Organizing guests with groups',
        tags: ['groups', 'organize', 'family', 'friends', 'filter', 'sort'],
        body: `Groups are labels you put on guest entries, like Family, College friends, Work, or Out of town.

They are purely for your own organization, and they help in three places:
- Filtering and scanning a long guest list
- Seating people: groups are shown when you are assigning tables, so you can keep a group together
- Meal and headcount summaries

You can rename groups whenever you like. Changing a group name updates every guest in it.`,
      },
      {
        id: 'couple-guests-rsvp',
        title: 'Sending RSVP links and collecting replies',
        tags: ['rsvp', 'reply', 'invite', 'email', 'link', 'meal', 'dietary', 'response'],
        body: `Instead of chasing replies by text, you can send each guest a personal RSVP link.

What your guests see is a simple, mobile-friendly page where they:
1. Find their name
2. Say whether they are coming
3. Confirm how many people are in their party
4. Choose a meal
5. Add any dietary notes

Replies come straight back onto your guest list. No retyping, no counting texts by hand.

You can resend a link to anyone who has not replied. Guests who have already replied are not sent a second invite, so you will not spam the people who were quick to answer.

Tip: send your RSVP links early and resend once near your deadline. Most of the work in collecting RSVPs is simply reminding the people who meant to reply and forgot.`,
      },
      {
        id: 'couple-guests-statuses',
        title: 'What each RSVP status means',
        tags: ['rsvp', 'status', 'attending', 'declined', 'awaiting', 'pending', 'counts'],
        body: `Every guest entry has a status, and it updates as replies come in:

- Awaiting (or pending) — you have not heard back yet. These people still count toward your invited total but not your confirmed headcount.
- Attending — they are coming, and their party size counts toward your headcount, your meal tallies, and your seating.
- Declined — they are not coming. They stay on your list for your records but are excluded from counts.

Your Wedding Planner home and your guest list both show a summary: attending, declined, and awaiting, plus your total headcount.

Your venue sees the same summary, so their catering and staffing numbers stay accurate as replies come in.`,
      },
      {
        id: 'couple-guests-meals',
        title: 'Meal choices and dietary notes',
        tags: ['meal', 'dietary', 'allergy', 'vegan', 'gluten', 'catering', 'menu', 'entree'],
        body: `Recording meal choices and dietary needs is one of the most useful things you can do in your guest list, because it is exactly what your venue needs for catering.

For each guest you can record a meal choice from the menu options your venue has set up, plus free-text dietary notes for anything else: allergies, intolerances, vegan or vegetarian, children's meals, and so on.

Two places meal choices come from:
- Guests choose their own when they reply through an RSVP link
- You can set or correct them yourself on any guest entry

Your venue sees meal-by-meal tallies and the dietary notes, so they can plan the kitchen without you having to compile a list. If a guest tells you about a severe allergy at the last minute, update their entry, and tell your venue directly as well.`,
      },
    ],
  },
  {
    id: 'couple-seating',
    label: 'Seating & Room Layout',
    iconName: 'Armchair',
    color: '#8b5cf6',
    articles: [
      {
        id: 'couple-seating-table-basics',
        title: 'Seating chart basics: tables and who sits where',
        tags: ['seating', 'tables', 'assign', 'seat', 'chart', 'reception', 'capacity', 'create table'],
        body: `The Seating tab is where your seating chart lives, and it is the source of truth for who sits where.

Start by creating your tables. Each table needs a name and a number of seats, for example "Table 1" with 8 seats, or "Head table" with 10. Add as many as you need.

Then seat your guests. Every guest entry shows a table picker, and you can also see who is already at a table and move people between tables. Parties fill seats by their party size, so a party of four takes four seats.

You will see a seated count on each table, like 6/8, so you always know how full it is. Anything you have not seated yet is listed separately, so nobody gets forgotten.

A few habits that make this easier:
- Create your tables before you build your room layout. Tables are created here, in the seating list, and then placed on the floor plan.
- Seat in groups. Groups are shown next to each guest, so you can keep families and friend groups together.
- Seat your confirmed guests first and leave a little slack. A couple of spare seats absorbs late replies.`,
      },
      {
        id: 'couple-seating-capacity',
        title: 'Over-capacity warnings',
        tags: ['over capacity', 'too many', 'warning', 'red', 'full', 'seats'],
        body: `If you seat more people at a table than it has seats, that table is flagged. You will see the count turn red, like 9/8, so an over-full table is obvious at a glance.

Nothing breaks when this happens, and nothing is deleted. It is a warning, not an error, and it is there so an over-capacity table does not slip past you into the final plan.

To fix it, either move somebody to another table or increase that table's number of seats if the room allows it.

Your venue sees the same counts, and they use them for day-of setup, so it is worth clearing every red table before you finalise.`,
      },
      {
        id: 'couple-room-layout',
        title: 'Building your room layout',
        tags: ['room layout', 'floor plan', 'canvas', 'drag', 'decor', 'dance floor', 'bar', 'stage', 'rotate', 'resize'],
        body: `The Room layout tab turns your seating chart into a picture of the room, so you can see the shape of your reception and your venue knows exactly how to set it out.

Switch to Room layout on your Seating page and choose Edit. You can now:
- Place a table: every table you created in your seating list is offered here. Pick one and it appears on the floor plan, showing its name and how full it is.
- Add a blank table: useful for sketching a layout before your table names are final.
- Add decor: Dance floor, Head table, Chairs, Bar, DJ, Gift table, Cake, Stage, and a Text label for anything else.
- Arrange everything: drag items to move them, drag the corner handle to resize, rotate an item, and delete anything you do not need.

Chairs are a row you can size to suit the space. Select a chair row and use the plus and minus control to set anywhere from 1 to 10 chairs, which is handy for ceremony seating or a few extra seats.

Tables come in three shapes: round, square, and long. Choose the shape you want before you place a table, or change the shape of a table you have already placed by selecting it.

Your layout is shared with your venue, so they can see and adjust the same floor plan. When you are happy with it, save your changes.`,
      },
      {
        id: 'couple-room-layout-view',
        title: 'Seeing who is seated at each table',
        tags: ['room layout', 'view', 'who is seated', 'guests at table', 'tap', 'hover', 'names'],
        body: `Once your tables are placed on the room layout, you can check who is sitting where without going back to the seating list.

The room layout has two modes: View and Edit. It opens in View.
- In View, tap or click any table. A panel opens listing everyone at that table, grouped by party, with each party's size, RSVP status, meal choice, and group.
- On a computer, hovering over a table also shows a quick preview of the names, so you can skim a whole room without clicking.
- Tables with nobody seated yet say so.
- In Edit mode, clicking a table selects it so you can move or reshape it, which is why the guest panel is a View-mode thing.

This is the fastest way to check your work: look for two people at the same table who should not be, or a group that got split. You can also use it to see how full each table looks on the floor plan at a glance.

Switching between View and Edit does not change your layout in any way, so move between them as often as you like.`,
      },
      {
        id: 'couple-room-layout-print',
        title: 'Printing or downloading your floor plan',
        tags: ['print', 'png', 'download', 'pdf', 'names', 'floor plan', 'save', 'share'],
        body: `You can turn your room layout into an image to print or hand to your venue.

Below the room layout you will find two buttons:
- PNG — downloads a picture of your floor plan
- Print — opens your browser's print dialog with the floor plan ready to print

There is also an "Include guest names" option. With it on, each table on the printed plan shows its name, its seated count, and the names of the parties at that table, so you get a genuinely useful seating chart for the day. Tick it off if you would rather print just the floor plan with table names and counts.

If a table is crowded with names, the plan shows the first few and a "+2 more" style note rather than cutting anyone off silently. If you need every name on paper, print in landscape or use the on-screen View mode to read the full list for that table.`,
      },
      {
        id: 'couple-room-layout-save',
        title: 'Saving your layout and unsaved changes',
        tags: ['save', 'unsaved', 'changes', 'dirty', 'lost', 'layout', 'leave'],
        body: `Your room layout has its own save button, separate from everything else in your Wedding Planner. Move a table, add a dance floor, or change a chair row, and you will see the save button appear as Save layout.

Two things worth knowing:
- Changes are saved when you press Save layout. If you leave the page or switch tabs first, unsaved changes are discarded.
- If you try to leave with unsaved changes, you are asked to confirm first, so you cannot lose a whole floor plan by accident.

If your layout looks different from what you expected, it is usually because a change was made but not saved, or because your venue edited the same floor plan. The room layout is shared, so you and your venue are both working on one plan. If it was changed elsewhere, you will be told and the latest version is loaded so you can reapply your changes.

Save as you go and this is never a problem.`,
      },
    ],
  },
  {
    id: 'couple-planning',
    label: 'Planning Tools',
    iconName: 'ListChecks',
    color: '#f59e0b',
    articles: [
      {
        id: 'couple-checklist',
        title: 'Your planning checklist',
        tags: ['checklist', 'todo', 'tasks', 'countdown', 'to do', 'deadline', 'timeline'],
        body: `The Checklist gives you every to-do in one place, with a countdown so you can see what is next.

Each item can be checked off, and you can add your own items for anything specific to your wedding. Completed items stay visible so you can see how far you have come, and you can always reopen something you ticked by mistake.

Checklist is one of the four main tabs on your phone, so it is easy to dip into whenever you have a spare minute.`,
      },
      {
        id: 'couple-budget',
        title: 'Your budget tracker',
        tags: ['budget', 'money', 'cost', 'spend', 'vendors', 'private', 'payments', 'total'],
        body: `Budget lets you track what you are spending and how it compares with your total.

Add a budget line for each thing you are paying for, with the amount and where it is going. Your running total updates as you go, so you can see what is left.

Your budget is private to you. Nobody else sees it: not your venue, and not anyone you have invited to help plan unless they own the wedding. It is shown as one card per line on a phone, so you never have to scroll sideways.

A useful habit: enter your estimates as soon as you have them, even roughly, then correct them as real quotes come in. Seeing the total early is what makes it useful.`,
      },
      {
        id: 'couple-timeline',
        title: 'Day-of timeline',
        tags: ['timeline', 'schedule', 'day of', 'order', 'ceremony', 'reception', 'itinerary'],
        body: `The Day-of timeline is where you plan how your wedding day runs, minute by minute: ceremony, photos, cocktail hour, dinner, speeches, first dance, and everything after.

Build it as a list of moments with times, then share it. Your venue and your vendors can plan around it, and you have one answer when somebody asks "what time is what?"

It is worth starting this early, even roughly. A timeline that exists and is roughly right beats a perfect one you never wrote down.`,
      },
      {
        id: 'couple-vendors',
        title: 'Keeping your vendors in one place',
        tags: ['vendors', 'suppliers', 'photographer', 'florist', 'band', 'dj', 'contacts', 'caterer'],
        body: `Vendors is where you keep the people making your day happen: photographer, florist, band or DJ, caterer, hair and makeup, officiant, and anyone else.

Add each vendor with their category and business name, plus the contact details you need. On a phone, each vendor is shown as a card with the category and name stacked, so nothing gets clipped.

Keeping this list in your Wedding Planner means you are not hunting through your phone for the florist's number the week of the wedding.`,
      },
      {
        id: 'couple-inspiration',
        title: 'Your inspiration board',
        tags: ['inspiration', 'mood board', 'ideas', 'photos', 'style', 'colors', 'theme'],
        body: `Inspiration is your mood board: the ideas, looks, colours, and details you want for your day.

Save the things you keep coming back to. When you are deciding on flowers, lighting, or a table setting, having your favourites in one place makes the decision much quicker.

It is also the easiest way to show your venue or your vendors the look you are after.`,
      },
      {
        id: 'couple-favorites',
        title: 'Favorites: venues you have saved',
        tags: ['favorites', 'wish list', 'saved', 'venues', 'shortlist', 'bookmark'],
        body: `As you browse venues on storyvenue.com, you can save the ones you like to Favorites.

Favorites is your shortlist. It keeps the venues you are seriously considering in one place, so you can compare them side by side instead of trying to remember which was which.

You will find Favorites in your account menu on a computer, and in the More tab on your phone.`,
      },
    ],
  },
  {
    id: 'couple-website',
    label: 'Wedding Website',
    iconName: 'Globe',
    color: '#10b981',
    articles: [
      {
        id: 'couple-site-setup',
        title: 'Building your wedding website',
        tags: ['website', 'site', 'minisite', 'build', 'publish', 'page', 'wedding website'],
        body: `Your free wedding website is included with your Wedding Planner, and it lives inside the same login. No separate account, no monthly fee.

Open Wedding website from your Wedding Planner tools. You can add:
- Your personalised link
- A main photo, and an optional cover banner
- Your names, a headline, and your story
- A live countdown to the big day
- Links to your Instagram, Facebook, TikTok, and Pinterest
- Up to six custom buttons for anything else: registry, hotel block, travel, livestream, schedule, and so on
- An "Our Venue" card that sends guests to your venue's page
- Online RSVP
- A guestbook where guests can leave well-wishes

When you are ready, press Publish. You can also copy your link or download a QR code, which is handy for save-the-dates and table cards.

Your site is mobile-first, so most guests will see it on a phone and it will look the way you intended.`,
      },
      {
        id: 'couple-site-link',
        title: 'Choosing your wedding website link',
        tags: ['link', 'url', 'website address', 'custom link', 'availability', 'share'],
        body: `Your wedding website gets a custom link you can share anywhere, in the form storyvenue.com/your-names.

As you type, your link is checked straight away, so you find out immediately whether it is available. Pick something short and easy to read out loud, like your first names joined together.

This is the one link you put on your invitations, texts, and social profiles, so choose it before you print anything.

If you change your link later, old links stop working, so it is worth settling on it early.`,
      },
      {
        id: 'couple-site-rsvp',
        title: 'Online RSVP on your website',
        tags: ['rsvp', 'website', 'online', 'reply', 'guest', 'headcount', 'meal'],
        body: `Your wedding website includes online RSVP, so guests can reply without you chasing them.

A guest finds their invitation by name on your site, then replies with their headcount, meal choice, and dietary notes. Their reply flows into your guest list and the same summaries your venue sees, so nobody has to copy anything across.

If you also send personal RSVP links from your guest list, replies land in exactly the same place. Both routes update the same list.`,
      },
      {
        id: 'couple-site-guestbook',
        title: 'Your guestbook',
        tags: ['guestbook', 'messages', 'well wishes', 'comments', 'approve', 'moderate'],
        body: `Your guestbook lets guests leave a note on your wedding website, and you decide what appears publicly.

Turn it on when you want it. Guests can write a message, and you approve posts before they show on your page, so nothing appears that you have not seen first.

It is a lovely thing to look back on after the day, and a nice way for guests who cannot attend to still say something.`,
      },
      {
        id: 'couple-invite-guests',
        title: 'Emailing your wedding website to guests',
        tags: ['invite', 'email', 'website', 'send', 'csv', 'import', 'recipients', 'list'],
        body: `Rather than sending your website link by hand, you can email it from your Wedding Planner.

Add the people you want to tell, then send. You can add them one at a time, or import a list from a spreadsheet in one go, and you can drag and drop a file to import it.

Anyone you email can be added to your guest list too, so you are not entering the same names twice.

People you have already sent it to are not emailed again, so you can send in batches as your list grows without spamming anyone. This option is for the account that owns the wedding.`,
      },
    ],
  },
  {
    id: 'couple-venue-contact',
    label: 'Your Venue',
    iconName: 'MessageCircle',
    color: '#0ea5e9',
    articles: [
      {
        id: 'couple-messages',
        title: 'Messaging your venue',
        tags: ['messages', 'chat', 'venue', 'contact', 'ask', 'question', 'thread'],
        body: `Once you are connected with your venue, Messages is your direct line to them.

It is a single thread for your wedding, so questions, answers, and decisions stay together instead of scattering across texts and emails. There is a button to start a new message right in the thread.

Use it for the things that matter: confirming timings, asking about the space, flagging a dietary need, or letting them know your headcount has changed.

On a phone, Messages is one of the main tabs, so it is always one tap away. On a computer, it is in the top navigation.

Your venue's team can see the thread, so if your main contact is away, somebody else can pick it up. Keep urgent day-of changes in here rather than in a text message, so there is a record.`,
      },
    ],
  },
  {
    id: 'couple-account',
    label: 'Your Account',
    iconName: 'User',
    color: '#6b7280',
    articles: [
      {
        id: 'couple-account-profile',
        title: 'Your profile and wedding details',
        tags: ['profile', 'account', 'email', 'name', 'wedding details', 'password', 'settings'],
        body: `Your Profile is where your account and wedding details live.

From here you can update the details that appear across your Wedding Planner, and your login email. If you change your email, use the new one the next time you log in.

Some of what you see here is shared with your venue on purpose, so they can plan your day: your wedding date, guest count, and space. You can always see what is in your profile, and your venue's own sharing settings control what appears on their side.`,
      },
      {
        id: 'couple-account-login',
        title: 'Logging in and resetting your password',
        tags: ['login', 'log in', 'password', 'forgot', 'reset', 'sign in', 'access', 'cant get in'],
        body: `Log in at app.storyvenue.com using the email address on your account.

If you have forgotten your password, choose the reset option on the login screen and follow the email you receive. The link is time-limited, so use it promptly; if it has expired, request a new one.

A few things that solve most login problems:
- Check you are using the same email address your account was created with, including whether it was a personal or shared address
- If you were invited by your partner or your venue, use the invite link you were sent the first time
- Look in your spam folder if a reset email has not arrived within a few minutes

If you are still locked out, ask your venue to help, or use the support option on the login screen.`,
      },
      {
        id: 'couple-native-app',
        title: 'Using StoryVenue on your phone',
        tags: ['app', 'phone', 'mobile', 'install', 'pwa', 'notifications', 'push', 'tab bar'],
        body: `Your Wedding Planner works properly on a phone, which is where most couples do their planning.

You can add it to your home screen so it opens like an app, without a browser bar in the way. Once it is on your home screen you get a bottom tab bar with Home, Guests, Messages, and Checklist, and a More tab for everything else.

If you turn on notifications, you can be alerted about the things that matter, like a new message from your venue.

On a computer, your Wedding Planner is the same information at a larger size, so you can switch between the two freely. Your plan is the same either way.`,
      },
    ],
  },
];

/** Flat lookup of every couple article id, for cross-referencing and search. */
export const COUPLE_HELP_ARTICLE_IDS: string[] = COUPLE_HELP_CATEGORIES.flatMap((c) =>
  c.articles.map((a) => a.id),
);
