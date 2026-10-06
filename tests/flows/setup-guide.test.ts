import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, runId, signedInSuperAdmin } from './helpers';

// The Setup Guide: suggested steps to a venue's first leads (owner's rules,
// Oct 4 2026). Every venue gets it opening after each sign-in; the venue can
// tick any step off itself; StoryPay is optional. Completing the checklist
// ends it for good: pop-up, bar and sidebar entry (Oct 6 2026; until then a
// reminder stayed until each step was really set up).
// Private Clients get it like everyone else (Oct 5 2026), with the
// strategy-call step already done for them.
describe('the Setup Guide', () => {
  const venueId = randomUUID();
  const email = `guide.${runId}@example.com`;
  const owner = new Browser();
  let admin: Browser;

  type Lesson = { id: string; ticked: boolean; verified: boolean; checked: boolean; unticked: boolean; optional: boolean; alreadyTheirs: boolean };
  type Guide = {
    eligible: boolean; prompted: boolean; autoOpen: boolean; showPill: boolean; checkedAll: boolean; fulfilled: boolean; finished: boolean;
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
  const COUNTED = ['walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'grow'];

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
    // The 3-minute walkthrough comes first (Oct 5 2026), then the steps as before.
    expect(g.lessons.map((l) => l.id)).toEqual(
      ['walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow'],
    );
    // StoryPay is shown but doesn't count: eight steps to do.
    expect(g.lessons.filter((l) => l.optional).map((l) => l.id)).toEqual(['payments']);
    expect(g).toMatchObject({ done: 0, total: 8, left: 8 });
    // The walkthrough's video is a link the team pastes: none is built in.
    expect(g.videos.walkthrough).toBeUndefined();
    // The sign-in it opens for, and the link the first step tells them to share.
    expect(g.loginId).toMatch(/^\d+$/);
    expect(g.listingUrl).toContain(`/venue/guide-barn-${runId}`);
    // The strategy-call step ships with its video.
    expect(g.videos.grow).toContain('cloudflarestream.com');

    expect((await new Browser().fetch('/api/onboarding/setup-guide')).status).toBe(401);
    expect((await new Browser().fetch('/api/onboarding/setup-guide', { method: 'POST', json: { step: 'grow' } })).status).toBe(401);
  });

  // The full guide greets a venue once per sign-in (owner's rule, Oct 5 2026).
  // The dashboard tells sign-ins apart by this id: the same for as long as
  // they stay signed in, another the next time.
  it('each sign-in has its own id, and keeps it for as long as it lasts', async () => {
    const first = (await guide()).loginId;
    expect(first).toMatch(/^\d+$/);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await guide()).loginId).toBe(first);

    const again = new Browser();
    await again.signIn(email);
    const res = await again.fetch('/api/onboarding/setup-guide');
    expect(res.status, await res.clone().text()).toBe(200);
    const second = ((await res.json()) as Guide).loginId;
    expect(second).toMatch(/^\d+$/);
    expect(Number(second)).toBeGreaterThan(Number(first));
    // The first browser is still on its own sign-in.
    expect((await guide()).loginId).toBe(first);
  });

  // Owner's rule (Oct 5 2026): "Private clients also get the setup guide
  // because that's what we will use to set up their account", and the last
  // step is green-checked for them: "they already signed up for that service".
  // Until then a Private Client got no prompts and no strategy-call step.
  it('a Private Client gets it like every venue, with the strategy-call step already done for them', async () => {
    try {
      expect((await db.from('venues').update({ is_private_client: true }).eq('id', venueId)).error?.message ?? null).toBeNull();
      const g = await guide();
      expect(g).toMatchObject({ eligible: true, prompted: true, autoOpen: true, showPill: true, checkedAll: false });
      // Every step, in the same order; the last one is done and the rest are theirs to do.
      expect(g.lessons.map((l) => l.id)).toEqual(
        ['walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow'],
      );
      expect(g.lessons.find((l) => l.id === 'grow')).toEqual({ id: 'grow', ticked: true, verified: true, checked: true, unticked: false, optional: false, alreadyTheirs: true });
      expect(where(g, 'checked')).toEqual(['grow']);
      expect(g).toMatchObject({ done: 1, total: 8, left: 7 });
      // It is worked out from the label, not saved as a tick of theirs.
      const { data } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
      expect((data!.onboarding_steps_completed as string[] | null) ?? []).not.toContain('guide:grow');
    } finally {
      await db.from('venues').update({ is_private_client: false }).eq('id', venueId);
    }
    // The label comes off: the step is an ordinary one again.
    const after = await guide();
    expect(after).toMatchObject({ prompted: true, autoOpen: true, done: 0, total: 8 });
    expect(after.lessons.find((l) => l.id === 'grow')).toMatchObject({ checked: false, alreadyTheirs: false });
  });

  it('support can switch a venue’s prompts off; the guide stays in its sidebar and its ticks are kept', async () => {
    expect((await tick('listing')).status).toBe(200);
    const off = await admin.fetch(`/api/admin/venues/${venueId}`, { method: 'PATCH', json: { setup_guide_popup_off: true } });
    expect(off.status, await off.clone().text()).toBeLessThan(300);
    const quiet = await guide();
    expect(quiet).toMatchObject({ eligible: true, prompted: false, autoOpen: false, showPill: false, finished: false });
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

  it('the venue can tick any step off itself; once all are ticked the guide is finished: no pop-up, no bar', async () => {
    expect((await tick('not-a-step')).status).toBe(400);
    const saved = async () => {
      const { data } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
      return [...(data!.onboarding_steps_completed as string[])].sort();
    };

    // StoryPay is optional: ticking it moves nothing.
    expect((await tick('payments')).status).toBe(200);
    expect(await guide()).toMatchObject({ done: 0, total: 8, autoOpen: true, finished: false });

    for (const step of COUNTED.slice(0, 7)) expect((await tick(step)).status, step).toBe(200);
    expect(await guide()).toMatchObject({ done: 7, checkedAll: false, finished: false, autoOpen: true, showPill: true });
    expect(await saved()).not.toContain('guide:finished');
    expect((await tick('grow')).status).toBe(200);
    expect((await tick('grow')).status).toBe(200); // ticking twice changes nothing

    const g = await guide();
    // Everything ticked, nothing actually set up: that is the checklist
    // completed (owner's rule, Oct 6 2026). The pop-up and the bar are both
    // off, and `finished` is what takes the sidebar entry away. It was the
    // bar that used to stay here, for the five steps that need something to exist.
    expect(g).toMatchObject({ done: 8, total: 8, checkedAll: true, finished: true, autoOpen: false, showPill: false, fulfilled: false, left: 5, eligible: true });
    // (The walkthrough, follow-up and strategy-call steps have nothing to detect: ticked is done.)
    expect(where(g, 'verified')).toEqual(['walkthrough', 'follow_up', 'grow']);
    // It is remembered, next to their ticks.
    expect(await saved()).toEqual(['payments', ...COUNTED, 'finished'].map((s) => `guide:${s}`).sort());

    // Unticking one takes "finished" back: the guide is theirs again.
    expect((await tick('leadfinder', false)).status).toBe(200);
    expect(await guide()).toMatchObject({ done: 7, checkedAll: false, finished: false, autoOpen: true, showPill: true });
    expect(await saved()).not.toContain('guide:finished');
    expect((await tick('leadfinder')).status).toBe(200);
    expect(await guide()).toMatchObject({ finished: true, autoOpen: false, showPill: false });
  });

  it('really setting a step up still shows on the step, and changes nothing about a finished guide', async () => {
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
    expect(where(nearly, 'verified')).toEqual(['walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'follow_up', 'grow']);
    expect(nearly).toMatchObject({ left: 1, fulfilled: false, finished: true, showPill: false, autoOpen: false });

    // …and mail reaches the Lead Finder address. StoryPay was never connected.
    expect((await db.from('leadfinder_imports').insert({ venue_id: venueId, subject: `Setup Guide check ${runId}` })).error?.message ?? null).toBeNull();
    const g = await guide();
    expect(g).toMatchObject({ left: 0, fulfilled: true, finished: true, showPill: false, autoOpen: false, checkedAll: true, eligible: true });
    expect(g.lessons.find((l) => l.id === 'payments')).toMatchObject({ verified: false, optional: true });
  });

  // Owner's ask (Oct 6 2026): "We need to be able to uncheck items... I found
  // some venues that don't have certain things implemented that are shown as
  // checked." Everything here is really set up by now, so every step is one
  // the app would have locked as Done.
  it('a step the app found set up can be unticked by the venue, which brings a finished guide back; ticking it ends it again', async () => {
    const before = await guide();
    expect(before.lessons.find((l) => l.id === 'web_form')).toMatchObject({ verified: true, checked: true, unticked: false });
    expect(before).toMatchObject({ finished: true, showPill: false });

    expect((await tick('web_form', false)).status).toBe(200);
    const after = await guide();
    expect(after.lessons.find((l) => l.id === 'web_form')).toMatchObject({ ticked: false, verified: false, checked: false, unticked: true });
    expect(after).toMatchObject({ done: 7, checkedAll: false, finished: false, showPill: true, autoOpen: true });
    const { data } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
    expect(data!.onboarding_steps_completed).toContain('guide:not:web_form');
    expect(data!.onboarding_steps_completed).not.toContain('guide:finished');

    // It stays unticked on the next look, though the form is still live.
    expect((await guide()).lessons.find((l) => l.id === 'web_form')).toMatchObject({ checked: false, unticked: true });

    expect((await tick('web_form')).status).toBe(200);
    const again = await guide();
    expect(again.lessons.find((l) => l.id === 'web_form')).toMatchObject({ ticked: true, verified: true, checked: true, unticked: false });
    expect(again).toMatchObject({ done: 8, finished: true, showPill: false, autoOpen: false });
  });

  it('a finished guide stays finished when something it counted is later switched off', async () => {
    // Say the listing step was never ticked by hand: it counted because the
    // listing was live. Then the venue takes its listing down.
    const { data } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
    const steps = data!.onboarding_steps_completed as string[];
    expect(steps).toContain('guide:finished');
    const down = await db.from('venues').update({ is_published: false, onboarding_steps_completed: steps.filter((s) => s !== 'guide:listing') }).eq('id', venueId);
    expect(down.error?.message ?? null).toBeNull();
    try {
      const g = await guide();
      // One step is no longer done…
      expect(g.lessons.find((l) => l.id === 'listing')).toMatchObject({ ticked: false, verified: false, checked: false });
      expect(g).toMatchObject({ done: 7, checkedAll: false });
      // …and none of the guide comes back for it.
      expect(g).toMatchObject({ finished: true, autoOpen: false, showPill: false });
    } finally {
      await db.from('venues').update({ is_published: true, onboarding_steps_completed: steps }).eq('id', venueId);
    }
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
