'use client';

import { useEffect, useState } from 'react';
import { DollarSign, FileText, Users, Clock } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';

interface Stats {
  totalRevenue: number;
  activeProposals: number;
  customerCount: number;
  pendingPayments: number;
}

interface Proposal {
  id: string;
  customer_name: string;
  customer_email: string;
  status: string;
  price: number;
  sent_at: string | null;
  created_at: string;
}

const metricCards = [
  { key: 'totalRevenue' as const, label: 'Total Revenue', icon: DollarSign, isCurrency: true },
  { key: 'activeProposals' as const, label: 'Active Proposals', icon: FileText, isCurrency: false },
  { key: 'customerCount' as const, label: 'Customers', icon: Users, isCurrency: false },
  { key: 'pendingPayments' as const, label: 'Pending Payments', icon: Clock, isCurrency: false },
];

export default function DashboardOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, proposalsRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/proposals?limit=5'),
        ]);

        if (statsRes.ok) {
          setStats(await statsRes.json());
        }
        if (proposalsRes.ok) {
          const data = await proposalsRes.json();
          setProposals(Array.isArray(data) ? data : data.proposals ?? []);
        }
      } catch {
        // silently fail — cards will show dashes
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Overview</h1>
        <p className="mt-1 text-sm text-gray-500">Your venue payment dashboard</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        {metricCards.map((card) => {
          const Icon = card.icon;
          const value = stats?.[card.key];

          return (
            <div
              key={card.key}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-500/15">
                <Icon size={20} className="text-teal-600" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {card.label}
                </p>
                <p className="mt-0.5 text-xl font-bold text-gray-900">
                  {loading
                    ? '—'
                    : card.isCurrency
                      ? formatCents(value ?? 0)
                      : (value ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent proposals table */}
      <div>
        <h2 className="font-heading text-lg font-semibold text-gray-900 mb-4">
          Recent Proposals
        </h2>

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Customer
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Status
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Amount
                </th>
                <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Sent Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : proposals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-gray-400">
                    No proposals yet
                  </td>
                </tr>
              ) : (
                proposals.map((p) => {
                  const color = getStatusColor(p.status);
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-gray-900">
                        {p.customer_name}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={classNames(
                            'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                            color.bg,
                            color.text
                          )}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-gray-700">{formatCents(p.price)}</td>
                      <td className="px-5 py-3.5 text-gray-500">
                        {p.sent_at ? formatDate(p.sent_at) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
