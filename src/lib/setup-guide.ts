/**
 * The Setup Guide: the short course every venue sees on its dashboard, the
 * suggested steps to its first leads. Owner's rules (Oct 4 2026):
 *
 *  - It opens by itself a few seconds after each sign-in, for every venue.
 *    The X closes it; the product is never gated behind it.
 *  - Private Clients get it like everyone else (Oct 5 2026: "that's what we
 *    will use to set up their account"; until then they were left out). Their
 *    last step, the strategy call, is shown already done: they have signed up
 *    for that service.
 *  - Every step is a suggestion the venue can tick off itself, done or not.
 *    Once every step is ticked the pop-up stops ("that's on them").
 *  - A small closed pill stays on the dashboard until each step is REALLY set
 *    up (the listing is live, mail has reached the Lead Finder address…), so a
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
  /** Shown in place of `steps` while the step's button would play a video and
   *  no video link has been set yet. */
  stepsNoVideo?: string[];
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
      'Press play above. The video is about 3 minutes long.',
      'You’ll see how a bride’s inquiry is captured, answered and followed up for you.',
      'When it ends, go on to step 2 and work down the list in order.',
    ],
    // Until the video's link is pasted (Admin → Setup Guide) there is nothing
    // to play, so "Press play" would make no sense: these are shown instead.
    stepsNoVideo: [
      'The walkthrough video is coming soon.',
      'For now, press Mark as done to move on.',
      'Then go on to step 2 and work down the list in order.',
    ],
    // Plays the step's video where it is. The link is pasted in Admin → Setup
    // Guide; until one is, the step offers "Mark as done" so it can't get stuck.
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
      'Press Open my listing and check that your photos, prices and details are right.',
      'Press Copy my link, then paste the link into your email signature.',
      'Post the same link on your Facebook page and in your Instagram posts.',
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
      'Press Open my pricing guide and read it the way a bride would.',
      'Check your prices and packages, and add your best photos.',
      'Make sure “Enable on public listing” is switched on, so every bride who asks gets it right away.',
    ],
    cta: { label: 'Open my pricing guide', href: '/dashboard/listing/pricing-guide' },
    navId: 'nav_listing_pricing_guide',
    manual: false,
    cover: '/setup-guide/pricing_guide.webp',
  },
  {
    id: 'lead_link',
    title: 'Put your Lead Link in your Instagram bio',
    summary: 'One link where followers get your pricing guide or book a tour.',
    steps: [
      'Press Set up my Lead Link. Your page is already built for you from your listing and pricing guide.',
      'Give your link a short name, like your venue’s name, and press Save.',
      'Press Copy, then paste the link into your Instagram bio and your Facebook page.',
    ],
    cta: { label: 'Set up my Lead Link', href: '/dashboard/listing/lead-link' },
    navId: 'nav_listing_lead_link',
    manual: false,
    cover: '/setup-guide/lead_link.webp',
  },
  {
    id: 'web_form',
    title: 'Add the inquiry form to your website',
    summary: 'Every inquiry from your website lands in your Lead Inbox and gets followed up for you.',
    steps: [
      'Press Get my embed code. On the Web Form page, press Copy code.',
      'Paste the code into the contact or pricing page of your website. If someone else looks after your website, send the code to them.',
      'Fill in the form on your website once as a test. Your inquiry shows up in your Lead Inbox.',
    ],
    cta: { label: 'Get my embed code', href: '/dashboard/listing/web-form' },
    navId: 'nav_listing_pricing_guide',
    manual: false,
    cover: '/setup-guide/web_form.webp',
  },
  {
    id: 'leadfinder',
    title: 'Forward your directory leads to Lead Finder',
    summary: 'Inquiries from The Knot, WeddingWire and other directories land in your Lead Inbox, so none slip through.',
    steps: [
      'Press Get my Lead Finder address and copy the email address you’re given.',
      'On The Knot, WeddingWire and your other directories, make it the email your inquiries are sent to, or forward their emails to it.',
      'Press Send a test inquiry and watch it show up in your Lead Inbox.',
    ],
    cta: { label: 'Get my Lead Finder address', href: '/dashboard/listing/lead-finder' },
    navId: 'nav_settings_integrations',
    manual: false,
    cover: '/setup-guide/leadfinder.webp',
  },
  {
    id: 'follow_up',
    title: 'Make your follow-up sound like you',
    summary: 'The Speed to Lead System responds to every new bride right away, so she never waits on you.',
    steps: [
      'Press Review my messages and read each text and email a new bride gets.',
      'Change the wording until it sounds like you, and leave every message switched on.',
      'Download the StoryVenue app from the App Store or Google Play, so new leads and replies reach your phone.',
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
      'Press Connect StoryPay™, then press Connect with Stripe.',
      'Answer Stripe’s questions about your business, and add the bank account your payments go to.',
      'When a bride is ready to book, send her a proposal. She signs it and pays from her phone.',
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
      'Press play above to watch the short video.',
      'Press See if your venue qualifies and answer a few quick questions about your venue.',
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
/** The venue finished the guide: every step was ticked or set up. Kept, so the
 *  guide stays gone if something is later switched off again. Not a step. */
export const GUIDE_FINISHED = 'guide:finished';

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
  /** Done because the venue already has what the step offers (a Private Client
   *  and the strategy call): green-checked, with nothing to press. */
  alreadyTheirs: boolean;
}

/**
 * The steps this venue sees, in order. A step is left out when the venue can't
 * act on it: its plan doesn't include the screen, or Lead Finder isn't switched
 * on for it.
 *
 * A Private Client sees the strategy-call step already done, whatever it has
 * ticked: it has signed up for that service (owner's rule, Oct 5 2026: "we
 * just need to green-check-mark that one completely").
 */
export function setupLessonsFor(ctx: SetupContext): SetupLessonState[] {
  const saved = new Set(savedSteps(ctx.stepsCompleted));
  const out: SetupLessonState[] = [];
  for (const lesson of SETUP_LESSONS) {
    if (lesson.navId && ctx.allowedNavIds && !ctx.allowedNavIds.includes(lesson.navId)) continue;
    if (lesson.id === 'leadfinder' && !ctx.leadFinderAvailable) continue;
    if (lesson.id === 'grow' && ctx.privateClient) {
      out.push({ id: lesson.id, ticked: true, verified: true, checked: true, optional: false, alreadyTheirs: true });
      continue;
    }
    const ticked = saved.has(`${GUIDE_STEP_PREFIX}${lesson.id}`);
    const verified = lesson.manual ? ticked : ctx.facts[DETECTED[lesson.id as keyof typeof DETECTED]] === true;
    out.push({ id: lesson.id, ticked, verified, checked: ticked || verified, optional: lesson.optional === true, alreadyTheirs: false });
  }
  return out;
}

/**
 * Where the venue stands. Optional steps count toward none of it.
 *  - checkedAll: every step is ticked or set up → the guide is finished: its
 *    pop-up, its bar and its sidebar entry all go (owner's rule, Oct 6 2026).
 *  - fulfilled:  every step is really set up. It decides nothing any more
 *    (until Oct 6 the bar stayed until then); a step's own tick still shows
 *    whether it is really set up.
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
 * What the guide's bar (on every dashboard page) and its sidebar entry say
 * while there are steps left: how many are done, by the venue's own word or
 * for real, and the step to send them to next. Once every step is done
 * neither is shown, so there is nothing to say then.
 */
export function setupGuideDisplay(guide: Pick<SetupGuideState, 'lessons' | 'done' | 'total'>): {
  done: number; total: number; label: string; nextId: SetupLessonId | null;
} {
  const counted = guide.lessons.filter((l) => !l.optional);
  return {
    done: guide.done, total: guide.total, label: `${guide.done} of ${guide.total} done`,
    nextId: counted.find((l) => !l.checked)?.id ?? null,
  };
}

/** The guide as the API hands it to the dashboard. */
export interface SetupGuideState {
  /** Wizard finished and the viewer runs the venue: the guide is theirs to
   *  open, and sits in their sidebar until they finish it. */
  eligible: boolean;
  /** This venue gets the prompts at all (every venue, unless support switched them off). */
  prompted: boolean;
  /** Open by itself after this sign-in (the dashboard still waits a few seconds). */
  autoOpen: boolean;
  /** The guide's bar is at the top of every dashboard page: there are steps
   *  left. (Named for the dark pill it used to be on inner pages.) */
  showPill: boolean;
  /** Every step is ticked or set up (optional ones aside). */
  checkedAll: boolean;
  /** The venue has completed the checklist, now or at any time before: the
   *  pop-up, the bar and the sidebar entry are gone, and stay gone (owner's
   *  rule, Oct 6 2026: "once they complete the setup guide checklist those
   *  big alerts aren't needed any longer"). */
  finished: boolean;
  /** Every step is really set up. */
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
  // Unticking a step takes back "finished" with it: the guide is theirs again.
  const rest = savedSteps(stored).filter((s) => s !== key && (done || s !== GUIDE_FINISHED));
  return done ? [...rest, key] : rest;
}

/** Has this venue finished the guide at some point? */
export const setupGuideFinished = (stored: unknown): boolean => savedSteps(stored).includes(GUIDE_FINISHED);

/** The venue's saved steps with the guide marked finished. */
export function withSetupGuideFinished(stored: unknown): string[] {
  const steps = savedSteps(stored);
  return steps.includes(GUIDE_FINISHED) ? steps : [...steps, GUIDE_FINISHED];
}

export const setupPromptsOff = (stored: unknown): boolean => savedSteps(stored).includes(GUIDE_PROMPTS_OFF);

/** The venue's saved steps with support's "prompts off" switch set or cleared. */
export function withSetupPromptsOff(stored: unknown, off: boolean): string[] {
  const rest = savedSteps(stored).filter((s) => s !== GUIDE_PROMPTS_OFF);
  return off ? [...rest, GUIDE_PROMPTS_OFF] : rest;
}

/**
 * Does this venue get the guide's prompts (the pop-up after each sign-in and
 * the bar on every page)? Every venue that has finished the setup wizard, old
 * or new, on any plan, Private Clients included: all but one support has
 * switched them off for. Only the people who run the venue (owner, admins)
 * are prompted.
 */
export function setupGuidePrompts(v: {
  wizardDone: boolean;
  promptsOff: boolean;
  canManage: boolean;
}): boolean {
  return v.wizardDone && v.canManage && !v.promptsOff;
}

/** Videos that ship with the guide; the admin's links (Admin → Setup Guide) replace them. */
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
