'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  FileStack,
  LayoutTemplate,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  MousePointerClick,
  PieChart,
  RefreshCw,
  Workflow,
} from 'lucide-react';

type MarketingAnalytics = {
  emailsSent: number;
  emailsOpened: number;
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

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50';

const quickLinks: { href: string; label: string; desc: string; Icon: typeof Mail }[] = [
  {
    href: '/dashboard/marketing/email/templates',
    label: 'Email templates',
    desc: 'Layouts, subjects, merge tags',
    Icon: FileStack,
  },
  {
    href: '/dashboard/marketing/email/campaigns',
    label: 'Email campaigns',
    desc: 'Broadcasts & scheduled sends',
    Icon: Megaphone,
  },
  {
    href: '/dashboard/marketing/workflows',
    label: 'Workflows',
    desc: 'Triggers, delays, email & SMS (more channels later)',
    Icon: Workflow,
  },
  {
    href: '/dashboard/marketing/form-builder',
    label: 'Lead Capture Forms',
    desc: 'Embeddable lead capture forms',
    Icon: LayoutTemplate,
  },
  {
    href: '/dashboard/marketing/trigger-links',
    label: 'Trigger links & tags',
    desc: 'Short URLs & lead tags',
    Icon: Link2,
  },
];

export default function MarketingAnalyticsPage() {
  const [m, setM] = useState<MarketingAnalytics | null>(null);
  const [crm, setCrm] = useState<CrmSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    void load();
  }, [load]);

  const openRate =
    m && m.emailsSent > 0 ? Math.round((m.emailsOpened / m.emailsSent) * 1000) / 10 : null;

  const formRecentShare =
    m && m.totalFormSubmissions > 0
      ? Math.round((m.formSubmissionsLast7Days / m.totalFormSubmissions) * 1000) / 10
      : null;

  return (
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
              Email performance, forms, CRM pipeline, and attribution — with quick links to every marketing tool.
            </p>
          </div>
        </div>
        <button type="button" className={primaryBtn} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Marketing tools</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {quickLinks.map(({ href, label, desc, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-3 transition hover:border-gray-300 hover:bg-white"
              >
                <Icon size={18} className="mt-0.5 shrink-0 text-gray-600" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{label}</span>
                  <span className="block text-xs text-gray-500">{desc}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {err ? <p className="mb-4 text-sm text-red-600">{err}</p> : null}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : m ? (
        <div className="space-y-6">
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

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Mail size={18} className="text-brand-600" /> Email campaigns
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Sent</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{m.emailsSent}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Opened</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{m.emailsOpened}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Open rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                  {openRate != null ? `${openRate}%` : '—'}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Opens are recorded when a recipient loads the tracking pixel in a campaign email.
            </p>
          </section>

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
  );
}
