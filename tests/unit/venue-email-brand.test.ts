import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

// The logo check downloads the venue's logo; here the download is stubbed with
// generated images, and the database with a fixed venue row.
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/safe-outbound-fetch', () => ({ safeFetch: fetchMock }));
const venueRow = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: venueRow.current }) }) }) }) },
}));

import { loadVenueEmailBrand, resolveVenueEmailBrand } from '@/lib/venue-email-brand';

let n = 0;
const url = () => `https://cdn.example.com/logo-${++n}.img`;
const served = (body: Buffer, status = 200, truncated = false) =>
  fetchMock.mockResolvedValueOnce({ status, contentType: 'image/png', body, truncated, finalUrl: '' });

async function logoPng(w: number, h: number, opts: { background: string; ink: string; inkShare: number; format?: 'png' | 'jpeg' | 'webp' }) {
  const inkW = Math.max(1, Math.round(w * opts.inkShare));
  const ink = await sharp({ create: { width: inkW, height: h, channels: 4, background: opts.ink } }).png().toBuffer();
  const img = sharp({ create: { width: w, height: h, channels: 4, background: opts.background } }).composite([{ input: ink, left: 0, top: 0 }]);
  return opts.format === 'jpeg' ? img.jpeg().toBuffer() : opts.format === 'webp' ? img.webp().toBuffer() : img.png().toBuffer();
}

beforeEach(() => fetchMock.mockReset());

describe('venue logo in emails', () => {
  it('uses a dark logo, sized to fit 200×64', async () => {
    served(await logoPng(300, 100, { background: '#ffffff00', ink: '#222222ff', inkShare: 0.3 }));
    const u = url();
    expect(await resolveVenueEmailBrand('Sunset Hill', u)).toEqual({ name: 'Sunset Hill', logo: { url: u, width: 192, height: 64 } });
  });

  it('keeps a square logo square and never enlarges a small one', async () => {
    served(await logoPng(1200, 1200, { background: '#ffffff', ink: '#000000', inkShare: 0.5, format: 'jpeg' }));
    expect((await resolveVenueEmailBrand('A', url())).logo).toMatchObject({ width: 64, height: 64 });
    served(await logoPng(100, 40, { background: '#ffffff', ink: '#000000', inkShare: 0.5 }));
    expect((await resolveVenueEmailBrand('B', url())).logo).toMatchObject({ width: 100, height: 40 });
  });

  it('falls back to the name for a white logo that would vanish on white', async () => {
    served(await logoPng(300, 100, { background: '#ffffff00', ink: '#ffffffff', inkShare: 0.6 }));
    expect(await resolveVenueEmailBrand('Rose Barn', url())).toEqual({ name: 'Rose Barn', logo: null });
  });

  it('falls back to the name for formats Gmail or Outlook can’t show', async () => {
    served(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="200" height="50" fill="#000"/></svg>'));
    expect((await resolveVenueEmailBrand('A', url())).logo).toBeNull();
    served(await logoPng(300, 100, { background: '#ffffff', ink: '#000000', inkShare: 0.5, format: 'webp' }));
    expect((await resolveVenueEmailBrand('A', url())).logo).toBeNull();
  });

  it('falls back to the name when the logo can’t be downloaded', async () => {
    served(Buffer.alloc(0), 404);
    expect((await resolveVenueEmailBrand('A', url())).logo).toBeNull();
    served(Buffer.alloc(10), 200, true);
    expect((await resolveVenueEmailBrand('A', url())).logo).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect((await resolveVenueEmailBrand('A', url())).logo).toBeNull();
    served(Buffer.from('not an image'));
    expect((await resolveVenueEmailBrand('A', url())).logo).toBeNull();
  });

  it('checks each logo once', async () => {
    served(await logoPng(300, 100, { background: '#ffffff', ink: '#000000', inkShare: 0.5 }));
    const u = url();
    await resolveVenueEmailBrand('A', u);
    await resolveVenueEmailBrand('A', u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('needs no download without a logo, and names a nameless venue', async () => {
    expect(await resolveVenueEmailBrand('  ', null)).toEqual({ name: 'Your Venue', logo: null });
    expect(await resolveVenueEmailBrand('A', 'not-a-url')).toEqual({ name: 'A', logo: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the branding-page logo over the older one', async () => {
    served(await logoPng(300, 100, { background: '#ffffff', ink: '#000000', inkShare: 0.5 }));
    venueRow.current = { name: 'Sunset Hill', brand_logo_url: 'https://cdn.example.com/brand.png', logo_url: 'https://cdn.example.com/old.png' };
    const brand = await loadVenueEmailBrand('venue-1');
    expect(brand.logo?.url).toBe('https://cdn.example.com/brand.png');
    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/brand.png');
  });
});
