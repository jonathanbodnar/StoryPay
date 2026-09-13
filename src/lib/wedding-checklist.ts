/**
 * Wedding planning checklist — shared types + tolerant-reader sanitizer.
 *
 * Stored on couple_weddings.checklist and editable by BOTH the couple and the
 * venue (same shared-document pattern as timeline/inspiration). Just an ordered
 * list of { title, dueDate, done, note } tasks. Everything here is defensive so
 * old/partial/hand-edited documents never crash a reader (the "tolerant reader"
 * pattern from docs/DATA_MIGRATIONS.md), and a `rev` token powers optimistic
 * concurrency.
 */

export interface ChecklistItem {
  id: string;
  title: string;
  /** "YYYY-MM-DD" or "" when no due date is set. */
  dueDate: string;
  done: boolean;
  note?: string | null;
}

export interface WeddingChecklist {
  rev: number;
  items: ChecklistItem[];
}

export const EMPTY_CHECKLIST: WeddingChecklist = { rev: 0, items: [] };

const MAX_ITEMS = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ck_${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
  return newId();
}

function sanitizeDate(v: unknown): string {
  if (typeof v !== 'string') return '';
  const d = v.trim();
  return DATE_RE.test(d) ? d : '';
}

/** Sort by due date ascending; blank due dates sink to the bottom. */
function byDue(a: ChecklistItem, b: ChecklistItem): number {
  if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}

export function sanitizeChecklist(raw: unknown): WeddingChecklist {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CHECKLIST, items: [] };
  const obj = raw as { rev?: unknown; items?: unknown };

  const rev = Math.max(0, Math.round(num(obj.rev, 0, 0, Number.MAX_SAFE_INTEGER)));
  const src = Array.isArray(obj.items) ? obj.items : [];
  const out: ChecklistItem[] = [];

  for (const row of src.slice(0, MAX_ITEMS)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 160) : '';
    if (!title) continue; // a task with no title is meaningless
    const note = typeof r.note === 'string' ? r.note.trim().slice(0, 240) : '';
    out.push({
      id: idOf(r.id),
      title,
      dueDate: sanitizeDate(r.dueDate),
      done: r.done === true,
      note: note || null,
    });
  }

  out.sort(byDue);
  return { rev, items: out };
}

/** Add N days to a "YYYY-MM-DD" and return the same format (UTC-safe). */
function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A standard planning checklist. When a wedding date is known, each task gets a
 * suggested due date relative to it (e.g. "book the photographer ~9 months out");
 * otherwise due dates are left blank for the couple to fill in.
 */
export function starterChecklist(weddingDate?: string | null): ChecklistItem[] {
  const wd = weddingDate && DATE_RE.test(weddingDate) ? weddingDate : null;
  // [daysBeforeWedding, task]
  const rows: [number, string][] = [
    [365, 'Set your budget'],
    [365, 'Draft your guest list'],
    [330, 'Book your venue'],
    [300, 'Book your photographer & videographer'],
    [300, 'Book your officiant'],
    [270, 'Book your caterer'],
    [240, 'Book your DJ or band'],
    [240, 'Shop for your wedding dress'],
    [210, 'Book your florist'],
    [180, 'Reserve hotel room blocks for guests'],
    [180, 'Book hair & makeup artists'],
    [150, 'Send save-the-dates'],
    [120, 'Order invitations'],
    [120, 'Plan your ceremony'],
    [90, 'Send invitations'],
    [90, 'Order the cake'],
    [75, 'Buy wedding rings'],
    [60, 'Finalize the menu & tastings'],
    [45, 'Confirm the day-of timeline with vendors'],
    [30, 'Finalize the guest count & seating chart'],
    [30, 'Get your marriage license'],
    [14, 'Confirm final headcount with caterer'],
    [7, 'Pack for the honeymoon'],
    [2, 'Rehearsal & rehearsal dinner'],
  ];
  return rows.map(([daysBefore, title]) => ({
    id: newId(),
    title,
    dueDate: wd ? shiftDate(wd, -daysBefore) : '',
    done: false,
    note: null,
  }));
}

/** Whole days from now until the wedding (negative if past). null if no date. */
export function daysUntil(weddingDate?: string | null): number | null {
  if (!weddingDate || !DATE_RE.test(weddingDate)) return null;
  const wd = new Date(`${weddingDate}T00:00:00`);
  if (Number.isNaN(wd.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((wd.getTime() - today.getTime()) / 86_400_000);
}

export { newId as newChecklistId };
