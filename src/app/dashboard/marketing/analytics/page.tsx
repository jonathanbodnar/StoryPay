'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, Mail, MousePointerClick, PieChart } from 'lucide-react';

type MarketingAnalytics = {
  emailsSent: number;
  emailsOpened: number;
  formSubmissions: Array<{ formId: string; name: string; count: number }>;
};

type CrmSummary = {
  pipelineValue: number;
  bookedThisMonth: number;
  monthlyBookingGoal: number | null;
  lostReasons: Array<{ reason: string; count: number }>;
  leadCount: number;
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/dashboard/marketing/email" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        ← Marketing email
      </Link>
      <div className="mb-8 flex items-start gap-3">
        <BarChart3 className="mt-1 shrink-0 text-brand-600" size={32} />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Marketing & CRM analytics</h1>
          <p className="mt-1 text-sm text-gray-600">
            Campaign delivery and opens, form volume, pipeline value, and loss reasons.
          </p>
        </div>
      </div>

      {err ? <p className="mb-4 text-sm text-red-600">{err}</p> : null}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Mail size={18} className="text-brand-600" /> Email campaigns
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Sent</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{m?.emailsSent ?? 0}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Opened</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{m?.emailsOpened ?? 0}</p>
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

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <MousePointerClick size={18} className="text-brand-600" /> Form submissions
            </h2>
            {(m?.formSubmissions?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No form submissions recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {(m?.formSubmissions ?? []).map((f) => (
                  <li key={f.formId} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-gray-800">{f.name}</span>
                    <span className="tabular-nums font-medium text-gray-900">{f.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
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
                          ({Math.min(100, Math.round((crm.bookedThisMonth / crm.monthlyBookingGoal) * 100))}% of goal)
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

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Top loss reasons</h2>
            {!crm?.lostReasons?.length ? (
              <p className="mt-3 text-sm text-gray-500">No loss reasons recorded yet. Mark a lost stage and add a reason on the lead.</p>
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
      )}
    </div>
  );
}
