'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronRight,
  Lock,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import type { DirectoryPlanCatalogEntry } from '@/lib/venue-billing';

// ── Feature definitions ────────────────────────────────────────────────────

const PLAN_FEATURES: { key: string; label: string; outcome: string }[] = [
  { key: 'dashboard_home',            label: 'Dashboard & CRM',              outcome: 'Central hub with contacts, leads, and activity metrics' },
  { key: 'conversations',             label: 'Conversations inbox',          outcome: 'Unified inbox for every client message and inquiry' },
  { key: 'calendar',                  label: 'Calendar & scheduling',        outcome: 'Block dates, track bookings, and sync availability' },
  { key: 'payments',                  label: 'Payments & proposals',         outcome: 'Send proposals, collect deposits, and track payments' },
  { key: 'marketing',                 label: 'Email marketing',              outcome: 'Campaigns, automations, and audience management' },
  { key: 'listing',                   label: 'Venue directory listing',      outcome: 'Appear in the wedding directory so couples can find you' },
  { key: 'nav_listing_pricing_guide', label: 'Pricing & availability guide', outcome: 'Share your pricing with couples in a polished branded guide' },
  { key: 'ai_assistant',              label: 'Ask AI assistant',             outcome: 'Draft emails, respond to leads, and generate content instantly' },
  { key: 'reports',                   label: 'Analytics & reports',          outcome: 'Revenue insights, booking trends, and performance data' },
];

