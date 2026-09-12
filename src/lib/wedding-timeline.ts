/**
 * Wedding "Day-of timeline" — shared types + tolerant-reader sanitizer.
 *
 * The timeline is a single, simple document stored on couple_weddings.timeline
 * that BOTH the couple and the venue can edit (mirrors the room-layout pattern).
 * It is just an ordered list of { time, title, note } rows. Everything here is
 * defensive so old/partial/hand-edited documents never crash a reader — the
 * "tolerant reader" pattern from docs/DATA_MIGRATIONS.md — and a `rev` token
 * powers the same optimistic-concurrency check the layout uses.
 */

export interface TimelineEvent {
  id: string;
  /** "HH:MM" in 24h, or "" when the time hasn't been set yet. */
  time: string;
  title: string;
  note?: string | null;
}

export interface WeddingTimeline {
  rev: number;
  events: TimelineEvent[];
}

export const EMPTY_TIMELINE: WeddingTimeline = { rev: 0, events: [] };

const MAX_EVENTS = 80;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ev_${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
  return newId();
}

/** Normalize a raw time value into "HH:MM" (24h) or "" if it can't be parsed. */
function sanitizeTime(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  if (TIME_RE.test(t)) return t;
  // Tolerate "9:5" / "9:05" style inputs by zero-padding.
  const m = t.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const h = Math.min(23, Math.max(0, Number(m[1])));
    const min = Math.min(59, Math.max(0, Number(m[2])));
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return '';
}

/** Compare two events for chronological order; blank times sort to the end. */
function byTime(a: TimelineEvent, b: TimelineEvent): number {
  if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}

/**
 * Normalize an arbitrary value into a safe WeddingTimeline. Rows without a title
 * AND without a time are dropped, times are normalized, text is trimmed/capped,
 * the event count is capped, `rev` is coerced to a non-negative integer, and the
 * result is sorted chronologically (blank times last).
 */
export function sanitizeTimeline(raw: unknown): WeddingTimeline {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_TIMELINE, events: [] };
  const obj = raw as { rev?: unknown; events?: unknown };

  const rev = Math.max(0, Math.round(num(obj.rev, 0, 0, Number.MAX_SAFE_INTEGER)));
  const src = Array.isArray(obj.events) ? obj.events : [];
  const out: TimelineEvent[] = [];

  for (const row of src.slice(0, MAX_EVENTS)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const time = sanitizeTime(r.time);
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 120) : '';
    const noteRaw = typeof r.note === 'string' ? r.note.trim().slice(0, 240) : '';
    if (!title && !time) continue; // fully-empty row
    out.push({ id: idOf(r.id), time, title, note: noteRaw || null });
  }

  out.sort(byTime);
  return { rev, events: out };
}

/** A sensible starter schedule couples can drop in and then tweak. */
export function starterTimeline(): TimelineEvent[] {
  const rows: [string, string][] = [
    ['13:00', 'Hair & makeup'],
    ['15:00', 'Photographer arrives'],
    ['16:00', 'First look & wedding party photos'],
    ['16:30', 'Guests arrive'],
    ['17:00', 'Ceremony'],
    ['17:30', 'Cocktail hour'],
    ['18:30', 'Grand entrance'],
    ['18:45', 'Dinner served'],
    ['19:45', 'Toasts'],
    ['20:00', 'First dance'],
    ['20:15', 'Dancing & open floor'],
    ['21:30', 'Cake cutting'],
    ['22:45', 'Last dance'],
    ['23:00', 'Grand send-off'],
  ];
  return rows.map(([time, title]) => ({ id: newId(), time, title, note: null }));
}

/** Format an "HH:MM" 24h string as a friendly 12h label (e.g. "5:00 PM"). */
export function formatTimeLabel(time: string): string {
  if (!TIME_RE.test(time)) return '';
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
}

export { newId as newTimelineId };
