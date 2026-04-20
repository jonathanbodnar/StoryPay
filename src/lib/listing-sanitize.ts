import type { ListingWritableField } from '@/lib/directory';

const SOCIAL_KEYS = new Set(['facebook', 'instagram', 'tiktok', 'pinterest', 'website']);

/**
 * Normalize PATCH body fragments for venues listing before Supabase update.
 */
export function sanitizeListingUpdates(
  updates: Partial<Record<ListingWritableField, unknown>>,
): Partial<Record<ListingWritableField, unknown>> {
  const out: Partial<Record<ListingWritableField, unknown>> = { ...updates };

  if ('lat' in out) {
    out.lat = parseCoord(out.lat, 'lat');
  }
  if ('lng' in out) {
    out.lng = parseCoord(out.lng, 'lng');
  }

  if ('show_map' in out) {
    out.show_map = Boolean(out.show_map);
  }

  if ('social_links' in out) {
    out.social_links = sanitizeSocialLinks(out.social_links);
  }

  if ('faq' in out) {
    out.faq = sanitizeFaq(out.faq);
  }

  return out;
}

function parseCoord(v: unknown, kind: 'lat' | 'lng'): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  if (Number.isNaN(n)) return null;
  if (kind === 'lat' && (n < -90 || n > 90)) return null;
  if (kind === 'lng' && (n < -180 || n > 180)) return null;
  return n;
}

function sanitizeSocialLinks(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SOCIAL_KEYS.has(k)) continue;
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t || t.length > 500) continue;
    if (!/^https?:\/\//i.test(t)) continue;
    out[k] = t;
  }
  return out;
}

function sanitizeFaq(raw: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { question: string; answer: string }[] = [];
  for (const row of raw.slice(0, 20)) {
    if (!row || typeof row !== 'object') continue;
    const q = String((row as { question?: unknown }).question ?? '').trim().slice(0, 500);
    const a = String((row as { answer?: unknown }).answer ?? '').trim().slice(0, 8000);
    if (!q && !a) continue;
    out.push({ question: q, answer: a });
  }
  return out;
}
