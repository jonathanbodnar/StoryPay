'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, X, Loader2, Calendar, User, ArrowRight } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import PaymentGate from '@/components/PaymentGate';

interface Plan {
  id: string;
  description?: string;
  customerName?: string | null;
  proposalId?: string | null;
  paymentsCompleted?: number;
  paymentsTotal?: number;
  paidAmount?: number;
  totalAmount?: number;
  nextPaymentDate?: string | null;
  nextPaymentAmount?: number | null;
  collection?: 'automatic' | 'manual' | 'online';
  status: string;
  effectiveStatus?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  completed: 'Paid in full',
  failed: 'Payment failed',
  overdue: 'Overdue',
  pending: 'Awaiting first payment',
  cancelled: 'Stopped',
  refunded: 'Refunded',
  partial_refund: 'Partly refunded',
};

const COLLECTION_LABEL: Record<string, string> = {
  automatic: 'Charged automatically',
  manual: 'Cash / check',
  online: 'Online',
};

function PaymentPlansPageInner() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/transactions?type=schedules')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setPlans(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return plans;
    const q = search.toLowerCase();
    return plans.filter(
      (s) =>
        s.customerName?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        (STATUS_LABEL[s.effectiveStatus || s.status] || s.status).toLowerCase().includes(q) ||
        String((s.totalAmount ?? 0) / 100).includes(q),
    );
  }, [plans, search]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment plans</h1>
          <p className="mt-1 text-sm text-gray-500">Every client paying over time, what they&apos;ve paid, and what&apos;s next</p>
        </div>
        <Link
          href="/dashboard/payments/new"
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          + New payment plan
        </Link>
      </div>

      <div className="relative mb-5 max-w-lg">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client, amount or status..."
          className="w-full rounded-2xl border border-gray-200 bg-white pl-9 pr-10 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
          style={{ fontSize: 16 }}
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      {search && <p className="text-sm text-gray-500 mb-4">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
      ) : plans.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-gray-200 bg-white">
          <Calendar size={36} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-medium text-gray-500">No payment plans yet</p>
          <p className="text-xs text-gray-400 mt-1">Create a proposal or invoice and choose Payment plan: a deposit, then monthly payments up to the wedding.</p>
          <Link href="/dashboard/payments/new" className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90" style={{ backgroundColor: '#1b1b1b' }}>
            + New
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_110px_120px_170px_150px_60px] gap-4 px-6 py-3 border-b border-gray-200 bg-gray-50">
            {['Client', 'Total', 'Paid', 'Next payment', 'Status', ''].map((h) => (
              <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-400">No results match your search</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map((s) => {
                const status = s.effectiveStatus || s.status;
                const color = getStatusColor(status);
                const href = s.proposalId ? `/dashboard/proposals/${s.proposalId}` : null;
                const row = (
                  <div className="flex flex-col sm:grid sm:grid-cols-[1fr_110px_120px_170px_150px_60px] gap-2 sm:gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
                        <User size={13} className="text-gray-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{s.customerName || 'Unknown client'}</p>
                        <p className="text-xs text-gray-400 truncate">
                          {s.description}
                          {s.collection ? ` · ${COLLECTION_LABEL[s.collection]}` : ''}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 sm:self-center">{formatCents(s.totalAmount ?? 0)}</p>
                    <div className="sm:self-center">
                      <p className="text-sm text-gray-700">{formatCents(s.paidAmount ?? 0)}</p>
                      <p className="text-xs text-gray-400">{s.paymentsCompleted ?? 0} of {s.paymentsTotal ?? 0} payments</p>
                    </div>
                    <p className="text-sm text-gray-600 sm:self-center">
                      {s.nextPaymentDate && s.nextPaymentAmount ? `${formatCents(s.nextPaymentAmount)} · ${formatDate(s.nextPaymentDate)}` : '—'}
                    </p>
                    <div className="sm:self-center">
                      <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', color.bg, color.text)}>
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    </div>
                    {href && (
                      <span className="flex items-center gap-1 text-xs text-gray-400 sm:self-center">
                        View <ArrowRight size={11} />
                      </span>
                    )}
                  </div>
                );
                return href ? (
                  <Link key={s.id} href={href} prefetch={false} className="block">
                    {row}
                  </Link>
                ) : (
                  <div key={s.id}>{row}</div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PaymentPlansPage() {
  return <PaymentGate><PaymentPlansPageInner /></PaymentGate>;
}
