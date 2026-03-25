'use client';

import { useEffect, useState } from 'react';
import { DollarSign, FileText, Users, Clock, TrendingUp, ArrowUpRight } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface Stats {
  totalRevenue: number;
  activeProposals: number;
  customerCount: number;
  pendingPayments: number;
  statusBreakdown: Record<string, number>;
  monthlyChart: { month: string; label: string; revenue: number; proposals: number }[];
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
  { key: 'totalRevenue' as const, label: 'Total Revenue', icon: DollarSign, isCurrency: true, accent: '#293745' },
  { key: 'activeProposals' as const, label: 'Active Proposals', icon: FileText, isCurrency: false, accent: '#354859' },
  { key: 'customerCount' as const, label: 'Customers', icon: Users, isCurrency: false, accent: '#4a6280' },
  { key: 'pendingPayments' as const, label: 'Pending Payments', icon: Clock, isCurrency: false, accent: '#6b8aab' },
];

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  sent: '#3b82f6',
  opened: '#f59e0b',
  signed: '#8b5cf6',
  paid: '#10b981',
  declined: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  opened: 'Opened',
  signed: 'Signed',
  paid: 'Paid',
  declined: 'Declined',
};

function formatShortCurrency(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

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
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const pieData = stats?.statusBreakdown
    ? Object.entries(stats.statusBreakdown).map(([status, count]) => ({
        name: STATUS_LABELS[status] || status,
        value: count,
        color: STATUS_COLORS[status] || '#94a3b8',
      }))
    : [];

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Overview</h1>
          <p className="mt-1 text-sm text-gray-500">Your venue payment dashboard</p>
        </div>
        <Link
          href="/dashboard/proposals/new"
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: '#293745' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2f3e4e')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#293745')}
        >
          <FileText size={16} />
          New Proposal
        </Link>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {metricCards.map((card) => {
          const Icon = card.icon;
          const value = stats?.[card.key];
          return (
            <div
              key={card.key}
              className="relative overflow-hidden rounded-xl border border-gray-100 bg-white p-5 transition-shadow hover:shadow-md"
            >
              <div className="absolute top-0 right-0 w-20 h-20 rounded-bl-full opacity-5" style={{ backgroundColor: card.accent }} />
              <div className="flex items-center gap-4">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: card.accent + '12' }}
                >
                  <Icon size={20} style={{ color: card.accent }} />
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
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Revenue chart */}
        <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-white p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-heading text-lg text-gray-900">Revenue</h2>
              <p className="text-xs text-gray-400 mt-0.5">Last 6 months</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
              <TrendingUp size={12} />
              <span>Trending</span>
            </div>
          </div>
          <div className="h-64">
            {loading || !stats?.monthlyChart ? (
              <div className="h-full flex items-center justify-center text-gray-300 text-sm">Loading chart...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.monthlyChart} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#293745" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#293745" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatShortCurrency} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value) => [formatCents(Number(value) || 0), 'Revenue']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#293745" strokeWidth={2.5} fill="url(#revenueGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Proposal status pie */}
        <div className="rounded-xl border border-gray-100 bg-white p-6">
          <h2 className="font-heading text-lg text-gray-900 mb-6">Proposal Status</h2>
          <div className="h-52">
            {loading || pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-300 text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex flex-wrap gap-3 mt-4 justify-center">
            {pieData.map((entry) => (
              <div key={entry.name} className="flex items-center gap-1.5 text-xs text-gray-500">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                {entry.name} ({entry.value})
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Proposals activity bar chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="rounded-xl border border-gray-100 bg-white p-6">
          <h2 className="font-heading text-lg text-gray-900 mb-6">Monthly Activity</h2>
          <div className="h-52">
            {loading || !stats?.monthlyChart ? (
              <div className="h-full flex items-center justify-center text-gray-300 text-sm">Loading...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.monthlyChart} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }} />
                  <Bar dataKey="proposals" fill="#293745" radius={[4, 4, 0, 0]} barSize={24} name="Proposals" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent proposals table */}
        <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg text-gray-900">Recent Proposals</h2>
            <Link
              href="/dashboard/proposals"
              className="flex items-center gap-1 text-xs font-medium text-brand-900 hover:underline"
            >
              View all <ArrowUpRight size={12} />
            </Link>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Customer
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Amount
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                      Loading...
                    </td>
                  </tr>
                ) : proposals.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                      No proposals yet
                    </td>
                  </tr>
                ) : (
                  proposals.map((p) => {
                    const color = getStatusColor(p.status);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/dashboard/proposals/${p.id}/edit`} className="font-medium text-gray-900 hover:text-brand-900 hover:underline">
                            {p.customer_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
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
                        <td className="px-4 py-3 text-gray-700">{formatCents(p.price)}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {p.sent_at ? formatDate(p.sent_at) : formatDate(p.created_at)}
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
    </div>
  );
}