function planIncludesFeature(featureFlags: Record<string, unknown>, key: string): boolean {
  if (Boolean(featureFlags[key])) return true;
  if (key === 'nav_listing_pricing_guide' && Boolean(featureFlags.listing)) return true;
  return false;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

// ── Step indicator shared component ────────────────────────────────────────

export function SignupStepHeader({
  step,
  totalSteps = 4,
}: {
  step: 1 | 2 | 3 | 4;
  totalSteps?: number;
}) {
  const steps = [
    { n: 1, label: 'Create account' },
    { n: 2, label: 'Choose plan' },
    { n: 3, label: 'Add-ons' },
    { n: 4, label: 'Add payment' },
  ].slice(0, totalSteps);

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={120} height={30} />
        <div className="hidden items-center gap-1.5 text-sm sm:flex">
          {steps.map((s, i) => {
            const isDone    = s.n < step;
            const isCurrent = s.n === step;
            return (
              <span key={s.n} className="flex items-center gap-1.5">
                {i > 0 && <span className="mx-1 text-gray-200">›</span>}
                {/* Step circle */}
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${
                    isDone
                      ? 'bg-emerald-500 text-white'
                      : isCurrent
                      ? 'bg-gray-900 text-white'
                      : 'border border-gray-200 text-gray-300'
                  }`}
                >
                  {isDone ? '✓' : s.n}
                </span>
                {/* Step label */}
                <span
                  className={
                    isDone
                      ? 'text-emerald-600 text-xs'
                      : isCurrent
                      ? 'font-semibold text-gray-900 text-xs'
                      : 'text-gray-300 text-xs'
                  }
                >
                  {s.label}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  plans: DirectoryPlanCatalogEntry[];
  allPlans: DirectoryPlanCatalogEntry[];
  planAddonInclusion: Record<string, { verified: boolean; sponsored: boolean }>;
  venueName: string;
  ownerFirstName: string;
};

// ── Component ──────────────────────────────────────────────────────────────

export function PlanPickerClient({ plans, ownerFirstName }: Props) {
  const router = useRouter();

  // Default selection priority:
  // 1. Plan with a highlight_label (admin-designated featured plan)
  // 2. Plan marked is_default
  // 3. First paid plan in the list
  const defaultPlan = useMemo(() => {
    const highlighted = plans.find((p) => p.highlight_label);
    if (highlighted) return highlighted.id;
    const adminDefault = plans.find((p) => p.is_default);
    if (adminDefault) return adminDefault.id;
    const paid = plans.filter((p) => (p.price_monthly_cents ?? 0) > 0);
    return paid[0]?.id ?? plans[0]?.id ?? '';
  }, [plans]);

  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlan);
  const [loading, setLoading] = useState(false);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  function handleContinue() {
    if (!selectedPlanId) return;
    setLoading(true);
    router.push(`/signup/addons?plan_id=${selectedPlanId}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SignupStepHeader step={2} />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Hero text */}
        <div className="mb-10 text-center">
          {ownerFirstName && (
            <p className="mb-1 text-sm font-medium text-emerald-600">
              Welcome, {ownerFirstName}! One more step.
            </p>
          )}
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Choose a plan to get started</h1>
          <p className="mt-2 text-base text-gray-500">
            Every paid plan includes a <strong>14-day free trial</strong>. No charge until after your trial ends.
          </p>
        </div>

        {/* Plan grid */}
        {(() => {
          const highlightIdx = plans.findIndex((p) => p.highlight_label);
          const featuredIdx  = highlightIdx >= 0 ? highlightIdx : Math.floor((plans.length - 1) / 2);

          return (
            <div
              className={`grid items-center gap-4 ${
                plans.length <= 2
                  ? 'sm:grid-cols-2'
                  : plans.length === 3
                  ? 'sm:grid-cols-3'
                  : 'sm:grid-cols-2 lg:grid-cols-4'
              }`}
            >
              {plans.map((plan, idx) => {
                const isSelected = plan.id === selectedPlanId;
                const isPaid     = (plan.price_monthly_cents ?? 0) > 0;
                const badgeLabel = plan.highlight_label ?? null;
                const isFeatured = idx === featuredIdx;

                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={[
                      'relative flex cursor-pointer flex-col rounded-2xl border bg-white transition-all duration-200',
                      // Featured: bigger padding, deep shadow, scaled up
                      // Side: compact padding, natural height (no self-stretch so
                      // they sit shorter and more square relative to the middle)
                      isFeatured
                        ? 'p-6 shadow-xl ring-2 ring-gray-900/10 scale-[1.04] z-10'
                        : 'p-4 shadow-sm',
                      badgeLabel || isFeatured ? 'mt-4' : '',
                      isSelected
                        ? 'border-gray-900'
                        : isFeatured
                        ? 'border-gray-800 hover:border-gray-900'
                        : 'border-gray-200 hover:border-gray-400',
                    ].join(' ')}
                  >
                    {/* Floating badge */}
                    {badgeLabel && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                        <span className="whitespace-nowrap rounded-full bg-gray-900 px-3 py-1 text-[11px] font-semibold text-white shadow">
                          {badgeLabel}
                        </span>
                      </div>
                    )}

                    {/* Selection radio */}
                    <div className="mb-2.5 flex items-start justify-between">
                      <div
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          isSelected ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                    </div>

                    {/* Plan name */}
                    <div className={`mb-1 font-bold text-gray-900 ${isFeatured ? 'text-lg' : 'text-sm'}`}>
                      {plan.name}
                    </div>
                    {/* Description only on featured card — keeps side cards compact */}
                    {isFeatured && plan.description && (
                      <p className="mb-3 text-xs text-gray-500 leading-snug">{plan.description}</p>
                    )}

                    {/* Price */}
                    <div className={isFeatured ? 'mb-1' : 'mb-0.5'}>
                      {isPaid ? (
                        <div className="flex items-baseline gap-1">
                          <span className={`font-extrabold text-gray-900 ${isFeatured ? 'text-3xl' : 'text-xl'}`}>
                            {formatCents(plan.price_monthly_cents!)}
                          </span>
                          <span className={`text-gray-500 ${isFeatured ? 'text-sm' : 'text-xs'}`}>/mo</span>
                        </div>
                      ) : (
                        <span className={`font-extrabold text-gray-900 ${isFeatured ? 'text-3xl' : 'text-xl'}`}>
                          Free
                        </span>
                      )}
                    </div>

                    {isPaid && (
                      <div className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ${isFeatured ? 'mb-4' : 'mb-2'}`}>
                        <Sparkles size={9} />
                        14-day free trial
                      </div>
                    )}

                    {/* Feature comparison
                        Side cards: label only (compact / square feel)
                        Featured card: label + outcome description (full detail) */}
                    <div className={`border-t border-gray-100 pt-2.5 ${isFeatured ? 'mt-2 space-y-2.5' : 'mt-1.5 space-y-1.5'}`}>
                      {PLAN_FEATURES.map((f) => {
                        const included = planIncludesFeature(
                          plan.feature_flags as Record<string, unknown>,
                          f.key,
                        );
                        return (
                          <div key={f.key} className="flex items-start gap-2">
                            {included ? (
                              <Check size={12} className="mt-px shrink-0 text-emerald-500" />
                            ) : (
                              <X size={12} className="mt-px shrink-0 text-red-400" />
                            )}
                            <div>
                              <div
                                className={`font-medium leading-tight ${
                                  isFeatured ? 'text-xs' : 'text-[11px]'
                                } ${included ? 'text-gray-800' : 'text-gray-400'}`}
                              >
                                {f.label}
                              </div>
                              {/* Outcome only on featured card */}
                              {isFeatured && (
                                <div
                                  className={`mt-0.5 text-[10px] leading-snug ${
                                    included ? 'text-gray-500' : 'text-gray-300'
                                  }`}
                                >
                                  {f.outcome}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* CTA */}
        <div className="mt-8 flex flex-col items-center gap-3">
          {/* Registration is a one-way door — no back button here */}
          <div className="flex items-center gap-2 text-[11px] text-gray-400 mb-1">
            <Lock size={11} className="shrink-0" />
            Registration complete — you can&apos;t go back to this step
          </div>

          <button
            type="button"
            disabled={loading || !selectedPlanId}
            onClick={handleContinue}
            className="flex items-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {loading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Loading…
              </>
            ) : (
              <>
                Continue to Add-ons
                <ChevronRight size={15} />
              </>
            )}
          </button>

          {selectedPlan && (
            <p className="text-xs text-gray-400">
              Selected: <strong className="text-gray-600">{selectedPlan.name}</strong>
              {(selectedPlan.price_monthly_cents ?? 0) > 0
                ? ` — ${formatCents(selectedPlan.price_monthly_cents!)}/mo`
                : ' — Free'}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Prices in USD. Subscription billed monthly. Upgrade, downgrade, or cancel anytime from your dashboard.
        </p>
      </div>
    </div>
  );
}
