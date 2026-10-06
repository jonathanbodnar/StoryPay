#!/usr/bin/env node
/**
 * The Setup Guide's lesson covers (public/setup-guide/<lesson>.webp): the part
 * of each screen that the lesson teaches, cut from the kit's captures of the
 * showcase venue. Run after capture.mjs, then commit the covers:
 *
 *   node scripts/shots/export-guide-covers.mjs
 *
 * Each crop is 16:10 of a 3200x2000 capture, chosen to leave out the app's
 * sidebar so the screen itself is readable at cover size.
 */

import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

/** lesson id (src/lib/setup-guide.ts) → capture and the region to keep. */
const COVERS = {
  // The dashboard's booking funnel: the whole system on one screen.
  // (Narrow enough to stop above the live-visitor map, which is blank on the test copy.)
  walkthrough: ['home__desktop.png', { left: 560, top: 0, width: 2100 }],
  listing: ['listing__desktop.png', { left: 320, top: 0, width: 2560 }],
  pricing_guide: ['guide-pricing__desktop.png', { left: 540, top: 150, width: 2560 }],
  // Without the phone preview: it frames the live directory, which has never heard of the test venue.
  lead_link: ['guide-lead-link__desktop.png', { left: 560, top: 200, width: 1840 }],
  // The Web Form page: the code to copy, how to add it, and the form itself.
  web_form: ['guide-web-form__desktop.png', { left: 600, top: 420, width: 2520 }],
  // The Lead Finder page's card: the address to hand out and how to connect it.
  leadfinder: ['guide-leadfinder__desktop.png', { left: 600, top: 440, width: 2480 }],
  follow_up: ['guide-follow-up__desktop.png', { left: 900, top: 150, width: 1920 }],
  payments: ['guide-payments__desktop.png', { left: 540, top: 110, width: 2560 }],
  grow: ['calendar__desktop.png', { left: 540, top: 110, width: 2560 }],
};

mkdirSync('public/setup-guide', { recursive: true });
for (const [id, [file, region]] of Object.entries(COVERS)) {
  const info = await sharp(`shots-out/raw/${file}`)
    .extract({ ...region, height: Math.round(region.width * 0.625) })
    .resize({ width: 1280, height: 800 })
    .webp({ quality: 82 })
    .toFile(`public/setup-guide/${id}.webp`);
  console.log(`${id}.webp  ${info.width}x${info.height}  ${Math.round(info.size / 1024)}kb`);
}
