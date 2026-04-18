'use client';

import { DollarSign, TrendingUp, PieChart } from 'lucide-react';

export type LeadInsightsPayload = {
  pipelineId: string | null;
  totals: { raw: number; weighted: number; count: number };
  byStage: Array<{
    stageId: string;
    name: string;
    raw: number;
    weighted: number;
    count: number;
    winPct: number;
  }>;
  referralRevenue: Array<{ referralLabel: string; revenue: number }>;
  directoryAttributedRevenue: number;
  listingBudget: number | null;
  roiVsListing: number | null;
};

function fmt(n: number, hide: boolean) {
  if (hide) return '•••';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function LeadInsightsStrip({
  data,
  hideRevenue,
  loading,
}: {
  data: LeadInsightsPayload | null;
  hideRevenue: boolean;
  loading: boolean;
}) {
  if (loading || !data?.pipelineId) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-sm text-gray-400">
        Loading pipeline insights…
      </div>
    );
  }

  const topSources = data.referralRevenue.slice(0, 5);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-gray-100 p-2">
            <DollarSign className="w-4 h-4 text-gray-600" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Open pipeline</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{fmt(data.totals.raw, hideRevenue)}</p>
            <p className="text-xs text-gray-500">{data.totals.count} leads</p>
          </div>
        </div>
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-violet-50 p-2">
            <TrendingUp className="w-4 h-4 text-violet-700" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Weighted (stage %)</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{fmt(data.totals.weighted, hideRevenue)}</p>
            <p className="text-xs text-gray-500">Rough forecast from stage win %</p>
          </div>
        </div>
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-emerald-50 p-2">
            <PieChart className="w-4 h-4 text-emerald-700" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Directory revenue (paid)</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{fmt(data.directoryAttributedRevenue, hideRevenue)}</p>
            <p className="text-xs text-gray-500">Matched leads → proposals</p>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Listing ROI (rough)</p>
          {data.listingBudget != null && data.listingBudget > 0 ? (
            <>
              <p className="text-lg font-bold text-gray-900 tabular-nums">
                {data.roiVsListing != null && !hideRevenue
                  ? `${data.roiVsListing.toFixed(1)}×`
                  : hideRevenue
                    ? '•••'
                    : '—'}
              </p>
              <p className="text-xs text-gray-500">
                vs {fmt(data.listingBudget, hideRevenue)}/mo budget (Settings)
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500 mt-1">Set monthly listing spend in Settings → General to estimate ROI.</p>
          )}
        </div>
      </div>
      {topSources.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50/50">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Paid revenue by referral label</p>
          <div className="flex flex-wrap gap-2">
            {topSources.map((s) => (
              <span
                key={s.referralLabel}
                className="inline-flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-2.5 py-1 text-xs text-gray-700"
              >
                <span className="truncate max-w-[140px]">{s.referralLabel}</span>
                <span className="font-semibold tabular-nums text-gray-900">{fmt(s.revenue, hideRevenue)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
