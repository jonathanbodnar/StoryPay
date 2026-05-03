'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Check,
  Loader2,
  Lock,
  Megaphone,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { DirectoryPlanCatalogEntry } from '@/lib/venue-billing';

// ── Feature definitions ────────────────────────────────────────────────────

const PLAN_FEATURES: { key: string; label: string; outcome: string }[] = [
  { key: 'dashboard_home',          label: 'Dashboard & CRM',             outcome: 'Central hub with contacts, leads, and activity metrics' },
  { key: 'conversations',           label: 'Conversations inbox',         outcome: 'Unified inbox for every client message and inquiry' },
  { key: 'calendar',                label: 'Calendar & scheduling',       outcome: 'Block dates, track bookings, and sync availability' },
  { key: 'payments',                label: 'Payments & proposals',        outcome: 'Send proposals, collect deposits, and track payments' },
  { key: 'marketing',               label: 'Email marketing',             outcome: 'Campaigns, automations, and audience management' },
  { key: 'listing',                 label: 'Venue directory listing',     outcome: 'Appear in the wedding directory so couples can find you' },
  { key: 'nav_listing_pricing_guide', label: 'Pricing & availability guide', outcome: 'Share your pricing with couples in a polished branded guide' },
  { key: 'ai_assistant',            label: 'Ask AI assistant',            outcome: 'Draft emails, respond to leads, and generate content instantly' },
  { key: 'reports',                 label: 'Analytics & reports',         outcome: 'Revenue insights, booking trends, and performance data' },
];

