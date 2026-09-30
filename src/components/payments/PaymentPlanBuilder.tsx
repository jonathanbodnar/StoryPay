'use client';

/**
 * Payment plan builder for proposals and invoices. The venue picks a deposit
 * and how the plan runs (monthly to an end date or the wedding, a deposit and
 * one final payment, or a custom schedule); the payments are worked out from
 * the total so they always add up. The math lives in lib/payment-plan.ts,
 * shared with the server's checks.
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import {
  addDaysYmd,
  dollarsToCents,
  planDepositCents,
  planEndDate,
  toYmd,
  type PlanDraft,
  type PlanEnd,
  type PlanKind,
  type PlanPayment,
} from '@/lib/payment-plan';

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500';
const SMALL_LABEL = 'block text-xs font-medium text-gray-500 mb-1.5';

/** "Nov 1, 2026" for a YYYY-MM-DD date, without time-zone shifts. */
export function formatYmd(ymd: string): string {
  const d = toYmd(ymd);
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function chip(active: boolean) {
  return `rounded-2xl border-2 px-3.5 py-2 text-sm font-medium transition-all ${
    active ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-300'
  }`;
}

/** One-line summary: "$2,500 at signing, then 6 monthly payments of $1,250 from Nov 1, 2026 to Apr 1, 2027". */
export function planSummary(payments: PlanPayment[], opts: { collectManually?: boolean } = {}): string {
  if (payments.length < 2) return '';
  const [first, ...rest] = payments;
  const start = opts.collectManually ? `${formatCents(first.amount)} due ${formatYmd(first.date)}` : `${formatCents(first.amount)} at signing`;
  if (rest.length === 1) return `${start}, then ${formatCents(rest[0].amount)} on ${formatYmd(rest[0].date)}`;
  const regular = rest[0].amount;
  const last = rest[rest.length - 1];
  const same = rest.slice(0, -1).every((p) => p.amount === regular);
  const amounts = same
    ? last.amount === regular
      ? `of ${formatCents(regular)}`
      : `of ${formatCents(regular)} (last one ${formatCents(last.amount)})`
    : '';
  return `${start}, then ${rest.length} payments ${amounts} from ${formatYmd(rest[0].date)} to ${formatYmd(last.date)}`.replace(/\s+/g, ' ');
}

export function ScheduleList({ payments, collectManually }: { payments: PlanPayment[]; collectManually?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
        {payments.map((p, i) => (
          <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="text-gray-600">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">{i + 1}</span>
              {i === 0 && !collectManually ? 'At signing' : formatYmd(p.date)}
            </span>
            <span className="font-semibold text-gray-900">{formatCents(p.amount)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 text-sm">
        <span className="font-semibold text-gray-700">{payments.length} payments</span>
        <span className="font-bold text-gray-900">{formatCents(payments.reduce((s, p) => s + p.amount, 0))}</span>
      </div>
    </div>
  );
}

interface Props {
  totalCents: number;
  draft: PlanDraft;
  onChange: (next: PlanDraft) => void;
  /** The schedule and any problem, from planFromDraft (the parent needs them to submit). */
  payments: PlanPayment[];
  problem: string | null;
  collectManually?: boolean;
  disabled?: boolean;
}

export default function PaymentPlanBuilder({ totalCents, draft, onChange, payments, problem, collectManually, disabled }: Props) {
  const set = (patch: Partial<PlanDraft>) => onChange({ ...draft, ...patch });
  const [depositFocus, setDepositFocus] = useState(false);
  const depositCents = planDepositCents(draft, totalCents);
  const end = planEndDate(draft);

  function toCustom() {
    const rows = (payments.length ? payments : [{ amount: depositCents, date: '' }]).map((p) => ({
      amount: p.amount ? (p.amount / 100).toFixed(2) : '',
      date: p.date,
    }));
    set({ kind: 'custom', rows: rows.length > 1 ? rows : [...rows, { amount: '', date: '' }] });
  }

  const endOptions: Array<{ key: PlanEnd; label: string }> =
    draft.kind === 'monthly'
      ? [
          { key: 'event', label: 'Before the wedding' },
          { key: 'date', label: 'On a date' },
          { key: 'count', label: 'Number of payments' },
        ]
      : [
          { key: 'event', label: 'Before the wedding' },
          { key: 'date', label: 'On a date' },
        ];

  const customTotal = draft.rows.reduce((s, r) => s + dollarsToCents(r.amount), 0);
  const customLeft = totalCents - customTotal;

  return (
    <div className="space-y-4">
      {/* How the plan runs */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'monthly', label: 'Monthly payments' },
          { key: 'deposit_final', label: 'Deposit + final payment' },
          { key: 'custom', label: 'Custom' },
        ] as Array<{ key: PlanKind; label: string }>).map((k) => (
          <button
            key={k.key}
            type="button"
            disabled={disabled}
            onClick={() => (k.key === 'custom' ? toCustom() : set({ kind: k.key, endMode: k.key === 'deposit_final' && draft.endMode === 'count' ? (draft.eventDate ? 'event' : 'date') : draft.endMode }))}
            className={chip(draft.kind === k.key)}
          >
            {k.label}
          </button>
        ))}
      </div>

      {draft.kind !== 'custom' && (
        <>
          {/* Deposit */}
          <div>
            <label className={SMALL_LABEL}>{collectManually ? 'Deposit (first payment)' : 'Deposit due at signing'}</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                {draft.depositMode === 'amount' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>}
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={disabled}
                  value={draft.deposit}
                  onFocus={() => setDepositFocus(true)}
                  onBlur={() => setDepositFocus(false)}
                  onChange={(e) => {
                    if (/^[0-9.,]*$/.test(e.target.value)) set({ deposit: e.target.value });
                  }}
                  placeholder={draft.depositMode === 'amount' ? '0.00' : '25'}
                  className={`${INPUT} ${draft.depositMode === 'amount' ? 'pl-7' : 'pr-8'}`}
                />
                {draft.depositMode === 'percent' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>}
              </div>
              <div className="flex shrink-0 rounded-2xl border border-gray-200 p-0.5">
                {(['amount', 'percent'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (m === draft.depositMode) return;
                      // Keep the same deposit when switching between $ and %.
                      const next =
                        m === 'amount'
                          ? depositCents > 0 ? (depositCents / 100).toFixed(2) : ''
                          : totalCents > 0 && depositCents > 0 ? String(Math.round((depositCents / totalCents) * 1000) / 10) : '';
                      set({ depositMode: m, deposit: next });
                    }}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${draft.depositMode === m ? 'bg-gray-900 text-white' : 'text-gray-500'}`}
                  >
                    {m === 'amount' ? '$' : '%'}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {draft.depositMode === 'percent' && depositCents > 0 && !depositFocus
                ? `${formatCents(depositCents)} of ${formatCents(totalCents)}.`
                : ''}
              {draft.kind === 'monthly' && depositCents === 0 ? ' No deposit: the payments are split evenly, and the first is due at signing.' : ''}
            </p>
          </div>

          {/* First monthly payment */}
          {draft.kind === 'monthly' && (
            <div>
              <label className={SMALL_LABEL}>First monthly payment</label>
              <input type="date" disabled={disabled} value={draft.firstDate} min={addDaysYmd(todayLocal(), 1)} onChange={(e) => set({ firstDate: e.target.value })} className={INPUT} />
            </div>
          )}

          {/* When it ends */}
          <div>
            <label className={SMALL_LABEL}>{draft.kind === 'monthly' ? 'Last payment' : 'Final payment'}</label>
            <div className="flex flex-wrap gap-2 mb-2.5">
              {endOptions.map((o) => (
                <button key={o.key} type="button" disabled={disabled} onClick={() => set({ endMode: o.key })} className={chip(draft.endMode === o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
            {draft.endMode === 'event' && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-[110px] shrink-0">
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={disabled}
                    value={draft.daysBefore}
                    onChange={(e) => {
                      if (/^\d{0,3}$/.test(e.target.value)) set({ daysBefore: e.target.value });
                    }}
                    className={`${INPUT} pr-12`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">days</span>
                </div>
                <span className="text-sm text-gray-500 whitespace-nowrap">before the wedding on</span>
                <div className="min-w-[150px] flex-1">
                  <input type="date" disabled={disabled} value={draft.eventDate} onChange={(e) => set({ eventDate: e.target.value })} className={INPUT} aria-label="Wedding date" />
                </div>
                <p className="w-full text-xs text-gray-400">
                  {draft.eventDate ? (end ? `Final payment on ${formatYmd(end)}.` : '') : 'Enter the wedding date.'}
                </p>
              </div>
            )}
            {draft.endMode === 'date' && (
              <input type="date" disabled={disabled} value={draft.endDate} min={addDaysYmd(todayLocal(), 1)} onChange={(e) => set({ endDate: e.target.value })} className={INPUT} />
            )}
            {draft.endMode === 'count' && (
              <div className="relative max-w-[220px]">
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={disabled}
                  value={draft.count}
                  onChange={(e) => {
                    if (/^\d{0,2}$/.test(e.target.value)) set({ count: e.target.value });
                  }}
                  className={`${INPUT} pr-36`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">monthly payments</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Custom schedule */}
      {draft.kind === 'custom' && (
        <div className="space-y-2">
          {draft.rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-xs font-bold text-gray-400">{i + 1}</span>
              <div className="relative flex-1 min-w-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={disabled}
                  value={row.amount}
                  onChange={(e) => {
                    if (!/^[0-9.,]*$/.test(e.target.value)) return;
                    set({ rows: draft.rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) });
                  }}
                  placeholder="0.00"
                  className={`${INPUT} pl-7`}
                />
              </div>
              {i === 0 && !collectManually ? (
                <span className="w-[136px] sm:w-[150px] shrink-0 rounded-2xl bg-gray-50 px-3 py-2.5 text-sm text-gray-500">At signing</span>
              ) : (
                <input
                  type="date"
                  disabled={disabled}
                  value={row.date}
                  onChange={(e) => set({ rows: draft.rows.map((r, j) => (j === i ? { ...r, date: e.target.value } : r)) })}
                  className="w-[136px] sm:w-[150px] shrink-0 rounded-2xl border border-gray-200 px-2.5 py-2.5 text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50"
                />
              )}
              <button
                type="button"
                disabled={disabled || draft.rows.length <= 2}
                onClick={() => set({ rows: draft.rows.filter((_, j) => j !== i) })}
                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-30"
                aria-label="Remove payment"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => set({ rows: [...draft.rows, { amount: '', date: '' }] })}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <Plus size={13} /> Add payment
            </button>
            <div className="text-xs text-right">
              <span className="text-gray-500">
                Scheduled {formatCents(customTotal)} of {formatCents(totalCents)}
              </span>
              {customLeft !== 0 && draft.rows.length > 0 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const lastIdx = draft.rows.length - 1;
                    const nextLast = dollarsToCents(draft.rows[lastIdx].amount) + customLeft;
                    if (nextLast <= 0) return;
                    set({ rows: draft.rows.map((r, j) => (j === lastIdx ? { ...r, amount: (nextLast / 100).toFixed(2) } : r)) });
                  }}
                  className="ml-2 font-semibold text-gray-900 underline underline-offset-2"
                >
                  {customLeft > 0 ? `Add the ${formatCents(customLeft)} left to the last payment` : `Take ${formatCents(-customLeft)} off the last payment`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {problem ? (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">{problem}</div>
      ) : (
        payments.length > 1 && (
          <div className="space-y-2">
            <p className="text-sm text-gray-700">{planSummary(payments, { collectManually })}.</p>
            {draft.kind !== 'custom' && <ScheduleList payments={payments} collectManually={collectManually} />}
            {draft.kind !== 'custom' && !disabled && (
              <button type="button" onClick={toCustom} className="text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-800">
                Edit amounts and dates
              </button>
            )}
          </div>
        )
      )}

      <p className="text-xs leading-relaxed text-gray-400">
        {collectManually
          ? 'You collect each payment by cash or check and record it here. If one is overdue, your client gets a reminder email.'
          : 'Payment 1 is charged when your client signs. The rest are charged automatically on their dates to the same card or bank account, and your client gets an email 3 days before each one.'}
      </p>
    </div>
  );
}

/** Today's date in the browser's calendar (the venue's own day). */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** When a one-time invoice is due. Empty = due on receipt (no reminders). */
export function DueDateField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const today = todayLocal();
  const presets = [
    { label: 'On receipt', v: '' },
    { label: '7 days', v: addDaysYmd(today, 7) },
    { label: '14 days', v: addDaysYmd(today, 14) },
    { label: '30 days', v: addDaysYmd(today, 30) },
  ];
  const custom = value !== '' && !presets.some((p) => p.v === value);
  return (
    <div>
      <label className={SMALL_LABEL}>Due</label>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button key={p.label} type="button" disabled={disabled} onClick={() => onChange(p.v)} className={chip(value === p.v)}>
            {p.label}
          </button>
        ))}
        <input
          type="date"
          disabled={disabled}
          min={today}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`rounded-2xl border-2 px-3 py-1.5 text-sm focus:outline-none ${custom ? 'border-gray-900' : 'border-gray-200'}`}
          aria-label="Due date"
        />
      </div>
      <p className="mt-1.5 text-xs text-gray-400">
        {value
          ? `Due ${formatYmd(value)}. If it isn’t paid by then, your client gets a reminder email.`
          : 'Due when your client receives it. No reminder emails.'}
      </p>
    </div>
  );
}
