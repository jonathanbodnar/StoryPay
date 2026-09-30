'use client';

import { useState } from 'react';
import { X, Loader2, AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react';

interface RefundModalProps {
  proposalId: string;
  /** The payment to refund (a payment-ledger row). */
  paymentId?: string | null;
  /** Older bookings without a ledger row: the charge to refund. */
  chargeId?: string | null;
  customerName: string;
  /** The payment's amount, in cents. */
  originalAmount: number;
  /** Already refunded from this payment, in cents. */
  refundedAmount?: number;
  /** The booking still has automatic payments scheduled. */
  hasScheduledPayments?: boolean;
  onSuccess: (fullRefund: boolean) => void;
  onClose: () => void;
}

function formatCents(c: number) {
  return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function RefundModal({
  proposalId, paymentId, chargeId, customerName, originalAmount, refundedAmount = 0, hasScheduledPayments, onSuccess, onClose,
}: RefundModalProps) {
  const refundable = Math.max(originalAmount - refundedAmount, 0);
  const [type, setType]           = useState<'full' | 'partial'>('full');
  const [partialDollars, setPartialDollars] = useState('');
  const [cancelRemaining, setCancelRemaining] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError]         = useState('');
  const [result, setResult]       = useState<{ refundedAmount: number; fullRefund: boolean; message?: string } | null>(null);

  const partialCents = Math.round(parseFloat(partialDollars || '0') * 100);
  const refundCents  = type === 'full' ? refundable : partialCents;
  const valid        = refundable > 0 && (type === 'full' || (partialCents > 0 && partialCents <= refundable));

  async function submit() {
    if (!valid) return;
    setProcessing(true);
    setError('');
    try {
      const res = await fetch('/api/transactions/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId,
          paymentId: paymentId || undefined,
          chargeId,
          amountCents: type === 'partial' ? partialCents : null,
          cancelRemaining: hasScheduledPayments ? cancelRemaining : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Refund failed'); return; }
      setResult(data);
      onSuccess(data.fullRefund);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl bg-white overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50">
              <RotateCcw size={16} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Refund payment</h3>
              <p className="text-xs text-gray-400 mt-0.5">{customerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 transition-colors">
            <X size={15} />
          </button>
        </div>

        {result ? (
          /* Success state */
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">Refund issued</p>
              <p className="text-sm text-gray-500 mt-1">
                {result.message || `${formatCents(result.refundedAmount)} has been refunded to ${customerName}.`}
              </p>
              <p className="text-xs text-gray-400 mt-2">It usually reaches their card or bank account in 5–10 business days.</p>
            </div>
            <button onClick={onClose} className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90" style={{ backgroundColor: '#1b1b1b' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {/* This payment */}
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">This payment</span>
                <span className="text-base font-bold text-gray-900">{formatCents(originalAmount)}</span>
              </div>
              {refundedAmount > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Already refunded</span>
                  <span>{formatCents(refundedAmount)}</span>
                </div>
              )}
            </div>

            {/* Refund type */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2.5">Refund</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType('full')}
                  className={`rounded-xl border-2 py-3 text-sm font-semibold transition-all ${
                    type === 'full'
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {refundedAmount > 0 ? 'The rest' : 'Full refund'}
                  <span className="block text-xs font-normal mt-0.5 opacity-70">{formatCents(refundable)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setType('partial')}
                  className={`rounded-xl border-2 py-3 text-sm font-semibold transition-all ${
                    type === 'partial'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  Part of it
                  <span className="block text-xs font-normal mt-0.5 opacity-70">Custom amount</span>
                </button>
              </div>
            </div>

            {/* Partial amount input */}
            {type === 'partial' && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Refund Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={(refundable / 100).toFixed(2)}
                    value={partialDollars}
                    onChange={e => setPartialDollars(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-8 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:bg-white transition-colors"
                    style={{ fontSize: 16 }}
                  />
                </div>
                {partialCents > refundable && (
                  <p className="text-xs text-red-500 mt-1">You can refund up to {formatCents(refundable)} of this payment.</p>
                )}
              </div>
            )}

            {/* The plan's remaining payments */}
            {hasScheduledPayments && (
              <label className="flex items-start gap-2.5 rounded-xl border border-gray-200 px-3.5 py-3 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={cancelRemaining}
                  onChange={(e) => setCancelRemaining(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  <span className="font-semibold text-gray-800">Also cancel the remaining automatic payments.</span>{' '}
                  For a booking that&apos;s off. Leave unchecked and the plan keeps running as scheduled.
                </span>
              </label>
            )}

            {/* What happens */}
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-3">
              <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700 leading-relaxed">
                {refundCents > 0
                  ? `${formatCents(refundCents)} goes back to your client's card or bank account. It can't be undone, and they won't be charged this amount again.`
                  : 'Enter an amount to refund.'}
              </p>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!valid || processing}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {processing
                  ? <><Loader2 size={14} className="animate-spin" /> Processing...</>
                  : `Refund ${refundCents > 0 ? formatCents(refundCents) : '...'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
