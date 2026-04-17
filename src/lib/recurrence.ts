// ============================================================================
// recurrence.ts
//
// Lightweight iCal-inspired recurrence expansion.
//
// We store the rule on a single "parent" calendar_events row. When the API
// fetches events for a date range, we expand the rule into virtual
// occurrences. Occurrences carry a synthetic id (`<parentId>@YYYY-MM-DD`)
// so the UI can still key them uniquely, but edits/deletes operate on the
// parent row (the MVP contract).
//
// Intentionally simpler than RFC 5545 — we support freq/interval/until/count
// which covers 95% of venue use-cases (weekly staff meeting, monthly
// maintenance, annual holiday block, multi-day weddings that repeat, etc.)
// ============================================================================

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval?: number;  // default 1
  until?: string;     // 'YYYY-MM-DD' — inclusive
  count?: number;     // max occurrences (safety cap + user-facing)
}

export function isRecurrenceRule(val: unknown): val is RecurrenceRule {
  if (!val || typeof val !== 'object') return false;
  const r = val as Record<string, unknown>;
  if (typeof r.freq !== 'string') return false;
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) return false;
  if (r.interval !== undefined && (typeof r.interval !== 'number' || r.interval < 1)) return false;
  if (r.until !== undefined && typeof r.until !== 'string') return false;
  if (r.count !== undefined && (typeof r.count !== 'number' || r.count < 1)) return false;
  return true;
}

/**
 * Normalize a rule into a canonical object we can persist. Returns null if the
 * input isn't a valid rule — callers should treat that as "not recurring".
 */
export function normalizeRule(input: unknown): RecurrenceRule | null {
  if (!isRecurrenceRule(input)) return null;
  const out: RecurrenceRule = { freq: input.freq };
  if (input.interval && input.interval > 1) out.interval = Math.floor(input.interval);
  if (input.until) {
    // Reject garbage but don't try to re-format — let downstream parse.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until)) return null;
    out.until = input.until;
  }
  if (input.count && input.count > 1) out.count = Math.floor(Math.min(input.count, 500));
  return out;
}

/** Advance `d` by one interval of the given freq. Mutates `d`. */
function advance(d: Date, freq: RecurrenceFreq, step: number) {
  switch (freq) {
    case 'daily':   d.setDate(d.getDate() + step); break;
    case 'weekly':  d.setDate(d.getDate() + 7 * step); break;
    case 'monthly': d.setMonth(d.getMonth() + step); break;
    case 'yearly':  d.setFullYear(d.getFullYear() + step); break;
  }
}

export interface ExpansionInput {
  id: string;
  start_at: string; // ISO
  end_at: string;   // ISO
  recurrence_rule: RecurrenceRule | null;
}

export interface ExpandedOccurrence {
  /** synthetic id for non-first occurrences: `<parentId>@YYYY-MM-DD` */
  id: string;
  parent_id: string;
  start_at: string;
  end_at: string;
  /** true for every occurrence except the first (so UI can show a badge) */
  is_occurrence: boolean;
}

/**
 * Expand a rule into every occurrence that overlaps [rangeStart, rangeEnd].
 * Always returns at least the original event (as occurrence #0) if it
 * overlaps the range.
 *
 * Hard-capped at 500 occurrences to prevent runaway loops if a client sends
 * a pathological rule.
 */
export function expandEvent(
  event: ExpansionInput,
  rangeStart: Date,
  rangeEnd: Date,
): ExpandedOccurrence[] {
  const baseStart = new Date(event.start_at);
  const baseEnd = new Date(event.end_at);
  const durationMs = baseEnd.getTime() - baseStart.getTime();
  const rule = event.recurrence_rule;

  // Non-recurring: emit once if it overlaps.
  if (!rule) {
    if (baseEnd < rangeStart || baseStart > rangeEnd) return [];
    return [{
      id: event.id,
      parent_id: event.id,
      start_at: event.start_at,
      end_at: event.end_at,
      is_occurrence: false,
    }];
  }

  const step = rule.interval && rule.interval > 1 ? rule.interval : 1;
  const maxCount = Math.min(rule.count ?? 500, 500);
  // `until` is an inclusive calendar date; set to end-of-day so same-day
  // occurrences don't get clipped by UTC conversion weirdness.
  const untilCutoff = rule.until ? new Date(`${rule.until}T23:59:59.999`) : null;

  const out: ExpandedOccurrence[] = [];
  const cur = new Date(baseStart);
  let count = 0;

  while (count < maxCount) {
    if (untilCutoff && cur > untilCutoff) break;
    const occStart = new Date(cur);
    const occEnd = new Date(cur.getTime() + durationMs);

    // We've passed the requested range — stop early.
    if (occStart > rangeEnd) break;

    // Only emit if it overlaps the range. We still loop forward otherwise
    // because a long-running rule might start before the range.
    if (occEnd >= rangeStart) {
      const dateKey = `${occStart.getFullYear()}-${String(occStart.getMonth() + 1).padStart(2, '0')}-${String(occStart.getDate()).padStart(2, '0')}`;
      out.push({
        id: count === 0 ? event.id : `${event.id}@${dateKey}`,
        parent_id: event.id,
        start_at: occStart.toISOString(),
        end_at: occEnd.toISOString(),
        is_occurrence: count > 0,
      });
    }

    advance(cur, rule.freq, step);
    count++;
  }

  return out;
}

/** Human-readable label for a rule — used in the event detail modal. */
export function describeRule(rule: RecurrenceRule | null | undefined): string {
  if (!rule) return '';
  const n = rule.interval && rule.interval > 1 ? rule.interval : 1;
  const noun = {
    daily:   n === 1 ? 'day' : 'days',
    weekly:  n === 1 ? 'week' : 'weeks',
    monthly: n === 1 ? 'month' : 'months',
    yearly:  n === 1 ? 'year' : 'years',
  }[rule.freq];
  const base = n === 1 ? `Every ${noun}` : `Every ${n} ${noun}`;
  if (rule.until) return `${base}, until ${rule.until}`;
  if (rule.count) return `${base}, ${rule.count} times`;
  return base;
}
