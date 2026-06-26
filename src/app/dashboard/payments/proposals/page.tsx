'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Search, X, Loader2, FileText, Send, Plus, Pencil, Eye, Trash2, Wallet } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import PaymentGate from '@/components/PaymentGate';

interface Proposal {
 id: string;
 customer_name: string | null;
 customer_email: string | null;
 customer_lunarpay_id: number | string | null;
 status: string;
 price: number;
 payment_type: string;
 public_token: string;
 sent_at: string | null;
 created_at: string;
 template_id?: string | null;
 collect_manually?: boolean;
 total_paid_cents?: number;
}

interface ManualPayment {
 id: string;
 amount_cents: number;
 method: 'cash' | 'check' | 'other';
 check_number: string | null;
 note: string | null;
 recorded_by: string | null;
 paid_at: string;
}

function methodLabel(method: string, checkNumber?: string | null): string {
 if (method === 'check') return checkNumber ? `Check #${checkNumber}` : 'Check';
 if (method === 'cash') return 'Cash';
 return 'Other';
}

function statusLabel(status: string): string {
 if (status === 'partially_paid') return 'Partial';
 return status;
}

/** Manual-collection proposals/invoices the owner can still record payments against. */
function canRecord(p: Proposal): boolean {
 return p.collect_manually === true && p.status !== 'draft';
}

