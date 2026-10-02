import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, request, type FullConfig } from '@playwright/test';
import { coupleSession, ensureFlowVenue, ensureSuperAdmin, env, FLOW_VENUE, SUPER_ADMIN_EMAIL, venueRecordIds } from '../flows/helpers';

// Get past the test copy's password page the way a person does (this is also
// the check that it lands back on the site), and keep that cookie for the tests.
export default async function globalSetup(config: FullConfig): Promise<void> {
  await ensureFlowVenue();
  mkdirSync('tests/browser/.auth', { recursive: true });
  const baseURL = config.projects[0].use.baseURL!;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.waitForURL(/\/staging-access/);
  await page.locator('input[name="password"]').fill(process.env.STAGING_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.waitForURL(new RegExp(`^${baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/login`));
  const staging = await page.context().storageState({ path: 'tests/browser/.auth/staging.json' });
  await browser.close();

  // The flow venue's owner, signed in once (sign-in allows 5 tries a minute).
  const api = await request.newContext({ baseURL, storageState: 'tests/browser/.auth/staging.json' });
  // Quiet mode: no email leaves the test copy while the tests run.
  const quietRes = await api.post('/api/staging/outbox', { data: { quietMinutes: 60 } });
  if (!quietRes.ok()) throw new Error(`quiet mode: ${quietRes.status()}`);
  const res = await api.post('/api/auth/sign-in', { data: { email: FLOW_VENUE.email, password: env.password } });
  if (!res.ok()) throw new Error(`owner sign-in: ${res.status()} ${await res.text()}`);
  await api.storageState({ path: 'tests/browser/.auth/owner.json' });
  await api.dispose();

  // A StoryVenue super admin.
  await ensureSuperAdmin();
  const admin = await request.newContext({ baseURL, storageState: 'tests/browser/.auth/staging.json' });
  const adminRes = await admin.post('/api/admin/login', { data: { email: SUPER_ADMIN_EMAIL, password: env.password } });
  if (!adminRes.ok()) throw new Error(`admin sign-in: ${adminRes.status()} ${await adminRes.text()}`);
  await admin.storageState({ path: 'tests/browser/.auth/admin.json' });
  await admin.dispose();

  // A couple: the planner keeps its session in the browser's storage.
  const session = await coupleSession();
  const ref = new URL(env.supabaseUrl).hostname.split('.')[0];
  writeFileSync('tests/browser/.auth/couple.json', JSON.stringify({
    cookies: staging.cookies,
    origins: [{ origin: baseURL, localStorage: [{ name: `sb-${ref}-auth-token`, value: JSON.stringify(session) }] }],
  }));

  // Real records for pages with an id in the address.
  writeFileSync('tests/browser/.auth/records.json', JSON.stringify(await venueRecordIds(FLOW_VENUE.id)));
}
