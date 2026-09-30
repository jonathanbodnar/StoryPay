'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Eye, X, RotateCcw, User, FileText } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import PaymentGate from '@/components/PaymentGate';
import RefundModal from '@/components/RefundModal';

interface Charge {
 id: string;
 /** The payment-ledger row (one per payment); null for an older booking without one. */
 paymentId?: string | null;
 proposalId?: string | null;
 paymentNumber?: number | null;
 method?: string | null;
 online?: boolean;
 refundedCents?: number;
 hasScheduledPayments?: boolean;
 invoiceNumber?: string | null;
 description: string;
 amount: number;
 fullInvoiceAmount?: number;
 paymentType?: string;
 status: string;
 date: string;
 refundedAt?: string | null;
 chargeId?: string;
 transactionId?: string;
 sessionId?: string;
 customerId?: string | number | null;
 customerName?: string | null;
}

const STATUS_LABEL: Record<string, string> = { paid: 'Paid', refunded: 'Refunded', partial_refund: 'Partly refunded' };

/** Online payments with something left to refund (and older bookings the refund route still handles). */
function canRefund(c: Charge): boolean {
 if (c.paymentId) return !!c.online && (c.refundedCents ?? 0) < c.amount;
 return c.status !== 'refunded' && c.status !== 'partial_refund';
}

