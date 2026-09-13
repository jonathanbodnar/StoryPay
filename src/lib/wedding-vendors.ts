/**
 * Wedding vendor directory — shared types + tolerant-reader sanitizer.
 *
 * Stored on couple_weddings.vendors and editable by BOTH the couple and the
 * venue (shared-document pattern). A simple list of vendor contacts the couple
 * and venue both need on the big day. Defensive throughout so old/partial docs
 * never crash a reader; a `rev` token powers optimistic concurrency.
 */

export const VENDOR_CATEGORIES = [
  'Photographer',
  'Videographer',
  'Florist',
  'DJ / Band',
  'Caterer',
  'Hair & Makeup',
  'Officiant',
  'Cake / Bakery',
  'Transportation',
  'Rentals',
  'Planner / Coordinator',
  'Other',
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export interface VendorContact {
  id: string;
  category: VendorCategory;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  note?: string | null;
}

export interface WeddingVendors {
  rev: number;
  items: VendorContact[];
}

export const EMPTY_VENDORS: WeddingVendors = { rev: 0, items: [] };

const MAX_ITEMS = 120;
const CATEGORY_SET = new Set<string>(VENDOR_CATEGORIES);

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `vn_${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
  return newId();
}

function sanitizeCategory(v: unknown): VendorCategory {
  return typeof v === 'string' && CATEGORY_SET.has(v) ? (v as VendorCategory) : 'Other';
}

export function sanitizeVendors(raw: unknown): WeddingVendors {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_VENDORS, items: [] };
  const obj = raw as { rev?: unknown; items?: unknown };

  const rev = Math.max(0, Math.round(num(obj.rev, 0, 0, Number.MAX_SAFE_INTEGER)));
  const src = Array.isArray(obj.items) ? obj.items : [];
  const out: VendorContact[] = [];

  for (const row of src.slice(0, MAX_ITEMS)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const businessName = typeof r.businessName === 'string' ? r.businessName.trim().slice(0, 120) : '';
    const contactName = typeof r.contactName === 'string' ? r.contactName.trim().slice(0, 120) : '';
    const phone = typeof r.phone === 'string' ? r.phone.trim().slice(0, 40) : '';
    const email = typeof r.email === 'string' ? r.email.trim().slice(0, 160) : '';
    const note = typeof r.note === 'string' ? r.note.trim().slice(0, 240) : '';
    // Drop rows with nothing useful in them.
    if (!businessName && !contactName && !phone && !email) continue;
    out.push({
      id: idOf(r.id),
      category: sanitizeCategory(r.category),
      businessName,
      contactName,
      phone,
      email,
      note: note || null,
    });
  }

  return { rev, items: out };
}

export { newId as newVendorId };
