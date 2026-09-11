/**
 * Wedding "Room layout" canvas — shared types + tolerant-reader sanitizer.
 *
 * The layout is a single visual document stored on couple_weddings.layout. It is
 * DECOUPLED from the seating data: a table element only references wedding_tables
 * by id (to show the table's number + live seated count). Everything here is
 * defensive so old/partial/hand-edited documents never crash a reader — this is
 * the "tolerant reader" pattern from docs/DATA_MIGRATIONS.md.
 */

export const TABLE_SHAPES = ['round', 'square', 'rect'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** Decor / structural elements that are pure geometry (no data binding). */
export const DECOR_KINDS = ['dance_floor', 'head_table', 'bar', 'dj', 'gift', 'cake', 'stage', 'label'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export type ElementKind = 'table' | DecorKind;

export interface LayoutElement {
  id: string;
  kind: ElementKind;
  /** Only meaningful for kind === 'table'. */
  shape?: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** For kind === 'table': the wedding_tables row it represents (or null). */
  tableId?: string | null;
  /** For kind === 'label' (and optionally others): free text. */
  text?: string | null;
}

export interface WeddingLayout {
  rev: number;
  elements: LayoutElement[];
}

/** Logical room canvas size (design units). The UI scales this to fit. */
export const ROOM_WIDTH = 1000;
export const ROOM_HEIGHT = 700;

const MAX_ELEMENTS = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECOR_SET: ReadonlySet<string> = new Set(DECOR_KINDS);
const SHAPE_SET: ReadonlySet<string> = new Set(TABLE_SHAPES);

export const EMPTY_LAYOUT: WeddingLayout = { rev: 0, elements: [] };

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function id(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `el_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalize an arbitrary value into a safe WeddingLayout. Unknown kinds/shapes
 * are dropped/defaulted, coordinates are clamped, element count is capped, and
 * `rev` is coerced to a non-negative integer.
 */
export function sanitizeLayout(raw: unknown): WeddingLayout {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LAYOUT };
  const obj = raw as { rev?: unknown; elements?: unknown };

  const rev = Math.max(0, Math.round(num(obj.rev, 0, 0, Number.MAX_SAFE_INTEGER)));
  const src = Array.isArray(obj.elements) ? obj.elements : [];
  const out: LayoutElement[] = [];

  for (const row of src.slice(0, MAX_ELEMENTS)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const kindRaw = String(r.kind ?? '');
    const isTable = kindRaw === 'table';
    if (!isTable && !DECOR_SET.has(kindRaw)) continue;

    const el: LayoutElement = {
      id: id(r.id),
      kind: (isTable ? 'table' : kindRaw) as ElementKind,
      x: num(r.x, 40, -200, ROOM_WIDTH + 200),
      y: num(r.y, 40, -200, ROOM_HEIGHT + 200),
      w: num(r.w, isTable ? 90 : 120, 16, ROOM_WIDTH),
      h: num(r.h, isTable ? 90 : 60, 16, ROOM_HEIGHT),
      rotation: num(r.rotation, 0, -360, 360),
    };

    if (isTable) {
      const shapeRaw = String(r.shape ?? 'round');
      el.shape = (SHAPE_SET.has(shapeRaw) ? shapeRaw : 'round') as TableShape;
      const tid = r.tableId;
      el.tableId = typeof tid === 'string' && UUID_RE.test(tid) ? tid : null;
    } else {
      const t = r.text;
      el.text = typeof t === 'string' ? t.trim().slice(0, 60) : null;
    }
    out.push(el);
  }

  return { rev, elements: out };
}

/** Human label + default size hint for the decor palette. */
export const DECOR_META: Record<DecorKind, { label: string; w: number; h: number }> = {
  dance_floor: { label: 'Dance floor', w: 200, h: 160 },
  head_table: { label: 'Head table', w: 220, h: 70 },
  bar: { label: 'Bar', w: 160, h: 60 },
  dj: { label: 'DJ', w: 90, h: 70 },
  gift: { label: 'Gift table', w: 110, h: 60 },
  cake: { label: 'Cake', w: 80, h: 80 },
  stage: { label: 'Stage', w: 200, h: 90 },
  label: { label: 'Text label', w: 120, h: 40 },
};
