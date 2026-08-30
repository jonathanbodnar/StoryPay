/**
 * Rasterize an ad template to a PNG buffer with next/og (Satori + resvg).
 * Fonts are loaded once per process; a failed font simply falls back to
 * ImageResponse's default sans.
 */

import { ImageResponse } from 'next/og';
import { AD_WIDTH, AD_HEIGHT, type TemplateKey } from './spec';
import { loadAdFonts, type LoadedFont } from './fonts';
import { adTemplateElement, type TemplateProps } from './templates';

let fontsPromise: Promise<LoadedFont[]> | null = null;
function getFonts(): Promise<LoadedFont[]> {
  if (!fontsPromise) fontsPromise = loadAdFonts();
  return fontsPromise;
}

export async function renderAdCreative(key: TemplateKey, props: TemplateProps): Promise<Buffer> {
  const fonts = await getFonts();
  const res = new ImageResponse(adTemplateElement(key, props), {
    width: AD_WIDTH,
    height: AD_HEIGHT,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight as 400 | 600 | 700, style: f.style })),
  });
  return Buffer.from(await res.arrayBuffer());
}
