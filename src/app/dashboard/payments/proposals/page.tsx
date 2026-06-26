'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, X, Loader2, FileText, Send, Plus, Pencil, Eye, Trash2, Wallet } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import PaymentGate from '@/components/PaymentGate';
import RecordPaymentModal from '@/components/RecordPaymentModal';

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

function statusLabel(status: string): string {
 if (status === 'partially_paid') return 'Partial';
 return status;
}

/** Manual-collection proposals/invoices the owner can still record payments against. */
function canRecord(p: Proposal): boolean {
 return p.collect_manually === true && p.status !== 'draft';
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