function planIncludesFeature(featureFlags: Record<string, unknown>, key: string): boolean {
  if (Boolean(featureFlags[key])) return true;
  if (key === 'nav_listing_pricing_guide' && Boolean(featureFlags.listing)) return true;
  return false;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

// 14-day trial end date formatted nicely
function trialEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
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

export function PlanPickerClient({ plans, allPlans, planAddonInclusion, ownerFirstName }: Props) {
  const router = useRouter();

  // Default to first paid plan (recommended)
  const defaultPlan = useMemo(() => {
    const paid = plans.filter((p) => (p.price_monthly_cents ?? 0) > 0);
    // Pick the first/cheapest paid plan as default
    return paid[0]?.id ?? plans[0]?.id ?? '';
  }, [plans]);

  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlan);
  const [addonVerified, setAddonVerified] = useState(false);
  const [addonSponsored, setAddonSponsored] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedPlan = useMemo(() => plans.find((p) => p.id === selectedPlanId) ?? null, [plans, selectedPlanId]);

  // Resolve effective addon flags (plan-included overrides user toggle)
  const inclusion = selectedPlanId ? planAddonInclusion[selectedPlanId] ?? { verified: false, sponsored: false } : { verified: false, sponsored: false };
  const effectiveVerified  = inclusion.verified  || addonVerified;
  const effectiveSponsored = inclusion.sponsored || addonSponsored;

  // Live total
  const totalCents = useMemo(() => {
    if (!selectedPlan) return 0;
    const base = selectedPlan.price_monthly_cents ?? 0;
    const verifiedCost  = effectiveVerified  && !inclusion.verified  ? 1900 : 0;
    const sponsoredCost = effectiveSponsored && !inclusion.sponsored ? 9900 : 0;
    return base + verifiedCost + sponsoredCost;
  }, [selectedPlan, effectiveVerified, effectiveSponsored, inclusion]);

  const isFree = totalCents === 0;
  const trialEnd = useMemo(() => trialEndDate(), []);

  async function handleContinue() {
    if (!selectedPlanId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/venue-billing/signup-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id:        selectedPlanId,
          addon_verified:  effectiveVerified,
          addon_sponsored: effectiveSponsored,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      if (data.redirect) {
        router.replace(data.redirect);
      } else if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={120} height={30} />
          <div className="hidden items-center gap-2 text-sm text-gray-500 sm:flex">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">✓</span>
            <span className="text-gray-400">Create account</span>
            <span className="mx-2 text-gray-300">→</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">2</span>
            <span className="font-semibold text-gray-900">Choose plan</span>
            <span className="mx-2 text-gray-300">→</span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-400">3</span>
            <span className="text-gray-400">Add payment</span>
          </div>
        </div>
      </div>

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
            Every paid plan includes a <strong>14-day free trial</strong>. No charge until {trialEnd}.
          </p>
        </div>

        {/* Plan grid */}
        <div className={`grid gap-4 ${plans.length <= 2 ? 'sm:grid-cols-2' : plans.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
          {plans.map((plan) => {
            const isSelected = plan.id === selectedPlanId;
            const isPaid = (plan.price_monthly_cents ?? 0) > 0;
            const isRecommended = plan.id === defaultPlan;

            return (
              <div
                key={plan.id}
                onClick={() => setSelectedPlanId(plan.id)}
                className={`relative flex cursor-pointer flex-col rounded-2xl border bg-white p-5 transition-colors ${
                  isSelected
                    ? 'border-gray-900'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                {isRecommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-gray-900 px-3 py-0.5 text-[11px] font-semibold text-white">
                      Recommended
                    </span>
                  </div>
                )}

                {/* Selection indicator */}
                <div className="mb-3 flex items-start justify-between">
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      isSelected ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                </div>

                {/* Plan name */}
                <div className="mb-1 text-base font-bold text-gray-900">{plan.name}</div>
                {plan.description && (
                  <p className="mb-3 text-xs text-gray-500 leading-snug">{plan.description}</p>
                )}

                {/* Price */}
                <div className="mb-1">
                  {isPaid ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold text-gray-900">
                        {formatCents(plan.price_monthly_cents!)}
                      </span>
                      <span className="text-sm text-gray-500">/mo</span>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold text-gray-900">Free</span>
                    </div>
                  )}
                </div>

                {isPaid && (
                  <div className="mb-4 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <Sparkles size={10} />
                    14-day free trial
                  </div>
                )}

                {/* Always-visible feature comparison list */}
                <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-3">
                  {PLAN_FEATURES.map((f) => {
                    const included = planIncludesFeature(plan.feature_flags, f.key);
                    return (
                      <div key={f.key} className="flex items-start gap-2">
                        {included ? (
                          <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                        ) : (
                          <X size={13} className="mt-0.5 shrink-0 text-gray-300" />
                        )}
                        <span className={`text-xs leading-tight ${included ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                          {f.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add-ons panel */}
        {selectedPlan && (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="mb-1 text-sm font-semibold text-gray-900">Add-ons</h3>
            <p className="mb-4 text-xs text-gray-500">Boost your listing visibility. Can be added or removed anytime.</p>

            <div className="space-y-3">
              {/* Verified */}
              <AddonRow
                icon={<BadgeCheck size={16} className="text-blue-500" />}
                label="Verified Listing"
                description="Displays a verified badge on your listing for increased trust"
                price="$19/mo"
                included={inclusion.verified}
                checked={addonVerified}
                onChange={setAddonVerified}
              />

              {/* Sponsored */}
              <AddonRow
                icon={<Megaphone size={16} className="text-purple-500" />}
                label="Sponsored Listing"
                description="Featured placement at the top of search results for maximum exposure"
                price="$99/mo"
                included={inclusion.sponsored}
                checked={addonSponsored}
                onChange={setAddonSponsored}
              />
            </div>
          </div>
        )}

        {/* Summary + CTA */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {selectedPlan?.name ?? 'No plan selected'}
              </p>
              {!isFree && (
                <p className="mt-0.5 text-xs text-gray-500">
                  First charge: <strong>{trialEnd}</strong>, then monthly on that date
                </p>
              )}
              {isFree && (
                <p className="mt-0.5 text-xs text-gray-500">No credit card required for free plan</p>
              )}
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold text-gray-900">
                {isFree ? 'Free' : `${formatCents(totalCents)}/mo`}
              </div>
              {!isFree && (
                <p className="text-xs text-emerald-600 font-medium">No charge for 14 days</p>
              )}
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}

          <button
            type="button"
            disabled={loading || !selectedPlanId}
            onClick={handleContinue}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {loading ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Setting up…
              </>
            ) : isFree ? (
              'Start for free →'
            ) : (
              <>
                <Lock size={14} />
                Start free trial — enter card details →
              </>
            )}
          </button>

          {!isFree && (
            <p className="mt-2 text-center text-[11px] text-gray-400">
              <ShieldCheck size={11} className="mr-0.5 inline" />
              Secured & encrypted. Cancel anytime before {trialEnd} and you won&apos;t be charged.
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Prices in USD. Subscription billed monthly. You can upgrade, downgrade, or cancel anytime from your dashboard.
        </p>
      </div>
    </div>
  );
}

// ── AddonRow ───────────────────────────────────────────────────────────────

function AddonRow({
  icon,
  label,
  description,
  price,
  included,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  price: string;
  included: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{label}</span>
          {included ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              Included in plan
            </span>
          ) : (
            <span className="text-xs text-gray-500 font-medium">{price}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500 leading-snug">{description}</p>
      </div>
      {included ? (
        <Check size={16} className="mt-0.5 shrink-0 text-emerald-500" />
      ) : (
        <label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <div className="h-5 w-9 rounded-full bg-gray-200 peer-checked:bg-gray-900 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
        </label>
      )}
    </div>
  );
}
