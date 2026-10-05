import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES } from '../flows/routes';
import {
  GUIDE_PROMPTS_OFF, SETUP_LESSONS, setupDrawerChoice, setupDrawerOpen, setupGuideDisplay, setupGuideProgress, setupGuidePrompts,
  setupGuideVideos, setupLessonsFor, setupPromptsOff, videoEmbedUrl, withSetupPromptsOff, withSetupStep,
  type SetupContext, type SetupFacts,
} from '@/lib/setup-guide';

// The Setup Guide: suggested steps to a venue's first leads. These are its
// rules (owner's, Oct 4 2026): every step can be ticked off by the venue, the
// pop-up stops once they all are, a reminder stays until each is really set
// up, and StoryPay is optional. Since Oct 5 2026 Private Clients are prompted
// like every other venue, with the strategy-call step already done for them.

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
const COUNTED = ['walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'grow'];

describe('the Setup Guide lessons', () => {
  it('each has its cover in the app and a real screen to send the venue to', () => {
    for (const lesson of SETUP_LESSONS) {
      expect(existsSync(join(__dirname, '..', '..', 'public', lesson.cover)), `${lesson.id} cover`).toBe(true);
      if (lesson.cta.href !== undefined) expect(PAGES, `${lesson.id} → ${lesson.cta.href}`).toContain(lesson.cta.href);
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
    // A Private Client sees every step, the strategy call included (done for them, below).
    expect(ids(ctx({ privateClient: true }))).toEqual(SETUP_LESSONS.map((l) => l.id));
  });
});

// Owner's rule (Oct 5 2026): "Private clients also get the setup guide because
// that's what we will use to set up their account… If we label them as a
// private client, go ahead and complete step number 9… because they already
// signed up for that service. We just need to green-check-mark that one
// completely." Until then they got no prompts and no strategy-call step.
describe('a Private Client’s guide', () => {
  const theirs = (over: Partial<SetupContext> = {}) => ctx({ privateClient: true, ...over });
  const grow = (c: SetupContext) => setupLessonsFor(c).find((l) => l.id === 'grow');

  it('the strategy-call step is there, already done, without them ticking anything', () => {
    expect(grow(theirs())).toEqual({ id: 'grow', ticked: true, verified: true, checked: true, optional: false, alreadyTheirs: true });
    // Whatever was or wasn't saved for the venue.
    expect(grow(theirs({ stepsCompleted: 'junk' }))).toMatchObject({ verified: true, checked: true, alreadyTheirs: true });
    expect(grow(theirs({ stepsCompleted: tickAll('grow') }))).toMatchObject({ verified: true, checked: true, alreadyTheirs: true });
  });

  it('it is their only head start: every other step is theirs to do, like any venue', () => {
    expect(checked(theirs())).toEqual(['grow']);
    expect(progress(theirs())).toEqual({ done: 1, total: 8, left: 7, checkedAll: false, fulfilled: false });
    const lessons = setupLessonsFor(theirs());
    expect(setupGuideDisplay({ lessons, ...setupGuideProgress(lessons) })).toEqual({ done: 1, total: 8, label: '1 of 8 done', nextId: 'walkthrough', settingUp: false });
    // They finish without ever being shown the survey: seven ticks, not eight.
    const rest = COUNTED.filter((id) => id !== 'grow');
    expect(progress(theirs({ stepsCompleted: tickAll(...rest) }))).toMatchObject({ done: 8, checkedAll: true });
    expect(progress(theirs({ stepsCompleted: tickAll('walkthrough', 'follow_up'), facts: EVERYTHING }))).toMatchObject({ checkedAll: true, fulfilled: true, left: 0 });
  });

  it('for every other venue the step is an ordinary one, done only once it has been shown', () => {
    expect(grow(ctx())).toEqual({ id: 'grow', ticked: false, verified: false, checked: false, optional: false, alreadyTheirs: false });
    expect(setupLessonsFor(ctx({ facts: EVERYTHING, stepsCompleted: tickAll(...COUNTED) })).filter((l) => l.alreadyTheirs)).toEqual([]);
    // The label comes off: the step goes back to what the venue itself ticked.
    expect(grow(ctx({ privateClient: false, stepsCompleted: tickAll('grow') }))).toMatchObject({ ticked: true, verified: true, alreadyTheirs: false });
  });
});

// The owner's rewrite of every step (Oct 5 2026): a 3-minute walkthrough
// first, then the same eight steps under new titles and buttons. Venues'
// ticks are saved by step id, so the ids must never change.
describe('the steps, as the owner wrote them', () => {
  it('nine steps in this order; the eight that were there keep their ids', () => {
    expect(SETUP_LESSONS.map((l) => l.id)).toEqual([
      'walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow',
    ]);
    expect(SETUP_LESSONS.map((l) => l.title)).toEqual([
      'Start here: watch the 3-minute walkthrough',
      'Share your listing link',
      'Check your pricing guide',
      'Put your Lead Link in your Instagram bio',
      'Add the inquiry form to your website',
      'Forward your directory leads to Lead Finder',
      'Make your follow-up sound like you',
      'Set up proposals and payments',
      'Want us to bring you qualified brides?',
    ]);
  });

  it('each main button says what it does', () => {
    expect(Object.fromEntries(SETUP_LESSONS.map((l) => [l.id, l.cta.label]))).toEqual({
      walkthrough: 'Watch the walkthrough',
      listing: 'Open my listing', // second to "Copy my link" in the guide
      pricing_guide: 'Open my pricing guide',
      lead_link: 'Set up my Lead Link',
      web_form: 'Get my embed code',
      leadfinder: 'Get my Lead Finder address',
      follow_up: 'Review my messages',
      payments: 'Connect StoryPay™',
      grow: 'See if your venue qualifies',
    });
    // Two buttons act inside the guide; the rest go to a screen.
    expect(SETUP_LESSONS.filter((l) => l.cta.href === undefined).map((l) => [l.id, l.cta.does])).toEqual([['walkthrough', 'play'], ['grow', 'call']]);
  });

  it('no em dashes anywhere, every step has three how-to lines, and StoryPay stays optional', () => {
    for (const l of SETUP_LESSONS) {
      for (const text of [l.title, l.summary, l.cta.label, ...l.steps]) expect(text, `${l.id}: ${text}`).not.toMatch(/[—–]/);
      expect(l.steps, l.id).toHaveLength(3);
    }
    expect(SETUP_LESSONS.filter((l) => l.optional).map((l) => l.id)).toEqual(['payments']);
  });

  // Owner's polish (Oct 5 2026, evening): headings and subheadings stay; the
  // 1-2-3 lines under them must each make sense on their own ("Add up to three
  // buttons, like Book a Tour" didn't), so each now names the button to press
  // or the thing to check. Names: "Lead Finder" is two words, and only
  // StoryPay™ and the Bride Booking System™ keep a ™.
  it('only StoryPay and the Bride Booking System carry a ™, and Lead Finder is two words', () => {
    for (const l of SETUP_LESSONS) {
      for (const text of [l.title, l.summary, l.cta.label, ...l.steps, ...(l.stepsNoVideo ?? [])]) {
        expect(text.replace(/StoryPay™|Bride Booking System™/g, ''), `${l.id}: ${text}`).not.toMatch(/™/);
        expect(text, `${l.id}: ${text}`).not.toMatch(/LeadFinder/);
      }
    }
    expect(SETUP_LESSONS.find((l) => l.id === 'leadfinder')!.title).toBe('Forward your directory leads to Lead Finder');
    expect(SETUP_LESSONS.find((l) => l.id === 'lead_link')!.title).toBe('Put your Lead Link in your Instagram bio');
  });

  it('a how-to line that sends them to a button names a button the step really has', () => {
    const byId = Object.fromEntries(SETUP_LESSONS.map((l) => [l.id, l]));
    // Each step's own main button, by its exact label.
    for (const id of ['pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'payments', 'grow'] as const) {
      expect(byId[id].steps.join(' '), id).toContain(`Press ${byId[id].cta.label}`);
    }
    // The listing step has two: Copy my link first, Open my listing second.
    expect(byId.listing.steps.join(' ')).toContain('Press Open my listing');
    expect(byId.listing.steps.join(' ')).toContain('Press Copy my link');
    // The line the owner pointed at is gone.
    expect(SETUP_LESSONS.flatMap((l) => l.steps).join(' ')).not.toMatch(/three buttons/i);
  });

  it('the walkthrough never says "press play" while there is no video to play', () => {
    const walkthrough = SETUP_LESSONS[0];
    expect(walkthrough.steps[0]).toMatch(/^Press play/);
    expect(walkthrough.stepsNoVideo).toHaveLength(3);
    for (const line of walkthrough.stepsNoVideo!) {
      expect(line).not.toMatch(/play|[—–]/i);
    }
    expect(walkthrough.stepsNoVideo!.join(' ')).toContain('Mark as done');
    // Only a step whose button plays a video needs the second set.
    expect(SETUP_LESSONS.filter((l) => l.stepsNoVideo).map((l) => l.id)).toEqual(['walkthrough']);
  });

  it('the walkthrough is for every venue on every plan, is ticked by hand, and ships with no video of its own', () => {
    const walkthrough = SETUP_LESSONS[0];
    expect(walkthrough).toMatchObject({ id: 'walkthrough', navId: null, manual: true, cover: '/setup-guide/walkthrough.webp' });
    // A plan with next to nothing still has it, first; so does a Private Client.
    expect(ids(ctx({ allowedNavIds: ['nav_listing_dashboard'] }))[0]).toBe('walkthrough');
    expect(ids(ctx({ privateClient: true }))[0]).toBe('walkthrough');
    // Its video is a link the team pastes: nothing is built in.
    expect(setupGuideVideos({}).walkthrough).toBeUndefined();
    expect(setupGuideVideos({ walkthrough: 'https://vimeo.com/123456789' }).walkthrough).toBe('https://player.vimeo.com/video/123456789');
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

  it('the three steps with nothing to detect are set up once they’re ticked', () => {
    expect(verified(ctx({ stepsCompleted: tickAll('walkthrough', 'follow_up', 'grow') }))).toEqual(['walkthrough', 'follow_up', 'grow']);
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
    expect(progress(ctx())).toEqual({ done: 0, total: 8, left: 8, checkedAll: false, fulfilled: false });
  });

  it('StoryPay is optional: it counts toward neither, ticked, set up or not', () => {
    // Every counted step ticked, StoryPay untouched: the pop-up is finished with.
    expect(progress(ctx({ stepsCompleted: tickAll(...COUNTED) })).checkedAll).toBe(true);
    // Only StoryPay done: nothing has moved.
    expect(progress(ctx({ stepsCompleted: tickAll('payments') }))).toMatchObject({ done: 0, total: 8, left: 8 });
    expect(progress(ctx({ facts: { ...NOTHING, stripeReady: true } }))).toMatchObject({ done: 0, total: 8, left: 8 });
    expect(setupLessonsFor(ctx()).filter((l) => l.optional).map((l) => l.id)).toEqual(['payments']);
  });

  it('every step ticked stops the pop-up, but the reminder stays until each is really set up', () => {
    const allTicked = progress(ctx({ stepsCompleted: tickAll(...COUNTED) }));
    // Five need something to exist; the walkthrough, follow-up and the strategy call are set up by being ticked.
    expect(allTicked).toEqual({ done: 8, total: 8, left: 5, checkedAll: true, fulfilled: false });

    // They then really do four of the five…
    const nearly = progress(ctx({ stepsCompleted: tickAll(...COUNTED), facts: { ...EVERYTHING, leadFinderMail: false } }));
    expect(nearly).toMatchObject({ checkedAll: true, fulfilled: false, left: 1 });
    // …and the last one.
    expect(progress(ctx({ stepsCompleted: tickAll(...COUNTED), facts: EVERYTHING }))).toMatchObject({ checkedAll: true, fulfilled: true, left: 0 });
  });

  it('really setting everything up finishes it without a single tick, bar the three hand-ticked steps', () => {
    expect(progress(ctx({ facts: EVERYTHING }))).toMatchObject({ done: 5, checkedAll: false, fulfilled: false, left: 3 });
    expect(progress(ctx({ facts: EVERYTHING, stepsCompleted: tickAll('walkthrough', 'follow_up', 'grow') }))).toMatchObject({ checkedAll: true, fulfilled: true });
  });
});

describe('what the bar on every page and the sidebar ring say', () => {
  const shown = (c: SetupContext) => {
    const lessons = setupLessonsFor(c);
    return setupGuideDisplay({ lessons, ...setupGuideProgress(lessons) });
  };

  it('while steps are still to tick: how many are done, and the next one to do', () => {
    expect(shown(ctx())).toEqual({ done: 0, total: 8, label: '0 of 8 done', nextId: 'walkthrough', settingUp: false });
    // Done by their own word or for real, it counts the same here.
    const some = ctx({ stepsCompleted: tickAll('walkthrough', 'listing'), facts: { ...NOTHING, guideEnabled: true } });
    expect(shown(some)).toEqual({ done: 3, total: 8, label: '3 of 8 done', nextId: 'lead_link', settingUp: false });
  });

  it('once every step is ticked: only what is really set up counts, so the reminder is honest', () => {
    // All eight ticked, nothing built: three are "set up by being ticked", five are owed.
    expect(shown(ctx({ stepsCompleted: tickAll(...COUNTED) }))).toEqual({ done: 3, total: 8, label: '5 left to set up', nextId: 'listing', settingUp: true });
    const nearly = ctx({ stepsCompleted: tickAll(...COUNTED), facts: { ...EVERYTHING, leadFinderMail: false } });
    expect(shown(nearly)).toEqual({ done: 7, total: 8, label: '1 left to set up', nextId: 'leadfinder', settingUp: true });
  });

  it('everything really set up: a full ring and nothing next', () => {
    expect(shown(ctx({ stepsCompleted: tickAll(...COUNTED), facts: EVERYTHING }))).toEqual({ done: 8, total: 8, label: 'All set up', nextId: null, settingUp: false });
  });

  it('StoryPay, being optional, is never the next step and never moves the ring', () => {
    const onlyPaymentsLeft = ctx({ stepsCompleted: tickAll(...COUNTED), facts: { ...EVERYTHING, stripeReady: false } });
    expect(shown(onlyPaymentsLeft)).toMatchObject({ done: 8, total: 8, nextId: null });
  });
});

// Owner's rule (Oct 5 2026): "open when logging in, closed only if they
// manually close it once logged in." Until then the drawer stayed however it
// was left on that device, for good: a venue that closed it once never saw it
// open again, sign-in after sign-in. (It also started as the bar on every page
// but the dashboard home, and on every phone.)
describe('the checklist drawer: open at every sign-in, closed only by hand until the next one', () => {
  const MONDAY = '1791230000';
  const TUESDAY = '1791316400';
  const open = (saved: string | null, signIn: string | null = MONDAY, stepsToTick = true) => setupDrawerOpen({ saved, signIn, stepsToTick });

  it('after signing in it is open, with nothing chosen yet', () => {
    expect(open(null)).toBe(true);
    expect(open('')).toBe(true);
  });

  it('closed by hand, it stays closed for the rest of that sign-in', () => {
    const closed = setupDrawerChoice(MONDAY, false);
    expect(open(closed, MONDAY)).toBe(false);
    // Opened again by hand: open.
    expect(open(setupDrawerChoice(MONDAY, true), MONDAY)).toBe(true);
  });

  it('signing in again opens it again, whatever was chosen the time before', () => {
    expect(open(setupDrawerChoice(MONDAY, false), TUESDAY)).toBe(true);
    // And a choice kept from before this rule ("closed", no sign-in) no longer holds it shut.
    expect(open('closed', TUESDAY)).toBe(true);
    expect(open('open', TUESDAY)).toBe(true);
    expect(open('nonsense|maybe', TUESDAY)).toBe(true);
  });

  it('once every step is ticked it rests as the bar, at each sign-in, and still opens by hand', () => {
    expect(open(null, TUESDAY, false)).toBe(false);
    // Left open the time before: that was another sign-in.
    expect(open(setupDrawerChoice(MONDAY, true), TUESDAY, false)).toBe(false);
    expect(open(setupDrawerChoice(TUESDAY, true), TUESDAY, false)).toBe(true);
  });

  it('with no sign-in time to go by, a choice still holds (for as long as the browser keeps it)', () => {
    expect(open(setupDrawerChoice(null, false), null)).toBe(false);
    // …and is never mistaken for a real sign-in's.
    expect(open(setupDrawerChoice(null, false), MONDAY)).toBe(true);
  });
});

describe('who is prompted (the pop-up after each sign-in, and the bar on every page)', () => {
  const venue = { wizardDone: true, promptsOff: false, canManage: true };

  it('every venue that has finished the setup wizard, old or new, on any plan, Private Clients included', () => {
    expect(setupGuidePrompts(venue)).toBe(true);
    // Being a Private Client isn't something the rule can even be told any more.
    expect(setupGuidePrompts.toString()).not.toMatch(/privateClient/);
  });

  it('never a venue still in the setup wizard, or a team member', () => {
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
