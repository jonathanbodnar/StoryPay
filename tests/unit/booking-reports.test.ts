import { describe, expect, it } from 'vitest';
import { nextReportAt } from '@/lib/booking-report-schedule';

const DAY = 86_400_000;

describe('scheduled booking reports', () => {
  it('a report that goes out on time is next due 30 days after its schedule', () => {
    const due = '2026-10-01T08:00:00.000Z';
    expect(nextReportAt(due, Date.parse(due) + 3_600_000)).toBe('2026-10-31T08:00:00.000Z');
  });

  it('a report sent late keeps its day of the month instead of drifting', () => {
    const due = '2026-10-01T08:00:00.000Z';
    expect(nextReportAt(due, Date.parse(due) + 2 * DAY)).toBe('2026-10-31T08:00:00.000Z');
  });

  it('a schedule set months ago sends once, then is next due in the future, not tomorrow', () => {
    const due = '2026-06-01T08:00:00.000Z';
    const now = Date.parse('2026-10-02T09:00:00.000Z');
    const next = Date.parse(nextReportAt(due, now));
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeLessThanOrEqual(30 * DAY);
    expect((next - Date.parse(due)) % (30 * DAY)).toBe(0);
  });
});
