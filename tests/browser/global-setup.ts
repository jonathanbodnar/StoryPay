import { chromium, request, type FullConfig } from '@playwright/test';
import { ensureFlowVenue, env, FLOW_VENUE } from '../flows/helpers';

// Get past the test copy's password page the way a person does (this is also
// the check that it lands back on the site), and keep that cookie for the tests.
export default async function globalSetup(config: FullConfig): Promise<void> {
  await ensureFlowVenue();
  const baseURL = config.projects[0].use.baseURL!;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.waitForURL(/\/staging-access/);
  await page.locator('input[name="password"]').fill(process.env.STAGING_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(new RegExp(`^${baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/login`));
  await page.context().storageState({ path: 'tests/browser/.auth/staging.json' });
  await browser.close();

  // The flow venue's owner, signed in once (sign-in allows 5 tries a minute).
  const api = await request.newContext({ baseURL, storageState: 'tests/browser/.auth/staging.json' });
  const res = await api.post('/api/auth/sign-in', { data: { email: FLOW_VENUE.email, password: env.password } });
  if (!res.ok()) throw new Error(`owner sign-in: ${res.status()} ${await res.text()}`);
  await api.storageState({ path: 'tests/browser/.auth/owner.json' });
  await api.dispose();
}
