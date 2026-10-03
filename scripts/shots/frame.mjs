#!/usr/bin/env node
/**
 * Draw the raw captures into device frames: a browser window, a laptop, a
 * tablet and a phone (with status bar and dynamic island). Runs on the
 * machine alone — no settings needed:
 *
 *   node scripts/shots/frame.mjs [name ...]
 *
 * Reads shots-out/raw + shots-out/meta.json (from capture.mjs) and writes
 * shots-out/framed/<shot>__<device>.png (transparent) and .webp.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const meta = JSON.parse(readFileSync('shots-out/meta.json', 'utf8'));
const only = process.argv.slice(2);
mkdirSync('shots-out/framed', { recursive: true });

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;

/** The capture with its corners rounded (so it sits in a frame's screen). */
async function roundedShot(file, radius) {
  const img = sharp(`shots-out/raw/${file}`);
  const { width, height } = await img.metadata();
  const mask = svg(width, height, `<rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/>`);
  return { buf: await img.composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer(), width, height };
}

/** The capture with only its bottom corners rounded (its top meets the status bar). */
async function bottomRoundedShot(file, radius) {
  const img = sharp(`shots-out/raw/${file}`);
  const { width, height } = await img.metadata();
  const mask = svg(width, height, `<rect y="${-radius}" width="${width}" height="${height + radius}" rx="${radius}" fill="#fff"/>`);
  return { buf: await img.composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer(), width, height };
}

/** The page's own top color — the phone's drawn status bar matches it, like the app. */
async function topColor(file) {
  const { channels } = await sharp(`shots-out/raw/${file}`).extract({ left: 0, top: 0, width: 400, height: 10 }).stats();
  const [r, g, b] = channels.map((c) => Math.round(c.mean));
  return { fill: `rgb(${r},${g},${b})`, dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 140 };
}

