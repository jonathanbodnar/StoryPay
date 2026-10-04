/**
 * The Setup Guide: the short course a venue sees on its dashboard until every
 * step is done. It opens by itself a few seconds after each sign-in (owner's
 * call, Oct 4 2026) and closes with the X; nothing switches it off except
 * finishing, or support switching the pop-up off for that venue.
 *
 * A step counts when the thing EXISTS (the listing is live, mail has reached
 * the LeadFinder address, Stripe takes charges…), not when a video was
 * watched. Two steps have nothing to detect and are ticked by hand.
 *
 * Pure rules only, shared by the API, the dashboard and the fast checks.
 * The database reads live in setup-guide-server.ts.
 */

import { parseVideoUrl } from '@/lib/video-providers';

export const SETUP_LESSON_IDS = [
  'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow',
] as const;
export type SetupLessonId = (typeof SETUP_LESSON_IDS)[number];

export interface SetupLesson {
  id: SetupLessonId;
  title: string;
  summary: string;
  steps: string[];
  /** Where the venue goes to do it. `grow` opens the strategy-call survey instead. */
  cta: { label: string; href: string } | null;
  /** The plan permission the screen needs; a venue whose plan lacks it never sees the step. */
  navId: string | null;
  /** Nothing to detect: the venue ticks it (follow_up) or it ticks when opened (grow). */
  manual: boolean;
  /** The screenshot behind the cover, replaced by the video's play button once a link is set. */
  cover: string;
}

export const SETUP_LESSONS: readonly SetupLesson[] = [
  {
    id: 'listing',
    title: 'Your listing is live. Share it',
    summary: 'Couples can find your venue on StoryVenue right now. The more places your link lives, the more inquiries you get.',
    steps: [
      'Open your listing and check your photos, pricing and details.',
      'Copy your link and add it to your website and email signature.',
      'Post it on Facebook and Instagram so engaged couples can find you.',
    ],
    cta: { label: 'Open my listing', href: '/dashboard/listing/venue-listing' },
    navId: 'nav_listing_dashboard',
    manual: false,
    cover: '/setup-guide/listing.webp',
  },
  {
    id: 'pricing_guide',
    title: 'Send couples your pricing guide',
    summary: 'When a couple asks for pricing they get your guide in seconds, and you get their name, email and phone.',
    steps: [
      'Open your pricing guide and check every price.',
      'Add your best photos and a short welcome note.',
      'Keep the guide switched on so it goes out the moment someone asks.',
    ],
    cta: { label: 'Open my pricing guide', href: '/dashboard/listing/pricing-guide' },
    navId: 'nav_listing_pricing_guide',
    manual: false,
    cover: '/setup-guide/pricing_guide.webp',
  },
  {
    id: 'lead_link',
    title: 'Put your Lead Link™ in your Instagram bio',
    summary: 'One link for your bio that sends followers to your pricing guide, your tour booking and anything else you choose.',
    steps: [
      'Pick a short name for your link.',
      'Add up to three buttons, like Book a Tour.',
      'Paste the link into your Instagram and Facebook bio.',
    ],
    cta: { label: 'Set up my Lead Link™', href: '/dashboard/listing/lead-link' },
    navId: 'nav_listing_lead_link',
    manual: false,
    cover: '/setup-guide/lead_link.webp',
  },
  {
    id: 'web_form',
    title: 'Add the inquiry form to your website',
    summary: 'Turn visitors on your own website into leads. Every inquiry lands in your Lead Inbox and gets followed up for you.',
    steps: [
      'Open your pricing guide and choose Get Embed Code.',
      'Paste the code on your website’s contact or pricing page.',
      'Send yourself a test inquiry and watch it arrive.',
    ],
    cta: { label: 'Get my embed code', href: '/dashboard/listing/pricing-guide' },
    navId: 'nav_listing_pricing_guide',
    manual: false,
    cover: '/setup-guide/web_form.webp',
  },
  {
    id: 'leadfinder',
    title: 'Catch every inquiry with LeadFinder™',
    summary: 'Inquiries that arrive by email from other directories become leads in your Lead Inbox automatically.',
    steps: [
      'Open Integrations and copy your LeadFinder™ address.',
      'Give that address to your directories, or forward their emails to it.',
      'Send a test inquiry to see a lead appear.',
    ],
    cta: { label: 'Set up LeadFinder™', href: '/dashboard/settings/integrations' },
    navId: 'nav_settings_integrations',
    manual: false,
    cover: '/setup-guide/leadfinder.webp',
  },
  {
    id: 'follow_up',
    title: 'See how every lead gets followed up',
    summary: 'The Speed to Lead System™ follows up with every new lead for you, from first inquiry to booked tour.',
    steps: [
      'Open the Speed to Lead System™ and read each message it sends.',
      'Change any wording so it sounds like you.',
      'Leave the system switched on so no lead goes cold.',
    ],
    cta: { label: 'Open Speed to Lead', href: '/dashboard/listing/booking-system' },
    navId: 'nav_listing_booking_system',
    manual: true,
    cover: '/setup-guide/follow_up.webp',
  },
  {
    id: 'payments',
    title: 'Get paid with StoryPay™',
    summary: 'Connect StoryPay™, powered by Stripe, so couples can sign their contract and pay from one link.',
    steps: [
      'Open Payment settings and choose Connect with Stripe.',
      'Answer Stripe’s questions about your business and bank account.',
      'Send your first proposal or invoice when a couple is ready to book.',
    ],
    cta: { label: 'Open Payment settings', href: '/dashboard/payments/settings' },
    navId: 'nav_payments_settings',
    manual: false,
    cover: '/setup-guide/payments.webp',
  },
  {
    id: 'grow',
    title: 'Want us to fill your calendar?',
    summary: 'See how our team runs the Bride Booking System™ for venues, then pick a time to talk about yours.',
    steps: [
      'Watch the short video.',
      'Answer a few questions about your venue.',
      'Pick a time for your strategy call.',
    ],
    cta: null,
    navId: null,
    manual: true,
    cover: '/setup-guide/grow.webp',
  },
];

