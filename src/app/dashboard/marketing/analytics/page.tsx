'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ExternalLink,
  Loader2,
  Mail,
  MousePointerClick,
  PieChart,
  RefreshCw,
  AlertTriangle,
  UserMinus,
  XCircle,
  Send,
  X,
  Search,
  ShieldOff,
} from 'lucide-react';
import type { AnalyticsDetailRow, AnalyticsDetailType } from '@/app/api/marketing/analytics/detail/route';

/* ─── types ─────────────────────────────────────────────────── */

type MarketingAnalytics = {
  emailsSent: number;
  emailsOpened: number;
  emailsBounced: number;
  unsubscribeCount: number;
  spamReportCount: number;
  formSubmissions: Array<{ formId: string; name: string; count: number }>;
  templateCount: number;
  campaignCount: number;
  automationCount: number;
  activeAutomationCount: number;
  formCount: number;
  totalFormSubmissions: number;
  formSubmissionsLast7Days: number;
  triggerLinkClicksTracked: number;
  suppressionCount: number;
  formBreakdownTruncated: boolean;
};

type CrmSummary = {
  pipelineValue: number;
  bookedThisMonth: number;
  monthlyBookingGoal: number | null;
  lostReasons: Array<{ reason: string; count: number }>;
  leadCount: number;
};

type ModalConfig = {
  type: AnalyticsDetailType;
  title: string;
  count: number;
  accentClass: string;
};

/* ─── helpers ───────────────────────────────────────────────── */

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function reasonLabel(type: AnalyticsDetailType, extra: string | null): string {
  if (type === 'suppressions' && extra) {
    if (extra === 'unsubscribe') return 'Unsubscribed';
    if (extra === 'spam') return 'Spam report';
    return extra;
  }
  if (type === 'bounced' && extra) return extra;
  return '';
}

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50';

/* ─── detail modal ──────────────────────────────────────────── */

function DetailModal({
  config,
  onClose,
}: {
  config: ModalConfig;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AnalyticsDetailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
  }, [search]);

  const fetchRows = useCallback(async (p: number, s: string, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        type: config.type,
        page: String(p),
        ...(s ? { search: s } : {}),
      });
      const res = await fetch(`/api/marketing/analytics/detail?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setTotal(data.total);
      setHasMore(data.hasMore);
      setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [config.type]);

  useEffect(() => {
    void fetchRows(0, debouncedSearch, false);
    setPage(0);
  }, [debouncedSearch, fetchRows]);

  // Trap focus and escape key
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchRows(nextPage, debouncedSearch, true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{config.title}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {loading ? 'Loading…' : `${total} contact${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-gray-100 px-5 py-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or phone…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="px-5 py-8 text-center text-sm text-red-600">{error}</div>
          ) : loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-gray-400">
              No contacts found{search ? ' matching your search' : ''}.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50/90 backdrop-blur-sm">
                <tr>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Contact</th>
                  <th className="hidden px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 sm:table-cell">
                    {config.type === 'sent' ? 'Last sent' : config.type === 'opened' ? 'Opened' : config.type === 'bounced' ? 'Bounced' : 'Date'}
                  </th>
                  {(config.type === 'bounced' || config.type === 'suppressions') && (
                    <th className="hidden px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 sm:table-cell">
                      {config.type === 'bounced' ? 'Error' : 'Reason'}
                    </th>
                  )}
                  {config.type === 'sent' && (
                    <th className="hidden px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400 sm:table-cell">
                      Emails
                    </th>
                  )}
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Profile
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={`${r.leadId}-${i}`} className="group hover:bg-gray-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{r.name || <span className="text-gray-400">—</span>}</p>
                      <p className="text-xs text-gray-500">{r.email || '—'}</p>
                      {r.phone && <p className="text-xs text-gray-400">{r.phone}</p>}
                    </td>
                    <td className="hidden whitespace-nowrap px-5 py-3 text-xs text-gray-500 sm:table-cell">
                      {fmtDate(r.date)}
                    </td>
                    {(config.type === 'bounced' || config.type === 'suppressions') && (
                      <td className="hidden px-5 py-3 text-xs text-gray-500 sm:table-cell">
                        {reasonLabel(config.type, r.extra) || '—'}
                      </td>
                    )}
                    {config.type === 'sent' && (
                      <td className="hidden px-5 py-3 text-xs tabular-nums text-gray-500 sm:table-cell">
                        {r.extra ?? '1 email'}
                      </td>
                    )}
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/dashboard/contacts/${r.leadId}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
                        target="_blank"
                      >
                        View <ExternalLink size={10} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Load more */}
          {hasMore && (
            <div className="px-5 py-4 text-center">
              <button
                type="button"
                disabled={loading}
                onClick={loadMore}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Load more
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3 text-center">
          <p className="text-xs text-gray-400">
            Showing {Math.min(rows.length, total)} of {total} result{total === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── clickable metric card ─────────────────────────────────── */

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  note,
  accentClass = 'text-gray-400',
  bgClass = 'bg-gray-50/80 border-gray-100',
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string | null;
  note?: string;
  accentClass?: string;
  bgClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-lg border px-4 py-3 text-left transition hover:shadow-md hover:ring-1 hover:ring-gray-200 ${bgClass}`}
    >
      <div className={`flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide ${accentClass}`}>
        <Icon size={12} />
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${accentClass}`}>{sub}</p>}
      {note && <p className="mt-1 text-[11px] text-gray-400">{note}</p>}
      <p className="mt-1.5 text-[10px] font-medium text-gray-400 opacity-0 transition group-hover:opacity-100">
        Click to view contacts →
      </p>
    </button>
  );
}

