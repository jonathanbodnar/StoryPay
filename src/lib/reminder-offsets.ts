/**
 * Reminder timing offsets shared by appointment and payment reminders. No
 * server imports, so the Notifications settings page can use them in the
 * browser; appointment-reminders.ts and payment-reminders.ts re-export them.
 */

export type ReminderOffset = { d: number; h: number; m: number };

export const DEFAULT_APPOINTMENT_REMINDER_OFFSETS: ReminderOffset[] = [
  { d: 1, h: 0, m: 0 },
  { d: 0, h: 1, m: 0 },
  { d: 0, h: 0, m: 10 },
];

const MAX_REMINDERS = 5;

export function normalizeReminderOffsets(raw: unknown): ReminderOffset[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_APPOINTMENT_REMINDER_OFFSETS];
  const out: ReminderOffset[] = [];
  for (const row of raw.slice(0, MAX_REMINDERS)) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const d = Math.max(0, Math.min(365, Math.floor(Number(o.d ?? o.days ?? 0) || 0)));
    const h = Math.max(0, Math.floor(Number(o.h ?? o.hours ?? 0) || 0));
    const m = Math.max(0, Math.min(59, Math.floor(Number(o.m ?? o.minutes ?? 0) || 0)));
    if (d === 0 && h === 0 && m === 0) continue;
    out.push({ d, h, m });
  }
  return out.length ? out : [...DEFAULT_APPOINTMENT_REMINDER_OFFSETS];
}

/** Default overdue-reminder offsets: 1 day after, 3 days after, 7 days after. */
export const DEFAULT_PAYMENT_REMINDER_OFFSETS: ReminderOffset[] = [
  { d: 1, h: 0, m: 0 },
  { d: 3, h: 0, m: 0 },
  { d: 7, h: 0, m: 0 },
];

const MAX_PAYMENT_REMINDER_SLOTS = 3;

/** Normalize and cap at 3 offsets for payment due emails. */
export function normalizePaymentReminderOffsets(raw: unknown): ReminderOffset[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_PAYMENT_REMINDER_OFFSETS];
  const n = normalizeReminderOffsets(raw.slice(0, MAX_PAYMENT_REMINDER_SLOTS));
  return n.length ? n.slice(0, MAX_PAYMENT_REMINDER_SLOTS) : [...DEFAULT_PAYMENT_REMINDER_OFFSETS];
}
