import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { expect, request, test, type Page } from '@playwright/test';
import { db, env, FLOW_VENUE, runId, submitListingLead } from '../flows/helpers';

/** On a phone, nothing should scroll sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page is wider than the screen').toBeLessThanOrEqual(1);
}

test('the owner signs in and works their leads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your venue' })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.getByPlaceholder('you@yourvenue.com').first().fill(FLOW_VENUE.email);
  await page.getByPlaceholder('••••••••').fill(env.password);
  await page.locator('form').filter({ has: page.getByPlaceholder('••••••••') }).locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: /Bride Booking System/ }).first()).toBeVisible();
  await expect(page.getByText("Let's Build Your Bride Booking System")).toHaveCount(0);

  await page.goto('/dashboard/leads');
  await expect(page.getByText('Ava Flow').first()).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('a couple opens their proposal and signs it', async ({ page }) => {
  // The owner sends it (the couple's side is the journey under test).
  const owner = await request.newContext({ baseURL: env.base, storageState: 'tests/browser/.auth/owner.json' });
  const res = await owner.post('/api/proposals', {
    data: {
      overrideContent: '<p>Wedding at Flow Test Venue on June 12, 2027. Full-day package.</p>',
      customerName: 'Riley Morgan', customerEmail: `riley.${runId}.${test.info().project.name}@example.com`,
      price: 450000, paymentType: 'full', paymentConfig: {}, collectManually: true, requireSignature: true,
    },
  });
  expect(res.status()).toBe(201);
  const { id, public_token: token } = (await res.json()) as { id: string; public_token: string };
  await owner.dispose();

  await page.goto(`/proposal/${token}`);
  await expect(page.getByRole('heading', { name: 'Sign This Proposal' })).toBeVisible();
  await expect(page.getByText('Full-day package')).toBeVisible();
  await expectNoSidewaysScroll(page);

  // Draw a signature.
  const pad = page.locator('canvas').first();
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();

  await page.getByPlaceholder('Printed Name').fill('Riley Morgan');
  const sign = page.getByRole('button', { name: 'Sign Proposal' });
  await expect(sign).toBeDisabled();
  await page.getByText(/consent to do business electronically/).click();
  await expect(sign).toBeEnabled();
  await sign.click();
  // A "collect payment directly" proposal is done once signed.
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  await expect(page.getByText(/Signed on /)).toBeVisible();
  await expect(page.getByRole('link', { name: /Download your signed contract/ })).toBeVisible();

  // Couples see the venue only: no StoryVenue name, logo, tab title or link preview.
  await expect(page.getByText(/StoryVenue/)).toHaveCount(0);
  await expect(page.getByAltText('StoryVenue')).toHaveCount(0);
  await expect(page).toHaveTitle(`Proposal from ${FLOW_VENUE.name}`);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', `Proposal from ${FLOW_VENUE.name}`);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  await page.goto(`/invoice/${id}`);
  await expect(page.getByText(FLOW_VENUE.name).first()).toBeVisible();
  await expect(page.getByText(/StoryVenue/)).toHaveCount(0);
  await expect(page).toHaveTitle(`Invoice from ${FLOW_VENUE.name}`);
});

// A venue of its own, not the shared test venue: the flow tests run alongside
// the browser tests and send the shared venue leads of their own, and this
// badge counts every unseen lead. (Oct 5 2026: it read 2, not 1, and failed a
// gate for a change that had nothing to do with it.)
test('live updates: a new lead lights up the Lead Inbox badge without a refresh', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The phone tab bar has its own badge.');
  const stamp = Date.now().toString(36);
  const email = `live.${stamp}.${runId}@example.com`;
  const venueId = randomUUID();
  const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
  const { error } = await db.from('venues').insert({
    id: venueId, name: `Live Journey ${runId}`, slug: `live-journey-${stamp}`, email,
    notification_email: email, brand_email: email, password_hash: await bcrypt.hash(env.password, 10),
    setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: new Date().toISOString(),
    directory_plan_id: plan?.id ?? null, directory_subscription_status: 'active', email_verified_at: new Date().toISOString(),
    owner_first_name: 'Liv', owner_last_name: 'Live', timezone: 'America/New_York', is_published: true, is_demo: false,
    // Support's switch: no Setup Guide pop-up over this journey.
    onboarding_steps_completed: ['guide:prompts-off'],
  });
  expect(error?.message ?? null).toBeNull();

  await page.goto('/login');
  await page.getByPlaceholder('you@yourvenue.com').first().fill(email);
  await page.getByPlaceholder('••••••••').fill(env.password);
  await page.locator('form').filter({ has: page.getByPlaceholder('••••••••') }).locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/);

  const inbox = page.getByRole('link', { name: /Lead Inbox/ }).first();
  await expect(inbox).toBeVisible();
  await expect(inbox).not.toHaveText(/\d/);
  const last = `Live${runId}`;
  const res = await submitListingLead({
    venue_id: venueId, first_name: 'Morgan', last_name: last, email: `morgan.${last.toLowerCase()}.${stamp}@example.com`,
    phone: '(212) 555-0177', source: 'directory', client_ip: '203.0.113.8',
  });
  expect(res.status, await res.clone().text()).toBe(201);
  await expect(inbox).toHaveText(/Lead Inbox\s*1\b/, { timeout: 20_000 });
});

// The Setup Guide (owner's rules, Oct 4 2026): it opens by itself a few
// seconds after a venue signs in, the X always closes it, the venue can tick
// steps off itself, and once every step is ticked it stops opening but a
// closed pill stays until each step is really set up.
test('the Setup Guide meets a venue after signing in, and steps aside once its steps are ticked', async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`;
  const email = `guide.${stamp}.${runId}@example.com`;
  const venueId = randomUUID();
  const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
  const { error } = await db.from('venues').insert({
    id: venueId, name: `Guide Journey ${runId}`, slug: `guide-journey-${stamp}`, email,
    notification_email: email, brand_email: email, password_hash: await bcrypt.hash(env.password, 10),
    setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: new Date().toISOString(),
    directory_plan_id: plan?.id ?? null, directory_subscription_status: 'active', email_verified_at: new Date().toISOString(),
    owner_first_name: 'Gia', owner_last_name: 'Guide', timezone: 'America/New_York', is_published: true, is_demo: false,
  });
  expect(error?.message ?? null).toBeNull();

  const signIn = async () => {
    await page.goto('/login');
    await page.getByPlaceholder('you@yourvenue.com').first().fill(email);
    await page.getByPlaceholder('••••••••').fill(env.password);
    await page.locator('form').filter({ has: page.getByPlaceholder('••••••••') }).locator('button[type="submit"]').click();
    await page.waitForURL(/\/dashboard/);
  };
  await signIn();

  // It isn't there the moment the dashboard appears; it opens by itself shortly after.
  const guide = page.getByTestId('setup-guide');
  await expect(guide).toBeVisible({ timeout: 20_000 });
  await expect(guide.getByRole('heading', { name: 'Setup guide' })).toBeVisible();
  await expect(guide.getByText(/\d of \d done/)).toBeVisible();
  // Its listing is live, so that step is already really done.
  await expect(guide.getByRole('button', { name: /^Done: Share your listing link/ })).toBeVisible();
  // It opens on the first step: the 3-minute walkthrough. No video link has
  // been pasted for it here, so there is no Watch button and it can be ticked.
  await expect(guide.getByRole('heading', { name: 'Start here: watch the 3-minute walkthrough' })).toBeVisible();
  await expect(guide.getByText(/\d of 8 done/)).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Watch the walkthrough' })).toHaveCount(0);
  await expect(guide.getByRole('button', { name: 'Mark as done', exact: true })).toBeVisible();
  // The listing step leads with copying the link; opening the listing is second.
  await guide.getByRole('button', { name: /^Done: Share your listing link/ }).locator('xpath=ancestor::li[1]').getByRole('button').first().click();
  await expect(guide.getByRole('heading', { name: 'Share your listing link' })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Copy my link' })).toBeVisible();
  await expect(guide.getByRole('link', { name: 'Open my listing' })).toHaveAttribute('href', '/dashboard/listing/venue-listing');
  await expectNoSidewaysScroll(page);

  // The venue ticks a step off itself; the guide says it isn't set up yet.
  await guide.getByRole('button', { name: /^Mark as done: Put your Lead Link/ }).click();
  await expect(guide.getByRole('button', { name: /^Marked done, not set up yet: Put your Lead Link/ })).toBeVisible();

  // The X closes it, and it stays closed for the rest of this sign-in.
  await guide.getByRole('button', { name: 'Close the setup guide' }).click();
  await expect(guide).toBeHidden();
  await page.reload();
  const card = page.getByTestId('setup-guide-card');
  await expect(card).toBeVisible();
  await page.waitForTimeout(5000);
  await expect(guide).toBeHidden();

  // The Setup guide is the first thing in the menu, above the Bride Booking System™.
  await expect(page.locator('aside:visible nav > :first-child')).toContainText('Setup guide');
  // On a wide screen the card shows every step's cover in a row that scrolls
  // sideways. It has no scrollbar of its own (it was a thick grey bar under
  // the covers): a thin marker appears while scrolling and fades once it stops.
  if (testInfo.project.name === 'desktop') {
    const strip = card.getByTestId('setup-guide-strip');
    const marker = card.getByTestId('setup-guide-strip-marker');
    const box = await strip.evaluate((el) => ({
      scrolls: el.scrollWidth > el.clientWidth, bar: (el as HTMLElement).offsetHeight - el.clientHeight, style: getComputedStyle(el).scrollbarWidth,
    }));
    expect(box).toEqual({ scrolls: true, bar: 0, style: 'none' });
    await expect(marker).toHaveCSS('opacity', '0');
    await strip.evaluate((el) => { el.scrollLeft = 240; });
    await expect(marker).toHaveCSS('opacity', '1');
    await expect(marker).toHaveCSS('opacity', '0', { timeout: 5000 });
    await expectNoSidewaysScroll(page);
  }

  // The same bar is on every page, so wherever they go they see there's setup
  // left (owner's call, Oct 5 2026; it replaced a dark pill on inner pages).
  // Away from the dashboard home it starts as the bar: it never pushes a
  // working page down by itself.
  await page.goto('/dashboard/leads');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute('data-open', 'false');
  await expect(card).toContainText(/\d of \d done/);
  await expect(page.getByTestId('setup-guide-pill')).toHaveCount(0);
  // The sidebar's entry carries the same green progress ring.
  await expect(page.locator('aside:visible nav > :first-child').getByTestId('setup-guide-progress')).toHaveAttribute('data-progress', /^\d\/\d$/);
  await expectNoSidewaysScroll(page);
  await page.goto('/dashboard/listing');
  await expect(card).toBeVisible({ timeout: 20_000 });

  // The card is a drawer hanging from the top of the page: open at first on
  // the dashboard home (on a wide screen), and one slim bar once they close
  // it (progress, Continue). It stays how they left it on this device; the
  // bar opens it again.
  const steps = page.locator('#setup-guide-steps');
  // (A phone starts with the bar: its open drawer is a long list of steps.)
  if (testInfo.project.name !== 'desktop') {
    await expect(card).toHaveAttribute('data-open', 'false');
    await expect(card).toContainText(/\d of \d done/);
    await card.getByRole('button', { name: 'Show the setup steps' }).click();
  }
  await expect(card).toHaveAttribute('data-open', 'true');
  await expect(steps).toBeVisible();
  const openHeight = (await card.boundingBox())!.height;
  await card.getByRole('button', { name: 'Close the setup steps' }).click();
  await expect(card).toHaveAttribute('data-open', 'false');
  await expect(steps).toBeHidden();
  await expect(card).toContainText(/\d of \d done/);
  await expect(card.getByRole('button', { name: 'Continue setup' })).toBeVisible();
  await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThan(70);
  // The bar is one hairline border, no shadow, and progress is a ring around
  // its icon (a line along the bottom was clipped by the rounded corners).
  await expect(card).toHaveCSS('box-shadow', 'none');
  await expect(card).toHaveCSS('border-bottom-width', '1px');
  await expect(card.getByTestId('setup-guide-progress')).toHaveAttribute('data-progress', /^\d\/\d$/);
  expect(openHeight).toBeGreaterThan(120);
  await page.reload();
  await expect(card).toHaveAttribute('data-open', 'false');
  await expect(steps).toBeHidden();
  await card.getByRole('button', { name: 'Show the setup steps' }).click();
  await expect(steps).toBeVisible();
  await expectNoSidewaysScroll(page);

  // The bar brings the guide itself back.
  await card.getByRole('button', { name: 'Continue setup' }).click();
  await expect(guide).toBeVisible();

  // Every step ticked (none of the rest really set up): at the next sign-in
  // the guide doesn't open by itself, and the bar stays, now counting what's
  // left to really set up, on every page.
  const { error: ticked } = await db.from('venues').update({
    onboarding_steps_completed: ['walkthrough', 'listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'grow'].map((s) => `guide:${s}`),
  }).eq('id', venueId);
  expect(ticked?.message ?? null).toBeNull();
  // Sign out (drop the venue session, keep the test copy's own gate cookie).
  // Leave the dashboard first: every answer to a signed-in request renews the
  // session cookie, so one still on its way would sign the venue back in.
  await page.goto('about:blank');
  for (const name of ['venue_id', 'venue_id_sig', 'venue_id_meta', 'member_id', 'member_id_sig', 'member_id_meta']) {
    await page.context().clearCookies({ name });
  }
  await signIn();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(/\d left to set up/);
  await expect(card).not.toContainText(/of \d done/);
  await page.waitForTimeout(5000);
  await expect(guide).toBeHidden();
  await expect(page.getByTestId('setup-guide-pill')).toHaveCount(0);
  await page.goto('/dashboard/leads');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(/\d left to set up/);

  // Its button opens the guide again, and it says why the reminder is still there.
  await card.getByRole('button', { name: 'Continue setup' }).click();
  await expect(guide).toBeVisible();
  await expect(guide.getByText(/ticked every step/)).toBeVisible();
});

// What the dashboard says about a plan or trial ending (owner's rules, Oct 5
// 2026). One of four bars used to sit on every page for the whole trial or
// notice period. Now: nothing during a carded trial until its last days; a
// cancelled plan is said once, then it's a chip on the Setup guide bar, then
// it's back in the last days with the way to keep the plan.
test('the dashboard says little about a plan or trial ending until it matters', async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`;
  const email = `plan.${stamp}.${runId}@example.com`;
  const venueId = randomUUID();
  const DAY = 86_400_000;
  const inDays = (d: number) => new Date(Date.now() + d * DAY - 60_000).toISOString();
  const day = (iso: string, month: 'long' | 'short') => new Intl.DateTimeFormat('en-US', { month, day: 'numeric', timeZone: 'America/New_York' }).format(new Date(iso));
  const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
  // A trial with a card on file, nine days left.
  const { error } = await db.from('venues').insert({
    id: venueId, name: `Plan Journey ${runId}`, slug: `plan-journey-${stamp}`, email,
    notification_email: email, brand_email: email, password_hash: await bcrypt.hash(env.password, 10),
    setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: new Date().toISOString(),
    directory_plan_id: plan!.id, directory_subscription_status: 'trialing', directory_subscription_external_id: `sub_browser_${stamp}`,
    directory_trial_started_at: new Date(Date.now() - 5 * DAY).toISOString(), directory_trial_ends_at: inDays(9), directory_trial_consumed: true,
    email_verified_at: new Date().toISOString(), owner_first_name: 'Pia', owner_last_name: 'Plan', timezone: 'America/New_York',
    is_published: true, is_demo: false,
  });
  expect(error?.message ?? null).toBeNull();
  const set = async (row: Record<string, unknown>) => {
    expect((await db.from('venues').update(row).eq('id', venueId)).error?.message ?? null).toBeNull();
    await page.goto('/dashboard/listing');
    await expect(page.getByTestId('setup-guide-card')).toBeVisible({ timeout: 20_000 });
  };

  await page.goto('/login');
  await page.getByPlaceholder('you@yourvenue.com').first().fill(email);
  await page.getByPlaceholder('••••••••').fill(env.password);
  await page.locator('form').filter({ has: page.getByPlaceholder('••••••••') }).locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/);
  // The Setup Guide opens by itself after sign-in; close it to see the page.
  const guide = page.getByTestId('setup-guide');
  await expect(guide).toBeVisible({ timeout: 20_000 });
  await guide.getByRole('button', { name: 'Close the setup guide' }).click();

  const notice = page.getByTestId('plan-notice');
  const chip = page.getByTestId('plan-chip');
  const wide = testInfo.project.name === 'desktop';

  // Card on file, nine days left: no countdown, no "switch to Free".
  await expect(page.getByTestId('setup-guide-card')).toBeVisible();
  await expect(notice).toBeHidden();
  await expect(page.locator('main')).not.toContainText(/days? left|Switch to Free/);

  // Its last days: the heads-up, with the charge date and where to manage it.
  const trialEnds = inDays(2);
  await set({ directory_trial_ends_at: trialEnds });
  await expect(notice).toContainText('Your trial ends in 2 days');
  await expect(notice).toContainText(`Your card will be charged $97/mo on ${day(trialEnds, 'long')}.`);
  await expect(notice.getByRole('link', { name: 'Manage subscription' })).toHaveAttribute('href', '/dashboard/directory-billing');
  await expect(notice).not.toContainText('Switch to Free');
  await expectNoSidewaysScroll(page);

  // They cancel, twenty days out: it's said once, and can be closed.
  const planEnds = inDays(20);
  await set({ directory_trial_ends_at: planEnds, directory_downgrade_at: planEnds });
  await expect(notice).toContainText(`Your plan ends ${day(planEnds, 'long')}`);
  await expect(notice).toContainText("won't be charged again");
  await expect(chip).toBeHidden();
  // The next visit: no notice, just a chip on the Setup guide bar (wide screens).
  await page.goto('/dashboard/listing');
  await expect(page.getByTestId('setup-guide-card')).toBeVisible({ timeout: 20_000 });
  await expect(notice).toBeHidden();
  if (wide) {
    await expect(chip).toHaveText(`Plan ends ${day(planEnds, 'short')}`);
    await expect(chip).toHaveAttribute('href', '/dashboard/directory-billing');
  }
  await expectNoSidewaysScroll(page);

  // The last days of that plan: it's back, with the way to keep the plan.
  const soon = inDays(2);
  await set({ directory_trial_ends_at: soon, directory_downgrade_at: soon });
  await expect(notice).toContainText('Your plan ends in 2 days');
  await expect(notice).toContainText(`(${day(soon, 'long')})`);
  await expect(notice.getByRole('link', { name: 'Keep my plan' })).toHaveAttribute('href', '/dashboard/directory-billing');
  await expect(chip).toBeHidden();

  // A trial with no card keeps its countdown: for them it's a real deadline.
  await set({ directory_downgrade_at: null, directory_subscription_external_id: null, directory_trial_ends_at: inDays(6) });
  await expect(notice).toContainText('Bride Booking System™ trial · 6 days left');
  await expect(notice.getByRole('button', { name: 'Start my plan early' })).toBeVisible();
});

// The Setup Guide's first step (owner's rewrite, Oct 5 2026): a 3-minute
// walkthrough. Its button plays the video right in the guide, and starting
// the video is what ticks the step. The video is a link the team pastes in
// Admin → Setup guide; here the guide is told there is one.
// The journey ends with the venue labelled a Private Client: it keeps the
// guide, and the last step is done for it.
test('watching the walkthrough ticks its step; a Private Client finds the last step already done', async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`;
  const email = `watch.${stamp}.${runId}@example.com`;
  const venueId = randomUUID();
  const { data: plan } = await db.from('directory_plans').select('id').eq('slug', 'bride-booking-system').single();
  const { error } = await db.from('venues').insert({
    id: venueId, name: `Watch Journey ${runId}`, slug: `watch-journey-${stamp}`, email,
    notification_email: email, brand_email: email, password_hash: await bcrypt.hash(env.password, 10),
    setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: new Date().toISOString(),
    directory_plan_id: plan?.id ?? null, directory_subscription_status: 'active', email_verified_at: new Date().toISOString(),
    owner_first_name: 'Wes', owner_last_name: 'Watch', timezone: 'America/New_York', is_published: false, is_demo: false,
  });
  expect(error?.message ?? null).toBeNull();

  // A walkthrough video link has been pasted (as Admin → Setup guide would store it).
  await page.route('**/api/onboarding/setup-guide', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    body.videos = { ...body.videos, walkthrough: 'https://player.vimeo.com/video/123456789' };
    await route.fulfill({ response: res, json: body });
  });

  await page.goto('/login');
  await page.getByPlaceholder('you@yourvenue.com').first().fill(email);
  await page.getByPlaceholder('••••••••').fill(env.password);
  await page.locator('form').filter({ has: page.getByPlaceholder('••••••••') }).locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/);

  const guide = page.getByTestId('setup-guide');
  await expect(guide).toBeVisible({ timeout: 20_000 });
  await expect(guide.getByRole('heading', { name: 'Start here: watch the 3-minute walkthrough' })).toBeVisible();
  // The steps read STEP 01 to STEP 08, with StoryPay as OPTIONAL, and the count is out of 8.
  await expect(guide.getByText(/0 of 8 done/)).toBeVisible();
  for (const label of ['Step 01', 'Step 08', 'Optional']) await expect(guide.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(guide.getByText('Step 09', { exact: true })).toHaveCount(0);

  // With a video, the step's button is Watch, and there's no "Mark as done".
  const watch = guide.getByRole('button', { name: 'Watch the walkthrough' });
  await expect(watch).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Mark as done', exact: true })).toHaveCount(0);
  await expect(guide.getByRole('button', { name: /^Mark as done: Start here/ })).toBeVisible();

  // Watch: the video plays where it is (same page), and the step is done.
  const url = page.url();
  await watch.click();
  await expect(guide.locator('iframe[src*="player.vimeo.com/video/123456789"]')).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(guide.getByRole('button', { name: /^Done: Start here/ })).toBeVisible();
  await expect(guide.getByText(/1 of 8 done/)).toBeVisible();
  const { data: saved } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
  expect(saved!.onboarding_steps_completed).toContain('guide:walkthrough');

  // The last step's button asks if the venue qualifies, and opens the survey.
  await guide.getByRole('button', { name: /Want us to bring you qualified brides\?/ }).first().click();
  await expect(guide.getByRole('button', { name: 'See if your venue qualifies' })).toBeVisible();
  await expect(guide.getByRole('button', { name: 'Book a strategy call' })).toHaveCount(0);
  await expectNoSidewaysScroll(page);

  // The same venue, labelled a Private Client (owner's rule, Oct 5 2026):
  // "Private clients also get the setup guide because that's what we will use
  // to set up their account", and its last step is green-checked for them:
  // "they already signed up for that service". Until then a Private Client
  // was shown neither the guide's bar nor that step. (Its ticks are cleared
  // too, so what's done below is done by the label alone. Same sign-in: the
  // checks share one address, and sign-in allows it ten a minute.)
  // (For an ordinary venue the step is done once it has been shown: wait for
  // that tick to be saved, so clearing the ticks below can't cross it.)
  await expect.poll(async () => {
    const { data } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
    return (data?.onboarding_steps_completed as string[] | null) ?? [];
  }).toContain('guide:grow');
  await expect(guide.getByRole('button', { name: /^Done: Want us to bring you qualified brides\?/ })).toBeVisible();
  await guide.getByRole('button', { name: 'Close the setup guide' }).click();
  await expect(guide).toBeHidden();
  const labelled = await db.from('venues').update({ is_private_client: true, onboarding_steps_completed: [] }).eq('id', venueId);
  expect(labelled.error?.message ?? null).toBeNull();
  await page.reload();
  // The bar is on their pages like anyone's, with one of eight done.
  const card = page.getByTestId('setup-guide-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('1 of 8 done');
  if (testInfo.project.name === 'desktop') {
    await expect(page.locator('aside:visible nav > :first-child').getByTestId('setup-guide-progress')).toHaveAttribute('data-progress', '1/8');
  }
  if ((await card.getAttribute('data-open')) === 'true') await card.getByRole('button', { name: 'Close the setup steps' }).click();
  await card.getByRole('button', { name: 'Continue setup' }).click();
  await expect(guide).toBeVisible();
  await expect(guide.getByText(/1 of 8 done/)).toBeVisible();
  // The last step is done, and can't be unticked.
  const done = guide.getByRole('button', { name: /^Done: Want us to bring you qualified brides\?/ });
  await expect(done).toBeVisible();
  await expect(done).toBeDisabled();
  // Opening it says why, and there is no survey to fill in for a service they already have.
  await guide.getByRole('button', { name: /Want us to bring you qualified brides\?/ }).first().click();
  await expect(guide.getByRole('heading', { name: 'Want us to bring you qualified brides?' })).toBeVisible();
  await expect(guide.getByTestId('setup-guide-already-theirs')).toHaveText('You’ve already signed up for this, so it’s done.');
  await expect(guide.getByRole('button', { name: 'See if your venue qualifies' })).toHaveCount(0);
  await expect(guide.getByText(/1 of 8 done/)).toBeVisible();
  await expectNoSidewaysScroll(page);
  // Nothing was saved as a tick of theirs: it comes from the label.
  const { data: theirs } = await db.from('venues').select('onboarding_steps_completed').eq('id', venueId).single();
  expect((theirs!.onboarding_steps_completed as string[] | null) ?? []).not.toContain('guide:grow');
  // The guide may be mid-reload through the stand-in above: let that go quietly.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