function TransactionsPageInner() {
 const [charges, setCharges] = useState<Charge[]>([]);
 const [loading, setLoading] = useState(true);
 const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
 const [refundTarget, setRefundTarget] = useState<Charge | null>(null);

 function load() {
 fetch('/api/transactions?type=charges', { cache: 'no-store' })
 .then((res) => (res.ok ? res.json() : []))
 .then((data) => {
 const items = Array.isArray(data) ? data : data.data ?? [];
 setCharges(items);
 })
 .catch(() => {})
 .finally(() => setLoading(false));
 }

 useEffect(() => { load(); }, []);

 return (
 <div>
 <div className="mb-8">
 <h1 className="font-heading text-2xl font-semibold text-gray-900">Transactions</h1>
 <p className="mt-1 text-sm text-gray-500">Every payment received: card, bank, cash and check. Refund a payment from here or from its booking.</p>
 </div>

 {loading ? (
 <div className="flex items-center justify-center py-20">
 <Loader2 className="animate-spin text-gray-400"size={24} />
 </div>
 ) : (
 <div className="rounded-2xl border border-gray-200 overflow-hidden">
 {charges.length === 0 ? (
 <p className="px-5 py-8 text-center text-gray-400 text-sm">No charges yet</p>
 ) : (
 <div className="divide-y divide-gray-200">
 {/* Desktop header */}
 <div className="hidden sm:grid grid-cols-[1fr_110px_110px_100px_auto] gap-2 px-5 py-2.5 bg-gray-50/60">
 {['Description','Amount','Status','Date','Actions'].map(h => (
 <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
 ))}
 </div>
 {charges.map((c) => {
 const color = getStatusColor(c.status);
 return (
 <div key={c.id} className="hover:bg-gray-50/50 transition-colors">
 {/* Mobile card */}
 <div className="sm:hidden px-4 py-3.5 space-y-2">
 <div className="flex items-start justify-between gap-2">
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-gray-900">{c.description}</p>
 {c.method && <p className="text-xs text-gray-400">{c.method}{c.paymentNumber ? ` · #${c.paymentNumber}` : ''}</p>}
 </div>
 <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium flex-shrink-0', color.bg, color.text)}>{STATUS_LABEL[c.status] ?? c.status}</span>
 </div>
 <div className="flex items-center justify-between gap-2">
 <div>
 <p className="text-sm font-semibold text-gray-800">{formatCents(c.amount)}</p>
 {(c.refundedCents ?? 0) > 0 && <p className="text-xs text-red-600">{formatCents(c.refundedCents ?? 0)} refunded</p>}
 <p className="text-xs text-gray-400">{formatDate(c.date)}</p>
 </div>
 <div className="flex items-center gap-1 flex-wrap justify-end">
 {c.proposalId && (
 <Link href={`/dashboard/proposals/${c.proposalId}`} prefetch={false} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <FileText size={12} /> Booking
 </Link>
 )}
 {c.customerId && (
 <Link href={`/dashboard/contacts/${c.customerId}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <User size={12} /> Customer
 </Link>
 )}
 <button onClick={() => setSelectedCharge(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <Eye size={12} /> View
 </button>
{canRefund(c) && (
<button onClick={() => setRefundTarget(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
<RotateCcw size={12} /> Refund
</button>
)}
</div>
</div>
</div>
{/* Desktop row */}
 <div className="hidden sm:grid grid-cols-[1fr_110px_110px_100px_auto] gap-2 px-5 py-3.5 items-center">
 <div className="min-w-0">
 <p className="text-sm font-medium text-gray-900 truncate">{c.description}</p>
 {c.method && <p className="text-xs text-gray-400 truncate">{c.method}{c.paymentNumber ? ` · #${c.paymentNumber}` : ''}</p>}
 </div>
 <div>
 <p className="text-sm text-gray-700">{formatCents(c.amount)}</p>
 {(c.refundedCents ?? 0) > 0 && <p className="text-[11px] text-red-600">{formatCents(c.refundedCents ?? 0)} refunded</p>}
 </div>
 <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium w-fit', color.bg, color.text)}>{STATUS_LABEL[c.status] ?? c.status}</span>
 <p className="text-sm text-gray-500">{formatDate(c.date)}</p>
 <div className="flex items-center justify-end gap-1">
 {c.proposalId && (
 <Link href={`/dashboard/proposals/${c.proposalId}`} prefetch={false} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <FileText size={13} /> Booking
 </Link>
 )}
 {c.customerId && (
 <Link href={`/dashboard/contacts/${c.customerId}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <User size={13} /> View Customer
 </Link>
 )}
 <button onClick={() => setSelectedCharge(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <Eye size={13} /> View Transaction
 </button>
{canRefund(c) && (
<button onClick={() => setRefundTarget(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
<RotateCcw size={13} /> Refund
</button>
)}
</div>
</div>
</div>
);
})}
</div>
)}
</div>
)}

 {/* Refund Modal */}
 {refundTarget && (
 <RefundModal
 proposalId={refundTarget.proposalId || refundTarget.id}
 paymentId={refundTarget.paymentId}
 chargeId={refundTarget.chargeId}
 customerName={refundTarget.customerName || refundTarget.description}
 originalAmount={refundTarget.amount}
 refundedAmount={refundTarget.refundedCents ?? 0}
 hasScheduledPayments={refundTarget.hasScheduledPayments}
 onSuccess={() => load()}
 onClose={() => setRefundTarget(null)}
 />
 )}

 {/* Charge Detail Modal */}
 {selectedCharge && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
 <div className="relative w-full max-w-md rounded-2xl bg-white p-6">
 <button
 onClick={() => setSelectedCharge(null)}
 className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
 >
 <X size={20} />
 </button>

 <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">Transaction Details</h2>

 <dl className="space-y-4">
 <div className="flex justify-between border-b border-gray-200 pb-3">
 <dt className="text-sm font-medium text-gray-500">Description</dt>
 <dd className="text-sm font-semibold text-gray-900">{selectedCharge.description}</dd>
 </div>
 <div className="flex justify-between border-b border-gray-200 pb-3">
<dt className="text-sm font-medium text-gray-500">Amount Paid</dt>
<dd className="text-sm font-semibold text-gray-900">{formatCents(selectedCharge.amount)}</dd>
</div>
{selectedCharge.fullInvoiceAmount && selectedCharge.fullInvoiceAmount !== selectedCharge.amount && (
<div className="flex justify-between border-b border-gray-200 pb-3">
<dt className="text-sm font-medium text-gray-500">Full Invoice</dt>
<dd className="text-sm text-gray-700">{formatCents(selectedCharge.fullInvoiceAmount)} {selectedCharge.paymentType === 'installment' ? '(installment plan)' : '(subscription)'}</dd>
</div>
)}
 <div className="flex justify-between border-b border-gray-200 pb-3">
 <dt className="text-sm font-medium text-gray-500">Status</dt>
 <dd>
 <span
 className={classNames(
 'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
 getStatusColor(selectedCharge.status).bg,
 getStatusColor(selectedCharge.status).text
 )}
 >
 {STATUS_LABEL[selectedCharge.status] ?? selectedCharge.status}
 </span>
 </dd>
 </div>
 <div className="flex justify-between border-b border-gray-200 pb-3">
 <dt className="text-sm font-medium text-gray-500">Date</dt>
 <dd className="text-sm text-gray-700">{formatDate(selectedCharge.date)}</dd>
 </div>
 {selectedCharge.chargeId && (
 <div className="flex justify-between border-b border-gray-200 pb-3">
 <dt className="text-sm font-medium text-gray-500">Charge ID</dt>
 <dd className="text-sm font-mono text-gray-700 break-all text-right max-w-[60%]">{selectedCharge.chargeId}</dd>
 </div>
 )}
 {selectedCharge.transactionId && (
 <div className="flex justify-between border-b border-gray-200 pb-3">
 <dt className="text-sm font-medium text-gray-500">Transaction ID</dt>
 <dd className="text-sm font-mono text-gray-700 break-all text-right max-w-[60%]">{selectedCharge.transactionId}</dd>
 </div>
 )}
{selectedCharge.sessionId && (
<div className="flex justify-between border-b border-gray-200 pb-3">
<dt className="text-sm font-medium text-gray-500">Session ID</dt>
<dd className="text-sm font-mono text-gray-700 break-all text-right max-w-[60%]">{selectedCharge.sessionId}</dd>
</div>
)}
{selectedCharge.refundedAt && (
<div className="flex justify-between">
<dt className="text-sm font-medium text-gray-500">Refunded</dt>
<dd className="text-sm text-gray-700">{(selectedCharge.refundedCents ?? 0) > 0 ? `${formatCents(selectedCharge.refundedCents ?? 0)} · ` : ''}{formatDate(selectedCharge.refundedAt)}</dd>
</div>
)}
</dl>

 <div className="mt-6 flex justify-end">
 <button
 onClick={() => setSelectedCharge(null)}
 className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
 >
 Close
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
}

export default function TransactionsPage() {
  return <PaymentGate><TransactionsPageInner /></PaymentGate>;
}
