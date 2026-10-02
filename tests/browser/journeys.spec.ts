import { expect, request, test, type Page } from '@playwright/test';
import { env, FLOW_VENUE, runId, submitListingLead } from '../flows/helpers';

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
