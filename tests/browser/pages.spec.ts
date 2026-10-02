import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_TABS } from '../../src/lib/admin-tabs-registry';
import { FLOW_VENUE } from '../flows/helpers';
import { PAGES } from '../flows/routes';

// Every page opens: each page in the app, as the person who uses it, on
// desktop and phone. A page fails on a crash (an uncaught error or the error
// screen), a server error from its own requests, or sideways scrolling on a
// phone. The page list is read from the code, so new pages are checked too.

const NONE = '00000000-0000-4000-8000-000000000000';
type Who = 'owner' | 'admin' | 'couple' | 'visitor';
const STATE: Record<Who, string> = {
  owner: 'tests/browser/.auth/owner.json',
  admin: 'tests/browser/.auth/admin.json',
  couple: 'tests/browser/.auth/couple.json',
  visitor: 'tests/browser/.auth/staging.json',
};

const COUPLE_SIGNED_OUT = /^\/couple\/(login|signup|reset-password|accept-invite|claim|save)\b/;
function whoFor(path: string): Who {
  if (path.startsWith('/dashboard') || path === '/setup') return 'owner';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/couple') && !COUPLE_SIGNED_OUT.test(path)) return 'couple';
  return 'visitor';
}

/** Real records where the address names one (records.json comes from global-setup). */
function fillPage(path: string, records: Record<string, string | undefined>): string {
  const pick = (k: string) => records[k] ?? NONE;
  return path.replace(/\[([^\]]+)\]/g, (_, param: string) => {
    if (path.startsWith('/dashboard/contacts/lead/')) return pick('lead');
    if (path.startsWith('/dashboard/contacts/')) return pick('customer');
    if (path.startsWith('/dashboard/proposals/templates/')) return pick('template');
    if (path.startsWith('/dashboard/proposals/')) return pick('proposal');
    if (path.startsWith('/dashboard/marketing/workflows/') || path.startsWith('/dashboard/marketing/email/automations/')) return pick('automation');
    if (path.startsWith('/dashboard/marketing/email/campaigns/')) return pick('campaign');
    if (path.startsWith('/dashboard/marketing/form-builder/')) return pick('form');
    if (path.startsWith('/proposal/')) return pick('token');
    if (path.startsWith('/invoice/')) return pick('proposal');
    if (path.startsWith('/embed/form/')) return pick('formToken');
    if (param === 'venueId') return FLOW_VENUE.id;
    if (param === 'slug') return FLOW_VENUE.slug;
    return NONE; // a link that doesn't exist: the page must say so, not crash
  });
}

// Harmless browser noise, not the app's errors.
const NOISE = /ResizeObserver loop|Loading chunk .* failed|NEXT_REDIRECT/;

async function opens(page: Page, url: string, checkWidth: boolean): Promise<void> {
  const base = test.info().project.use.baseURL!;
  const problems: string[] = [];
  page.on('pageerror', (e) => { if (!NOISE.test(e.message)) problems.push(`error: ${e.message.slice(0, 200)}`); });
  page.on('response', (r) => {
    if (r.status() >= 500 && r.url().startsWith(base)) problems.push(`${r.status()} from ${new URL(r.url()).pathname}`);
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  if (res && res.status() >= 500) problems.push(`the page answered ${res.status()}`);
  await page.waitForTimeout(2500); // let the page's own requests land
  if (await page.getByText(/Something went wrong|Application error/).count()) problems.push('the error screen');
  if (checkWidth) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`${overflow}px wider than the screen`);
  }
  expect(problems, url).toEqual([]);
}

// Written by global-setup, so it's read when a test runs, not when the list is built.
let records: Record<string, string | undefined> | null = null;
const recordsNow = () => (records ??= JSON.parse(readFileSync('tests/browser/.auth/records.json', 'utf8')));

const groups: Record<Who, string[]> = { owner: [], admin: [], couple: [], visitor: [] };
for (const path of PAGES) {
  if (path === '/staging-access') continue;
  if (path === '/admin/[[...slug]]') {
    for (const tab of [...ADMIN_TABS.map((t) => t.key), 'team', 'profile']) groups.admin.push(`/admin/${tab}`);
    continue;
  }
  groups[whoFor(path)].push(path);
}

for (const who of Object.keys(groups) as Who[]) {
  test.describe(`pages for ${who === 'visitor' ? 'visitors' : `the ${who}`}`, () => {
    test.describe.configure({ mode: 'parallel' });
    test.use({ storageState: STATE[who] });
    for (const path of groups[who]) {
      // The StoryVenue admin is a desktop tool, so its width isn't checked on phones.
      test(`${path} opens`, async ({ page }) => opens(page, fillPage(path, recordsNow()), test.info().project.name === 'phone' && who !== 'admin'));
    }
  });
}
