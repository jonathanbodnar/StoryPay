/**
 * The venue's "Service fee" line on invoices and proposals.
 *
 * On by default at the venue's rate (venues.service_fee_rate, default 3.5%),
 * and the venue can change the % or remove it on any invoice. It's part of
 * the total, so the couple pays the same whether they pay by card, bank
 * transfer or check. That's what keeps it a service fee rather than a card
 * surcharge, so never label or describe it as a card/processing fee.
 */

export const DEFAULT_SERVICE_FEE_PCT = 3.5;

/** A venue's rate as a percentage (0 = off by default), falling back to 3.5%. */
export function normalizeServiceFeePct(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SERVICE_FEE_PCT;
  return Math.min(Math.round(n * 100) / 100, 25);
}

export function formatServiceFeePct(pct: number): string {
  return String(Math.round(pct * 100) / 100);
}

export function serviceFeeLabel(pct: number): string {
  return `Service fee (${formatServiceFeePct(pct)}%)`;
}

export function serviceFeeCents(baseCents: number, pct: number): number {
  return Math.max(0, Math.round((baseCents * pct) / 100));
}
