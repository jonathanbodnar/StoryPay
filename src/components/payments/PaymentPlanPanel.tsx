'use client';

/**
 * A client's payment plan on their booking page: every payment with its
 * status, and the venue's tools for automatic plans (change a date, move the
 * rest a month, charge now, cancel the rest, send a card-update link, record
 * a check). Data and actions: /api/proposals/[id]/plan.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarClock, CreditCard, Zap, Ban, Wallet, Mail } from 'lucide-react';
import { formatCents, formatDate, classNames } from '@/lib/utils';

interface PlanPayment {
  id: string | null;
  number: number;
  amount_cents: number | null;
  due_date: string | null;
  status: string;
  last_error?: string | null;
  heads_up_sent?: boolean;
}

interface Plan {
  auto: boolean;
  status: string;
  price_cents: number;
  paid_cents: number;
  balance_cents: number;
  customer_email: string | null;
  card: string | null;
  payments: PlanPayment[];
}

const BADGE: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
  covered: { label: 'Covered', cls: 'bg-emerald-50 text-emerald-700' },
  scheduled: { label: 'Scheduled', cls: 'bg-sky-50 text-sky-700' },
  processing: { label: 'Processing', cls: 'bg-amber-50 text-amber-700' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
  canceled: { label: 'Canceled', cls: 'bg-gray-100 text-gray-500' },
  due: { label: 'Due', cls: 'bg-amber-50 text-amber-700' },
  overdue: { label: 'Overdue', cls: 'bg-red-50 text-red-700' },
  upcoming: { label: 'Upcoming', cls: 'bg-gray-100 text-gray-600' },
};

const BTN =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50';

function tomorrowYmd(): string {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PaymentPlanPanel({
  proposalId,
  onChanged,
  onRecordPayment,
}: {
  proposalId: string;
  /** The ledger or status may have changed (a payment was charged). */
  onChanged?: () => void;
  onRecordPayment?: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; date: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/plan`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok) setPlan((data?.plan as Plan | null) ?? null);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => { void load(); }, [load]);

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setNote(null);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      setNote(res.ok ? { ok: true, text: data?.message || 'Done.' } : { ok: false, text: data?.error || 'That didn’t work. Please try again.' });
      setEditing(null);
      setConfirmCancel(false);
      await load();
      onChanged?.();
    } catch {
      setNote({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="mb-6 flex justify-center rounded-2xl border border-gray-200 bg-white p-6">
        <Loader2 size={18} className="animate-spin text-gray-300" />
      </div>
    );
  }
  if (!plan || !plan.payments.length) return null;

  const paidCount = plan.payments.filter((p) => p.status === 'paid' || p.status === 'covered').length;
  const open = plan.payments.filter((p) => p.id && (p.status === 'scheduled' || p.status === 'failed'));
  const next = open.filter((p) => p.status === 'scheduled').sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
  const stopped = ['refunded', 'partial_refund', 'cancelled'].includes(plan.status);

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Payment plan</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {paidCount} of {plan.payments.length} paid · Balance {formatCents(plan.balance_cents)}
            {next?.due_date && next.amount_cents ? ` · Next: ${formatCents(next.amount_cents)} on ${formatDate(next.due_date)}` : ''}
          </p>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        {plan.auto
          ? `Charged automatically${plan.card ? ` to ${plan.card}` : ''}. Your client gets an email 3 days before each payment.`
          : 'Collected by cash or check. Record each payment as it comes in; overdue payments get a reminder email.'}
      </p>

      {note && (
        <div className={classNames('mb-3 rounded-xl px-4 py-2.5 text-xs', note.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>{note.text}</div>
      )}

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
        {plan.payments.map((p) => {
          const badge = BADGE[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' };
          const canChange = plan.auto && !stopped && !!p.id && (p.status === 'scheduled' || p.status === 'failed');
          const isEditing = editing?.id === p.id;
          return (
            <div key={`${p.number}-${p.id ?? 'first'}`} className="px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-500">{p.number}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{p.amount_cents != null ? formatCents(p.amount_cents) : '—'}</p>
                  <p className="text-xs text-gray-400">{p.due_date ? formatDate(p.due_date) : '—'}</p>
                </div>
                <span className={classNames('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', badge.cls)}>{badge.label}</span>
                {canChange && !isEditing && (
                  <div className="flex gap-1.5">
                    <button type="button" className={BTN} disabled={!!busy} onClick={() => setEditing({ id: p.id as string, date: p.due_date && p.due_date > tomorrowYmd() ? p.due_date : tomorrowYmd() })}>
                      <CalendarClock size={13} /> Change date
                    </button>
                    <button
                      type="button"
                      className={BTN}
                      disabled={!!busy}
                      onClick={() => {
                        if (confirm(`Charge ${p.amount_cents != null ? formatCents(p.amount_cents) : 'this payment'} now to ${plan.card || 'the saved card'}?`)) {
                          void act(`charge-${p.id}`, { action: 'charge_now', installmentId: p.id });
                        }
                      }}
                    >
                      {busy === `charge-${p.id}` ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Charge now
                    </button>
                  </div>
                )}
              </div>
              {p.status === 'failed' && p.last_error && <p className="mt-1.5 pl-9 text-xs text-red-600">{p.last_error}</p>}
              {isEditing && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-9">
                  <input
                    type="date"
                    min={tomorrowYmd()}
                    value={editing.date}
                    onChange={(e) => setEditing({ id: editing.id, date: e.target.value })}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!!busy || !editing.date}
                    onClick={() => void act(`date-${p.id}`, { action: 'reschedule', installmentId: p.id, date: editing.date })}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {busy === `date-${p.id}` ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plan.auto && !stopped && (
        <div className="mt-4 flex flex-wrap gap-2">
          {open.length > 0 && (
            <button type="button" className={BTN} disabled={!!busy} onClick={() => void act('push', { action: 'push_all', months: 1 })}>
              {busy === 'push' ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />} Move remaining payments 1 month later
            </button>
          )}
          {plan.customer_email && (
            <button type="button" className={BTN} disabled={!!busy} onClick={() => void act('card', { action: 'send_card_link' })}>
              {busy === 'card' ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Send card update link
            </button>
          )}
          {onRecordPayment && plan.balance_cents > 0 && (
            <button type="button" className={BTN} disabled={!!busy} onClick={onRecordPayment}>
              <Wallet size={13} /> Record a check or cash payment
            </button>
          )}
          {open.length > 0 && !confirmCancel && (
            <button type="button" className={`${BTN} text-red-600`} disabled={!!busy} onClick={() => setConfirmCancel(true)}>
              <Ban size={13} /> Cancel remaining payments
            </button>
          )}
        </div>
      )}
      {confirmCancel && (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-800">
          <p className="mb-2">
            Stop the {open.length} remaining automatic payment{open.length === 1 ? '' : 's'}? Nothing more is charged to your client&apos;s card. The balance
            of {formatCents(plan.balance_cents)} stays on the booking for you to collect another way.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => void act('cancel', { action: 'cancel_remaining' })} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              {busy === 'cancel' ? 'Canceling…' : 'Yes, cancel them'}
            </button>
            <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-lg px-3 py-1.5 text-red-800 hover:bg-red-100">Keep the plan</button>
          </div>
        </div>
      )}
      {plan.auto && plan.card === null && plan.payments.some((p) => p.status === 'failed') && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500"><CreditCard size={12} /> Send your client a card update link, and the failed payment is retried once they add a card.</p>
      )}
    </div>
  );
}
