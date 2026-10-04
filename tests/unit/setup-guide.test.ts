import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES } from '../flows/routes';
import {
  SETUP_LESSONS, setupGuideIsGuided, setupGuideVideos, setupLessonsFor, videoEmbedUrl,
  type SetupContext, type SetupFacts,
} from '@/lib/setup-guide';

// The Setup Guide walks a new venue through the steps that get it its first
// leads. These are its rules: which steps a venue sees, what makes one done,
// who gets walked through it, and which video links it will play.

const NOTHING: SetupFacts = {
  published: false, guideEnabled: false, leadLinkSet: false, webFormLive: false, leadFinderMail: false, stripeReady: false,
};
const ctx = (over: Partial<SetupContext> = {}): SetupContext => ({
  facts: NOTHING, stepsCompleted: [], allowedNavIds: null, leadFinderAvailable: true, privateClient: false, ...over,
});
const ids = (c: SetupContext) => setupLessonsFor(c).map((l) => l.id);
const done = (c: SetupContext) => setupLessonsFor(c).filter((l) => l.done).map((l) => l.id);

describe('the Setup Guide lessons', () => {
  it('each has its cover in the app and a real screen to send the venue to', () => {
    for (const lesson of SETUP_LESSONS) {
      expect(existsSync(join(__dirname, '..', '..', 'public', lesson.cover)), `${lesson.id} cover`).toBe(true);
      if (lesson.cta) expect(PAGES, `${lesson.id} → ${lesson.cta.href}`).toContain(lesson.cta.href);
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(0);
    }
    expect(new Set(SETUP_LESSONS.map((l) => l.id)).size).toBe(SETUP_LESSONS.length);
  });

  it('a step is done when the thing exists, not when a video was watched', () => {
    expect(done(ctx())).toEqual([]);
    expect(done(ctx({ facts: { ...NOTHING, published: true, leadFinderMail: true, stripeReady: true } })))
      .toEqual(['listing', 'leadfinder', 'payments']);
    // The pricing guide and the website form live on the same screen but are separate steps.
    expect(done(ctx({ facts: { ...NOTHING, guideEnabled: true } }))).toEqual(['pricing_guide']);
    expect(done(ctx({ facts: { ...NOTHING, webFormLive: true } }))).toEqual(['web_form']);
  });

  it('only the two steps with nothing to detect are ticked by hand', () => {
    // Ticking a detected step (or an old checklist's step) changes nothing.
    expect(done(ctx({ stepsCompleted: ['guide:listing', 'guide:payments', 'profile_branding', 7, null] }))).toEqual([]);
    expect(done(ctx({ stepsCompleted: ['guide:follow_up', 'guide:grow'] }))).toEqual(['follow_up', 'grow']);
    // …and whatever is stored there, the guide never breaks.
    expect(done(ctx({ stepsCompleted: 'not a list' }))).toEqual([]);
  });

  it('a venue only sees the steps it can act on', () => {
    expect(ids(ctx())).toEqual(SETUP_LESSONS.map((l) => l.id));
    // Its plan has no Lead Link: no Lead Link step.
    const plan = ['nav_listing_dashboard', 'nav_listing_pricing_guide', 'nav_settings_integrations', 'nav_listing_booking_system', 'nav_payments_settings'];
    expect(ids(ctx({ allowedNavIds: plan }))).not.toContain('lead_link');
    // No pricing guide screen: neither the guide step nor the embed-code step that lives on it.
    const noGuide = ids(ctx({ allowedNavIds: plan.filter((n) => n !== 'nav_listing_pricing_guide') }));
    expect(noGuide).not.toContain('pricing_guide');
    expect(noGuide).not.toContain('web_form');
    expect(ids(ctx({ leadFinderAvailable: false }))).not.toContain('leadfinder');
    // A Private Client already works with our team: no strategy-call step.
    expect(ids(ctx({ privateClient: true }))).not.toContain('grow');
  });
});

describe('who is walked through the guide (the pop-up after each sign-in)', () => {
  const newVenue = {
    complete: false, wizardDone: true, createdAt: '2026-10-05T12:00:00Z', popupOff: false, privateClient: false, canManage: true,
  };

  it('a venue that signed up since the guide shipped, until it finishes', () => {
    expect(setupGuideIsGuided(newVenue)).toBe(true);
    expect(setupGuideIsGuided({ ...newVenue, complete: true })).toBe(false);
  });

  it('never a venue from before it, one still in the setup wizard, a Private Client or a team member', () => {
    expect(setupGuideIsGuided({ ...newVenue, createdAt: '2026-09-01T00:00:00Z' })).toBe(false);
    expect(setupGuideIsGuided({ ...newVenue, createdAt: null })).toBe(false);
    expect(setupGuideIsGuided({ ...newVenue, wizardDone: false })).toBe(false);
    expect(setupGuideIsGuided({ ...newVenue, privateClient: true })).toBe(false);
    expect(setupGuideIsGuided({ ...newVenue, canManage: false })).toBe(false);
  });

  it('and not once support has switched the pop-up off for that venue', () => {
    expect(setupGuideIsGuided({ ...newVenue, popupOff: true })).toBe(false);
  });
});

describe('lesson videos', () => {
  it('a pasted link becomes that service’s player address', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
    expect(videoEmbedUrl('youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
    expect(videoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(videoEmbedUrl('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).toBe('https://www.loom.com/embed/0123456789abcdef0123456789abcdef');
    expect(videoEmbedUrl('https://customer-abc123.cloudflarestream.com/4c6bff483d8d73749d70e15a49cd8992/watch'))
      .toBe('https://customer-abc123.cloudflarestream.com/4c6bff483d8d73749d70e15a49cd8992/iframe');
  });

  it('anything else is refused, so a link can never frame another site inside the dashboard', () => {
    for (const bad of ['', '   ', 'not a link', 'https://evil.example.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)',
      'https://customer-abc123.cloudflarestream.com/../../login', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ']) {
      expect(videoEmbedUrl(bad), bad).toBeNull();
    }
  });

  it('the strategy-call step ships with its video; a saved link replaces it and an emptied one removes it', () => {
    expect(Object.keys(setupGuideVideos({}))).toEqual(['grow']);
    expect(setupGuideVideos({ listing: 'https://vimeo.com/123456789' })).toMatchObject({ listing: 'https://player.vimeo.com/video/123456789' });
    expect(setupGuideVideos({ grow: 'https://vimeo.com/42' }).grow).toBe('https://player.vimeo.com/video/42');
    expect(setupGuideVideos({ grow: '' }).grow).toBeUndefined();
    // A bad link that somehow got saved is simply not played.
    expect(setupGuideVideos({ listing: 'https://evil.example.com/x' }).listing).toBeUndefined();
    expect(setupGuideVideos('nonsense')).toMatchObject({ grow: expect.stringContaining('cloudflarestream.com') });
  });
});
