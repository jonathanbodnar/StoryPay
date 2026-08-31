/**
 * Fetch + normalize venue photos for compositing into ad templates.
 *
 * Every photo is EXIF-rotated (fixes sideways iPhone JPGs), cover-cropped to
 * the exact slot dimensions and re-encoded as a compact JPEG data URI so
 * Satori (next/og) embeds it deterministically without a network fetch.
 */

import sharp from 'sharp';

export async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

const fetchBuffer = fetchImageBuffer;

/**
 * Cover-crop an already-decoded buffer to w×h (JPEG data URI, or null).
 * Lets a caller fetch each source image ONCE and crop it into many slots
 * without re-downloading — critical for generating a 6-creative batch fast.
 */
export async function prepareCoverFromBuffer(buf: Buffer, w: number, h: number): Promise<string | null> {
  try {
    const out = await sharp(buf)
      .rotate() // apply EXIF orientation
      .resize(w, h, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Cover-crop a photo to w×h and return a JPEG data URI (or null on failure).
 *
 * Uses sharp's "attention" strategy, which crops toward the most salient region
 * (faces, high-contrast subjects) instead of a blind center crop — so brides,
 * couples and building facades stay in frame instead of getting decapitated.
 */
export async function prepareCover(url: string, w: number, h: number): Promise<string | null> {
  const buf = await fetchBuffer(url);
  if (!buf) return null;
  return prepareCoverFromBuffer(buf, w, h);
}

/** Contain-fit a logo within maxW×maxH, preserving transparency (PNG data URI). */
export async function prepareLogo(url: string, maxW: number, maxH: number): Promise<string | null> {
  const buf = await fetchBuffer(url);
  if (!buf) return null;
  try {
    const out = await sharp(buf)
      .rotate()
      .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
}
