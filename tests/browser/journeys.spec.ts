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

test.describe('live updates', () => {
  test.use({ storageState: 'tests/browser/.auth/owner.json' });

  test('a new lead lights up the Lead Inbox badge without a refresh', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'The phone tab bar has its own badge.');
    await page.goto('/dashboard/leads'); // opening the inbox marks everything seen
    await page.goto('/dashboard');
    const inbox = page.getByRole('link', { name: /Lead Inbox/ }).first();
    await expect(inbox).toBeVisible();
    await expect(inbox).not.toHaveText(/\d/);
    const last = `Live${runId}`;
    const res = await submitListingLead({
      venue_id: FLOW_VENUE.id, first_name: 'Morgan', last_name: last, email: `morgan.${last.toLowerCase()}@example.com`,
      phone: '(212) 555-0177', source: 'directory', client_ip: '203.0.113.8',
    });
    expect(res.status).toBe(201);
    await expect(inbox).toHaveText(/Lead Inbox\s*1\b/, { timeout: 20_000 });
  });
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
  await expect(guide.getByRole('button', { name: /^Done: Your listing is live/ })).toBeVisible();
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

  // The card is a drawer hanging from the top of the dashboard: open at first
  // on a wide screen, and one slim bar once they close it (progress,
  // Continue). It stays how they left it on this device; the bar opens it again.
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

  // Every step ticked (none of the rest really set up): at the next sign-in it
  // doesn't open, and the closed pill is there instead.
  const { error: ticked } = await db.from('venues').update({
    onboarding_steps_completed: ['listing', 'pricing_guide', 'lead_link', 'web_form', 'leadfinder', 'follow_up', 'grow'].map((s) => `guide:${s}`),
  }).eq('id', venueId);
  expect(ticked?.message ?? null).toBeNull();
  // Sign out (drop the venue session, keep the test copy's own gate cookie).
  for (const name of ['venue_id', 'venue_id_sig', 'venue_id_meta', 'member_id', 'member_id_sig', 'member_id_meta']) {
    await page.context().clearCookies({ name });
  }
  await signIn();
  const pill = page.getByTestId('setup-guide-pill');
  await expect(pill).toBeVisible({ timeout: 20_000 });
  await expect(pill).toContainText('left to set up');
  await page.waitForTimeout(5000);
  await expect(guide).toBeHidden();
  await expect(card).toHaveCount(0);

  // The pill opens it again, and it says why the reminder is still there.
  await pill.click();
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
