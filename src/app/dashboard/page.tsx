'use client';

import { useEffect, useState } from 'react';
import { DollarSign, FileText, Users, Clock, TrendingUp, TrendingDown, ArrowUpRight, Receipt, ArrowRight, CheckCircle2, Send, PenLine, Eye } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface Stats {
  totalRevenue: number;
  activeProposals: number;
  customerCount: number;
  pendingPayments: number;
  statusBreakdown: Record<string, number>;
  monthlyChart: { month: string; label: string; revenue: number; proposals: number }[];
  trends: {
    revenueChange: number;
    proposalChange: number;
    thisMonthRevenue: number;
    lastMonthRevenue: number;
    thisMonthProposals: number;
    lastMonthProposals: number;
  };
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

const STATUS_ICON: Record<string, React.ElementType> = {
  draft: FileText,
  sent: Send,
  opened: Eye,
  signed: PenLine,
  paid: CheckCircle2,
};

function formatShortCurrency(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function TrendBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || value === 0) return null;
  const up = value > 0;
  return (
    <span className={classNames(
      'inline-flex items-center gap-0.5 text-[11px] font-semibold',
      up ? 'text-emerald-600' : 'text-red-500'
    )}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(Math.round(value))}%
    </span>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={classNames('animate-pulse rounded bg-gray-100', className ?? '')} />;
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
          fetch('/api/proposals?limit=6'),
        ]);
        if (statsRes.ok) setStats(await statsRes.json());
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

  const revenueChange = stats?.trends?.revenueChange ?? null;
  const proposalChange = stats?.trends?.proposalChange ?? null;

  const statusBreakdown = stats?.statusBreakdown ?? {};
  const statusOrder = ['paid', 'signed', 'sent', 'opened', 'draft'];
  const STATUS_COLORS: Record<string, string> = {
    draft: '#94a3b8',
    sent: '#3b82f6',
    opened: '#f59e0b',
    signed: '#8b5cf6',
    paid: '#10b981',
  };
  const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft', sent: 'Sent', opened: 'Opened', signed: 'Signed', paid: 'Paid',
  };

  const totalProposals = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-full bg-gray-50/40">
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gray-900 leading-tight">Overview</h1>
          <p className="mt-0.5 text-sm text-gray-500">Your venue payment dashboard</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard/invoices/new"
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:shadow hover:border-gray-300"
          >
            <Receipt size={15} />
            Create Invoice
          </Link>
          <Link
            href="/dashboard/proposals/new"
            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:opacity-90"
            style={{ backgroundColor: '#293745' }}
          >
            <FileText size={15} />
            Create Proposal
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Total Revenue */}
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Revenue</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: '#29374510' }}>
              <DollarSign size={15} style={{ color: '#293745' }} />
            </div>
          </div>
          {loading ? (
            <>
              <Skeleton className="h-7 w-28 mb-2" />
              <Skeleton className="h-3.5 w-16" />
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-900 tracking-tight">{formatCents(stats?.totalRevenue ?? 0)}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <TrendBadge value={revenueChange} />
                <span className="text-xs text-gray-400">vs last month</span>
              </div>
            </>
          )}
        </div>

        {/* Active Proposals */}
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Active Proposals</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <FileText size={15} className="text-blue-500" />
            </div>
          </div>
          {loading ? (
            <>
              <Skeleton className="h-7 w-16 mb-2" />
              <Skeleton className="h-3.5 w-20" />
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-900 tracking-tight">{(stats?.activeProposals ?? 0).toLocaleString()}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <TrendBadge value={proposalChange} />
                <span className="text-xs text-gray-400">vs last month</span>
              </div>
            </>
          )}
        </div>

        {/* Customers */}
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Customers</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
              <Users size={15} className="text-violet-500" />
            </div>
          </div>
          {loading ? (
            <>
              <Skeleton className="h-7 w-16 mb-2" />
              <Skeleton className="h-3.5 w-24" />
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-900 tracking-tight">{(stats?.customerCount ?? 0).toLocaleString()}</p>
              <Link href="/dashboard/customers" className="inline-flex items-center gap-1 text-xs text-gray-400 mt-1.5 hover:text-gray-600 transition-colors">
                View all <ArrowRight size={10} />
              </Link>
            </>
          )}
        </div>

        {/* Pending Payments */}
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pending Payments</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
              <Clock size={15} className="text-amber-500" />
            </div>
          </div>
          {loading ? (
            <>
              <Skeleton className="h-7 w-16 mb-2" />
              <Skeleton className="h-3.5 w-28" />
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-900 tracking-tight">{(stats?.pendingPayments ?? 0).toLocaleString()}</p>
              <Link href="/dashboard/proposals" className="inline-flex items-center gap-1 text-xs text-gray-400 mt-1.5 hover:text-gray-600 transition-colors">
                View proposals <ArrowRight size={10} />
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Revenue chart + status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Revenue chart */}
        <div className="lg:col-span-2 rounded-xl bg-white border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Revenue</p>
              <p className="text-2xl font-bold text-gray-900 tracking-tight mt-1">
                {loading ? <span className="inline-block h-7 w-32 animate-pulse rounded bg-gray-100" /> : formatCents(stats?.totalRevenue ?? 0)}
              </p>
            </div>
            <div className="text-right">
              {!loading && revenueChange !== null && (
                <div className={classNames(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                  (revenueChange ?? 0) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                )}>
                  {(revenueChange ?? 0) >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {Math.abs(Math.round(revenueChange ?? 0))}% vs last month
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">Last 6 months</p>
            </div>
          </div>

          <div className="h-56 mt-4">
            {loading || !stats?.monthlyChart ? (
              <div className="h-full flex items-end gap-2 pb-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex-1 rounded animate-pulse bg-gray-100" style={{ height: `${30 + Math.random() * 50}%` }} />
                ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.monthlyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#293745" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#293745" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatShortCurrency} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip
                    formatter={(v) => [formatCents(Number(v) || 0), 'Revenue']}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    cursor={{ stroke: '#293745', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#293745" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4, fill: '#293745' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Proposal status breakdown */}
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Proposal Status</p>
            <Link href="/dashboard/proposals" className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-0.5">
              View all <ArrowUpRight size={11} />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-4 flex-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-8" />
                </div>
              ))}
            </div>
          ) : totalProposals === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No proposals yet</div>
          ) : (
            <div className="flex-1 flex flex-col justify-between">
              {/* Stacked bar */}
              <div className="flex rounded-full overflow-hidden h-2 mb-5 gap-px">
                {statusOrder.filter(s => statusBreakdown[s]).map(s => (
                  <div
                    key={s}
                    style={{ backgroundColor: STATUS_COLORS[s], width: `${(statusBreakdown[s] / totalProposals) * 100}%` }}
                  />
                ))}
              </div>

              <div className="space-y-3">
                {statusOrder.filter(s => statusBreakdown[s] > 0).map(s => {
                  const StatusIcon = STATUS_ICON[s] ?? FileText;
                  const pct = Math.round((statusBreakdown[s] / totalProposals) * 100);
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: STATUS_COLORS[s] + '18' }}>
                        <StatusIcon size={13} style={{ color: STATUS_COLORS[s] }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-700">{STATUS_LABELS[s]}</span>
                          <span className="text-xs font-semibold text-gray-900">{statusBreakdown[s]}</span>
                        </div>
                        <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[s] }} />
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

      {/* Recent proposals */}
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">Recent Proposals</p>
          <Link
            href="/dashboard/proposals"
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
          >
            View all <ArrowUpRight size={12} />
          </Link>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/60 border-b border-gray-100">
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Amount</th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">Date</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-6 py-4">
                    <Skeleton className="h-4 w-28 mb-1.5" />
                    <Skeleton className="h-3 w-36" />
                  </td>
                  <td className="px-6 py-4"><Skeleton className="h-5 w-14 rounded-full" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-16" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                  <td className="px-6 py-4" />
                </tr>
              ))
            ) : proposals.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <FileText size={32} className="mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400">No proposals yet</p>
                  <Link href="/dashboard/proposals/new" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-900 hover:underline">
                    Create your first proposal <ArrowRight size={11} />
                  </Link>
                </td>
              </tr>
            ) : (
              proposals.map((p) => {
                const color = getStatusColor(p.status);
                return (
                  <tr key={p.id} className="group hover:bg-gray-50/60 transition-colors">
                    <td className="px-6 py-3.5">
                      <p className="font-medium text-gray-900 group-hover:text-brand-900 transition-colors">{p.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{p.customer_email}</p>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={classNames('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize', color.bg, color.text)}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-medium text-gray-900">{formatCents(p.price)}</td>
                    <td className="px-6 py-3.5 text-gray-400 text-xs">{formatDate(p.sent_at ?? p.created_at)}</td>
                    <td className="px-6 py-3.5 text-right">
                      <Link
                        href={`/dashboard/proposals/${p.id}/edit`}
                        className="invisible group-hover:visible inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
                      >
                        Open <ArrowUpRight size={11} />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
