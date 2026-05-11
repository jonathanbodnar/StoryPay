'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Eye, X, RotateCcw, User } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import PaymentGate from '@/components/PaymentGate';
import RefundModal from '@/components/RefundModal';

interface Charge {
 id: string;
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

function TransactionsPageInner() {
 const [charges, setCharges] = useState<Charge[]>([]);
 const [loading, setLoading] = useState(true);
 const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
 const [refundTarget, setRefundTarget] = useState<Charge | null>(null);

 useEffect(() => {
 setLoading(true);
 fetch('/api/transactions?type=charges')
 .then((res) => (res.ok ? res.json() : []))
 .then((data) => {
 const items = Array.isArray(data) ? data : data.data ?? [];
 setCharges(items);
 })
 .catch(() => {})
 .finally(() => setLoading(false));
 }, []);

 return (
 <div>
 <div className="mb-8">
 <h1 className="font-heading text-2xl font-semibold text-gray-900">Transactions</h1>
 <p className="mt-1 text-sm text-gray-500">Payment history and charge records</p>
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
 <div className="hidden sm:grid grid-cols-[1fr_90px_90px_100px_auto] gap-2 px-5 py-2.5 bg-gray-50/60">
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
 <p className="text-sm font-medium text-gray-900 flex-1">{c.description}</p>
 <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize flex-shrink-0', color.bg, color.text)}>{c.status}</span>
 </div>
 <div className="flex items-center justify-between gap-2">
 <div>
 <p className="text-sm font-semibold text-gray-800">{formatCents(c.amount)}</p>
 <p className="text-xs text-gray-400">{formatDate(c.date)}</p>
 </div>
 <div className="flex items-center gap-1 flex-wrap justify-end">
 {c.customerId && (
 <Link href={`/dashboard/contacts/${c.customerId}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <User size={12} /> Customer
 </Link>
 )}
 <button onClick={() => setSelectedCharge(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <Eye size={12} /> View
 </button>
{c.status !== 'refunded' && c.status !== 'partial_refund' && (
<button onClick={() => setRefundTarget(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
<RotateCcw size={12} /> Refund
</button>
)}
</div>
</div>
</div>
{/* Desktop row */}
 <div className="hidden sm:grid grid-cols-[1fr_90px_90px_100px_auto] gap-2 px-5 py-3.5 items-center">
 <p className="text-sm font-medium text-gray-900 truncate">{c.description}</p>
 <p className="text-sm text-gray-700">{formatCents(c.amount)}</p>
 <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize w-fit', color.bg, color.text)}>{c.status}</span>
 <p className="text-sm text-gray-500">{formatDate(c.date)}</p>
 <div className="flex items-center justify-end gap-1">
 {c.customerId && (
 <Link href={`/dashboard/contacts/${c.customerId}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <User size={13} /> View Customer
 </Link>
 )}
 <button onClick={() => setSelectedCharge(c)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">
 <Eye size={13} /> View Transaction
 </button>
{c.status !== 'refunded' && c.status !== 'partial_refund' && (
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
 proposalId={refundTarget.id}
 chargeId={refundTarget.chargeId}
 customerName={refundTarget.customerName || refundTarget.description}
 originalAmount={refundTarget.amount}
onSuccess={(fullRefund) => {
setCharges(prev => prev.map(c => c.id === refundTarget.id ? { ...c, status: fullRefund ? 'refunded' : 'partial_refund' } : c));
setRefundTarget(null);
}}
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
 {selectedCharge.status}
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
<dd className="text-sm text-gray-700">{formatDate(selectedCharge.refundedAt)}</dd>
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
