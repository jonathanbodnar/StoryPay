/**
 * Load Google Fonts as ttf/otf ArrayBuffers for next/og ImageResponse.
 *
 * next/og (Satori) cannot use woff2, so we hit the css2 endpoint with an old
 * User-Agent that makes Google serve a truetype `src` url, then fetch the file.
 * Results are cached in-module for the life of the server process.
 */

export interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: number;
  style: 'normal';
}

const cache = new Map<string, ArrayBuffer | null>();

async function fetchFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
    const css = await fetch(cssUrl, {
      headers: {
        // Old UA → Google returns a truetype src url (Satori-compatible).
        'User-Agent':
          'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-us) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1',
      },
    }).then((r) => (r.ok ? r.text() : ''));

    if (!css) { cache.set(key, null); return null; }

    // Prefer a truetype/opentype src; fall back to the first url found.
    const matches = [...css.matchAll(/src:\s*url\(([^)]+)\)\s*format\('([^']+)'\)/g)];
    let fontUrl =
      matches.find((m) => /truetype|opentype/.test(m[2]))?.[1] ||
      matches[0]?.[1] ||
      css.match(/url\((https:[^)]+\.(?:ttf|otf))\)/)?.[1] ||
      null;

    if (!fontUrl) { cache.set(key, null); return null; }
    fontUrl = fontUrl.replace(/^['"]|['"]$/g, '');

    const buf = await fetch(fontUrl).then((r) => (r.ok ? r.arrayBuffer() : null));
    cache.set(key, buf);
    return buf;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/**
 * Returns the font set for the ad templates: Playfair Display (serif headline)
 * + Montserrat (sans body). Any font that fails to load is simply omitted, and
 * ImageResponse falls back to its default sans-serif.
 */
export async function loadAdFonts(): Promise<LoadedFont[]> {
  const specs: { family: string; name: string; weight: number }[] = [
    { family: 'Playfair Display', name: 'Playfair Display', weight: 700 },
    { family: 'Montserrat', name: 'Montserrat', weight: 400 },
    { family: 'Montserrat', name: 'Montserrat', weight: 600 },
    { family: 'Montserrat', name: 'Montserrat', weight: 700 },
  ];

  const loaded = await Promise.all(
    specs.map(async (s) => {
      const data = await fetchFont(s.family, s.weight);
      return data ? { name: s.name, data, weight: s.weight, style: 'normal' as const } : null;
    }),
  );

  return loaded.filter((f): f is LoadedFont => f !== null);
}
