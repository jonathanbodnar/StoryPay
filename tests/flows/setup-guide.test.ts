import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, runId, signedInSuperAdmin } from './helpers';

// The Setup Guide: suggested steps to a venue's first leads (owner's rules,
// Oct 4 2026). Every venue but Private Clients gets it opening after each
// sign-in; the venue can tick any step off itself and the pop-up stops once
// all are ticked; a reminder pill stays until each step is really set up;
// StoryPay is optional.
describe('the Setup Guide', () => {
  const venueId = randomUUID();
  const email = `guide.${runId}@example.com`;
  const owner = new Browser();
  let admin: Browser;

  type Lesson = { id: string; ticked: boolean; verified: boolean; checked: boolean; optional: boolean };
  type Guide = {
    eligible: boolean; prompted: boolean; autoOpen: boolean; showPill: boolean; checkedAll: boolean; fulfilled: boolean;
    done: number; total: number; left: number; loginId: string | null; listingUrl: string | null;
    lessons: Lesson[]; videos: Record<string, string>;
  };
  const guide = async (): Promise<Guide> => {
    const res = await owner.fetch('/api/onboarding/setup-guide');
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as Guide;
  };
  const where = (g: Guide, key: 'checked' | 'verified' | 'ticked') => g.lessons.filter((l) => l[key]).map((l) => l.id);
  const tick = (step: string, done = true) => owner.fetch('/api/onboarding/setup-guide', { method: 'POST', json: { step, done } });
  const COUNTED = ['listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'grow'];

  beforeAll(async () => {
    // A venue that has been around for two years (the guide is for existing
    // venues too), past the setup wizard, with nothing set up. No plan, so
    // every screen (and so every step) is open to it.
    const { error } = await db.from('venues').insert({
      id: venueId, name: `Guide Barn ${runId}`, slug: `guide-barn-${runId}`, email,
      notification_email: email, brand_email: email, password_hash: await bcrypt.hash(env.password, 10),
      setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: '2024-10-01T00:00:00Z',
      created_at: '2024-10-01T00:00:00Z',
      email_verified_at: new Date().toISOString(), owner_first_name: 'Gia', owner_last_name: 'Guide',
      timezone: 'America/New_York', is_published: false, is_demo: false,
    });
    if (error) throw new Error(`guide venue: ${error.message}`);
    await owner.signIn(email);
    admin = await signedInSuperAdmin();
  });

  it('every venue gets it after signing in, old or new; a stranger gets nothing', async () => {
    const g = await guide();
    expect(g).toMatchObject({ eligible: true, prompted: true, autoOpen: true, showPill: true, checkedAll: false, fulfilled: false });
    expect(g.lessons.map((l) => l.id)).toEqual(
      ['listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow'],
    );
    // StoryPay is shown but doesn't count: seven steps to do.
    expect(g.lessons.filter((l) => l.optional).map((l) => l.id)).toEqual(['payments']);
    expect(g).toMatchObject({ done: 0, total: 7, left: 7 });
    // The sign-in it opens for, and the link the first step tells them to share.
    expect(g.loginId).toMatch(/^\d+$/);
    expect(g.listingUrl).toContain(`/venue/guide-barn-${runId}`);
    // The strategy-call step ships with its video.
    expect(g.videos.grow).toContain('cloudflarestream.com');

    expect((await new Browser().fetch('/api/onboarding/setup-guide')).status).toBe(401);
    expect((await new Browser().fetch('/api/onboarding/setup-guide', { method: 'POST', json: { step: 'grow' } })).status).toBe(401);
  });

  it('a Private Client is never prompted: our team sets those up', async () => {
    try {
      expect((await db.from('venues').update({ is_private_client: true }).eq('id', venueId)).error?.message ?? null).toBeNull();
      const g = await guide();
      expect(g).toMatchObject({ eligible: true, prompted: false, autoOpen: false, showPill: false });
      expect(g.lessons.map((l) => l.id)).not.toContain('grow'); // nor pitched a strategy call
    } finally {
      await db.from('venues').update({ is_private_client: false }).eq('id', venueId);
    }
    expect(await guide()).toMatchObject({ prompted: true, autoOpen: true });
  });

  it('support can switch a venue’s prompts off; the guide stays in its sidebar and its ticks are kept', async () => {
    expect((await tick('listing')).status).toBe(200);
    const off = await admin.fetch(`/api/admin/venues/${venueId}`, { method: 'PATCH', json: { setup_guide_popup_off: true } });
    expect(off.status, await off.clone().text()).toBeLessThan(300);
    const quiet = await guide();
    expect(quiet).toMatchObject({ eligible: true, prompted: false, autoOpen: false, showPill: false });
    expect(where(quiet, 'ticked')).toEqual(['listing']);
    // A venue ticking a step doesn't undo support's switch.
    expect((await tick('lead_link')).status).toBe(200);
    expect((await guide()).prompted).toBe(false);

    expect((await admin.fetch(`/api/admin/venues/${venueId}`, { method: 'PATCH', json: { setup_guide_popup_off: false } })).status).toBeLessThan(300);
    const back = await guide();
    expect(back).toMatchObject({ prompted: true, autoOpen: true, showPill: true });
    expect(where(back, 'ticked')).toEqual(['listing', 'lead_link']);
    // Put it back to nothing ticked for the next check.
    expect((await tick('listing', false)).status).toBe(200);
    expect((await tick('lead_link', false)).status).toBe(200);
    expect(where(await guide(), 'ticked')).toEqual([]);
  });

  it('the venue can tick any step off itself; once all are ticked the pop-up stops, and the reminder stays', async () => {
    expect((await tick('not-a-step')).status).toBe(400);

    // StoryPay is optional: ticking it moves nothing.
    expect((await tick('payments')).status).toBe(200);
    expect(await guide()).toMatchObject({ done: 0, total: 7, autoOpen: true });

    for (const step of COUNTED.slice(0, 6)) expect((await tick(step)).status, step).toBe(200);
    expect(await guide()).toMatchObject({ done: 6, checkedAll: false, autoOpen: true });
    expect((await tick('grow')).status).toBe(200);
    expect((await tick('grow')).status).toBe(200); // ticking twice changes nothing

    const g = await guide();
    // Everything ticked, nothing actually set up: no more pop-up, but the pill
    // stays for the five steps that need something to exist.
    expect(g).toMatchObject({ done: 7, total: 7, checkedAll: true, autoOpen: false, fulfilled: false, showPill: true, left: 5 });
    expect(where(g, 'verified')).toEqual(['follow_up', 'grow']);
    const { data } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
    expect([...(data!.onboarding_steps_completed as string[])].sort()).toEqual(['payments', ...COUNTED].map((s) => `guide:${s}`).sort());

    // Unticking one brings the pop-up back.
    expect((await tick('leadfinder', false)).status).toBe(200);
    expect(await guide()).toMatchObject({ done: 6, checkedAll: false, autoOpen: true });
    expect((await tick('leadfinder')).status).toBe(200);
  });

  it('the reminder goes once every step is really set up', async () => {
    // The listing goes live, the Lead Link gets its name, the guide is switched
    // on, the website form brings a lead…
    const venue = await db.from('venues').update({ is_published: true, lead_link_slug: `guide${runId}` }).eq('id', venueId);
    expect(venue.error?.message ?? null).toBeNull();
    const made = await Promise.all([
      db.from('venue_pricing_guides').insert({ venue_id: venueId, enabled: true }),
      db.from('leads').insert({ venue_id: venueId, name: 'Web Form', first_name: 'Web', last_name: 'Form', email: `webform.${runId}@example.com`, source: 'embed' }),
    ]);
    expect(made.map((r) => r.error?.message ?? null)).toEqual([null, null]);
    const nearly = await guide();
    expect(where(nearly, 'verified')).toEqual(['listing', 'pricing_guide', 'lead_link', 'web_form', 'follow_up', 'grow']);
    expect(nearly).toMatchObject({ left: 1, fulfilled: false, showPill: true, autoOpen: false });

    // …and mail reaches the LeadFinder address. StoryPay was never connected.
    expect((await db.from('leadfinder_imports').insert({ venue_id: venueId, subject: `Setup guide check ${runId}` })).error?.message ?? null).toBeNull();
    const g = await guide();
    expect(g).toMatchObject({ left: 0, fulfilled: true, showPill: false, autoOpen: false, checkedAll: true, eligible: true });
    expect(g.lessons.find((l) => l.id === 'payments')).toMatchObject({ verified: false, optional: true });
  });

  it('a lesson’s video is a link the team pastes, and only a real video link is taken', async () => {
    const before = ((await (await admin.fetch('/api/admin/setup-guide')).json()) as { videos: Record<string, string> }).videos;
    try {
      const bad = await admin.fetch('/api/admin/setup-guide', { method: 'PUT', json: { videos: { ...before, listing: 'https://evil.example.com/watch?v=1' } } });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { lesson: string }).lesson).toBe('listing');

      const ok = await admin.fetch('/api/admin/setup-guide', { method: 'PUT', json: { videos: { ...before, listing: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } } });
      expect(ok.status, await ok.clone().text()).toBe(200);
      const g = await guide();
      expect(g.videos.listing).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
      expect(g.videos.grow).toContain('cloudflarestream.com'); // the others are untouched

      // A venue can't set the videos, and neither can a stranger.
      expect((await owner.fetch('/api/admin/setup-guide', { method: 'PUT', json: { videos: before } })).status).toBe(401);
      expect((await new Browser().fetch('/api/admin/setup-guide')).status).toBe(401);
    } finally {
      await admin.fetch('/api/admin/setup-guide', { method: 'PUT', json: { videos: before } });
    }
  });
});
