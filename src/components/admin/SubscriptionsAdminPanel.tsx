'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  TrendingUp,
  Users,
  XCircle,
  Search,
  AlertTriangle,
} from 'lucide-react';

const BRAND = '#1b1b1b';

type Plan = {
  id: string;
  name: string;
  slug: string;
  price_monthly_cents: number | null;
  is_default: boolean;
  venue_count: number;
  active_count: number;
  past_due_count: number;
  canceled_count: number;
  mrr_cents: number;
};

type VenueRow = {
  id: string;
  name: string;
  email: string | null;
  created_at: string | null;
  plan: { id: string; name: string; slug: string; price_monthly_cents: number | null } | null;
  status: string;
  external_subscription_id: string | null;
  lunarpay_customer_id: string | null;
  addons: { verified: boolean; sponsored: boolean; concierge: boolean };
  mrr_cents: number;
  lifetime_cents: number;
  last_payment: { amount_cents: number; occurred_at: string | null; event_type: string | null } | null;
};

type Summary = {
  total_mrr_cents: number;
  total_arr_cents: number;
  active_count: number;
  trialing_count: number;
  past_due_count: number;
  canceled_count: number;
  unsubscribed_count: number;
  venue_count: number;
  paying_count: number;
};

type AddonPrices = {
  verified_cents: number;
  sponsored_cents: number;
  concierge_cents: number;
};

type ApiResponse = {
  addon_prices: AddonPrices;
  summary: Summary;
  plans: Plan[];
  venues: VenueRow[];
};

type StatusFilter = 'all' | 'active' | 'past_due' | 'canceled' | 'none' | 'trialing';

