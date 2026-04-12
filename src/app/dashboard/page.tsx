'use client';

import { useEffect, useState, useCallback } from 'react';
import { DollarSign, FileText, Users, Clock, TrendingUp, TrendingDown, ArrowUpRight, Receipt, ArrowRight, CheckCircle2, Send, PenLine, Eye, XCircle, CreditCard, RotateCcw } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';
import Link from 'next/link';
import DateRangePicker, { DateRange, PRESETS } from '@/components/DateRangePicker';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// ─── Brand palette ────────────────────────────────────────────────────────────
const B = {
  primary: '#1b1b1b',
  active:  '#2d2d2d',
  hover:   '#333333',
  // Tinted backgrounds derived from primary
  bg5:     '#1b1b1b08',
  bg10:    '#1b1b1b18',
  bg15:    '#1b1b1b26',
  bg20:    '#1b1b1b3a',
  // Lighter brand shades for status variety
  teal:    '#2d5a6e',
  slate:   '#444444',
  muted:   '#888888',
  light:   '#e5e7eb',
};

// ─── Proposal status — all brand-derived ─────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  draft:   '#9ca3af',   // gray
  sent:    '#3b82f6',   // blue
  opened:  '#f59e0b',   // amber
  signed:  '#8b5cf6',   // purple
  paid:    '#10b981',   // green
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', opened: 'Opened', signed: 'Signed', paid: 'Paid',
};

const STATUS_ICON: Record<string, React.ElementType> = {
  draft:  FileText,
  sent:   Send,
  opened: Eye,
  signed: PenLine,
  paid:   CheckCircle2,
};

