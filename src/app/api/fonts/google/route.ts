import { type NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Full font catalog: set `GOOGLE_FONTS_API_KEY` (Web Fonts Developer API key from Google Cloud).
 * https://developers.google.com/fonts/docs/developer_api
 * Without a key, a curated fallback list is returned.
 */

/** Used when `GOOGLE_FONTS_API_KEY` is unset or the API fails. */
const POPULAR: string[] = [
  'ABeeZee',
  'Abel',
  'Abril Fatface',
  'Alegreya',
  'Alegreya Sans',
  'Alfa Slab One',
  'Amatic SC',
  'Anton',
  'Archivo',
  'Archivo Black',
  'Archivo Narrow',
  'Arimo',
  'Arvo',
  'Asap',
  'Barlow',
  'Barlow Condensed',
  'Be Vietnam Pro',
  'Bebas Neue',
  'Bitter',
  'Bodoni Moda',
  'Cabin',
  'Cairo',
  'Cardo',
  'Catamaran',
  'Caveat',
  'Chakra Petch',
  'Cormorant',
  'Cormorant Garamond',
  'Crimson Pro',
  'Crimson Text',
  'DM Sans',
  'DM Serif Display',
  'Dancing Script',
  'Domine',
  'EB Garamond',
  'Epilogue',
  'Exo',
  'Exo 2',
  'Fira Code',
  'Fira Sans',
  'Fjalla One',
  'Fraunces',
  'Fredoka',
  'Gelasio',
  'IBM Plex Mono',
  'IBM Plex Sans',
  'IBM Plex Serif',
  'Inconsolata',
  'Inter',
  'JetBrains Mono',
  'Josefin Sans',
  'Jost',
  'Kalam',
  'Karla',
  'Lato',
  'Lexend',
  'Libre Baskerville',
  'Libre Franklin',
  'Lilita One',
  'Lobster',
  'Lora',
  'Manrope',
  'Merriweather',
  'Merriweather Sans',
  'Montserrat',
  'Mukta',
  'Mulish',
  'Noto Sans',
  'Noto Serif',
  'Nunito',
  'Nunito Sans',
  'Open Sans',
  'Oswald',
  'Outfit',
  'Overpass',
  'Oxygen',
  'Pacifico',
  'Playfair Display',
  'Plus Jakarta Sans',
  'Poppins',
  'Prompt',
  'Public Sans',
  'Quicksand',
  'Raleway',
  'Red Hat Display',
  'Righteous',
  'Roboto',
  'Roboto Condensed',
  'Roboto Flex',
  'Roboto Mono',
  'Roboto Slab',
  'Rubik',
  'Saira',
  'Sarabun',
  'Signika',
  'Slabo 27px',
  'Source Code Pro',
  'Source Sans 3',
  'Source Serif 4',
  'Space Grotesk',
  'Space Mono',
  'Spectral',
  'Syne',
  'Tajawal',
  'Titillium Web',
  'Ubuntu',
  'Varela Round',
  'Work Sans',
  'Yanone Kaffeesatz',
  'Zilla Slab',
];

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const limit = Math.min(
    2000,
    Math.max(1, limitRaw ? Number.parseInt(limitRaw, 10) || 500 : 500)
  );

  const key = process.env.GOOGLE_FONTS_API_KEY;
  if (!key) {
    let list = POPULAR;
    if (q) list = list.filter((f) => f.toLowerCase().includes(q));
    return NextResponse.json({
      families: q ? list.slice(0, limit) : list,
      source: 'fallback' as const,
    });
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(key)}&sort=alpha`,
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) {
      let list = POPULAR;
      if (q) list = list.filter((f) => f.toLowerCase().includes(q));
      return NextResponse.json({
        families: q ? list.slice(0, limit) : list,
        warning: 'Google Fonts API error; using fallback list.',
        source: 'fallback' as const,
      });
    }
    const data = (await res.json()) as { items?: { family: string }[] };
    let families = (data.items ?? []).map((i) => i.family).filter(Boolean);
    if (!families.length) families = POPULAR;
    if (q) {
      families = families.filter((f) => f.toLowerCase().includes(q)).slice(0, limit);
    }
    return NextResponse.json({ families, source: 'google' as const });
  } catch {
    let list = POPULAR;
    if (q) list = list.filter((f) => f.toLowerCase().includes(q));
    return NextResponse.json({
      families: q ? list.slice(0, limit) : list,
      warning: 'Using fallback font list.',
      source: 'fallback' as const,
    });
  }
}