/* ─── main page ─────────────────────────────────────────────── */

export default function MarketingAnalyticsPage() {
  const [m, setM] = useState<MarketingAnalytics | null>(null);
  const [crm, setCrm] = useState<CrmSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalConfig | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [a, b] = await Promise.all([
      fetch('/api/marketing/analytics', { cache: 'no-store' }),
      fetch('/api/reports/crm-summary', { cache: 'no-store' }),
    ]);
    if (a.ok) {
      const j = (await a.json()) as MarketingAnalytics;
      setM(j);
    } else setErr('Could not load marketing metrics.');
    if (b.ok) {
      const j = (await b.json()) as CrmSummary;
      setCrm(j);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openModal = (type: AnalyticsDetailType, title: string, count: number, accentClass: string) => {
    setModal({ type, title, count, accentClass });
  };

  const openRate =
    m && m.emailsSent > 0 ? Math.round((m.emailsOpened / m.emailsSent) * 1000) / 10 : null;
  const bounceRate =
    m && m.emailsSent > 0 ? Math.round((m.emailsBounced / m.emailsSent) * 1000) / 10 : null;
  const unsubRate =
    m && m.emailsSent > 0 ? Math.round((m.unsubscribeCount / m.emailsSent) * 1000) / 10 : null;
  const spamRate =
    m && m.emailsSent > 0 ? Math.round((m.spamReportCount / m.emailsSent) * 1000) / 10 : null;
  const formRecentShare =
    m && m.totalFormSubmissions > 0
      ? Math.round((m.formSubmissionsLast7Days / m.totalFormSubmissions) * 1000) / 10
      : null;

  return (
    <>
      {modal && (
        <DetailModal config={modal} onClose={() => setModal(null)} />
      )}

      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          ← Dashboard
        </Link>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BarChart3 className="mt-1 shrink-0 text-brand-600" size={32} />
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Marketing analytics</h1>
              <p className="mt-1 max-w-xl text-sm text-gray-600">
                Email performance, forms, CRM pipeline, and attribution — click any card to explore the contacts behind each metric.
              </p>
            </div>
          </div>
          <button type="button" className={primaryBtn} onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {err ? <p className="mb-4 text-sm text-red-600">{err}</p> : null}

        {loading ? (
          <div className="flex min-h-[30vh] items-center justify-center text-gray-500">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : m ? (
          <div className="space-y-6">
            {/* At a glance */}
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <BarChart3 size={18} className="text-brand-600" /> At a glance
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { k: 'Templates', v: m.templateCount },
                  { k: 'Campaigns', v: m.campaignCount },
                  { k: 'Workflows', v: m.automationCount },
                  { k: 'Active workflows', v: m.activeAutomationCount },
                  { k: 'Forms', v: m.formCount },
                  { k: 'Suppressions', v: m.suppressionCount },
                ].map((row) => (
                  <div key={row.k} className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{row.k}</p>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">{row.v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    Trigger link clicks (tracked)
                  </p>
                  <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
                    {m.triggerLinkClicksTracked}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Logged when leads hit your short URLs.</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Form submissions (7d)</p>
                  <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
                    {m.formSubmissionsLast7Days}
                    {m.totalFormSubmissions > 0 ? (
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        of {m.totalFormSubmissions} all-time
                        {formRecentShare != null ? ` · ${formRecentShare}% in last 7d` : ''}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
            </section>

            {/* Email deliverability — all cards clickable */}
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Mail size={18} className="text-brand-600" /> Email deliverability
              </h2>
              <p className="mt-1 text-xs text-gray-500">Click any card to see the contacts behind that metric.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard
                  icon={Send}
                  label="Sent"
                  value={m.emailsSent}
                  accentClass="text-gray-400"
                  bgClass="bg-gray-50/80 border-gray-100"
                  onClick={() => openModal('sent', 'Emails sent — contacts', m.emailsSent, 'text-gray-400')}
                />
                <MetricCard
                  icon={Mail}
                  label="Opened"
                  value={m.emailsOpened}
                  sub={openRate != null ? `${openRate}% open rate` : null}
                  accentClass="text-gray-400"
                  bgClass="bg-gray-50/80 border-gray-100"
                  onClick={() => openModal('opened', 'Email opens — contacts', m.emailsOpened, 'text-gray-400')}
                />
                <MetricCard
                  icon={XCircle}
                  label="Bounced"
                  value={m.emailsBounced}
                  sub={bounceRate != null ? `${bounceRate}% of sent` : null}
                  accentClass="text-amber-600"
                  bgClass="bg-amber-50/60 border-amber-100"
                  onClick={() => openModal('bounced', 'Bounced emails — contacts', m.emailsBounced, 'text-amber-600')}
                />
                <MetricCard
                  icon={UserMinus}
                  label="Unsubscribes"
                  value={m.unsubscribeCount}
                  sub={unsubRate != null ? `${unsubRate}% of sent` : null}
                  note="Contacts who opted out of emails"
                  accentClass="text-orange-600"
                  bgClass="bg-orange-50/60 border-orange-100"
                  onClick={() => openModal('unsubscribes', 'Unsubscribed contacts', m.unsubscribeCount, 'text-orange-600')}
                />
                <MetricCard
                  icon={AlertTriangle}
                  label="Spam reports"
                  value={m.spamReportCount}
                  sub={spamRate != null ? `${spamRate}% of sent` : null}
                  note="Keep under 0.1% to protect deliverability"
                  accentClass={m.spamReportCount > 0 ? 'text-red-600' : 'text-gray-400'}
                  bgClass={m.spamReportCount > 0 ? 'bg-red-50/60 border-red-200' : 'bg-gray-50/80 border-gray-100'}
                  onClick={() => openModal('spam', 'Spam reports — contacts', m.spamReportCount, 'text-red-600')}
                />
                <MetricCard
                  icon={ShieldOff}
                  label="Total suppressions"
                  value={m.suppressionCount}
                  note="Emails never sent to these contacts"
                  accentClass="text-gray-400"
                  bgClass="bg-gray-50/80 border-gray-100"
                  onClick={() => openModal('suppressions', 'All suppressions — contacts', m.suppressionCount, 'text-gray-500')}
                />
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Opens tracked via pixel. Bounces = failed delivery. Unsubscribes and spam reports are suppressed automatically.
              </p>
            </section>

            {/* Form submissions by form */}
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <MousePointerClick size={18} className="text-brand-600" /> Form submissions by form
              </h2>
              {m.totalFormSubmissions === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No form submissions recorded yet.</p>
              ) : (
                <>
                  {m.formBreakdownTruncated ? (
                    <p className="mt-2 text-xs text-amber-800">
                      Showing up to {10000} recent rows for the breakdown; total submissions: {m.totalFormSubmissions}.
                    </p>
                  ) : null}
                  <ul className="mt-3 divide-y divide-gray-100">
                    {m.formSubmissions.length === 0 ? (
                      <li className="py-2 text-sm text-gray-500">Breakdown loading…</li>
                    ) : (
                      m.formSubmissions.map((f) => {
                        const pct =
                          m.totalFormSubmissions > 0
                            ? Math.round((f.count / m.totalFormSubmissions) * 1000) / 10
                            : 0;
                        return (
                          <li key={f.formId} className="py-3">
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="font-medium text-gray-800">{f.name}</span>
                              <span className="tabular-nums text-gray-900">
                                {f.count}{' '}
                                <span className="text-gray-400">({pct}%)</span>
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full bg-brand-600/80"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </>
              )}
            </section>

            {/* Pipeline & revenue */}
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <PieChart size={18} className="text-brand-600" /> Pipeline & revenue
              </h2>
              {crm ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Pipeline value (sum)</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(crm.pipelineValue)}</p>
                    <p className="mt-1 text-xs text-gray-500">{crm.leadCount} leads</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Booked this month</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(crm.bookedThisMonth)}</p>
                    {crm.monthlyBookingGoal != null ? (
                      <p className="mt-1 text-xs text-gray-500">
                        Goal: {fmtMoney(crm.monthlyBookingGoal)}
                        {crm.monthlyBookingGoal > 0 ? (
                          <span className="ml-2">
                            (
                            {Math.min(
                              100,
                              Math.round((crm.bookedThisMonth / crm.monthlyBookingGoal) * 100),
                            )}
                            % of goal)
                          </span>
                        ) : null}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-500">Set a monthly goal under venue settings.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-500">CRM summary unavailable.</p>
              )}
            </section>

            {/* Top loss reasons */}
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-900">Top loss reasons</h2>
              {!crm?.lostReasons?.length ? (
                <p className="mt-3 text-sm text-gray-500">
                  No loss reasons recorded yet. Mark a lost stage and add a reason on the lead.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {crm.lostReasons.slice(0, 8).map((r) => (
                    <li key={r.reason} className="flex items-center justify-between text-sm">
                      <span className="text-gray-800">{r.reason}</span>
                      <span className="tabular-nums text-gray-600">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </>
  );
}
