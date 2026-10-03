/**
 * What the screenshot kit shoots: which screens, as whom, on which devices.
 * Paths are written exactly as they appear under src/app (dynamic segments in
 * brackets), so the fast check can confirm every one still exists; `fill`
 * holds the showcase venue's real record for each segment.
 */

export const SHOWCASE_VENUE_ID = 'ca110000-0000-4000-8000-000000000001';
export const SHOWCASE_OWNER_EMAIL = 'showcase-owner@example.com';
const PLAN_PROPOSAL_ID = 'ca110000-0000-4000-8000-000000008020';
const SENT_PROPOSAL_TOKEN = 'showcase-proposal-token-0001';
const LISTING_SLUG = 'willow-creek-estate';

/**
 * Screen sizes and the frame each one is drawn into. Width/height are CSS
 * pixels; every shot is taken at the deviceScaleFactor for retina sharpness.
 */
export const DEVICES = {
  desktop: { width: 1600, height: 1000, deviceScaleFactor: 2, frame: 'browser' },
  laptop: { width: 1512, height: 982, deviceScaleFactor: 2, frame: 'laptop' },
  tablet: { width: 1194, height: 834, deviceScaleFactor: 2, frame: 'tablet' },
  phone: { width: 393, height: 852, deviceScaleFactor: 3, frame: 'phone', isMobile: true, hasTouch: true },
};

const ALL = ['desktop', 'laptop', 'tablet', 'phone'];

/**
 * name          file names start with it
 * path          the page, as written under src/app
 * fill          values for the path's [segments]
 * who           'owner' (signed in as the showcase venue) or 'visitor'
 * devices       which of DEVICES to shoot (default: desktop + phone)
 * alsoFullPage  also save an unframed full-length capture (long public pages)
 * settleMs      extra wait for screens that load in stages (default 2500)
 * click         a Playwright locator clicked after load (e.g. open a thread)
 */
export const SHOTS = [
  { name: 'home', path: '/dashboard', who: 'owner', devices: ALL },
  { name: 'leads', path: '/dashboard/leads', who: 'owner', devices: ALL, settleMs: 4000 },
  { name: 'conversations', path: '/dashboard/conversations', who: 'owner', click: 'text=Emma Sinclair' },
  { name: 'calendar', path: '/dashboard/calendar', who: 'owner', devices: ['desktop', 'tablet'] },
  { name: 'proposals', path: '/dashboard/proposals', who: 'owner' },
  { name: 'booking', path: '/dashboard/proposals/[id]', fill: { id: PLAN_PROPOSAL_ID }, who: 'owner', devices: ['desktop'] },
  { name: 'reports', path: '/dashboard/reports', who: 'owner', devices: ['desktop', 'laptop'], settleMs: 4000 },
  { name: 'transactions', path: '/dashboard/transactions', who: 'owner', devices: ['desktop'] },
  { name: 'installments', path: '/dashboard/payments/installments', who: 'owner', devices: ['desktop'] },
  { name: 'proposal-couple', path: '/proposal/[token]', fill: { token: SENT_PROPOSAL_TOKEN }, who: 'visitor', devices: ALL, alsoFullPage: true },
  { name: 'listing', path: '/venue/[slug]', fill: { slug: LISTING_SLUG }, who: 'visitor', alsoFullPage: true },
];

/** The page's address with its [segments] filled in. */
export function urlFor(shot) {
  return shot.path.replace(/\[([^\]]+)\]/g, (_, p) => {
    const v = shot.fill?.[p];
    if (!v) throw new Error(`${shot.name}: no fill value for [${p}]`);
    return v;
  });
}
