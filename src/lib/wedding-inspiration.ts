/**
 * Wedding "Inspiration board" — shared types + tolerant-reader sanitizer.
 *
 * The board is a single document stored on couple_weddings.inspiration that BOTH
 * the couple and the venue can curate (mirrors the room-layout / timeline
 * pattern). Each item is just a reference — an image URL to display plus an
 * optional click-through link — so we never host image bytes, only URLs. A `rev`
 * token powers the same optimistic-concurrency check the other shared docs use.
 */

export const INSPIRATION_TYPES = ['pin', 'image', 'link'] as const;
export type InspirationType = (typeof INSPIRATION_TYPES)[number];

export const INSPIRATION_SOURCES = ['pinterest', 'manual'] as const;
export type InspirationSource = (typeof INSPIRATION_SOURCES)[number];

export interface InspirationItem {
  id: string;
  type: InspirationType;
  /** Image to render (Pinterest CDN, og:image, or a direct image URL). */
  imageUrl: string | null;
  /** Optional click-through (the Pin, the source article, etc.). */
  linkUrl: string | null;
  title: string | null;
  note: string | null;
  source: InspirationSource;
}

export interface WeddingInspiration {
  rev: number;
  items: InspirationItem[];
}

export const EMPTY_INSPIRATION: WeddingInspiration = { rev: 0, items: [] };

const MAX_ITEMS = 300;
const TYPE_SET: ReadonlySet<string> = new Set(INSPIRATION_TYPES);
const SOURCE_SET: ReadonlySet<string> = new Set(INSPIRATION_SOURCES);

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `insp_${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
  return newId();
}

/** Accept only http(s) URLs, capped in length; anything else becomes null. */
export function safeHttpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

/**
 * Normalize an arbitrary value into a safe WeddingInspiration. Items without any
 * usable image or link are dropped, URLs are validated, text is trimmed/capped,
 * the item count is capped, and `rev` is coerced to a non-negative integer.
 * Curated order is preserved (no sorting).
 */
export function sanitizeInspiration(raw: unknown): WeddingInspiration {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_INSPIRATION, items: [] };
  const obj = raw as { rev?: unknown; items?: unknown };

  const rev = Math.max(0, Math.round(num(obj.rev, 0, 0, Number.MAX_SAFE_INTEGER)));
  const src = Array.isArray(obj.items) ? obj.items : [];
  const out: InspirationItem[] = [];

  for (const row of src.slice(0, MAX_ITEMS)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const imageUrl = safeHttpUrl(r.imageUrl);
    const linkUrl = safeHttpUrl(r.linkUrl);
    if (!imageUrl && !linkUrl) continue; // nothing to show

    const typeRaw = String(r.type ?? '');
    const type = (TYPE_SET.has(typeRaw) ? typeRaw : imageUrl ? 'image' : 'link') as InspirationType;
    const sourceRaw = String(r.source ?? '');
    const source = (SOURCE_SET.has(sourceRaw) ? sourceRaw : 'manual') as InspirationSource;

    out.push({
      id: idOf(r.id),
      type,
      imageUrl,
      linkUrl,
      title: text(r.title, 200),
      note: text(r.note, 300),
      source,
    });
  }

  return { rev, items: out };
}

export { newId as newInspirationId };
