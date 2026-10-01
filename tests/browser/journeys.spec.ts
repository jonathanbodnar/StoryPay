import { expect, request, test, type Page } from '@playwright/test';
import { env, FLOW_VENUE, runId } from '../flows/helpers';

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
  const { public_token: token } = (await res.json()) as { public_token: string };
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
});