function RecordPaymentModal({ proposal, onClose, onSaved }: {
 proposal: Proposal;
 onClose: () => void;
 onSaved: () => void;
}) {
 const [payments, setPayments] = useState<ManualPayment[]>([]);
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
       <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Recorded payments</p>
       {payments.map(p => (
        <div key={p.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2 text-sm">
         <div className="min-w-0">
          <p className="font-medium text-gray-800">{formatCents(p.amount_cents)} <span className="text-gray-400 font-normal">· {methodLabel(p.method, p.check_number)}</span></p>
          <p className="text-xs text-gray-400 truncate">{formatDate(p.paid_at)}{p.note ? ` · ${p.note}` : ''}{p.recorded_by ? ` · ${p.recorded_by}` : ''}</p>
         </div>
         <button onClick={() => removePayment(p.id)} disabled={deletingId === p.id} className="text-gray-300 hover:text-red-500 transition-colors p-1 disabled:opacity-50" title="Remove">
          <Trash2 size={13} />
         </button>
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

function PaymentsProposalsPageInner() {
 const [proposals, setProposals] = useState<Proposal[]>([]);
 const [loading, setLoading] = useState(true);
 const [loadError, setLoadError] = useState<string | null>(null);
 const [search, setSearch] = useState('');
 const [copiedId, setCopiedId] = useState<string | null>(null);
 const [sendingId, setSendingId] = useState<string | null>(null);
 const [deletingId, setDeletingId] = useState<string | null>(null);
 const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
 const [recordingFor, setRecordingFor] = useState<Proposal | null>(null);

 async function fetchProposals() {
   setLoading(true);
   setLoadError(null);
   try {
     const res = await fetch('/api/proposals', { cache: 'no-store' });
     const data = await res.json().catch(() => null);
     if (!res.ok) {
       setLoadError(
         (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string')
           ? data.error
           : `Failed to load proposals (HTTP ${res.status})`
       );
       setProposals([]);
       return;
     }
     setProposals(Array.isArray(data) ? data : []);
   } catch (e) {
     setLoadError(e instanceof Error ? e.message : 'Network error');
     setProposals([]);
   } finally {
     setLoading(false);
   }
 }

 useEffect(() => { void fetchProposals(); }, []);

 function copyLink(p: Proposal) {
 navigator.clipboard.writeText(`${window.location.origin}/proposal/${p.public_token}`);
 setCopiedId(p.id); setTimeout(()=>setCopiedId(null),2000);
 }

 async function resend(p: Proposal) {
 setSendingId(p.id);
 try {
 await fetch(`/api/proposals/${p.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sendNow:true}) });
 fetchProposals();
 } finally { setSendingId(null); }
 }

 async function deleteDraft(id: string) {
 setDeletingId(id);
 try {
 await fetch(`/api/proposals/${id}`, { method: 'DELETE' });
 setProposals(prev => prev.filter(p => p.id !== id));
 } finally {
 setDeletingId(null);
 setConfirmDelete(null);
 }
 }

 const filtered = useMemo(() => {
 if (!search.trim()) return proposals;
 const q = search.toLowerCase();
 return proposals.filter(p =>
 p.customer_name?.toLowerCase().includes(q) ||
 p.customer_email?.toLowerCase().includes(q) ||
 p.status?.toLowerCase().includes(q) ||
 p.payment_type?.toLowerCase().includes(q) ||
 String(p.price/100).includes(q) ||
 (p.sent_at && formatDate(p.sent_at).toLowerCase().includes(q))
 );
 }, [proposals, search]);

 const drafts = filtered.filter(p=>p.status==='draft');
 const sent = filtered.filter(p=>p.status!=='draft');

 return (
 <div>
 <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
 <div>
 <h1 className="text-2xl font-bold text-gray-900">Proposals</h1>
 <p className="mt-1 text-sm text-gray-500">Manage drafts and track sent proposals</p>
 </div>
 <Link
 href="/dashboard/payments/new"
 className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
 >
 <Plus size={18} /> New proposal
 </Link>
 </div>

 <div className="relative mb-5 max-w-lg">
 <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
 <input type="text"value={search} onChange={e=>setSearch(e.target.value)}
 placeholder="Search by client, status, amount, date..."
 className="w-full rounded-2xl border border-gray-200 bg-white pl-9 pr-10 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
 style={{ fontSize: 16 }} />
 {search && <button onClick={()=>setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14}/></button>}
 </div>

{loadError && (
  <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
    <p className="font-semibold mb-0.5">Couldn&apos;t load proposals</p>
    <p className="text-red-600/90 font-mono text-xs break-all">{loadError}</p>
    <button onClick={() => void fetchProposals()} className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-200">
      Retry
    </button>
  </div>
)}
{loading ? (
<div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-400"/></div>
) : (
<div className="space-y-6">
 {/* Drafts */}
 {drafts.length > 0 && (
 <div>
 <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Drafts ({drafts.length})</h2>
 <div className="space-y-2">
 {drafts.map(p => (
 <div key={p.id} className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 hover:bg-gray-50 transition-colors overflow-hidden">
 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-3.5 gap-2">
 {/* Info */}
 <div className="flex items-center gap-3 min-w-0">
 <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 flex-shrink-0">Draft</span>
 <div className="min-w-0">
 <p className="text-sm font-medium text-gray-900 truncate">{p.customer_name || 'No customer yet'}</p>
 {p.customer_email && <p className="text-xs text-gray-400 truncate">{p.customer_email}</p>}
 </div>
 {p.price > 0 && <span className="text-sm text-gray-500 flex-shrink-0 ml-auto sm:ml-0">{formatCents(p.price)}</span>}
 </div>

 {/* Actions — scrollable row on mobile */}
 <div className="flex items-center gap-1 overflow-x-auto flex-nowrap flex-shrink-0">
 {/* Preview */}
 <Link
 href={`/proposal/${p.public_token}`}
 target="_blank"
 className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
 title="Preview"
 >
 <Eye size={12}/> <span className="hidden sm:inline">Preview</span>
 </Link>

 {/* Edit */}
 <Link
 href={`/dashboard/proposals/${p.id}/edit`}
 className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
 title="Edit"
 >
 <Pencil size={12}/> <span className="hidden sm:inline">Edit</span>
 </Link>

 {/* Send */}
 <button
 onClick={() => resend(p)}
 disabled={sendingId === p.id}
 className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-200 transition-colors disabled:opacity-50"
 title="Send"
 >
 <Send size={12}/> <span className="hidden sm:inline">{sendingId === p.id ? 'Sending…' : 'Send'}</span>
 </button>

 {/* Delete */}
 {confirmDelete === p.id ? (
 <div className="flex items-center gap-1 ml-1">
 <button
 onClick={() => deleteDraft(p.id)}
 disabled={deletingId === p.id}
 className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
 >
 {deletingId === p.id ? 'Deleting…' : 'Confirm'}
 </button>
 <button
 onClick={() => setConfirmDelete(null)}
 className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-200 transition-colors"
 >
 Cancel
 </button>
 </div>
 ) : (
 <button
 onClick={() => setConfirmDelete(p.id)}
 className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors ml-1"
 title="Delete draft"
 >
 <Trash2 size={12}/> <span className="hidden sm:inline">Delete</span>
 </button>
 )}
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Sent */}
 <div>
 {sent.length > 0 && <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Sent ({sent.length})</h2>}
 {sent.length === 0 && drafts.length === 0 ? (
 <div className="py-16 text-center rounded-2xl border border-dashed border-gray-200 bg-white">
 <FileText size={36} className="mx-auto mb-3 text-gray-200"/>
 <p className="text-sm font-medium text-gray-500">{search ? 'No proposals match your search' : 'No proposals yet'}</p>
 <Link
 href="/dashboard/payments/new"
 className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
 >
 <Plus size={18} /> Create first proposal
 </Link>
 </div>
 ) : (
 <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
 {/* Desktop header */}
 <div className="hidden sm:grid grid-cols-[1fr_100px_120px_100px_100px_130px] gap-4 px-6 py-3 border-b border-gray-200 bg-gray-50">
 {['Client','Status','Amount','Payment','Sent','Actions'].map(h=>(
 <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
 ))}
 </div>
 <div className="divide-y divide-gray-200">
 {sent.map(p=>{
 const color = getStatusColor(p.status);
 return (
 <div key={p.id} className="hover:bg-gray-50/50 transition-colors">
 {/* Mobile card */}
 <div className="sm:hidden px-4 py-4 space-y-2">
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <Link href={`/dashboard/proposals/${p.id}/edit`} className="text-sm font-semibold text-gray-900 hover:underline block truncate">{p.customer_name||'Unknown'}</Link>
 {p.customer_email && <p className="text-xs text-gray-400 truncate">{p.customer_email}</p>}
 </div>
 <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize flex-shrink-0', color.bg, color.text)}>{statusLabel(p.status)}</span>
 </div>
 <div className="flex items-center gap-4 text-sm text-gray-500">
 <span className="font-semibold text-gray-800">{formatCents(p.price)}</span>
 <span className="capitalize">{p.payment_type}</span>
 {p.sent_at && <span>{formatDate(p.sent_at)}</span>}
 </div>
 {p.collect_manually && (p.total_paid_cents ?? 0) > 0 && p.status !== 'paid' && (
 <p className="text-xs text-amber-600">Balance {formatCents(Math.max(p.price - (p.total_paid_cents ?? 0), 0))}</p>
 )}
 {canRecord(p) && (
 <button onClick={()=>setRecordingFor(p)} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 transition">
 <Wallet size={12}/> Record payment
 </button>
 )}
 </div>
 {/* Desktop row */}
 <div className="hidden sm:grid grid-cols-[1fr_100px_120px_100px_100px_130px] gap-4 px-6 py-4 items-center">
 <div>
 <Link href={`/dashboard/proposals/${p.id}/edit`} className="text-sm font-semibold text-gray-900 hover:underline truncate block">{p.customer_name||'Unknown'}</Link>
 {p.customer_email && <p className="text-xs text-gray-400 truncate">{p.customer_email}</p>}
 </div>
 <span className={classNames('inline-block self-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize w-fit', color.bg, color.text)}>{statusLabel(p.status)}</span>
 <div className="self-center">
 <p className="text-sm text-gray-700">{formatCents(p.price)}</p>
 {p.collect_manually && (p.total_paid_cents ?? 0) > 0 && p.status !== 'paid' && (
 <p className="text-xs text-amber-600">Bal {formatCents(Math.max(p.price - (p.total_paid_cents ?? 0), 0))}</p>
 )}
 </div>
 <p className="text-sm text-gray-500 self-center capitalize">{p.payment_type}</p>
 <p className="text-sm text-gray-500 self-center">{p.sent_at?formatDate(p.sent_at):'—'}</p>
 <div className="self-center">
 {canRecord(p) ? (
 <button onClick={()=>setRecordingFor(p)} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 transition">
 <Wallet size={12}/> Record
 </button>
 ) : <span className="text-xs text-gray-300">—</span>}
 </div>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 )}
  </div>
  </div>
  )}

  {recordingFor && (
  <RecordPaymentModal
  proposal={recordingFor}
  onClose={()=>setRecordingFor(null)}
  onSaved={()=>{ void fetchProposals(); }}
  />
  )}
  </div>
  );
}

export default function PaymentsProposalsPage() {
  return (
    <PaymentGate>
      <PaymentsProposalsPageInner />
    </PaymentGate>
  );
}
