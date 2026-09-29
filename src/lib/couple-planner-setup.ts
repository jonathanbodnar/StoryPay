/**
 * The Wedding Planner home's setup checklist: the best-practice first steps a
 * couple should take. Pure constants, safe for server routes and the page.
 *
 * Each item ticks itself when the app sees it done (/api/couple/home works that
 * out); the couple can also tick or untick any item by hand, which is stored in
 * couple_profiles.planner_setup and wins over the automatic check.
 *
 * Connecting a venue is deliberately not a step: many venues aren't on
 * StoryVenue, so it's an optional card on the home page instead.
 */

export const PLANNER_SETUP_ITEMS = [
  {
    key: 'wedding_date',
    title: 'Add your wedding date',
    desc: 'Starts your countdown and gives your to-dos their due dates.',
    href: '/couple/profile',
    cta: 'Add date',
  },
  {
    key: 'website',
    title: 'Publish your wedding website',
    desc: 'Your story, details and registry in one link to share.',
    href: '/couple/site',
    cta: 'Build it',
  },
  {
    key: 'guests',
    title: 'Add your guest list',
    desc: 'Track RSVPs, meal choices and your headcount.',
    href: '/couple/guests',
    cta: 'Add guests',
  },
  {
    key: 'website_invite',
    title: 'Invite guests to your website',
    desc: 'Email everyone your site so they can RSVP online.',
    href: '/couple/invite-guests',
    cta: 'Send invites',
  },
  {
    key: 'inspiration',
    title: 'Create your inspiration board',
    desc: 'Connect Pinterest or save the looks you love.',
    href: '/couple/inspiration',
    cta: 'Start board',
  },
  {
    key: 'budget',
    title: 'Set your budget',
    desc: 'Plan and track spending. Only you can see it.',
    href: '/couple/budget',
    cta: 'Set budget',
  },
  {
    key: 'partner',
    title: 'Invite your partner or planner',
    desc: 'Plan together, with view or edit access.',
    href: '#collaborators',
    cta: 'Invite',
  },
] as const;

export type PlannerSetupKey = (typeof PLANNER_SETUP_ITEMS)[number]['key'];

export const PLANNER_SETUP_KEYS: readonly PlannerSetupKey[] = PLANNER_SETUP_ITEMS.map((i) => i.key);

export function isPlannerSetupKey(v: unknown): v is PlannerSetupKey {
  return typeof v === 'string' && (PLANNER_SETUP_KEYS as readonly string[]).includes(v);
}

/** One checklist row as the home page gets it. */
export interface PlannerSetupState {
  key: PlannerSetupKey;
  /** Shown as done: the couple's own tick if they set one, else the automatic check. */
  done: boolean;
  /** What the app detected on its own. */
  auto: boolean;
}