function formatCents(c: number): string {
  return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatCentsExact(c: number): string {
  return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusPill(status: string): string {
  switch (status) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'trialing':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'past_due':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'canceled':
      return 'border-gray-200 bg-gray-100 text-gray-600';
    case 'pending':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-500';
  }
}

export function SubscriptionsAdminPanel() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [planFilter, setPlanFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/subscriptions', { cache: 'no-store' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error || 'Could not load subscriptions');
        return;
      }
      setData((await res.json()) as ApiResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredVenues = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.venues.filter((v) => {
      if (statusFilter !== 'all' && v.status !== statusFilter) return false;
      if (planFilter !== 'all') {
        if (planFilter === '__none__') {
          if (v.plan) return false;
        } else if (v.plan?.id !== planFilter) {
          return false;
        }
      }
      if (q) {
        const hay = `${v.name} ${v.email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, statusFilter, planFilter, search]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-24 text-gray-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
        {err}
      </div>
    );
  }

  if (!data) return null;

  const { summary, plans } = data;
  const ap = data.addon_prices ?? { verified_cents: 0, sponsored_cents: 0, concierge_cents: 0 };
  function fmtAddon(cents: number) { return cents > 0 ? `$${Math.round(cents / 100)}/mo` : ''; }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="font-heading text-xl text-gray-900">Subscriptions overview</h2>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          Live view of every venue&apos;s plan, status, and MRR contribution. Plan + access-level
          changes are managed under <span className="font-semibold">Directory plans</span>.
        </p>
      </div>

      {/* MRR + status cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Monthly recurring revenue"
          value={formatCents(summary.total_mrr_cents)}
          sub={`ARR ${formatCents(summary.total_arr_cents)}`}
          icon={<TrendingUp size={16} />}
          tone="emerald"
        />
        <SummaryCard
          label="Active subscriptions"
          value={String(summary.paying_count)}
          sub={`${summary.active_count} paid · ${summary.trialing_count} trial`}
          icon={<CheckCircle2 size={16} />}
          tone="emerald"
        />
        <SummaryCard
          label="Past due"
          value={String(summary.past_due_count)}
          sub="Payments LunarPay reported as failed"
          icon={<AlertTriangle size={16} />}
          tone={summary.past_due_count > 0 ? 'red' : 'gray'}
        />
        <SummaryCard
          label="Canceled / unsubscribed"
          value={String(summary.canceled_count + summary.unsubscribed_count)}
          sub={`${summary.canceled_count} canceled · ${summary.unsubscribed_count} no plan`}
          icon={<XCircle size={16} />}
          tone="gray"
        />
      </div>

      {/* Per-plan breakdown */}
      <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <CreditCard size={16} className="text-gray-700" /> Revenue by plan
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Active + trialing venues only contribute to MRR.
          </p>
        </div>
        {plans.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500">
            No plans configured. Create plans in the <span className="font-semibold">Directory plans</span>{' '}
            tab.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-6 py-3">Plan</th>
                  <th className="px-6 py-3 text-right">$/mo</th>
                  <th className="px-6 py-3 text-right">Total venues</th>
                  <th className="px-6 py-3 text-right">Active</th>
                  <th className="px-6 py-3 text-right">Past due</th>
                  <th className="px-6 py-3 text-right">Canceled</th>
                  <th className="px-6 py-3 text-right">MRR</th>
                  <th className="px-6 py-3 text-right">% of MRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plans.map((p) => {
                  const pct =
                    summary.total_mrr_cents > 0
                      ? (p.mrr_cents / summary.total_mrr_cents) * 100
                      : 0;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/60">
                      <td className="px-6 py-3">
                        <div className="font-medium text-gray-900">{p.name}</div>
                        <div className="text-[11px] font-mono text-gray-400">{p.slug}</div>
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-gray-700">
                        {p.price_monthly_cents != null ? formatCentsExact(p.price_monthly_cents) : '—'}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-700">{p.venue_count}</td>
                      <td className="px-6 py-3 text-right text-emerald-700 font-medium">
                        {p.active_count}
                      </td>
                      <td className="px-6 py-3 text-right text-red-700">
                        {p.past_due_count > 0 ? p.past_due_count : '—'}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-500">
                        {p.canceled_count > 0 ? p.canceled_count : '—'}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-gray-900 font-semibold">
                        {formatCents(p.mrr_cents)}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-500">
                        {pct > 0 ? `${pct.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Venue subscription list */}
      <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Users size={16} className="text-gray-700" /> All venue subscriptions
          </h3>
          <span className="text-xs text-gray-500">
            {filteredVenues.length} of {data.venues.length}
          </span>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 bg-gray-50/60">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search venue name or email…"
              className="w-full rounded-lg border border-gray-200 pl-7 pr-3 py-1.5 text-xs"
            />
          </div>

          <div className="flex items-center gap-1">
            {(['all', 'active', 'trialing', 'past_due', 'canceled', 'none'] as StatusFilter[]).map(
              (s) => {
                const active = statusFilter === s;
                const label =
                  s === 'all'
                    ? 'All'
                    : s === 'past_due'
                      ? 'Past due'
                      : s === 'none'
                        ? 'No plan'
                        : s.charAt(0).toUpperCase() + s.slice(1);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-gray-900 text-white'
                        : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {label}
                  </button>
                );
              },
            )}
          </div>

          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs bg-white"
          >
            <option value="all">All plans</option>
            <option value="__none__">No plan assigned</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {filteredVenues.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500">
            No venues match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="px-6 py-3">Venue</th>
                  <th className="px-6 py-3">Plan</th>
                  <th className="px-6 py-3">Add-ons</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Active amount</th>
                  <th className="px-6 py-3 text-right">Lifetime</th>
                  <th className="px-6 py-3">Last payment</th>
                  <th className="px-6 py-3">Joined</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredVenues.map((v) => {
                  const addons = v.addons ?? { verified: false, sponsored: false, concierge: false };
                  return (
                  <tr key={v.id} className="hover:bg-gray-50/60">
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-900">{v.name}</div>
                      <div className="text-[11px] text-gray-500">{v.email || '—'}</div>
                    </td>
                    <td className="px-6 py-3">
                      {v.plan ? (
                        <div>
                          <div className="text-gray-900">{v.plan.name}</div>
                          <div className="text-[11px] text-gray-500">
                            {v.plan.price_monthly_cents != null
                              ? `${formatCentsExact(v.plan.price_monthly_cents)}/mo base`
                              : 'Free'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {addons.verified && (
                          <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-semibold text-blue-700 whitespace-nowrap">
                            {`✓ Verified${ap.verified_cents > 0 ? ` · ${fmtAddon(ap.verified_cents)}` : ''}`}
                          </span>
                        )}
                        {addons.sponsored && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700 whitespace-nowrap">
                            {`✓ Sponsored${ap.sponsored_cents > 0 ? ` · ${fmtAddon(ap.sponsored_cents)}` : ''}`}
                          </span>
                        )}
                        {addons.concierge && (
                          <span className="inline-flex items-center rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-semibold text-violet-700 whitespace-nowrap">
                            {`✓ Concierge${ap.concierge_cents > 0 ? ` · ${fmtAddon(ap.concierge_cents)}` : ''}`}
                          </span>
                        )}
                        {!addons.verified && !addons.sponsored && !addons.concierge && (
                          <span className="text-xs text-gray-400">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${statusPill(
                          v.status,
                        )}`}
                      >
                        {v.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-gray-900">
                      {v.mrr_cents > 0 ? (
                        <div>
                          <div className="font-semibold">{formatCentsExact(v.mrr_cents)}<span className="text-[11px] font-normal text-gray-500">/mo</span></div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-gray-700">
                      {v.lifetime_cents > 0 ? formatCents(v.lifetime_cents) : '—'}
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {v.last_payment ? (
                        <div>
                          <div>{formatDate(v.last_payment.occurred_at)}</div>
                          <div className="text-[11px] text-gray-500">
                            {formatCentsExact(v.last_payment.amount_cents)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-700">{formatDate(v.created_at)}</td>
                    <td className="px-6 py-3 text-right">
                      <a
                        href={`/admin/venues#venue-${v.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-100"
                      >
                        Manage
                      </a>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  tone = 'gray',
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: 'emerald' | 'red' | 'gray' | 'amber';
}) {
  const toneClasses: Record<string, string> = {
    emerald: 'border-emerald-100 bg-emerald-50/40 text-emerald-900',
    red: 'border-red-100 bg-red-50/40 text-red-900',
    gray: 'border-gray-200 bg-white text-gray-900',
    amber: 'border-amber-100 bg-amber-50/40 text-amber-900',
  };
  const iconTone: Record<string, string> = {
    emerald: 'text-emerald-600',
    red: 'text-red-600',
    gray: 'text-gray-500',
    amber: 'text-amber-600',
  };
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-70">
        <span className={iconTone[tone]}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold" style={{ color: BRAND }}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-gray-500">{sub}</div> : null}
    </div>
  );
}
