'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { formatCents, formatDate } from '@/lib/utils';

export interface RecordPaymentProposal {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  price: number;
}

interface LedgerPayment {
  id: string;
  payment_number: number | null;
  amount_cents: number;
  method: 'cash' | 'check' | 'other' | 'cc' | 'ach';
  source?: 'manual' | 'online';
  check_number: string | null;
  note: string | null;
  recorded_by: string | null;
  paid_at: string;
}

export function paymentMethodLabel(method: string, checkNumber?: string | null): string {
  if (method === 'check') return checkNumber ? `Check #${checkNumber}` : 'Check';
  if (method === 'cash') return 'Cash';
  if (method === 'cc') return 'Card';
  if (method === 'ach') return 'Bank (ACH)';
  return 'Other';
}

export default function RecordPaymentModal({ proposal, onClose, onSaved }: {
  proposal: RecordPaymentProposal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [payments, setPayments] = useState<LedgerPayment[]>([]);
  const [priceCents, setPriceCents] = useState(proposal.price);
  const [balanceCents, setBalanceCents] = useState(proposal.price);
  const [totalPaidCents, setTotalPaidCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'check' | 'other'>('cash');
  const [checkNumber, setCheckNumber] = useState('');
  const [note, setNote] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/payments`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setPayments(Array.isArray(data.payments) ? data.payments : []);
        setPriceCents(data.price_cents ?? proposal.price);
        setBalanceCents(data.balance_cents ?? proposal.price);
        setTotalPaidCents(data.total_paid_cents ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [proposal.id, proposal.price]);

  useEffect(() => { void load(); }, [load]);

  async function record() {
    setError('');
    const cents = Math.round(parseFloat(amount.replace(/,/g, '') || '0') * 100);
    if (!cents || cents <= 0) { setError('Enter an amount greater than $0.'); return; }
    if (method === 'check' && !checkNumber.trim()) { setError('Enter the check number.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: cents, method, checkNumber: checkNumber.trim() || undefined, note: note.trim() || undefined, sendReceipt }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError((data && data.error) || 'Failed to record payment.'); return; }
      setAmount(''); setCheckNumber(''); setNote('');
      await load();
      onSaved();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function removePayment(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/payments/${id}`, { method: 'DELETE' });
      if (res.ok) { await load(); onSaved(); }
    } finally {
      setDeletingId(null);
    }
  }

  const isPaid = balanceCents <= 0 && totalPaidCents > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Record payment</h2>
            <p className="text-xs text-gray-400">{proposal.customer_name || 'Customer'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Balance summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Total</p>
              <p className="text-sm font-bold text-gray-900">{formatCents(priceCents)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-emerald-500 font-semibold">Paid</p>
              <p className="text-sm font-bold text-emerald-700">{formatCents(totalPaidCents)}</p>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-amber-500 font-semibold">Balance</p>
              <p className="text-sm font-bold text-amber-700">{formatCents(balanceCents)}</p>
            </div>
          </div>

          {/* Existing payments */}
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
          ) : payments.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Payments</p>
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800">
                      {p.payment_number != null && <span className="text-gray-400 font-normal mr-1.5">#{p.payment_number}</span>}
                      {formatCents(p.amount_cents)} <span className="text-gray-400 font-normal">· {paymentMethodLabel(p.method, p.check_number)}</span>
                    </p>
                    <p className="text-xs text-gray-400 truncate">{formatDate(p.paid_at)}{p.note ? ` · ${p.note}` : ''}{p.recorded_by ? ` · ${p.recorded_by}` : ''}</p>
                  </div>
                  {p.source !== 'online' && (
                    <button onClick={() => removePayment(p.id)} disabled={deletingId === p.id} className="text-gray-300 hover:text-red-500 transition-colors p-1 disabled:opacity-50" title="Remove">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isPaid ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-700 font-medium text-center">
              Paid in full
            </div>
          ) : (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Add a payment</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input type="text" inputMode="decimal" value={amount}
                      onChange={e => { if (/^[0-9.,]*$/.test(e.target.value)) setAmount(e.target.value); }}
                      placeholder="0.00" className="w-full rounded-xl border border-gray-200 pl-7 pr-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Method</label>
                  <select value={method} onChange={e => setMethod(e.target.value as 'cash' | 'check' | 'other')}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none appearance-none bg-white">
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              {method === 'check' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Check number</label>
                  <input type="text" value={checkNumber} onChange={e => setCheckNumber(e.target.value)}
                    placeholder="e.g. 1042" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Note <span className="text-gray-300">(optional)</span></label>
                <input type="text" value={note} onChange={e => setNote(e.target.value)}
                  placeholder="e.g. Deposit collected at tour" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none" />
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={sendReceipt} onChange={e => setSendReceipt(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-900/20" />
                <span className="text-xs text-gray-600">Email a receipt to {proposal.customer_email || 'the client'}</span>
              </label>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <button onClick={record} disabled={saving}
                className="w-full rounded-xl bg-brand-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 transition disabled:opacity-50">
                {saving ? 'Recording…' : 'Record payment'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
