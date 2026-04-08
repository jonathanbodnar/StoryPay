'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Eye, X, RotateCcw, User } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import RefundModal from '@/components/RefundModal';

type TabKey = 'charges' | 'schedules' | 'subscriptions';

interface Charge {
  id: string;
  description: string;
  amount: number;
  status: string;
  date: string;
  chargeId?: string;
  transactionId?: string;
  sessionId?: string;
  customerId?: string | number | null;
  customerName?: string | null;
}

interface Schedule {
  id: number;
  description?: string;
  totalAmount?: number;
  amount?: number;
  paymentsCount?: number;
  numberOfPayments?: number;
  status: string;
  customerId?: string | number | null;
  customerName?: string | null;
}

interface Subscription {
  id: string;
  description: string;
  amount: number;
  frequency: string;
  status: string;
  nextPayment: string | null;
  customerId?: string | number | null;
  customerName?: string | null;
}

const tabs: { key: TabKey; label: string }[] = [
  { key: 'charges', label: 'Charges' },
  { key: 'schedules', label: 'Payment Schedules' },
  { key: 'subscriptions', label: 'Subscriptions' },
];

export default function TransactionsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('charges');
  const [charges, setCharges] = useState<Charge[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [refundTarget, setRefundTarget] = useState<Charge | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/transactions?type=${activeTab}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const items = Array.isArray(data) ? data : data.data ?? [];
        if (activeTab === 'charges') setCharges(items);
        else if (activeTab === 'schedules') setSchedules(items);
        else setSubscriptions(items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTab]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Transactions</h1>
        <p className="mt-1 text-sm text-gray-500">Payment history and schedules</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1 w-full sm:w-fit overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={classNames(
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          {activeTab === 'charges' && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Description
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Amount
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Status
                  </th>
                  <th className="hidden sm:table-cell px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Date
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {charges.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                      No charges yet
                    </td>
                  </tr>
                ) : (
                  charges.map((c) => {
                    const color = getStatusColor(c.status);
                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-gray-900">{c.description}</td>
                        <td className="px-5 py-3.5 text-gray-700">{formatCents(c.amount)}</td>
                        <td className="px-5 py-3.5">
                          <span
                            className={classNames(
                              'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                              color.bg,
                              color.text
                            )}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="hidden sm:table-cell px-5 py-3.5 text-gray-500">{formatDate(c.date)}</td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {c.customerId && (
                              <Link
                                href={`/dashboard/customers/${c.customerId}`}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                              >
                                <User size={13} />
                                View Customer
                              </Link>
                            )}
                            <button
                              onClick={() => setSelectedCharge(c)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                            >
                              <Eye size={13} />
                              View Transaction
                            </button>
                            {c.status !== 'refunded' && (
                              <button
                                onClick={() => setRefundTarget(c)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                              >
                                <RotateCcw size={13} />
                                Refund
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'schedules' && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Description
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Total Amount
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Payments
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Status
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                      No payment schedules yet
                    </td>
                  </tr>
                ) : (
                  schedules.map((s) => {
                    const color = getStatusColor(s.status);
                    return (
                      <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-gray-900">
                          {s.description || `Schedule #${s.id}`}
                        </td>
                        <td className="px-5 py-3.5 text-gray-700">
                          {formatCents(s.totalAmount ?? s.amount ?? 0)}
                        </td>
                        <td className="px-5 py-3.5 text-gray-700">
                          {s.paymentsCount ?? s.numberOfPayments ?? '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={classNames(
                              'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                              color.bg,
                              color.text
                            )}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {s.customerId && (
                            <Link
                              href={`/dashboard/customers/${s.customerId}`}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                            >
                              <User size={13} />
                              View Customer
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'subscriptions' && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Description
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Amount / Period
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Frequency
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Next Payment
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Status
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subscriptions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-gray-400">
                      No subscriptions yet
                    </td>
                  </tr>
                ) : (
                  subscriptions.map((s) => {
                    const color = getStatusColor(s.status);
                    return (
                      <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-gray-900">{s.description}</td>
                        <td className="px-5 py-3.5 text-gray-700">{formatCents(s.amount)}</td>
                        <td className="px-5 py-3.5 text-gray-700 capitalize">{s.frequency}</td>
                        <td className="px-5 py-3.5 text-gray-500">
                          {s.nextPayment ? formatDate(s.nextPayment) : '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={classNames(
                              'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                              color.bg,
                              color.text
                            )}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {s.customerId && (
                            <Link
                              href={`/dashboard/customers/${s.customerId}`}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                            >
                              <User size={13} />
                              View Customer
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
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
            if (fullRefund) {
              setCharges(prev => prev.map(c => c.id === refundTarget.id ? { ...c, status: 'refunded' } : c));
            }
            setRefundTarget(null);
          }}
          onClose={() => setRefundTarget(null)}
        />
      )}

      {/* Charge Detail Modal */}
      {selectedCharge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <button
              onClick={() => setSelectedCharge(null)}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>

            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">Transaction Details</h2>

            <dl className="space-y-4">
              <div className="flex justify-between border-b border-gray-100 pb-3">
                <dt className="text-sm font-medium text-gray-500">Description</dt>
                <dd className="text-sm font-semibold text-gray-900">{selectedCharge.description}</dd>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-3">
                <dt className="text-sm font-medium text-gray-500">Amount</dt>
                <dd className="text-sm font-semibold text-gray-900">{formatCents(selectedCharge.amount)}</dd>
              </div>
              <div className="flex justify-between border-b border-gray-100 pb-3">
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
              <div className="flex justify-between border-b border-gray-100 pb-3">
                <dt className="text-sm font-medium text-gray-500">Date</dt>
                <dd className="text-sm text-gray-700">{formatDate(selectedCharge.date)}</dd>
              </div>
              {selectedCharge.chargeId && (
                <div className="flex justify-between border-b border-gray-100 pb-3">
                  <dt className="text-sm font-medium text-gray-500">Charge ID</dt>
                  <dd className="text-sm font-mono text-gray-700 break-all text-right max-w-[60%]">{selectedCharge.chargeId}</dd>
                </div>
              )}
              {selectedCharge.transactionId && (
                <div className="flex justify-between border-b border-gray-100 pb-3">
                  <dt className="text-sm font-medium text-gray-500">Transaction ID</dt>
                  <dd className="text-sm font-mono text-gray-700 break-all text-right max-w-[60%]">{selectedCharge.transactionId}</dd>
                </div>
              )}
              {selectedCharge.sessionId && (
                <div className="flex justify-between">
                  <dt className="text-sm font-medium text-gray-500">Session ID</dt>
                  <dd className="text-sm font-mono text-gray-700 break-all text-right max-w-[60%]">{selectedCharge.sessionId}</dd>
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
