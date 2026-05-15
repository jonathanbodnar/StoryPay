'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Lock, Loader2 } from 'lucide-react';
import type { DirectoryPlanCatalogEntry } from '@/lib/venue-billing';

// ── Per-plan static content ─────────────────────────────────────────────────

interface PlanContent {
  tagline: string;
  inherits: string | null;
  bullets: string[];
  ctaLabel: string;
}

const PLAN_CONTENT: Record<string, PlanContent> = {
  'all-inclusive': {
    tagline: 'We fill your calendar. You host.',
    inherits: 'Booking System',
    bullets: [
      'Venue Concierge: our team personally works your leads',
      'Every bride followed up without you lifting a finger',
      'Leads re-engaged for months automatically',
      'Nothing falls through the cracks. Ever.',
      'Verified and Sponsored badges included',
    ],
    ctaLabel: 'Start 14-day trial',
  },
  'booking system': {
    tagline: 'We bring the brides. You close them.',
    inherits: 'Venue Pro',
    bullets: [
      'Managed Meta ads so brides come to you',
      'Tour-ready leads in your pipeline daily',
      'Verified badge included',
      'You handle the follow-up',
    ],
    ctaLabel: 'Start 14-day trial',
  },
  'venue pro': {
    tagline: 'Run your venue like a business.',
    inherits: 'Free',
    bullets: [
      'Full lead pipeline so no inquiry gets lost',
      'Marketing Automations so follow-up runs without you',
      'Every message in one inbox',
      'Calendar with conflict detection so you never double-book',
      'Revenue reports so you know where you stand',
    ],
    ctaLabel: 'Start 14-day trial',
  },
  'free': {
    tagline: 'Get listed. Get paid.',
    inherits: null,
    bullets: [
      'Directory listing couples actually find',
      'Proposals with e-signatures built in',
      'Built-in payments. 0% processing fees. You keep 100%.',
    ],
    ctaLabel: 'Start for free',
  },
};

// Desired left-to-right display order
const PLAN_ORDER: Record<string, number> = {
  'all-inclusive': 0,
  'booking system': 1,
  'venue pro': 2,
  'free': 3,
};

function planKey(name: string) {
  return name.toLowerCase().trim();
}

function getPlanContent(name: string): PlanContent {
  return (
    PLAN_CONTENT[planKey(name)] ?? {
      tagline: '',
      inherits: null,
      bullets: [],
      ctaLabel: 'Get started',
    }
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ── Step indicator ───────────────────────────────────────────────────────────

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
    { n: 3, label: 'Upgrades' },
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

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  plans: DirectoryPlanCatalogEntry[];
  allPlans: DirectoryPlanCatalogEntry[];
  planAddonInclusion: Record<string, { verified: boolean; sponsored: boolean }>;
  venueName: string;
  ownerFirstName: string;
  hideHeader?: boolean;
};

// ── Component ────────────────────────────────────────────────────────────────

export function PlanPickerClient({ plans, ownerFirstName, hideHeader }: Props) {
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);

  // Sort into the desired display order (All-Inclusive → Booking System → Venue Pro → Free)
  const sortedPlans = [...plans].sort((a, b) => {
    const aOrd = PLAN_ORDER[planKey(a.name)] ?? 99;
    const bOrd = PLAN_ORDER[planKey(b.name)] ?? 99;
    return aOrd - bOrd;
  });

  function handleSelect(planId: string) {
    if (loadingPlanId) return;
    setLoadingPlanId(planId);
    window.location.href = `/signup/addons?plan_id=${planId}`;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {!hideHeader && <SignupStepHeader step={2} />}

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Hero text */}
        <div className="mb-10 text-center">
          {ownerFirstName && (
            <p className="mb-2 text-sm font-medium text-emerald-600">
              Welcome, {ownerFirstName}! One more step.
            </p>
          )}
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">StoryVenue Plans</h1>
          <p className="mt-2 text-base text-gray-500">
            14-day free trial. No down payment. No contracts. No cancellation fees.
          </p>
        </div>

        {/* Plan grid — all cards stretch to equal height so buttons are bottom-pinned */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {sortedPlans.map((plan) => {
            const content    = getPlanContent(plan.name);
            const isPaid     = (plan.price_monthly_cents ?? 0) > 0;
            const isFeatured = !!plan.highlight_label;
            const isLoading  = loadingPlanId === plan.id;
            const isDisabled = !!loadingPlanId && !isLoading;

            // Combine "Everything in X, plus:" as the first bullet item
            const allBullets: string[] = [
              ...(content.inherits ? [`Everything in ${content.inherits}, plus:`] : []),
              ...content.bullets,
            ];

            return (
              <div
                key={plan.id}
                className={[
                  'relative flex flex-col rounded-2xl bg-white px-7 pb-7 pt-8',
                  isFeatured
                    ? 'border-2 border-gray-900 shadow-[0_8px_32px_rgba(0,0,0,0.18)]'
                    : 'border border-gray-200',
                ].join(' ')}
              >
                {/* "Most Popular" badge — sits on top border edge */}
                {plan.highlight_label && (
                  <div className="absolute -top-[14px] left-1/2 -translate-x-1/2 z-10">
                    <span className="whitespace-nowrap rounded-full bg-gray-900 px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-white">
                      {plan.highlight_label}
                    </span>
                  </div>
                )}

                {/* Plan name */}
                <h2 className="text-[1.35rem] font-bold leading-tight text-gray-900">{plan.name}</h2>

                {/* Tagline — pulled from plan.description so it's editable in the admin */}
                {plan.description && (
                  <p className="mt-1 text-[13px] italic text-gray-500">{plan.description}</p>
                )}

                {/* Price */}
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-5xl font-extrabold tracking-tight text-gray-900">
                    {isPaid ? formatCents(plan.price_monthly_cents!) : '$0'}
                  </span>
                  <span className="text-sm font-normal text-gray-500">/mo</span>
                </div>

                {/* Bullet list — inherits line folded in as first item */}
                <ul className="mt-6 flex-1 space-y-2.5">
                  {allBullets.map((bullet, i) => {
                    const isInherits = content.inherits && i === 0;
                    return (
                      <li
                        key={i}
                        className={[
                          'flex items-start gap-2 leading-snug',
                          isInherits ? 'text-[12px] text-gray-500 font-semibold' : 'text-[13px] text-gray-700',
                        ].join(' ')}
                      >
                        <span className="mt-[3px] shrink-0 text-gray-400 select-none">·</span>
                        {bullet}
                      </li>
                    );
                  })}
                </ul>

                {/* CTA button — always at bottom */}
                <button
                  type="button"
                  onClick={() => handleSelect(plan.id)}
                  disabled={isDisabled}
                  className={[
                    'mt-8 flex w-full items-center justify-center rounded-xl py-3 text-[13px] font-semibold transition-all disabled:opacity-50',
                    isFeatured
                      ? 'bg-gray-900 text-white hover:bg-gray-700'
                      : 'border border-gray-300 bg-white text-gray-900 hover:border-gray-600',
                  ].join(' ')}
                >
                  {isLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    content.ctaLabel
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <div className="mt-10 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <Lock size={11} className="shrink-0" />
            Registration complete — you can&apos;t go back to this step
          </div>
          <p className="text-center text-xs text-gray-400">
            Prices in USD. Subscription billed monthly. Upgrade, downgrade, or cancel anytime from your dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
