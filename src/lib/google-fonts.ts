import type { MarketingFormDefinition } from '@/lib/marketing-form-schema';

/** Collect unique Google Font family names from theme + block styles. */
export function collectGoogleFontFamiliesFromDefinition(
  def: MarketingFormDefinition
): string[] {
  const out: string[] = [];
  const t = extractGoogleFontName(def.theme?.fontFamily);
  if (t) out.push(t);
  for (const b of def.blocks) {
    const f = extractGoogleFontName(b.style?.fontFamily);
    if (f) out.push(f);
  }
  return [...new Set(out)];
}

/** First font family from a CSS `font-family` stack, if it looks like a named webfont. */
export function extractGoogleFontName(css: string | undefined): string | null {
  if (!css?.trim()) return null;
  const first = css.split(',')[0]?.trim() ?? '';
  const name = first.replace(/^["']|["']$/g, '').trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  if (
    lower.includes('system-ui') ||
    lower.includes('ui-sans') ||
    lower.includes('sans-serif') ||
    lower.includes('serif') ||
    lower.includes('monospace') ||
    lower === 'inherit' ||
    lower === 'initial'
  ) {
    return null;
  }
  return name;
}

/** Build a Google Fonts CSS2 URL for the given family names (weights 400–700). */
export function googleFontsStylesheetHref(families: string[]): string | null {
  const uniq = [...new Set(families.map((f) => f.trim()).filter(Boolean))];
  if (uniq.length === 0) return null;
  const qs = uniq
    .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${qs}&display=swap`;
}
