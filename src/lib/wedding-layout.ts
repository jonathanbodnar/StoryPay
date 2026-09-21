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
export const DECOR_KINDS = ['dance_floor', 'head_table', 'chairs', 'bar', 'dj', 'gift', 'cake', 'stage', 'label'] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export type ElementKind = 'table' | DecorKind;

/** Chair-row bounds. A row is decorative geometry — no guests are assigned to it. */
export const CHAIR_MIN = 1;
export const CHAIR_MAX = 10;
export const CHAIR_DEFAULT = 5;
/** Design-unit width per chair, used to size a row from its count. Kept equal to
 *  CHAIR_ROW_H so the element box matches the row's aspect ratio exactly. */
export const CHAIR_PITCH = 28;
export const CHAIR_ROW_H = 28;
/**
 * One chair, drawn inside a CHAIR_CELL × CHAIR_CELL box. Shared by the on-screen
 * SVG and the canvas PNG/print renderer so the two can never drift apart.
 */
export const CHAIR_CELL = 20;
export const CHAIR_GLYPH: ReadonlyArray<{ x: number; y: number; w: number; h: number; r: number }> = [
  { x: 5,    y: 1.5,  w: 10,  h: 8,   r: 2.5 },  // backrest
  { x: 2.5,  y: 10.5, w: 15,  h: 3.5, r: 1.75 }, // seat
  { x: 4,    y: 14,   w: 2.4, h: 5,   r: 1.2 },  // left leg
  { x: 13.6, y: 14,   w: 2.4, h: 5,   r: 1.2 },  // right leg
];
/** Matches the decor tiles (gray-100 fill, gray-300 border) so chairs sit
 *  visually with the rest of the palette rather than standing out. */
export const CHAIR_FILL = '#f3f4f6';
export const CHAIR_STROKE = '#d1d5db';

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
  /** Only meaningful for kind === 'chairs': how many chairs are in the row. */
  count?: number | null;
}

/** Clamped chair count for a row element — single source of truth for render + export. */
export function chairCountOf(el: Pick<LayoutElement, 'count'>): number {
  const n = typeof el.count === 'number' && Number.isFinite(el.count) ? Math.round(el.count) : CHAIR_DEFAULT;
  return Math.min(CHAIR_MAX, Math.max(CHAIR_MIN, n));
}

/**
 * Choose which guest lines fit on a printed table, collapsing whatever doesn't
 * fit into a "+N more" line so nothing is silently dropped from the plan.
 */
export function fitPartyLines(names: string[], maxLines: number): string[] {
  if (maxLines <= 0 || names.length === 0) return [];
  const shown = names.slice(0, maxLines);
  if (names.length <= shown.length) return shown;
  const out = shown.slice(0, Math.max(0, maxLines - 1));
  out.push(`+${names.length - out.length} more`);
  return out;
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
    const isChairs = kindRaw === 'chairs';
    if (!isTable && !DECOR_SET.has(kindRaw)) continue;

    // Absent/null/empty count means "not set" → default. (num() would coerce
    // null to 0, which would clamp to CHAIR_MIN instead of defaulting.)
    const rawCount = r.count;
    const chairCount = isChairs
      ? Math.round(num(
          rawCount === null || rawCount === undefined || rawCount === '' ? undefined : rawCount,
          CHAIR_DEFAULT, CHAIR_MIN, CHAIR_MAX,
        ))
      : 0;

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
    } else if (isChairs) {
      el.count = chairCount;
      // A chair row's size is derived from its count, not from stored geometry,
      // so a row saved under older sizing constants self-corrects on read.
      el.w = chairCount * CHAIR_PITCH;
      el.h = CHAIR_ROW_H;
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
  chairs: { label: 'Chairs', w: CHAIR_DEFAULT * CHAIR_PITCH, h: CHAIR_ROW_H },
  bar: { label: 'Bar', w: 160, h: 60 },
  dj: { label: 'DJ', w: 90, h: 70 },
  gift: { label: 'Gift table', w: 110, h: 60 },
  cake: { label: 'Cake', w: 80, h: 80 },
  stage: { label: 'Stage', w: 200, h: 90 },
  label: { label: 'Text label', w: 120, h: 40 },
};
