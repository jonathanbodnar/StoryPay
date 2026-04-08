'use client';

import { useState } from 'react';
import { X, Loader2, AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react';

interface RefundModalProps {
  proposalId: string;
  chargeId?: string | null;
  customerName: string;
  originalAmount: number; // in cents
  onSuccess: (fullRefund: boolean) => void;
  onClose: () => void;
}

function formatCents(c: number) {
  return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function RefundModal({
  proposalId, chargeId, customerName, originalAmount, onSuccess, onClose,
}: RefundModalProps) {
  const [type, setType]           = useState<'full' | 'partial'>('full');
  const [partialDollars, setPartialDollars] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(false);
  const [result, setResult]       = useState<{ refundedAmount: number; fullRefund: boolean } | null>(null);

  const partialCents = Math.round(parseFloat(partialDollars || '0') * 100);
  const refundCents  = type === 'full' ? originalAmount : partialCents;
  const valid        = type === 'full' || (partialCents > 0 && partialCents <= originalAmount);

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
          chargeId,
          amountCents: type === 'partial' ? partialCents : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Refund failed'); return; }
      setResult(data);
      setDone(true);
      onSuccess(data.fullRefund);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50">
              <RotateCcw size={16} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Issue Refund</h3>
              <p className="text-xs text-gray-400 mt-0.5">{customerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 transition-colors">
            <X size={15} />
          </button>
        </div>

        {done && result ? (
          /* Success state */
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">Refund Issued</p>
              <p className="text-sm text-gray-500 mt-1">
                {formatCents(result.refundedAmount)} has been refunded to {customerName}.
              </p>
              {!result.fullRefund && (
                <p className="text-xs text-gray-400 mt-1">Partial refund — transaction remains active.</p>
              )}
            </div>
            <button onClick={onClose} className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90" style={{ backgroundColor: '#293745' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {/* Original amount */}
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-gray-500">Original charge</span>
              <span className="text-base font-bold text-gray-900">{formatCents(originalAmount)}</span>
            </div>

            {/* Refund type */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2.5">Refund Type</p>
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
                  Full Refund
                  <span className="block text-xs font-normal mt-0.5 opacity-70">{formatCents(originalAmount)}</span>
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
                  Partial Refund
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
                    max={(originalAmount / 100).toFixed(2)}
                    value={partialDollars}
                    onChange={e => setPartialDollars(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-8 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:bg-white transition-colors"
                    style={{ fontSize: 16 }}
                  />
                </div>
                {partialCents > 0 && partialCents <= originalAmount && (
                  <p className="text-xs text-gray-400 mt-1">
                    Remaining after refund: {formatCents(originalAmount - partialCents)}
                  </p>
                )}
                {partialCents > originalAmount && (
                  <p className="text-xs text-red-500 mt-1">Cannot exceed original charge of {formatCents(originalAmount)}</p>
                )}
              </div>
            )}

            {/* Warning */}
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-3">
              <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700 leading-relaxed">
                {type === 'full'
                  ? 'This will issue a full refund of ' + formatCents(originalAmount) + ' to the client. This cannot be undone.'
                  : partialCents > 0
                    ? 'This will refund ' + formatCents(partialCents) + ' to the client. The remaining balance stays paid.'
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
                  : `Refund ${type === 'full' ? formatCents(originalAmount) : partialCents > 0 ? formatCents(refundCents) : '...'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
