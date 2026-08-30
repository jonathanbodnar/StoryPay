/**
 * Fetch + normalize venue photos for compositing into ad templates.
 *
 * Every photo is EXIF-rotated (fixes sideways iPhone JPGs), cover-cropped to
 * the exact slot dimensions and re-encoded as a compact JPEG data URI so
 * Satori (next/og) embeds it deterministically without a network fetch.
 */

import sharp from 'sharp';

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/** Cover-crop a photo to w×h and return a JPEG data URI (or null on failure). */
export async function prepareCover(url: string, w: number, h: number): Promise<string | null> {
  const buf = await fetchBuffer(url);
  if (!buf) return null;
  try {
    const out = await sharp(buf)
      .rotate() // apply EXIF orientation
      .resize(w, h, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch {
    return null;
  }
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
