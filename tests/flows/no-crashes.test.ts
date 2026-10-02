import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, coupleSession, ensureFlowVenue, env, FLOW_VENUE, runId, signedInOwner, signedInSuperAdmin, venueRecordIds } from './helpers';
import { ROUTES } from './routes';

// Nothing crashes: every read route answers the right person (the venue owner,
// a StoryVenue super admin, or a couple) without a server error. Dynamic parts
// of the address get real records from the flow venue where one exists.
//
// Venues can't see each other: every owner read route that names a record,
// given the other (demo) venue's record instead, must not return it.

const DEMO_VENUE_ID = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const NONE = '00000000-0000-4000-8000-000000000000';

// Not called here: timed jobs, webhooks and test-copy routes have their own
// checks; sign-in routes would end the shared session; the rest are
// redirects into outside sign-in pages.
const SKIP = /^\/api\/(cron|mcp|staging|webhooks|auth)\b|^\/api\/admin\/(login|support\/logout)\b|callback$|\/connect$|^\/(g|t)\/|^\/staging-access$|^\/api\/payments\/stripe\/connect\/(refresh|return)$|^\/api\/venue-billing\/stripe\/checkout-return$|^\/api\/v1\//;

// Push notifications are switched off on the test copy (no keys), so this
// one answers 503 "not configured" there by design.
const OFF_ON_TEST_COPY = new Set(['/api/push/vapid-public-key']);

type Who = 'owner' | 'admin' | 'couple';
const whoFor = (path: string): Who => (path.startsWith('/api/admin/') ? 'admin' : path.startsWith('/api/couple/') ? 'couple' : 'owner');

type Ids = Record<string, string | undefined>;

/** The record a dynamic segment names, chosen from the segment before it and its own name. */
function recordFor(prev: string, param: string): keyof Ids | 'venue' | 'slug' | null {
  if (param === 'venueId') return 'venue';
  if (param === 'slug' || param === 'venueSlug') return 'slug';
  if (param === 'leadId') return 'lead';
  if (param === 'threadId') return 'thread';
  if (param === 'proposalId') return 'proposal';
  if (param === 'customerId' || param === 'contactId') return 'customer';
  if (param === 'token' && prev === 'public') return 'token';
  const byPrev: Record<string, keyof Ids> = {
    leads: 'lead', 'venue-customers': 'customer', customers: 'customer', proposals: 'proposal', invoices: 'proposal',
    threads: 'thread', calendar: 'event', automations: 'automation', campaigns: 'campaign', forms: 'form',
    segments: 'segment', tags: 'tag', pipelines: 'pipeline', templates: 'template', 'venue-packages': 'pkg',
    'venue-coupons': 'coupon', spaces: 'space', team: 'member',
  };
  if (param === 'id' && prev === 'venues') return 'venue';
  return byPrev[prev] ?? null;
}

function address(path: string, ids: Ids, venue: { id: string; slug: string }): { url: string; named: string[] } {
  const segs = path.split('/');
  const named: string[] = [];
  const out = segs.map((s, i) => {
    const m = s.match(/^\[(?:\[?\.\.\.)?([^\]]+)\]?\]$/);
    if (!m) return s;
    if (s.startsWith('[[') || s.startsWith('[...')) return 'x';
    const kind = recordFor(segs[i - 1] ?? '', m[1]);
    const value = kind === 'venue' ? venue.id : kind === 'slug' ? venue.slug : kind ? ids[kind] : undefined;
    if (kind && value) named.push(value);
    return value ?? NONE;
  });
  return { url: out.join('/'), named };
}

describe('nothing crashes, and venues can’t see each other', () => {
  const sessions: Partial<Record<Who, Browser>> = {};
  let coupleToken = '';
  let mine: Ids = {};
  let theirs: Ids = {};

  beforeAll(async () => {
    await ensureFlowVenue();
    sessions.owner = await signedInOwner();
    sessions.admin = await signedInSuperAdmin();
    coupleToken = (await coupleSession()).access_token;

    // The other venue needs a proposal of its own to try reaching.
    const demo = new Browser();
    await demo.signIn(process.env.ADMIN_EMAIL || '');
    await demo.fetch('/api/proposals', {
      method: 'POST',
      json: { overrideContent: `<p>Demo venue proposal ${runId}</p>`, customerName: 'Demo Couple', customerEmail: `demo.${runId}@example.com`, price: 100000, paymentType: 'full', paymentConfig: {}, collectManually: true },
    });

    [mine, theirs] = await Promise.all([venueRecordIds(FLOW_VENUE.id), venueRecordIds(DEMO_VENUE_ID)]);
  });

  async function call(who: Who, url: string): Promise<Response> {
    if (who === 'couple') {
      return fetch(env.base + url, { headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${coupleToken}` }, redirect: 'manual' });
    }
    return sessions[who]!.fetch(url);
  }

  async function pool<T>(items: T[], fn: (t: T) => Promise<void>): Promise<void> {
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (next < items.length) await fn(items[next++]); }));
  }

  const reads = ROUTES.filter((r) => r.methods.includes('GET') && !SKIP.test(r.path) && !OFF_ON_TEST_COPY.has(r.path));

  it('every read route answers without a server error', async () => {
    const crashes: string[] = [];
    await pool(reads, async (r) => {
      const who = whoFor(r.path);
      const { url } = address(r.path, mine, { id: FLOW_VENUE.id, slug: FLOW_VENUE.slug });
      const res = await call(who, url);
      if (res.status >= 500) crashes.push(`${url} as ${who} → ${res.status} ${(await res.text()).slice(0, 120)}`);
    });
    expect(crashes.sort()).toEqual([]);
  }, 300_000);

  it('the other venue’s records never come back', async () => {
    const leaks: string[] = [];
    const owned = reads.filter((r) => whoFor(r.path) === 'owner' && /\[[^.\]]+\]/.test(r.path) && !r.path.startsWith('/api/public/') && !/^\/api\/(proposals\/public|invoices|rsvp|card-update|availability|invite|embed|page-seo)\b/.test(r.path));
    await pool(owned, async (r) => {
      const { url, named } = address(r.path, theirs, { id: DEMO_VENUE_ID, slug: 'maple-hollow-barn-test' });
      if (!named.length) return; // no record of theirs to try
      const res = await call('owner', url);
      const body = await res.text();
      if (res.ok && (body.includes(DEMO_VENUE_ID) || named.some((id) => body.includes(id)))) leaks.push(`${url} → ${res.status} ${body.slice(0, 120)}`);
    });
    expect(leaks.sort()).toEqual([]);
  }, 300_000);
});