const LESSON_BY_ID = new Map<string, SetupLesson>(SETUP_LESSONS.map((l) => [l.id, l]));
export const setupLesson = (id: string): SetupLesson | undefined => LESSON_BY_ID.get(id);

/** What the database says exists for a venue (setup-guide-server.ts reads these). */
export interface SetupFacts {
  published: boolean;
  guideEnabled: boolean;
  leadLinkSet: boolean;
  webFormLive: boolean;
  leadFinderMail: boolean;
  stripeReady: boolean;
}

export interface SetupContext {
  facts: SetupFacts;
  /** venues.onboarding_steps_completed (hand-ticked steps are stored as "guide:<id>"). */
  stepsCompleted: unknown;
  /** The plan's allowed screens; null = everything. */
  allowedNavIds: readonly string[] | null;
  leadFinderAvailable: boolean;
  privateClient: boolean;
}

export const MANUAL_STEP_PREFIX = 'guide:';

const DETECTED: Record<Exclude<SetupLessonId, 'follow_up' | 'grow'>, keyof SetupFacts> = {
  listing: 'published',
  pricing_guide: 'guideEnabled',
  lead_link: 'leadLinkSet',
  web_form: 'webFormLive',
  leadfinder: 'leadFinderMail',
  payments: 'stripeReady',
};

/**
 * The steps this venue sees, in order, each with whether it's done. A step is
 * left out when the venue can't act on it: its plan doesn't include the
 * screen, LeadFinder isn't switched on for it, or (the strategy-call step) it
 * is already a Private Client.
 */
