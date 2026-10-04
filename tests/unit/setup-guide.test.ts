import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES } from '../flows/routes';
import {
  GUIDE_PROMPTS_OFF, SETUP_LESSONS, setupGuideProgress, setupGuidePrompts, setupGuideVideos, setupLessonsFor,
  setupPromptsOff, videoEmbedUrl, withSetupPromptsOff, withSetupStep,
  type SetupContext, type SetupFacts,
} from '@/lib/setup-guide';

// The Setup Guide: suggested steps to a venue's first leads. These are its
// rules (owner's, Oct 4 2026): every step can be ticked off by the venue, the
// pop-up stops once they all are, a reminder stays until each is really set
// up, StoryPay is optional, and everyone but Private Clients is prompted.

const NOTHING: SetupFacts = {
  published: false, guideEnabled: false, leadLinkSet: false, webFormLive: false, leadFinderMail: false, stripeReady: false,
};
const EVERYTHING: SetupFacts = {
  published: true, guideEnabled: true, leadLinkSet: true, webFormLive: true, leadFinderMail: true, stripeReady: true,
};
const ctx = (over: Partial<SetupContext> = {}): SetupContext => ({
  facts: NOTHING, stepsCompleted: [], allowedNavIds: null, leadFinderAvailable: true, privateClient: false, ...over,
});
const ids = (c: SetupContext) => setupLessonsFor(c).map((l) => l.id);
const checked = (c: SetupContext) => setupLessonsFor(c).filter((l) => l.checked).map((l) => l.id);
const verified = (c: SetupContext) => setupLessonsFor(c).filter((l) => l.verified).map((l) => l.id);
const progress = (c: SetupContext) => setupGuideProgress(setupLessonsFor(c));
const tickAll = (...steps: string[]) => steps.map((s) => `guide:${s}`);
const COUNTED = ['listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'grow'];

describe('the Setup Guide lessons', () => {
  it('each has its cover in the app and a real screen to send the venue to', () => {
    for (const lesson of SETUP_LESSONS) {
      expect(existsSync(join(__dirname, '..', '..', 'public', lesson.cover)), `${lesson.id} cover`).toBe(true);
      if (lesson.cta) expect(PAGES, `${lesson.id} → ${lesson.cta.href}`).toContain(lesson.cta.href);
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(0);
    }
    expect(new Set(SETUP_LESSONS.map((l) => l.id)).size).toBe(SETUP_LESSONS.length);
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

describe('ticked versus really set up', () => {
  it('the venue can tick any step off itself, and that counts as done for them', () => {
    expect(checked(ctx())).toEqual([]);
    expect(checked(ctx({ stepsCompleted: tickAll('listing', 'leadfinder') }))).toEqual(['listing', 'leadfinder']);
    // …but ticking isn't setting up: nothing is verified.
    expect(verified(ctx({ stepsCompleted: tickAll('listing', 'leadfinder') }))).toEqual([]);
  });

  it('a step is really set up when the thing exists, ticked or not', () => {
    const real = ctx({ facts: { ...NOTHING, published: true, leadFinderMail: true } });
    expect(verified(real)).toEqual(['listing', 'leadfinder']);
    expect(checked(real)).toEqual(['listing', 'leadfinder']);
    // The pricing guide and the website form share a screen but are separate steps.
    expect(verified(ctx({ facts: { ...NOTHING, guideEnabled: true } }))).toEqual(['pricing_guide']);
    expect(verified(ctx({ facts: { ...NOTHING, webFormLive: true } }))).toEqual(['web_form']);
  });

  it('the two steps with nothing to detect are set up once they’re ticked', () => {
    expect(verified(ctx({ stepsCompleted: tickAll('follow_up', 'grow') }))).toEqual(['follow_up', 'grow']);
  });

  it('whatever is stored for the venue, the guide never breaks', () => {
    for (const junk of ['not a list', null, 7, [7, null, 'profile_branding', { a: 1 }]]) {
      expect(checked(ctx({ stepsCompleted: junk })), String(junk)).toEqual([]);
    }
  });

  it('ticking and unticking keeps the venue’s other steps and support’s switch', () => {
    const saved = ['guide:listing', GUIDE_PROMPTS_OFF, 'profile_branding'];
    expect(withSetupStep(saved, 'lead_link', true)).toEqual([...saved, 'guide:lead_link']);
    expect(withSetupStep(saved, 'listing', true)).toEqual(['guide:prompts-off', 'profile_branding', 'guide:listing']);
    expect(withSetupStep(saved, 'listing', false)).toEqual([GUIDE_PROMPTS_OFF, 'profile_branding']);
    expect(withSetupStep('junk', 'listing', true)).toEqual(['guide:listing']);
  });
});

describe('when the pop-up stops and when the reminder goes', () => {
  it('nothing done: everything is left', () => {
    expect(progress(ctx())).toEqual({ done: 0, total: 7, left: 7, checkedAll: false, fulfilled: false });
  });

  it('StoryPay is optional: it counts toward neither, ticked, set up or not', () => {
    // Every counted step ticked, StoryPay untouched: the pop-up is finished with.
    expect(progress(ctx({ stepsCompleted: tickAll(...COUNTED) })).checkedAll).toBe(true);
    // Only StoryPay done: nothing has moved.
    expect(progress(ctx({ stepsCompleted: tickAll('payments') }))).toMatchObject({ done: 0, total: 7, left: 7 });
    expect(progress(ctx({ facts: { ...NOTHING, stripeReady: true } }))).toMatchObject({ done: 0, total: 7, left: 7 });
    expect(setupLessonsFor(ctx()).filter((l) => l.optional).map((l) => l.id)).toEqual(['payments']);
  });

  it('every step ticked stops the pop-up, but the reminder stays until each is really set up', () => {
    const allTicked = progress(ctx({ stepsCompleted: tickAll(...COUNTED) }));
    // Five need something to exist; follow-up and the strategy call are set up by being ticked.
    expect(allTicked).toEqual({ done: 7, total: 7, left: 5, checkedAll: true, fulfilled: false });

    // They then really do four of the five…
    const nearly = progress(ctx({ stepsCompleted: tickAll(...COUNTED), facts: { ...EVERYTHING, leadFinderMail: false } }));
    expect(nearly).toMatchObject({ checkedAll: true, fulfilled: false, left: 1 });
    // …and the last one.
    expect(progress(ctx({ stepsCompleted: tickAll(...COUNTED), facts: EVERYTHING }))).toMatchObject({ checkedAll: true, fulfilled: true, left: 0 });
  });

  it('really setting everything up finishes it without a single tick, bar the two hand-ticked steps', () => {
    expect(progress(ctx({ facts: EVERYTHING }))).toMatchObject({ done: 5, checkedAll: false, fulfilled: false, left: 2 });
    expect(progress(ctx({ facts: EVERYTHING, stepsCompleted: tickAll('follow_up', 'grow') }))).toMatchObject({ checkedAll: true, fulfilled: true });
  });
});

describe('who is prompted (the pop-up after each sign-in, and the pill)', () => {
  const venue = { wizardDone: true, promptsOff: false, privateClient: false, canManage: true };

  it('every venue that has finished the setup wizard, old or new, on any plan', () => {
    expect(setupGuidePrompts(venue)).toBe(true);
  });

  it('never a Private Client, a venue still in the setup wizard, or a team member', () => {
    expect(setupGuidePrompts({ ...venue, privateClient: true })).toBe(false);
    expect(setupGuidePrompts({ ...venue, wizardDone: false })).toBe(false);
    expect(setupGuidePrompts({ ...venue, canManage: false })).toBe(false);
  });

  it('and not once support has switched them off for that venue (its ticks are kept)', () => {
    expect(setupGuidePrompts({ ...venue, promptsOff: true })).toBe(false);
    const saved = ['guide:listing'];
    expect(setupPromptsOff(saved)).toBe(false);
    const off = withSetupPromptsOff(saved, true);
    expect(off).toEqual(['guide:listing', GUIDE_PROMPTS_OFF]);
    expect(setupPromptsOff(off)).toBe(true);
    expect(withSetupPromptsOff(off, false)).toEqual(['guide:listing']);
    // The switch isn't a step: it ticks nothing.
    expect(checked(ctx({ stepsCompleted: off }))).toEqual(['listing']);
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