interface Stats {
  totalRevenue: number;
  activeProposals: number;
  customerCount: number;
  pendingPayments: number;
  failedPayments: number;
  refundedCount: number;
  refundedAmount: number;
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

interface Transaction {
  id: string;
  description: string;
  amount: number;
  status: string;
  date: string;
  customerId?: string | null;
  customerName?: string | null;
}

function formatShortCurrency(cents: number) {
  const dollars = cents / 100;
  if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`;
  if (dollars >= 1000)    return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function TrendBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || value === 0) return null;
  const up = value > 0;
  return (
    <span className={classNames('inline-flex items-center gap-0.5 text-[11px] font-semibold', up ? 'text-emerald-600' : 'text-red-500')}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(Math.round(value))}%
    </span>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={classNames('animate-pulse rounded', className ?? '')} style={{ backgroundColor: B.bg10 }} />;
}

// KPI card icon badge — colored per card
function IconBadge({ icon: Icon, bg, color }: { icon: React.ElementType; bg: string; color: string }) {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: bg }}>
      <Icon size={15} style={{ color }} />
    </div>
  );
}

function getDefaultRange(): DateRange {
  const preset = PRESETS.find(p => p.label === 'Last 30 days')!;
  return { ...preset.getRange(), label: preset.label };
}

// Custom tooltip for Recharts
function BrandTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border px-3.5 py-2.5 text-sm shadow-lg" style={{ borderColor: B.light, backgroundColor: '#fff' }}>
      <p className="text-xs font-semibold mb-1" style={{ color: B.muted }}>{label}</p>
      <p className="font-bold" style={{ color: B.primary }}>{formatCents(payload[0].value || 0)}</p>
    </div>
  );
}

export default function DashboardOverview() {
  const [stats, setStats]             = useState<Stats | null>(null);
  const [proposals, setProposals]     = useState<Proposal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading]         = useState(true);
  const [txLoading, setTxLoading]     = useState(true);
  const [dateRange, setDateRange]     = useState<DateRange>(getDefaultRange);

  const fetchData = useCallback(async (range: DateRange) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const [statsRes, proposalsRes] = await Promise.all([
        fetch(`/api/dashboard/stats?${params}`),
        fetch('/api/proposals?limit=5'),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (proposalsRes.ok) {
        const data = await proposalsRes.json();
        setProposals(Array.isArray(data) ? data : data.proposals ?? []);
      }
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  // Fetch recent transactions (charges) once on mount
  useEffect(() => {
    setTxLoading(true);
    fetch('/api/transactions?type=charges')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const items = Array.isArray(data) ? data : data.data ?? [];
        setTransactions(items.slice(0, 5));
      })
      .catch(() => {})
      .finally(() => setTxLoading(false));
  }, []);

  useEffect(() => { fetchData(dateRange); }, [fetchData, dateRange]);

  const revenueChange  = stats?.trends?.revenueChange  ?? null;
  const proposalChange = stats?.trends?.proposalChange ?? null;
  const statusBreakdown = stats?.statusBreakdown ?? {};
  const statusOrder = ['paid', 'signed', 'sent', 'opened', 'draft'];
  const totalProposals = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-full bg-white">

      {/* ── Onboarding Checklist ── */}
      <OnboardingChecklist />

      {/* ── Header ── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl leading-tight" style={{ color: B.primary }}>Home</h1>
          <p className="mt-0.5 text-sm text-gray-500">Your venue payment dashboard</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">

        {/* Revenue */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Revenue</span>
            <IconBadge icon={DollarSign} bg="#f0fdf4" color="#16a34a" />
          </div>
          {loading ? <><Skeleton className="h-7 w-24 mb-2" /><Skeleton className="h-3.5 w-16" /></> : (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color: B.primary }}>{formatCents(stats?.totalRevenue ?? 0)}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <TrendBadge value={revenueChange} />
                <span className="text-xs text-gray-400">vs prior period</span>
              </div>
            </>
          )}
        </div>

        {/* Proposals */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Proposals</span>
            <IconBadge icon={FileText} bg="#eff6ff" color="#2563eb" />
          </div>
          {loading ? <><Skeleton className="h-7 w-16 mb-2" /><Skeleton className="h-3.5 w-20" /></> : (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color: B.primary }}>{(stats?.activeProposals ?? 0).toLocaleString()}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <TrendBadge value={proposalChange} />
                <span className="text-xs text-gray-400">vs prior period</span>
              </div>
            </>
          )}
        </div>

        {/* Customers */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Customers</span>
            <IconBadge icon={Users} bg="#faf5ff" color="#7c3aed" />
          </div>
          {loading ? <><Skeleton className="h-7 w-16 mb-2" /><Skeleton className="h-3.5 w-24" /></> : (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color: B.primary }}>{(stats?.customerCount ?? 0).toLocaleString()}</p>
              <Link href="/dashboard/customers" className="inline-flex items-center gap-1 text-xs mt-1.5 transition-colors" style={{ color: B.muted }}
                onMouseEnter={e => (e.currentTarget.style.color = B.primary)}
                onMouseLeave={e => (e.currentTarget.style.color = B.muted)}>
                View all <ArrowRight size={10} />
              </Link>
            </>
          )}
        </div>

        {/* Pending */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Pending</span>
            <IconBadge icon={Clock} bg="#fff7ed" color="#d97706" />
          </div>
          {loading ? <><Skeleton className="h-7 w-16 mb-2" /><Skeleton className="h-3.5 w-28" /></> : (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color: B.primary }}>{(stats?.pendingPayments ?? 0).toLocaleString()}</p>
              <Link href="/dashboard/proposals" className="inline-flex items-center gap-1 text-xs mt-1.5 transition-colors" style={{ color: B.muted }}
                onMouseEnter={e => (e.currentTarget.style.color = B.primary)}
                onMouseLeave={e => (e.currentTarget.style.color = B.muted)}>
                View proposals <ArrowRight size={10} />
              </Link>
            </>
          )}
        </div>

        {/* Failed */}
        <div className="rounded-2xl bg-white p-5" style={{ border: `1px solid ${(stats?.failedPayments ?? 0) > 0 ? '#fca5a5' : '#e5e7eb'}` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-red-400">Failed</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
              <XCircle size={15} className="text-red-500" />
            </div>
          </div>
          {loading ? <><Skeleton className="h-7 w-16 mb-2" /><Skeleton className="h-3.5 w-28" /></> : (
            <>
              <p className={classNames('text-2xl font-bold tracking-tight', (stats?.failedPayments ?? 0) > 0 ? 'text-red-600' : '')} style={(stats?.failedPayments ?? 0) === 0 ? { color: B.primary } : {}}>
                {(stats?.failedPayments ?? 0).toLocaleString()}
              </p>
              {(stats?.failedPayments ?? 0) > 0
                ? <Link href="/dashboard/transactions" className="inline-flex items-center gap-1 text-xs text-red-400 mt-1.5 hover:text-red-600 transition-colors font-medium">Review <ArrowRight size={10} /></Link>
                : <p className="text-xs mt-1.5" style={{ color: B.muted }}>All clear</p>
              }
            </>
          )}
        </div>

        {/* Refunded */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Refunded</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-50">
              <RotateCcw size={15} className="text-gray-500" />
            </div>
          </div>
          {loading ? <><Skeleton className="h-7 w-16 mb-2" /><Skeleton className="h-3.5 w-28" /></> : (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color: (stats?.refundedCount ?? 0) > 0 ? '#ef4444' : B.primary }}>
                {(stats?.refundedCount ?? 0).toLocaleString()}
              </p>
              {(stats?.refundedCount ?? 0) > 0 ? (
                <div className="mt-1.5">
                  <p className="text-xs text-red-500 font-medium">{formatCents(stats?.refundedAmount ?? 0)} refunded</p>
                  <Link href="/dashboard/transactions" className="inline-flex items-center gap-1 text-xs text-gray-400 mt-0.5 hover:text-gray-700 transition-colors">
                    View <ArrowRight size={10} />
                  </Link>
                </div>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: B.muted }}>None this period</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Revenue chart + status breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 overflow-x-hidden">

        {/* Revenue chart */}
        <div className="lg:col-span-2 rounded-2xl bg-white p-6">
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Revenue</p>
              <p className="text-2xl font-bold tracking-tight mt-1" style={{ color: B.primary }}>
                {loading ? <span className="inline-block h-7 w-32 animate-pulse rounded" style={{ backgroundColor: B.bg10 }} /> : formatCents(stats?.totalRevenue ?? 0)}
              </p>
            </div>
            <div className="text-right">
              {!loading && revenueChange !== null && (
                <div className={classNames('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                  (revenueChange ?? 0) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
                  {(revenueChange ?? 0) >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {Math.abs(Math.round(revenueChange ?? 0))}% vs prior period
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">{dateRange.label}</p>
            </div>
          </div>

          <div className="h-56 mt-4">
            {loading || !stats?.monthlyChart ? (
              <div className="h-full flex items-end gap-2 pb-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex-1 rounded animate-pulse" style={{ height: `${30 + i * 8}%`, backgroundColor: B.bg10 }} />
                ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.monthlyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={B.primary} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={B.primary} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={B.light} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: B.muted }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatShortCurrency} tick={{ fontSize: 11, fill: B.muted }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<BrandTooltip />} cursor={{ stroke: B.active, strokeWidth: 1, strokeDasharray: '4 4' }} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={B.primary}
                    strokeWidth={2.5}
                    fill="url(#revGrad)"
                    dot={false}
                    activeDot={{ r: 5, fill: B.primary, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Proposal status breakdown */}
        <div className="rounded-2xl bg-white p-6 flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Proposal Status</p>
            <Link href="/dashboard/proposals"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all">
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
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: B.muted }}>No data for period</div>
          ) : (
            <div className="flex-1 flex flex-col justify-between">
              {/* Stacked bar */}
              <div className="flex rounded-full overflow-hidden h-2 mb-5 gap-px">
                {statusOrder.filter(s => statusBreakdown[s]).map(s => (
                  <div key={s} style={{ backgroundColor: STATUS_COLORS[s], width: `${(statusBreakdown[s] / totalProposals) * 100}%` }} />
                ))}
              </div>
              <div className="space-y-3">
                {statusOrder.filter(s => statusBreakdown[s] > 0).map(s => {
                  const StatusIcon = STATUS_ICON[s] ?? FileText;
                  const pct = Math.round((statusBreakdown[s] / totalProposals) * 100);
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: STATUS_COLORS[s] + '22' }}>
                        <StatusIcon size={13} style={{ color: STATUS_COLORS[s] }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-700">{STATUS_LABELS[s]}</span>
                          <span className="text-xs font-semibold" style={{ color: B.primary }}>{statusBreakdown[s]}</span>
                        </div>
                        <div className="h-1 w-full rounded-full overflow-hidden" style={{ backgroundColor: B.bg10 }}>
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

      {/* ── Recent proposals ── */}
      <div className="rounded-2xl bg-white overflow-hidden mb-6" style={{ border: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <p className="text-sm font-semibold" style={{ color: B.primary }}>Recent Proposals</p>
          <Link href="/dashboard/proposals"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all">
            View all <ArrowUpRight size={11} />
          </Link>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Customer</th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Status</th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Amount</th>
              <th className="hidden sm:table-cell px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Date</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody style={{ borderTop: 'none' }}>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-28 mb-1.5" /><Skeleton className="h-3 w-36" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-5 w-14 rounded-full" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-16" /></td>
                  <td className="hidden sm:table-cell px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                  <td className="px-6 py-4" />
                </tr>
              ))
            ) : proposals.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <FileText size={32} className="mx-auto mb-3" style={{ color: B.bg20 }} />
                  <p className="text-sm text-gray-400">No proposals yet</p>
                  <Link href="/dashboard/proposals/new" className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: B.primary }}>
                    Create your first proposal <ArrowRight size={11} />
                  </Link>
                </td>
              </tr>
            ) : (
              proposals.map((p) => {
                const color = getStatusColor(p.status);
                return (
                  <tr key={p.id} className="group transition-colors" style={{ cursor: 'default', borderBottom: '1px solid #e5e7eb' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#fafafa')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}>
                    <td className="px-6 py-3.5">
                      <p className="font-medium text-gray-900 group-hover:underline transition-colors" style={{ color: B.primary }}>{p.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{p.customer_email}</p>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={classNames('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize', color.bg, color.text)}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-semibold" style={{ color: B.primary }}>{formatCents(p.price)}</td>
                    <td className="hidden sm:table-cell px-6 py-3.5 text-xs text-gray-400">{formatDate(p.sent_at ?? p.created_at)}</td>
                    <td className="px-6 py-3.5 text-right">
                      <Link href={`/dashboard/proposals/${p.id}/edit`}
                        className="invisible group-hover:visible inline-flex items-center gap-1 text-xs font-medium transition-colors"
                        style={{ color: B.muted }}
                        onMouseEnter={e => (e.currentTarget.style.color = B.primary)}
                        onMouseLeave={e => (e.currentTarget.style.color = B.muted)}>
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

      {/* ── Recent Transactions ── */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div className="flex items-center gap-2">
            <CreditCard size={15} style={{ color: B.muted }} />
            <p className="text-sm font-semibold" style={{ color: B.primary }}>Recent Transactions</p>
          </div>
          <Link href="/dashboard/transactions"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all">
            View all <ArrowUpRight size={11} />
          </Link>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #e5e7eb' }}>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Description</th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Amount</th>
              <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Status</th>
              <th className="hidden sm:table-cell px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: B.muted }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {txLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-40" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-16" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-5 w-14 rounded-full" /></td>
                  <td className="hidden sm:table-cell px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                </tr>
              ))
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center">
                  <CreditCard size={28} className="mx-auto mb-2" style={{ color: B.bg20 }} />
                  <p className="text-sm text-gray-400">No transactions yet</p>
                </td>
              </tr>
            ) : (
              transactions.map((tx) => {
                const color = getStatusColor(tx.status);
                return (
                  <tr key={tx.id} className="group transition-colors" style={{ borderBottom: '1px solid #e5e7eb' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#fafafa')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}>
                    <td className="px-6 py-3.5">
                      <p className="font-medium" style={{ color: B.primary }}>{tx.description}</p>
                      {tx.customerName && <p className="text-xs text-gray-400 mt-0.5">{tx.customerName}</p>}
                    </td>
                    <td className="px-6 py-3.5 font-semibold" style={{ color: B.primary }}>{formatCents(tx.amount)}</td>
                    <td className="px-6 py-3.5">
                      <span className={classNames('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize', color.bg, color.text)}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-6 py-3.5 text-xs text-gray-400">{formatDate(tx.date)}</td>
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
