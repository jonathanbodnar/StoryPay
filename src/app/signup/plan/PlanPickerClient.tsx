'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  BotMessageSquare,
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

  // Default selection priority:
  // 1. Plan with a highlight_label (the admin-designated featured plan)
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
  const [addonVerified,   setAddonVerified]   = useState(false);
  const [addonSponsored,  setAddonSponsored]  = useState(false);
  const [addonConcierge,  setAddonConcierge]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedPlan = useMemo(() => plans.find((p) => p.id === selectedPlanId) ?? null, [plans, selectedPlanId]);

  // Resolve effective addon flags (plan-included overrides user toggle)
  const inclusion = selectedPlanId ? planAddonInclusion[selectedPlanId] ?? { verified: false, sponsored: false } : { verified: false, sponsored: false };
  const effectiveVerified  = inclusion.verified  || addonVerified;
  const effectiveSponsored = inclusion.sponsored || addonSponsored;

  // Concierge availability is read directly from the selected plan's feature_flags
  const conciergeAvailable = Boolean((selectedPlan?.feature_flags as Record<string, unknown> | null)?.addon_concierge_available);
  const conciergeIncluded  = Boolean((selectedPlan?.feature_flags as Record<string, unknown> | null)?.addon_concierge_included);
  const effectiveConcierge = conciergeIncluded || addonConcierge;

  // Reset concierge toggle when switching to a plan that doesn't allow it
  // (done imperatively in setSelectedPlanId handler below)

  // Live total
  const totalCents = useMemo(() => {
    if (!selectedPlan) return 0;
    const base          = selectedPlan.price_monthly_cents ?? 0;
    const verifiedCost  = effectiveVerified   && !inclusion.verified  ? 1900  : 0;
    const sponsoredCost = effectiveSponsored  && !inclusion.sponsored ? 9900  : 0;
    const conciergeCost = effectiveConcierge  && !conciergeIncluded   ? 49900 : 0;
    return base + verifiedCost + sponsoredCost + conciergeCost;
  }, [selectedPlan, effectiveVerified, effectiveSponsored, effectiveConcierge, inclusion, conciergeIncluded]);

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
          plan_id:         selectedPlanId,
          addon_verified:  effectiveVerified,
          addon_sponsored: effectiveSponsored,
          addon_concierge: effectiveConcierge,
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

        {/* Plan grid
            The "featured" card (highlight_label or middle index) is scaled up
            slightly and given a deeper shadow to draw the eye. */}
        {(() => {
          // Determine which plan index is "featured" (gets the large treatment)
          const highlightIdx = plans.findIndex((p) => p.highlight_label);
          const featuredIdx  = highlightIdx >= 0 ? highlightIdx : Math.floor((plans.length - 1) / 2);

          return (
            <div className={`grid items-center gap-4 ${
              plans.length <= 2 ? 'sm:grid-cols-2' :
              plans.length === 3 ? 'sm:grid-cols-3' :
              'sm:grid-cols-2 lg:grid-cols-4'
            }`}>
              {plans.map((plan, idx) => {
                const isSelected  = plan.id === selectedPlanId;
                const isPaid      = (plan.price_monthly_cents ?? 0) > 0;
                const badgeLabel  = plan.highlight_label ?? null;
                const isFeatured  = idx === featuredIdx;

                return (
                  <div
                    key={plan.id}
                    onClick={() => {
                      setSelectedPlanId(plan.id);
                      const ff = plan.feature_flags as Record<string, unknown> | null;
                      if (!ff?.addon_concierge_available) setAddonConcierge(false);
                    }}
                    className={[
                      'relative flex cursor-pointer flex-col rounded-2xl border bg-white transition-all duration-200',
                      // Featured card: bigger padding, deeper shadow, slightly scaled up
                      isFeatured
                        ? 'p-6 shadow-xl ring-2 ring-gray-900/10 scale-[1.035] z-10'
                        // Side cards: stretch to the same row height so left = right
                        : 'p-5 shadow-sm self-stretch',
                      // Badge/featured offset
                      (badgeLabel || isFeatured) ? 'mt-4' : '',
                      // Border
                      isSelected
                        ? 'border-gray-900'
                        : isFeatured
                          ? 'border-gray-800 hover:border-gray-900'
                          : 'border-gray-200 hover:border-gray-400',
                    ].join(' ')}
                  >
                    {/* Floating badge — shown for highlight_label OR featured-but-unlabeled */}
                    {badgeLabel && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                        <span className="whitespace-nowrap rounded-full bg-gray-900 px-3 py-1 text-[11px] font-semibold text-white shadow">
                          {badgeLabel}
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
                    <div className={`mb-1 font-bold text-gray-900 ${isFeatured ? 'text-lg' : 'text-base'}`}>
                      {plan.name}
                    </div>
                    {plan.description && (
                      <p className="mb-3 text-xs text-gray-500 leading-snug">{plan.description}</p>
                    )}

                    {/* Price */}
                    <div className="mb-1">
                      {isPaid ? (
                        <div className="flex items-baseline gap-1">
                          <span className={`font-extrabold text-gray-900 ${isFeatured ? 'text-3xl' : 'text-2xl'}`}>
                            {formatCents(plan.price_monthly_cents!)}
                          </span>
                          <span className="text-sm text-gray-500">/mo</span>
                        </div>
                      ) : (
                        <span className={`font-extrabold text-gray-900 ${isFeatured ? 'text-3xl' : 'text-2xl'}`}>
                          Free
                        </span>
                      )}
                    </div>

                    {isPaid && (
                      <div className="mb-4 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        <Sparkles size={10} />
                        14-day free trial
                      </div>
                    )}

                    {/* Full feature comparison — every plan shows all rows */}
                    <div className="mt-2 flex-1 space-y-2.5 border-t border-gray-100 pt-3">
                      {PLAN_FEATURES.map((f) => {
                        const included = planIncludesFeature(plan.feature_flags, f.key);
                        return (
                          <div key={f.key} className="flex items-start gap-2">
                            {included ? (
                              <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                            ) : (
                              <X size={13} className="mt-0.5 shrink-0 text-red-400" />
                            )}
                            <div>
                              <div className={`text-xs font-medium leading-tight ${included ? 'text-gray-800' : 'text-gray-400'}`}>
                                {f.label}
                              </div>
                              <div className={`text-[10px] leading-snug mt-0.5 ${included ? 'text-gray-500' : 'text-gray-300'}`}>
                                {f.outcome}
                              </div>
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

              {/* Venue Concierge — only shown on plans that allow it */}
              {(conciergeAvailable || conciergeIncluded) && (
                <AddonRow
                  icon={<BotMessageSquare size={16} className="text-violet-500" />}
                  label="Venue Concierge"
                  description="A personal concierge + AI forever-follow-up so no lead is ever forgotten. Helps you book more tours automatically."
                  price="$499/mo"
                  included={conciergeIncluded}
                  checked={addonConcierge}
                  onChange={setAddonConcierge}
                />
              )}
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