export function setupLessonsFor(ctx: SetupContext): Array<{ id: SetupLessonId; done: boolean }> {
  const ticked = new Set(
    (Array.isArray(ctx.stepsCompleted) ? ctx.stepsCompleted : []).filter((s): s is string => typeof s === 'string'),
  );
  const out: Array<{ id: SetupLessonId; done: boolean }> = [];
  for (const lesson of SETUP_LESSONS) {
    if (lesson.navId && ctx.allowedNavIds && !ctx.allowedNavIds.includes(lesson.navId)) continue;
    if (lesson.id === 'leadfinder' && !ctx.leadFinderAvailable) continue;
    if (lesson.id === 'grow' && ctx.privateClient) continue;
    const done = lesson.manual
      ? ticked.has(`${MANUAL_STEP_PREFIX}${lesson.id}`)
      : ctx.facts[DETECTED[lesson.id as keyof typeof DETECTED]] === true;
    out.push({ id: lesson.id, done });
  }
  return out;
}

/** Venues that signed up from this day on are walked through the guide. */
export const SETUP_GUIDE_GUIDED_SINCE = '2026-10-04T00:00:00Z';

/**
 * Is this venue being walked through the guide (the pop-up after each sign-in
 * and the card on its dashboard)? Only a venue that signed up since the guide
 * shipped, has finished the setup wizard, still has steps left, and whose
 * pop-up support hasn't switched off. Private Clients are set up by our team.
 * Every other venue just has the guide in its sidebar.
 */
export function setupGuideIsGuided(v: {
  complete: boolean;
  wizardDone: boolean;
  createdAt: string | null | undefined;
  popupOff: boolean;
  privateClient: boolean;
  canManage: boolean;
}): boolean {
  if (v.complete || !v.wizardDone || v.popupOff || v.privateClient || !v.canManage) return false;
  const created = v.createdAt ? Date.parse(v.createdAt) : NaN;
  return Number.isFinite(created) && created >= Date.parse(SETUP_GUIDE_GUIDED_SINCE);
}

/** Videos that ship with the guide; the admin's links (Admin → Setup guide) replace them. */
export const SETUP_GUIDE_DEFAULT_VIDEOS: Partial<Record<SetupLessonId, string>> = {
  // The strategy-call presentation, the same video as storyvenue.com/strategy-call.
  grow: 'https://customer-v0pnfrdybz7soiqg.cloudflarestream.com/4c6bff483d8d73749d70e15a49cd8992/iframe',
};

/**
 * The address to put in the player for a pasted video link: YouTube, Vimeo,
 * Loom, Wistia or Cloudflare Stream. Null for anything else, so a pasted link
 * can never frame an arbitrary site inside the dashboard.
 */
export function videoEmbedUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const stream = /^([0-9a-f]{32})$/i;
  if (/^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(host) || host === 'iframe.videodelivery.net') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return stream.test(id) ? `https://${host}/${id}${host === 'iframe.videodelivery.net' ? '' : '/iframe'}` : null;
  }
  const parsed = parseVideoUrl(value);
  if (!parsed?.id) return null;
  const id = encodeURIComponent(parsed.id);
  switch (parsed.provider) {
    case 'youtube': return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    case 'vimeo': return `https://player.vimeo.com/video/${id}`;
    case 'loom': return `https://www.loom.com/embed/${id}`;
    case 'wistia': return `https://fast.wistia.net/embed/iframe/${id}`;
    default: return null;
  }
}

/** The stored links ({ lessonId: url }) as player addresses, defaults filled in. */
export function setupGuideVideos(stored: unknown): Partial<Record<SetupLessonId, string>> {
  const saved = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const out: Partial<Record<SetupLessonId, string>> = {};
  for (const id of SETUP_LESSON_IDS) {
    // An empty saved value means "no video here", even where a default exists.
    const raw = id in saved ? saved[id] : SETUP_GUIDE_DEFAULT_VIDEOS[id];
    const embed = videoEmbedUrl(typeof raw === 'string' ? raw : null);
    if (embed) out[id] = embed;
  }
  return out;
}
