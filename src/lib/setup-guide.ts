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
 *  - The first step is a 3-minute walkthrough video (added Oct 5 2026 with the
 *    owner's rewrite of every step's wording): it ticks when the venue starts
 *    the video.
 *
 * Pure rules only, shared by the API, the dashboard and the fast checks.
 * The database reads live in setup-guide-server.ts.
 */

import { parseVideoUrl } from '@/lib/video-providers';

export const SETUP_LESSON_IDS = [
  'walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow',
] as const;
export type SetupLessonId = (typeof SETUP_LESSON_IDS)[number];

export interface SetupLesson {
  id: SetupLessonId;
  title: string;
  summary: string;
  steps: string[];
  /**
   * The step's main button. With `href` it takes the venue to the screen where
   * the step is done. Without one it does something in the guide itself:
   * `play` starts the step's video where it is (walkthrough), `call` opens the
   * strategy-call survey (grow).
   */
  cta: { label: string; href: string; does?: undefined } | { label: string; does: 'play' | 'call'; href?: undefined };
  /** The plan permission the screen needs; a venue whose plan lacks it never sees the step. */
  navId: string | null;
  /** Nothing to detect, so ticking it is all there is: the venue ticks it
   *  (follow_up), it ticks when its video is started (walkthrough), or it
   *  ticks when shown (grow). */
  manual: boolean;
  /** Shown as a suggestion that doesn't count toward finishing the guide. */
  optional?: boolean;
  /** The screenshot behind the cover, replaced by the video's play button once a link is set. */
  cover: string;
}

