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

  if ('notification_phone' in out) {
    out.notification_phone = normalizeUsPhone(out.notification_phone);
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

/**
 * Autosave sends intermediate values while the venue owner is still typing
 * (e.g. "www.facebook.com/" before they paste the rest). We used to reject
 * anything without a leading http(s)://, which meant the server response
 * round-trip would overwrite the in-progress value with an empty string and
 * the text would disappear from the input. Now we preserve whatever the
 * author typed (trimmed, length-capped) and leave the "must start with http"
 * decision to the public page renderer.
 */
function sanitizeSocialLinks(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SOCIAL_KEYS.has(k)) continue;
    if (typeof v !== 'string') continue;
    const t = v.trim().slice(0, 500);
    if (!t) continue;
    out[k] = t;
  }
  return out;
}

/**
 * Preserve blank rows so clicking "Add FAQ item" (which inserts an empty
 * row the user then fills in) doesn't vanish on the next autosave.
 */
function sanitizeFaq(raw: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { question: string; answer: string }[] = [];
  for (const row of raw.slice(0, 20)) {
    if (!row || typeof row !== 'object') continue;
    const q = String((row as { question?: unknown }).question ?? '').slice(0, 500);
    const a = String((row as { answer?: unknown }).answer ?? '').slice(0, 8000);
    out.push({ question: q, answer: a });
  }
  return out;
}

/**
 * USA-only SaaS — store notification phones as "+1" followed by 0–10
 * digits. Autosave fires while the owner is still typing, so if we rejected
 * partial values here ("+16145" isn't a 10-digit US number yet) the server
 * round trip would wipe the input and make the field feel broken. We
 * preserve whatever digits were typed (dropping a leading "1" country
 * prefix and anything beyond 10 digits) so the value round-trips cleanly
 * from the first keystroke.
 *
 * Consumers that actually place a call/SMS should check that the stored
 * value has 10 trailing digits before trusting it.
 */
function normalizeUsPhone(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  let digits = s.replace(/\D+/g, '');
  if (digits.startsWith('1') && digits.length > 10) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (!digits) return null;
  return `+1${digits}`;
}
