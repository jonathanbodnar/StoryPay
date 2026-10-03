#!/usr/bin/env node
/**
 * Shoot the product on the test copy: sign in as the showcase venue's owner
 * (scripts/shots/seed-showcase.mjs builds it) and photograph each screen in
 * scripts/shots/pages.mjs at every device size, retina sharp.
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/shots/capture.mjs [name ...]
 *
 * Raw captures land in shots-out/raw plus shots-out/meta.json; then
 * `node scripts/shots/frame.mjs` draws them into device frames. Pass shot
 * names to reshoot only those. Test copy only, like every staging script.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { DEVICES, SHOTS, SHOWCASE_OWNER_EMAIL, urlFor } from './pages.mjs';

const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
const password = process.env.STAGING_PASSWORD || '';
if (process.env.APP_ENV !== 'staging' || !base || /storyvenue\.com/.test(base) || !password) {
  console.error('Screenshots are taken on the test copy only: railway run --environment Dev -- node scripts/shots/capture.mjs');
  process.exit(1);
}

const only = process.argv.slice(2);
const shots = only.length ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;
if (!shots.length) {
  console.error(`No such shot. Known: ${SHOTS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

// Live-updating screens keep their sockets open, so "networkidle" never
// comes; load + a settle pause is what the page sweep uses too.
const SETTLE_DEFAULT = 2500;

// No blinking carets or mid-animation UI in the pictures.
const CALM_CSS = `
  * { caret-color: transparent !important; }
  *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
`;

mkdirSync('shots-out/raw', { recursive: true });

const browser = await chromium.launch();

// One owner sign-in for the whole run (sign-in allows 5/min per account);
// every context reuses the session. The staging gate takes the key header.
const gate = { 'x-staging-key': password };
const signin = await browser.newContext({ baseURL: base, extraHTTPHeaders: gate });
const res = await signin.request.post('/api/auth/sign-in', { data: { email: SHOWCASE_OWNER_EMAIL, password } });
if (!res.ok()) throw new Error(`owner sign-in: ${res.status()} ${await res.text()} — run seed-showcase.mjs first`);
const ownerState = await signin.storageState();
await signin.close();

// Reshooting a few names keeps the rest of the run's records.
const meta = existsSync('shots-out/meta.json') ? JSON.parse(readFileSync('shots-out/meta.json', 'utf8')) : {};
let taken = 0;

for (const [deviceName, device] of Object.entries(DEVICES)) {
  const wanted = shots.filter((s) => (s.devices ?? ['desktop', 'phone']).includes(deviceName));
  if (!wanted.length) continue;
  const { frame, ...viewportConfig } = device;
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: viewportConfig.isMobile ?? false,
    hasTouch: viewportConfig.hasTouch ?? false,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    reducedMotion: 'reduce',
    extraHTTPHeaders: gate,
  });
  for (const shot of wanted) {
    const page = await context.newPage();
    if (shot.who === 'owner') await context.addCookies(ownerState.cookies);
    await page.goto(urlFor(shot), { waitUntil: 'load', timeout: 60_000 });
    await page.addStyleTag({ content: CALM_CSS });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(shot.settleMs ?? SETTLE_DEFAULT);
    if (shot.click) {
      await page.locator(shot.click).first().click();
      await page.waitForTimeout(shot.settleMs ?? SETTLE_DEFAULT);
    }
    // The "Add to Home Screen" nudge is real product UI, but it covers the
    // screen being photographed.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('div, aside')) {
        if (el.childElementCount && el.textContent?.includes('Add to Home Screen') && getComputedStyle(el).position === 'fixed') el.remove();
      }
    });
    const file = `${shot.name}__${deviceName}.png`;
    await page.screenshot({ path: `shots-out/raw/${file}` });
    meta[file] = { shot: shot.name, device: deviceName, frame, width: device.width, height: device.height, dsf: device.deviceScaleFactor };
    taken++;
    if (shot.alsoFullPage) {
      await page.screenshot({ path: `shots-out/raw/${shot.name}__${deviceName}--full.png`, fullPage: true });
      taken++;
    }
    console.log(`shot ${shot.name} on ${deviceName}`);
    await page.close();
  }
  await context.close();
}

await browser.close();
writeFileSync('shots-out/meta.json', JSON.stringify(meta, null, 1));
console.log(`\n${taken} captures in shots-out/raw. Now: node scripts/shots/frame.mjs`);
