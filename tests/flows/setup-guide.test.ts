import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, runId, signedInSuperAdmin } from './helpers';

// The Setup Guide: a venue that just signed up is walked through the steps
// that get it its first leads. A step is done when the thing exists (it can't
// be ticked), the guide opens by itself after every sign-in until all are
// done, and only support can switch that pop-up off for a venue.
describe('the Setup Guide', () => {
  const venueId = randomUUID();
  const email = `guide.${runId}@example.com`;
  const owner = new Browser();
  let admin: Browser;

  type Guide = {
    eligible: boolean; guided: boolean; autoOpen: boolean; complete: boolean; done: number; total: number;
    loginId: string | null; listingUrl: string | null;
    lessons: Array<{ id: string; done: boolean }>; videos: Record<string, string>;
  };
  const guide = async (): Promise<Guide> => {
    const res = await owner.fetch('/api/onboarding/setup-guide');
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as Guide;
  };
  const doneIds = (g: Guide) => g.lessons.filter((l) => l.done).map((l) => l.id);
  const tick = (step: string) => owner.fetch('/api/onboarding/setup-guide', { method: 'POST', json: { step } });

  beforeAll(async () => {
    // A venue fresh out of the setup wizard, with nothing set up yet. No plan,
    // so every screen (and so every step) is open to it.
    const { error } = await db.from('venues').insert({
      id: venueId, name: `Guide Barn ${runId}`, slug: `guide-barn-${runId}`, email,
      notification_email: email, brand_email: email, password_hash: await bcrypt.hash(env.password, 10),
      setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: new Date().toISOString(),
      email_verified_at: new Date().toISOString(), owner_first_name: 'Gia', owner_last_name: 'Guide',
      timezone: 'America/New_York', is_published: false, is_demo: false,
    });
    if (error) throw new Error(`guide venue: ${error.message}`);
    await owner.signIn(email);
    admin = await signedInSuperAdmin();
  });

  it('a new venue is walked through it, and a stranger gets nothing', async () => {
    const g = await guide();
    expect(g).toMatchObject({ eligible: true, guided: true, autoOpen: true, complete: false, done: 0 });
    expect(g.lessons.map((l) => l.id)).toEqual(
      ['listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow'],
    );
    expect(g.total).toBe(8);
    // The sign-in it opens for, and the link the first step tells them to share.
    expect(g.loginId).toMatch(/^\d+$/);
    expect(g.listingUrl).toContain(`/venue/guide-barn-${runId}`);
    // The strategy-call step ships with its video.
    expect(g.videos.grow).toContain('cloudflarestream.com');

    expect((await new Browser().fetch('/api/onboarding/setup-guide')).status).toBe(401);
    expect((await new Browser().fetch('/api/onboarding/setup-guide', { method: 'POST', json: { step: 'grow' } })).status).toBe(401);
  });

  it('a step can’t be ticked off: it is done when the venue has set the thing up', async () => {
    for (const step of ['listing', 'payments', 'leadfinder', 'not-a-step']) {
      expect((await tick(step)).status, step).toBe(400);
    }
    expect(doneIds(await guide())).toEqual([]);

    // The listing goes live, the Lead Link gets its name, Stripe takes charges,
    // the guide is switched on, the website form brings a lead, mail reaches LeadFinder.
    const venue = await db.from('venues')
      .update({ is_published: true, lead_link_slug: `guide${runId}`, stripe_charges_enabled: true })
      .eq('id', venueId);
    expect(venue.error?.message ?? null).toBeNull();
    const made = await Promise.all([
      db.from('venue_pricing_guides').insert({ venue_id: venueId, enabled: true }),
      db.from('leads').insert({ venue_id: venueId, name: 'Web Form', first_name: 'Web', last_name: 'Form', email: `webform.${runId}@example.com`, source: 'embed' }),
      db.from('leadfinder_imports').insert({ venue_id: venueId, subject: `Setup guide check ${runId}` }),
    ]);
    expect(made.map((r) => r.error?.message ?? null)).toEqual([null, null, null]);

    const g = await guide();
    expect(doneIds(g)).toEqual(['listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'payments']);
    expect(g).toMatchObject({ done: 6, complete: false, autoOpen: true });
  });

  it('support can switch the pop-up off for a venue; the guide stays in its sidebar', async () => {
    const off = await admin.fetch(`/api/admin/venues/${venueId}`, { method: 'PATCH', json: { setup_guide_popup_off: true } });
    expect(off.status, await off.clone().text()).toBeLessThan(300);
    expect(await guide()).toMatchObject({ eligible: true, guided: false, autoOpen: false, complete: false });

    expect((await admin.fetch(`/api/admin/venues/${venueId}`, { method: 'PATCH', json: { setup_guide_popup_off: false } })).status).toBeLessThan(300);
    expect(await guide()).toMatchObject({ guided: true, autoOpen: true });
  });

  it('the two steps with nothing to set up finish it, and then it stops opening', async () => {
    expect((await tick('follow_up')).status).toBe(200);
    expect(await guide()).toMatchObject({ done: 7, complete: false, autoOpen: true });
    expect((await tick('grow')).status).toBe(200);
    expect((await tick('grow')).status).toBe(200); // ticking twice changes nothing
    const g = await guide();
    expect(g).toMatchObject({ done: 8, total: 8, complete: true, guided: false, autoOpen: false, eligible: true });
    const { data } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
    expect(data!.onboarding_steps_completed).toEqual(['guide:follow_up', 'guide:grow']);
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
