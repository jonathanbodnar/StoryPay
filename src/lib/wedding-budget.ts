/**
 * Wedding budget tracker — types + tolerant-reader sanitizer.
 *
 * Stored on couple_weddings.budget but COUPLE-PRIVATE: only the couple API route
 * (src/app/api/couple/budget/route.ts) ever reads/writes it, and no venue route
 * selects the column, so the venue never sees it. A `rev` token keeps the
 * couple's own multiple tabs/devices from clobbering each other.
 */

export const BUDGET_CATEGORIES = [
  'Venue',
  'Catering',
  'Photography',
  'Videography',
  'Attire',
  'Flowers & Decor',
  'Music & Entertainment',
  'Invitations & Stationery',
  'Hair & Makeup',
  'Transportation',
  'Rings',
  'Favors & Gifts',
  'Officiant',
  'Miscellaneous',
] as const;

export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export interface BudgetLine {
  id: string;
  category: BudgetCategory;
  /** Optional free-text label to distinguish multiple lines in one category. */
  label: string;
  estimated: number;
  actual: number;
  paid: boolean;
  note?: string | null;
}

export interface WeddingBudget {
  rev: number;
  /** Optional overall target the couple sets; 0 means "no target". */
  target: number;
  lines: BudgetLine[];
}

export const EMPTY_BUDGET: WeddingBudget = { rev: 0, target: 0, lines: [] };

const MAX_LINES = 200;
const MAX_MONEY = 100_000_000; // $100M ceiling to keep numbers sane
const CATEGORY_SET = new Set<string>(BUDGET_CATEGORIES);

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function money(v: unknown): number {
  return Math.round(num(v, 0, 0, MAX_MONEY) * 100) / 100;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `bg_${Math.random().toString(36).slice(2, 10)}`;
}

function idOf(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
  return newId();
}

function sanitizeCategory(v: unknown): BudgetCategory {
  return typeof v === 'string' && CATEGORY_SET.has(v) ? (v as BudgetCategory) : 'Miscellaneous';
}

export function sanitizeBudget(raw: unknown): WeddingBudget {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BUDGET, lines: [] };
  const obj = raw as { rev?: unknown; target?: unknown; lines?: unknown };

  const rev = Math.max(0, Math.round(num(obj.rev, 0, 0, Number.MAX_SAFE_INTEGER)));
  const target = money(obj.target);
  const src = Array.isArray(obj.lines) ? obj.lines : [];
  const out: BudgetLine[] = [];

  for (const row of src.slice(0, MAX_LINES)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 120) : '';
    const note = typeof r.note === 'string' ? r.note.trim().slice(0, 240) : '';
    out.push({
      id: idOf(r.id),
      category: sanitizeCategory(r.category),
      label,
      estimated: money(r.estimated),
      actual: money(r.actual),
      paid: r.paid === true,
      note: note || null,
    });
  }

  return { rev, target, lines: out };
}

/** One starter line per category so the couple has a scaffold to fill in. */
export function starterBudget(): BudgetLine[] {
  return BUDGET_CATEGORIES.map((category) => ({
    id: newId(),
    category,
    label: '',
    estimated: 0,
    actual: 0,
    paid: false,
    note: null,
  }));
}

export interface BudgetTotals {
  estimated: number;
  actual: number;
  paid: number;
  remaining: number; // target - actual (0 if no target)
}

export function budgetTotals(b: WeddingBudget): BudgetTotals {
  let estimated = 0;
  let actual = 0;
  let paid = 0;
  for (const l of b.lines) {
    estimated += l.estimated;
    actual += l.actual;
    if (l.paid) paid += l.actual;
  }
  return {
    estimated: Math.round(estimated * 100) / 100,
    actual: Math.round(actual * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    remaining: b.target > 0 ? Math.round((b.target - actual) * 100) / 100 : 0,
  };
}

export { newId as newBudgetId };