/** A soft drop shadow under a rounded body. */
async function shadow(w, h, radius, blur, canvasW, canvasH, x, y) {
  const rect = await sharp(svg(canvasW, canvasH,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="#000" fill-opacity="0.30"/>`)).png().toBuffer();
  return sharp(rect).blur(blur).toBuffer();
}

/** Assemble margin + shadow + body + screenshot (+ overlay) and write both files. */
async function compose({ out, bodyW, bodyH, margin, bodySvgAt, shotBuf, shotX, shotY, overlaySvg, shadowRadius, s }) {
  const canvasW = bodyW + margin * 2;
  const canvasH = bodyH + margin * 2;
  const layers = [
    { input: await shadow(bodyW, bodyH, shadowRadius, 22 * s, canvasW, canvasH, margin, margin + 16 * s), left: 0, top: 0 },
    { input: await sharp(bodySvgAt).png().toBuffer(), left: margin, top: margin },
    { input: shotBuf, left: margin + shotX, top: margin + shotY },
  ];
  if (overlaySvg) layers.push({ input: await sharp(overlaySvg).png().toBuffer(), left: margin, top: margin });
  const img = sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers);
  await img.clone().png().toFile(`shots-out/framed/${out}.png`);
  await img.webp({ quality: 88 }).toFile(`shots-out/framed/${out}.webp`);
}

const FRAMES = {
  /** A clean browser window: traffic lights, an address pill, the page. */
  async browser(file, m) {
    const s = m.dsf;
    const bar = 48 * s;
    const { buf, width: w, height: h } = await roundedShot(file, 0);
    const bodyW = w + 2 * s;
    const bodyH = h + bar + 2 * s;
    const r = 12 * s;
    const pillW = Math.min(560 * s, Math.round(w * 0.4));
    const body = svg(bodyW, bodyH, `
      <rect width="${bodyW}" height="${bodyH}" rx="${r}" fill="#d8d5cf"/>
      <rect x="${s}" y="${s}" width="${w}" height="${h + bar}" rx="${r - s}" fill="#f3f1ee"/>
      <circle cx="${26 * s}" cy="${bar / 2 + s}" r="${6.5 * s}" fill="#ff5f57"/>
      <circle cx="${48 * s}" cy="${bar / 2 + s}" r="${6.5 * s}" fill="#febc2e"/>
      <circle cx="${70 * s}" cy="${bar / 2 + s}" r="${6.5 * s}" fill="#28c840"/>
      <rect x="${(bodyW - pillW) / 2}" y="${s + 10 * s}" width="${pillW}" height="${28 * s}" rx="${14 * s}" fill="#e7e4df"/>
      <text x="${bodyW / 2}" y="${s + 10 * s + 19 * s}" text-anchor="middle" ${FONT} font-size="${13 * s}" fill="#6f6b64">app.storyvenue.com</text>
    `);
    await compose({ out: file.replace('.png', ''), bodyW, bodyH, margin: 72 * s, bodySvgAt: body, shotBuf: buf, shotX: s, shotY: bar + s, shadowRadius: r, s });
  },

  /** A laptop: dark screen bezel on an aluminum deck. */
  async laptop(file, m) {
    const s = m.dsf;
    const { buf, width: w, height: h } = await roundedShot(file, 6 * s);
    const bez = 22 * s;
    const lidW = w + bez * 2;
    const lidH = h + bez * 2;
    const deckH = 36 * s;
    const deckW = Math.round(lidW * 1.16);
    const bodyW = deckW;
    const bodyH = lidH + deckH;
    const lidX = Math.round((deckW - lidW) / 2);
    const body = svg(bodyW, bodyH, `
      <rect x="${lidX}" y="0" width="${lidW}" height="${lidH + 10 * s}" rx="${26 * s}" fill="#101113"/>
      <circle cx="${bodyW / 2}" cy="${bez / 2}" r="${3.2 * s}" fill="#2c2d30"/>
      <defs><linearGradient id="deck" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e3e4e6"/><stop offset="1" stop-color="#aeb0b5"/>
      </linearGradient></defs>
      <rect x="0" y="${lidH}" width="${deckW}" height="${deckH}" rx="${14 * s}" fill="url(#deck)"/>
      <rect x="${(bodyW - 170 * s) / 2}" y="${lidH}" width="${170 * s}" height="${11 * s}" rx="${6 * s}" fill="#c6c8cc"/>
    `);
    await compose({ out: file.replace('.png', ''), bodyW, bodyH, margin: 80 * s, bodySvgAt: body, shotBuf: buf, shotX: lidX + bez, shotY: bez, shadowRadius: 20 * s, s });
  },

  /** A tablet: slim dark bezel, camera on the top edge. */
  async tablet(file, m) {
    const s = m.dsf;
    const { buf, width: w, height: h } = await roundedShot(file, 14 * s);
    const bez = 34 * s;
    const bodyW = w + bez * 2;
    const bodyH = h + bez * 2;
    const body = svg(bodyW, bodyH, `
      <rect width="${bodyW}" height="${bodyH}" rx="${38 * s}" fill="#17181b"/>
      <rect x="${3 * s}" y="${3 * s}" width="${bodyW - 6 * s}" height="${bodyH - 6 * s}" rx="${35 * s}" fill="#0c0d0f"/>
      <circle cx="${bodyW / 2}" cy="${bez / 2}" r="${4 * s}" fill="#2e3033"/>
    `);
    await compose({ out: file.replace('.png', ''), bodyW, bodyH, margin: 70 * s, bodySvgAt: body, shotBuf: buf, shotX: bez, shotY: bez, shadowRadius: 38 * s, s });
  },

  /** A phone: rounded body, side buttons, dynamic island, and an opaque
   *  status bar in the page's own top color — so a web capture sits under
   *  the island exactly the way the native app does. */
  async phone(file, m) {
    const s = m.dsf;
    const strip = 48 * s; // the drawn status bar above the capture
    const { buf, width: w, height: h } = await bottomRoundedShot(file, 44 * s);
    const bez = 14 * s;
    const nub = 4 * s;
    const bodyW = w + bez * 2 + nub * 2;
    const bodyH = h + strip + bez * 2;
    const bx = nub; // body starts after the button nubs
    const { fill, dark } = await topColor(file);
    const ink = dark ? '#ffffff' : '#0a0a0c';
    const screenX = bx + bez;
    const islandW = 122 * s;
    const islandX = bodyW / 2 - islandW / 2;
    const sy = bez + strip / 2 + 2 * s; // glyph center line on the status bar
    const batX = bodyW - bez - nub - 40 * s;
    const body = svg(bodyW, bodyH, `
      <rect x="${bx}" y="0" width="${bodyW - nub * 2}" height="${bodyH}" rx="${58 * s}" fill="#17181b"/>
      <rect x="${bx + 3 * s}" y="${3 * s}" width="${bodyW - nub * 2 - 6 * s}" height="${bodyH - 6 * s}" rx="${55 * s}" fill="#050506"/>
      <rect x="${screenX}" y="${bez}" width="${w}" height="${strip + 50 * s}" rx="${44 * s}" fill="${fill}"/>
    `);
    const overlay = svg(bodyW, bodyH, `
      <rect x="0" y="${170 * s}" width="${nub}" height="${34 * s}" rx="${2 * s}" fill="#0d0d10"/>
      <rect x="0" y="${224 * s}" width="${nub}" height="${56 * s}" rx="${2 * s}" fill="#0d0d10"/>
      <rect x="0" y="${296 * s}" width="${nub}" height="${56 * s}" rx="${2 * s}" fill="#0d0d10"/>
      <rect x="${bodyW - nub}" y="${240 * s}" width="${nub}" height="${86 * s}" rx="${2 * s}" fill="#0d0d10"/>
      <text x="${screenX + 36 * s}" y="${sy + 6 * s}" ${FONT} font-size="${16 * s}" font-weight="600" fill="${ink}">9:41</text>
      <g fill="${ink}">
        <rect x="${batX - 44 * s}" y="${sy - 4 * s}" width="${3 * s}" height="${4.5 * s}" rx="${1 * s}"/>
        <rect x="${batX - 39.5 * s}" y="${sy - 6 * s}" width="${3 * s}" height="${6.5 * s}" rx="${1 * s}"/>
        <rect x="${batX - 35 * s}" y="${sy - 8 * s}" width="${3 * s}" height="${8.5 * s}" rx="${1 * s}"/>
        <rect x="${batX - 30.5 * s}" y="${sy - 10 * s}" width="${3 * s}" height="${10.5 * s}" rx="${1 * s}"/>
      </g>
      <g stroke="${ink}" stroke-width="${2.2 * s}" fill="none" stroke-linecap="round">
        <path d="M ${batX - 21 * s} ${sy - 3 * s} a ${6 * s} ${6 * s} 0 0 1 8.4 0"/>
        <path d="M ${batX - 24 * s} ${sy - 6.4 * s} a ${10.4 * s} ${10.4 * s} 0 0 1 14.4 0"/>
      </g>
      <circle cx="${batX - 16.8 * s}" cy="${sy}" r="${1.4 * s}" fill="${ink}"/>
      <rect x="${batX}" y="${sy - 5.5 * s}" width="${24 * s}" height="${11.5 * s}" rx="${3.5 * s}" stroke="${ink}" stroke-opacity="0.45" stroke-width="${1.2 * s}" fill="none"/>
      <rect x="${batX + 2 * s}" y="${sy - 3.5 * s}" width="${16 * s}" height="${7.5 * s}" rx="${1.8 * s}" fill="${ink}"/>
      <rect x="${batX + 25.4 * s}" y="${sy - 1.8 * s}" width="${1.6 * s}" height="${3.6 * s}" rx="${0.8 * s}" fill="${ink}" fill-opacity="0.5"/>
      <rect x="${islandX}" y="${bez + 10 * s}" width="${islandW}" height="${34 * s}" rx="${17 * s}" fill="#000"/>
    `);
    await compose({ out: file.replace('.png', ''), bodyW, bodyH, margin: 60 * s, bodySvgAt: body, shotBuf: buf, shotX: screenX, shotY: bez + strip, overlaySvg: overlay, shadowRadius: 58 * s, s });
  },
};

let framed = 0;
for (const [file, m] of Object.entries(meta)) {
  if (only.length && !only.includes(m.shot)) continue;
  await FRAMES[m.frame](file, m);
  framed++;
  console.log(`framed ${file} as ${m.frame}`);
}
console.log(`\n${framed} framed images in shots-out/framed (png + webp).`);
