/**
 * The Setup Guide: the short course every venue sees on its dashboard, the
 * suggested steps to its first leads. Owner's rules (Oct 4 2026):
 *
 *  - It opens by itself a few seconds after each sign-in, for every venue
 *    except Private Clients (our team sets those up). The X closes it; the
 *    product is never gated behind it.
 *  - Every step is a suggestion the venue can tick off itself, done or not.
 *    Once every step is ticked the pop-up stops ("that's on them").
 *  - A small closed pill stays on the dashboard until each step is REALLY set
 *    up (the listing is live, mail has reached the LeadFinder address…), so a
 *    step that was only ticked keeps its reminder.
 *  - StoryPay is optional: shown, but it counts toward neither.
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
  /** Nothing to detect, so ticking it is all there is: the venue ticks it
   *  (follow_up) or it ticks when shown (grow). */
  manual: boolean;
  /** Shown as a suggestion that doesn't count toward finishing the guide. */
  optional?: boolean;
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
    optional: true,
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
  /** venues.onboarding_steps_completed: the venue's own ticks, stored as "guide:<id>". */
  stepsCompleted: unknown;
  /** The plan's allowed screens; null = everything. */
  allowedNavIds: readonly string[] | null;
  leadFinderAvailable: boolean;
  privateClient: boolean;
}

/** What's kept in venues.onboarding_steps_completed for the guide. */
export const GUIDE_STEP_PREFIX = 'guide:';
/** Support switched this venue's pop-up and pill off (Venue Management). Not a step. */
export const GUIDE_PROMPTS_OFF = 'guide:prompts-off';

const DETECTED: Record<Exclude<SetupLessonId, 'follow_up' | 'grow'>, keyof SetupFacts> = {
  listing: 'published',
  pricing_guide: 'guideEnabled',
  lead_link: 'leadLinkSet',
  web_form: 'webFormLive',
  leadfinder: 'leadFinderMail',
  payments: 'stripeReady',
};

const savedSteps = (stored: unknown): string[] =>
  (Array.isArray(stored) ? stored : []).filter((s): s is string => typeof s === 'string');

export interface SetupLessonState {
  id: SetupLessonId;
  /** The venue ticked it off itself. */
  ticked: boolean;
  /** It really is set up (for a step with nothing to detect: it was ticked). */
  verified: boolean;
  /** Ticked or really set up: what the venue sees as done. */
  checked: boolean;
  optional: boolean;
}

/**
 * The steps this venue sees, in order. A step is left out when the venue can't
 * act on it: its plan doesn't include the screen, LeadFinder isn't switched on
 * for it, or (the strategy-call step) it is already a Private Client.
 */
export function setupLessonsFor(ctx: SetupContext): SetupLessonState[] {
  const saved = new Set(savedSteps(ctx.stepsCompleted));
  const out: SetupLessonState[] = [];
  for (const lesson of SETUP_LESSONS) {
    if (lesson.navId && ctx.allowedNavIds && !ctx.allowedNavIds.includes(lesson.navId)) continue;
    if (lesson.id === 'leadfinder' && !ctx.leadFinderAvailable) continue;
    if (lesson.id === 'grow' && ctx.privateClient) continue;
    const ticked = saved.has(`${GUIDE_STEP_PREFIX}${lesson.id}`);
    const verified = lesson.manual ? ticked : ctx.facts[DETECTED[lesson.id as keyof typeof DETECTED]] === true;
    out.push({ id: lesson.id, ticked, verified, checked: ticked || verified, optional: lesson.optional === true });
  }
  return out;
}

/**
 * Where the venue stands. Optional steps count toward none of it.
 *  - checkedAll: every step is ticked or set up → the pop-up stops.
 *  - fulfilled:  every step is really set up     → the pill goes too.
 */
export function setupGuideProgress(lessons: readonly SetupLessonState[]): {
  done: number; total: number; left: number; checkedAll: boolean; fulfilled: boolean;
} {
  const counted = lessons.filter((l) => !l.optional);
  const done = counted.filter((l) => l.checked).length;
  const left = counted.filter((l) => !l.verified).length;
  return { done, total: counted.length, left, checkedAll: counted.length > 0 && done === counted.length, fulfilled: left === 0 };
}

/** The guide as the API hands it to the dashboard. */
export interface SetupGuideState {
  /** Wizard finished and the viewer runs the venue: the guide is in their sidebar. */
  eligible: boolean;
  /** This venue gets the prompts at all (everyone but Private Clients). */
  prompted: boolean;
  /** Open by itself after this sign-in (the dashboard still waits a few seconds). */
  autoOpen: boolean;
  /** The closed pill stays on the dashboard: something isn't really set up yet. */
  showPill: boolean;
  /** Every step is ticked or set up (optional ones aside): the pop-up has stopped. */
  checkedAll: boolean;
  /** Every step is really set up: nothing left to remind them of. */
  fulfilled: boolean;
  /** Steps ticked or set up, of the steps that count. */
  done: number;
  total: number;
  /** Steps that still aren't really set up. */
  left: number;
  lessons: SetupLessonState[];
  /** Player addresses by lesson, for the lessons that have a video. */
  videos: Partial<Record<SetupLessonId, string>>;
  listingUrl: string | null;
}

/** The venue's saved steps with one step ticked or unticked. */
export function withSetupStep(stored: unknown, id: SetupLessonId, done: boolean): string[] {
  const key = `${GUIDE_STEP_PREFIX}${id}`;
  const rest = savedSteps(stored).filter((s) => s !== key);
  return done ? [...rest, key] : rest;
}

export const setupPromptsOff = (stored: unknown): boolean => savedSteps(stored).includes(GUIDE_PROMPTS_OFF);

/** The venue's saved steps with support's "prompts off" switch set or cleared. */
export function withSetupPromptsOff(stored: unknown, off: boolean): string[] {
  const rest = savedSteps(stored).filter((s) => s !== GUIDE_PROMPTS_OFF);
  return off ? [...rest, GUIDE_PROMPTS_OFF] : rest;
}

/**
 * Does this venue get the guide's prompts (the pop-up after each sign-in and
 * the pill)? Every venue that has finished the setup wizard, old or new, on any
 * plan — except Private Clients, and one support has switched them off for.
 * Only the people who run the venue (owner, admins) are prompted.
 */
export function setupGuidePrompts(v: {
  wizardDone: boolean;
  promptsOff: boolean;
  privateClient: boolean;
  canManage: boolean;
}): boolean {
  return v.wizardDone && v.canManage && !v.privateClient && !v.promptsOff;
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
