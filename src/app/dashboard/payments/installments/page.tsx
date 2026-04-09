'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, X, Loader2, Calendar, User, ArrowRight } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';

interface Schedule {
  id: number | string;
  description?: string;
  totalAmount?: number;
  amount?: number;
  paymentsCount?: number;
  numberOfPayments?: number;
  status: string;
  customerId?: string | number | null;
  customerName?: string | null;
}

export default function InstallmentsPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  useEffect(() => {
    fetch('/api/transactions?type=schedules')
      .then(r => r.ok ? r.json() : [])
      .then(d => setSchedules(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return schedules;
    const q = search.toLowerCase();
    return schedules.filter(s =>
      s.customerName?.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.status?.toLowerCase().includes(q) ||
      String((s.totalAmount ?? s.amount ?? 0) / 100).includes(q) ||
      String(s.paymentsCount ?? s.numberOfPayments ?? '').includes(q)
    );
  }, [schedules, search]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Installments</h1>
          <p className="mt-1 text-sm text-gray-500">Active installment payment schedules</p>
        </div>
        <Link href="/dashboard/payments/new"
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shadow-sm"
          style={{ backgroundColor: '#1b1b1b' }}>
          + New Installment Plan
        </Link>
      </div>

      <div className="relative mb-5 max-w-lg">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by client, amount, status, payment count..."
          className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-10 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors shadow-sm"
          style={{ fontSize: 16 }} />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
      </div>

      {search && <p className="text-sm text-gray-500 mb-4">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
      ) : schedules.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-gray-200 bg-white">
          <Calendar size={36} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-medium text-gray-500">No installment plans yet</p>
          <p className="text-xs text-gray-400 mt-1">Create a proposal or invoice with an installment payment plan</p>
          <Link href="/dashboard/payments/new" className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 shadow-sm" style={{ backgroundColor: '#1b1b1b' }}>+ New</Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_120px_100px_100px_100px_80px] gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50">
            {['Client','Total','Payments','Per Payment','Status',''].map(h=>(
              <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-400">No results match your search</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(s => {
                const color = getStatusColor(s.status);
                const total = s.totalAmount ?? s.amount ?? 0;
                const count = s.paymentsCount ?? s.numberOfPayments ?? 0;
                const perPayment = count > 0 ? Math.round(total / count) : 0;
                return (
                  <div key={s.id} className="flex flex-col sm:grid sm:grid-cols-[1fr_120px_100px_100px_100px_80px] gap-2 sm:gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
                        <User size={13} className="text-gray-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{s.customerName || s.description || 'Unknown'}</p>
                        {s.customerName && s.description && <p className="text-xs text-gray-400 truncate">{s.description}</p>}
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 self-center">{formatCents(total)}</p>
                    <p className="text-sm text-gray-600 self-center">{count} payments</p>
                    <p className="text-sm text-gray-600 self-center">{perPayment > 0 ? formatCents(perPayment) : '—'}</p>
                    <div className="self-center">
                      <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', color.bg, color.text)}>{s.status}</span>
                    </div>
                    {s.customerId && (
                      <Link href={`/dashboard/customers/${s.customerId}`} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors self-center">
                        View <ArrowRight size={11}/>
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