export const SETUP_LESSONS: readonly SetupLesson[] = [
  {
    id: 'walkthrough',
    title: 'Start here: watch the 3-minute walkthrough',
    summary: 'How the Bride Booking System™ works and what to set up first.',
    steps: [
      'Press play above. The walkthrough takes about 3 minutes.',
      'See how every inquiry gets captured, answered and followed up for you.',
      'Then work down this list in order, starting with your listing link.',
    ],
    // Plays the step's video where it is. The link is pasted in Admin → Setup
    // guide; until one is, the step offers "Mark as done" so it can't get stuck.
    cta: { label: 'Watch the walkthrough', does: 'play' },
    navId: null,
    manual: true,
    cover: '/setup-guide/walkthrough.webp',
  },
  {
    id: 'listing',
    title: 'Share your listing link',
    summary: 'Your listing is already live. Every place you post the link is another way brides find you.',
    steps: [
      'Open your listing and make sure your photos, pricing and details look right.',
      'Copy your link and add it to your email signature.',
      'Share it on your Facebook page and in your social posts.',
    ],
    cta: { label: 'Open my listing', href: '/dashboard/listing/venue-listing' },
    navId: 'nav_listing_dashboard',
    manual: false,
    cover: '/setup-guide/listing.webp',
  },
  {
    id: 'pricing_guide',
    title: 'Check your pricing guide',
    summary: 'It’s what brides ask for first. They get it in seconds, and you get their name, email and phone.',
    steps: [
      'Open your pricing guide and check every price.',
      'Add your best photos and a short welcome note.',
      'Keep it switched on so it goes out the moment a bride asks.',
    ],
    cta: { label: 'Open my pricing guide', href: '/dashboard/listing/pricing-guide' },
    navId: 'nav_listing_pricing_guide',
    manual: false,
    cover: '/setup-guide/pricing_guide.webp',
  },
  {
    id: 'lead_link',
    title: 'Put your Lead Link™ in your Instagram bio',
    summary: 'One link where followers get your pricing guide or book a tour.',
    steps: [
      'Pick a short name for your link.',
      'Add up to three buttons, like Book a Tour.',
      'Paste the link into your Instagram bio and your Facebook page.',
    ],
    cta: { label: 'Set up my Lead Link™', href: '/dashboard/listing/lead-link' },
    navId: 'nav_listing_lead_link',
    manual: false,
    cover: '/setup-guide/lead_link.webp',
  },
  {
    id: 'web_form',
    title: 'Add the inquiry form to your website',
    summary: 'Every inquiry from your website lands in your Lead Inbox and gets followed up for you.',
    steps: [
      'Open your pricing guide and choose Get Embed Code.',
      'Paste the code on your website’s contact or pricing page, or send it to whoever runs your site.',
      'Send yourself a test inquiry and watch it arrive.',
    ],
    cta: { label: 'Get my embed code', href: '/dashboard/listing/pricing-guide' },
    navId: 'nav_listing_pricing_guide',
    manual: false,
    cover: '/setup-guide/web_form.webp',
  },
  {
    id: 'leadfinder',
    title: 'Forward your directory leads to LeadFinder™',
    summary: 'Inquiries from The Knot, WeddingWire and other directories land in your Lead Inbox, so none slip through.',
    steps: [
      'Copy your LeadFinder™ address from Integrations.',
      'Give that address to your directories, or forward their inquiry emails to it.',
      'Send a test inquiry and watch it land in your Lead Inbox.',
    ],
    cta: { label: 'Get my LeadFinder™ address', href: '/dashboard/settings/integrations' },
    navId: 'nav_settings_integrations',
    manual: false,
    cover: '/setup-guide/leadfinder.webp',
  },
  {
    id: 'follow_up',
    title: 'Make your follow-up sound like you',
    summary: 'The Speed to Lead System™ responds to every new bride right away, so she never waits on you.',
    steps: [
      'Open the Speed to Lead System™ and read each message it sends.',
      'Change any wording so it sounds like you, and leave it switched on.',
      'Download the StoryVenue app from the App Store or Google Play so new leads and replies reach your phone.',
    ],
    cta: { label: 'Review my messages', href: '/dashboard/listing/booking-system' },
    navId: 'nav_listing_booking_system',
    manual: true,
    cover: '/setup-guide/follow_up.webp',
  },
  {
    id: 'payments',
    title: 'Set up proposals and payments',
    summary: 'With StoryPay™, brides sign your proposal and pay the deposit from one link on their phone.',
    steps: [
      'Open Payment settings and choose Connect with Stripe.',
      'Answer Stripe’s questions about your business and bank account.',
      'Send your first proposal when a bride is ready to book.',
    ],
    cta: { label: 'Connect StoryPay™', href: '/dashboard/payments/settings' },
    navId: 'nav_payments_settings',
    manual: false,
    optional: true,
    cover: '/setup-guide/payments.webp',
  },
  {
    id: 'grow',
    title: 'Want us to bring you qualified brides?',
    summary: 'Watch how our team does it for venues like yours.',
    steps: [
      'Watch the short video above.',
      'Answer a few quick questions about your venue.',
      'If it’s a fit, pick a time for your strategy call.',
    ],
    // Opens the survey and booking modal.
    cta: { label: 'See if your venue qualifies', does: 'call' },
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

const DETECTED: Record<Exclude<SetupLessonId, 'walkthrough' | 'follow_up' | 'grow'>, keyof SetupFacts> = {
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

/**
 * What the guide's bar (on every dashboard page) and its sidebar entry say.
 * While there are steps still to tick it counts what's been done, by the
 * venue's own word or for real. Once every step is ticked it counts only
 * what's really set up, so a step ticked without doing it still shows as
 * owed (the owner's rule: the reminder stays until each step is fulfilled).
 * `nextId` is the step to send them to.
 */
export function setupGuideDisplay(guide: Pick<SetupGuideState, 'lessons' | 'done' | 'total' | 'left' | 'checkedAll' | 'fulfilled'>): {
  done: number; total: number; label: string; nextId: SetupLessonId | null; settingUp: boolean;
} {
  const counted = guide.lessons.filter((l) => !l.optional);
  if (!guide.checkedAll) {
    return {
      done: guide.done, total: guide.total, label: `${guide.done} of ${guide.total} done`,
      nextId: counted.find((l) => !l.checked)?.id ?? null, settingUp: false,
    };
  }
  const real = Math.max(0, guide.total - guide.left);
  return {
    done: real, total: guide.total,
    label: guide.fulfilled ? 'All set up' : `${guide.left} left to set up`,
    nextId: counted.find((l) => !l.verified)?.id ?? null, settingUp: !guide.fulfilled,
  };
}

/** The guide as the API hands it to the dashboard. */
export interface SetupGuideState {
  /** Wizard finished and the viewer runs the venue: the guide is in their sidebar. */
  eligible: boolean;
  /** This venue gets the prompts at all (everyone but Private Clients). */
  prompted: boolean;
  /** Open by itself after this sign-in (the dashboard still waits a few seconds). */
  autoOpen: boolean;
  /** The guide's bar stays at the top of every dashboard page: something isn't
   *  really set up yet. (Named for the dark pill it used to be on inner pages.) */
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
