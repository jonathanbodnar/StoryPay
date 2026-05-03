'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  BotMessageSquare,
  Check,
  ChevronLeft,
  Lock,
  Loader2,
  Megaphone,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { AddonPrices } from '@/lib/directory-addons';
import { SignupStepHeader } from '@/app/signup/plan/PlanPickerClient';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function trialEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ── Types ─────────────────────────────────────────────────────────────────--

type Props = {
  planId: string;
  planName: string;
  planPriceCents: number;
  inclusion: { verified: boolean; sponsored: boolean; concierge: boolean };
  conciergeAvailable: boolean;
  addonPrices: AddonPrices;
  ownerFirstName: string;
};

// ── Component ─────────────────────────────────────────────────────────────--

export function AddonsClient({
  planId,
  planName,
  planPriceCents,
  inclusion,
  conciergeAvailable,
  addonPrices,
  ownerFirstName,
}: Props) {
  const router = useRouter();

  const [addonVerified,  setAddonVerified]  = useState(false);
  const [addonSponsored, setAddonSponsored] = useState(false);
  const [addonConcierge, setAddonConcierge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const effectiveVerified  = inclusion.verified  || addonVerified;
  const effectiveSponsored = inclusion.sponsored || addonSponsored;
  const effectiveConcierge = inclusion.concierge || addonConcierge;

  const totalCents = useMemo(() => {
    const verifiedCost  = effectiveVerified  && !inclusion.verified  ? addonPrices.verified_cents  : 0;
    const sponsoredCost = effectiveSponsored && !inclusion.sponsored ? addonPrices.sponsored_cents : 0;
    const conciergeCost = effectiveConcierge && !inclusion.concierge ? addonPrices.concierge_cents : 0;
    return planPriceCents + verifiedCost + sponsoredCost + conciergeCost;
  }, [
    planPriceCents,
    effectiveVerified, effectiveSponsored, effectiveConcierge,
    inclusion,
    addonPrices,
  ]);

  const isFree   = totalCents === 0;
  const trialEnd = useMemo(() => trialEndDate(), []);

  async function handleContinue() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/venue-billing/signup-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id:         planId,
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
      <SignupStepHeader step={3} />

      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        {/* Hero text */}
        <div className="mb-8 text-center">
          {ownerFirstName && (
            <p className="mb-1 text-sm font-medium text-emerald-600">
              Almost there, {ownerFirstName}!
            </p>
          )}
          <h1 className="text-2xl font-bold text-gray-900">Boost your listing with add-ons</h1>
          <p className="mt-2 text-sm text-gray-500">
            Add optional upgrades to your <strong>{planName}</strong> plan. You can add or remove these anytime from your dashboard.
          </p>
        </div>

        {/* Add-on cards */}
        <div className="space-y-3">
          <AddonCard
            icon={<BadgeCheck size={20} className="text-blue-500" />}
            label="Verified Listing"
            description="Displays a verified badge on your directory listing. Builds credibility and increases inquiries from couples who filter for trusted venues."
            price={formatCents(addonPrices.verified_cents) + '/mo'}
            included={inclusion.verified}
            checked={addonVerified}
            onChange={setAddonVerified}
          />

          <AddonCard
            icon={<Megaphone size={20} className="text-purple-500" />}
            label="Sponsored Listing"
            description="Featured placement at the top of search results. Maximum exposure for your venue when couples are actively searching."
            price={formatCents(addonPrices.sponsored_cents) + '/mo'}
            included={inclusion.sponsored}
            checked={addonSponsored}
            onChange={setAddonSponsored}
          />

          {(conciergeAvailable || inclusion.concierge) && (
            <AddonCard
              icon={<BotMessageSquare size={20} className="text-violet-500" />}
              label="Venue Concierge"
              description="A personal concierge + AI forever-follow-up so no lead is ever forgotten. Helps you book more tours automatically without lifting a finger."
              price={formatCents(addonPrices.concierge_cents) + '/mo'}
              included={inclusion.concierge}
              checked={addonConcierge}
              onChange={setAddonConcierge}
            />
          )}
        </div>

        {/* Monthly summary */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">Monthly summary</h3>

          <div className="space-y-1.5 text-sm text-gray-600">
            <div className="flex items-center justify-between">
              <span>{planName}</span>
              <span>{planPriceCents > 0 ? formatCents(planPriceCents) + '/mo' : 'Free'}</span>
            </div>
            {effectiveVerified && (
              <div className="flex items-center justify-between text-blue-600">
                <span>Verified Listing{inclusion.verified ? ' (included)' : ''}</span>
                <span>{inclusion.verified ? '—' : formatCents(addonPrices.verified_cents) + '/mo'}</span>
              </div>
            )}
            {effectiveSponsored && (
              <div className="flex items-center justify-between text-purple-600">
                <span>Sponsored Listing{inclusion.sponsored ? ' (included)' : ''}</span>
                <span>{inclusion.sponsored ? '—' : formatCents(addonPrices.sponsored_cents) + '/mo'}</span>
              </div>
            )}
            {effectiveConcierge && (
              <div className="flex items-center justify-between text-violet-600">
                <span>Venue Concierge{inclusion.concierge ? ' (included)' : ''}</span>
                <span>{inclusion.concierge ? '—' : formatCents(addonPrices.concierge_cents) + '/mo'}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-gray-100 pt-2 font-semibold text-gray-900">
              <span>Total</span>
              <span>{isFree ? 'Free' : formatCents(totalCents) + '/mo'}</span>
            </div>
          </div>

          {!isFree && (
            <p className="mt-2 text-xs text-emerald-600 font-medium flex items-center gap-1">
              <Sparkles size={11} />
              First charge on {trialEnd} — 14-day free trial included
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}

          {/* Back + Continue row */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/signup/plan')}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 shrink-0"
            >
              <ChevronLeft size={14} />
              Back
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleContinue}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
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
                  Continue to payment →
                </>
              )}
            </button>
          </div>

          {!isFree && (
            <p className="mt-2 text-center text-[11px] text-gray-400">
              <ShieldCheck size={11} className="mr-0.5 inline" />
              Secured &amp; encrypted. Cancel anytime before {trialEnd} and you won&apos;t be charged.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AddonCard ─────────────────────────────────────────────────────────────--

function AddonCard({
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
  const isActive = included || checked;

  return (
    <div
      className={`flex items-start gap-4 rounded-2xl border bg-white p-4 transition-all duration-150 ${
        isActive ? 'border-gray-900 shadow-sm' : 'border-gray-200'
      }`}
    >
      <div className="mt-0.5 shrink-0 rounded-xl bg-gray-50 p-2">{icon}</div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{label}</span>
          {included ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              Included in plan
            </span>
          ) : (
            <span className="text-xs font-medium text-gray-500">{price}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>

      <div className="mt-0.5 shrink-0">
        {included ? (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500">
            <Check size={13} className="text-white" />
          </div>
        ) : (
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
            />
            <div className="h-6 w-11 rounded-full bg-gray-200 peer-checked:bg-gray-900 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        )}
      </div>
    </div>
  );
}
