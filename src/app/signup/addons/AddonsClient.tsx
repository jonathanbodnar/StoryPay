'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

function formatCentsExact(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function trialEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ── Fortis Elements types (local cast — avoids global declaration conflicts) ─
interface FortisElements {
  create(opts: Record<string, unknown>): void;
  eventBus: { on(evt: string, cb: (d: unknown) => void): void };
}
function getFortisSDK(): { elements: new (token: string) => FortisElements } | undefined {
  return (window as unknown as { Commerce?: { elements: new (token: string) => FortisElements } }).Commerce;
}

// ── Types ─────────────────────────────────────────────────────────────────--

type Stage = 'addons' | 'payment' | 'success';

interface IntentData {
  clientToken: string;
  environment: string;
  amountCents: number;
  trialEndsAt: string;
}

type Props = {
  planId: string;
  planName: string;
  planPriceCents: number;
  inclusion: { verified: boolean; sponsored: boolean; concierge: boolean };
  conciergeAvailable: boolean;
  addonPrices: AddonPrices;
  ownerFirstName: string;
};

// ── SaasPaymentForm ─────────────────────────────────────────────────────────

function SaasPaymentForm({
  intent,
  trialEnd,
  onSuccess,
  onError,
}: {
  intent: IntentData;
  trialEnd: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const mountedRef = useRef(false);
  const [ready, setReady]           = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const sdkUrl =
      intent.environment === 'production'
        ? 'https://js.fortis.tech/commercejs-v1.0.0.min.js'
        : 'https://js.sandbox.fortis.tech/commercejs-v1.0.0.min.js';

    const existing = document.querySelector(`script[src="${sdkUrl}"]`);
    const loadSdk: Promise<void> = existing
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = sdkUrl;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Failed to load payment SDK'));
          document.head.appendChild(s);
        });

    loadSdk
      .then(() => {
        const SDK = getFortisSDK();
        if (!SDK) throw new Error('Payment SDK unavailable. Please refresh and try again.');
        const elements = new SDK.elements(intent.clientToken);
        elements.create({
          container: '#saas-payment-form',
          environment: intent.environment,
          theme: 'default',
          floatingLabels: true,
          showSubmitButton: true,
          hideTotal: true,
          hideAgreementCheckbox: true,
          appearance: {
            colorButtonSelectedBackground: '#1a1a1a',
            colorButtonSelectedText: '#ffffff',
            colorButtonText: '#4a5568',
            colorButtonBackground: '#f7fafc',
            colorBackground: '#ffffff',
            colorText: '#1a202c',
            fontFamily: 'SourceSans',
            fontSize: '16px',
            borderRadius: '8px',
          },
        });

        // SaaS is always a ticket intention (hasRecurring:true).
        // LP docs: Fortis fires `ticket_success`; payload IS the raw ticketId
        // string (may be an object in some SDK versions — handle both).
        elements.eventBus.on('ticket_success', async (ticketPayload) => {
          setProcessing(true);
          let ticketId: string | undefined;
          let pmMethod = 'cc';
          if (typeof ticketPayload === 'string') {
            ticketId = ticketPayload;
          } else if (ticketPayload && typeof ticketPayload === 'object') {
            const p = ticketPayload as { id?: string; payment_method?: string };
            ticketId = p.id ? String(p.id) : undefined;
            pmMethod = p.payment_method || 'cc';
          }
          if (!ticketId) {
            onError('Payment tokenization failed. Please try again.');
            setProcessing(false);
            return;
          }
          await handleConfirm({ ticketId, paymentMethod: pmMethod });
        });

        elements.eventBus.on('validationError', (errPayload) => {
          const e = (errPayload ?? {}) as { message?: string };
          onError(e.message || 'Please check your card details and try again.');
        });
        elements.eventBus.on('error', (errPayload) => {
          const e = (errPayload ?? {}) as { message?: string };
          onError(e.message || 'Payment error. Please try again.');
          setProcessing(false);
        });

        setReady(true);
      })
      .catch((err: unknown) => {
        console.error('[SaasPaymentForm] init failed:', err);
        const msg =
          err instanceof Error                              ? err.message :
          typeof err === 'string'                           ? err :
          (err as { message?: string } | null)?.message ?? null;
        onError(msg ? `Failed to initialize payment form: ${msg}` : 'Failed to initialize payment form');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = async ({ ticketId, paymentMethod }: { ticketId: string; paymentMethod: string }) => {
    try {
      const res = await fetch('/api/venue-billing/signup-checkout/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, paymentMethod }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to activate trial');
      onSuccess();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      setProcessing(false);
    }
  };

  return (
    <div className="relative">
      {!ready && (
        <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading secure payment form…</span>
        </div>
      )}
      {/* Processing overlay while server activates the subscription */}
      {processing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-medium">Activating your trial…</span>
          </div>
        </div>
      )}
      <div
        id="saas-payment-form"
        className={ready ? 'mb-2' : 'hidden'}
        style={{ minHeight: ready ? 300 : 0 }}
      />
    </div>
  );
}

// ── AddonsClient ─────────────────────────────────────────────────────────────

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
  const [error, setError]     = useState('');
  const [stage, setStage]     = useState<Stage>('addons');
  const [intent, setIntent]   = useState<IntentData | null>(null);

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
      const data = await res.json() as { redirect?: string; url?: string; nextStep?: string; error?: string };
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      if (data.redirect) {
        router.replace(data.redirect);
        return;
      }
      // Legacy LP hosted checkout (should not occur with new code)
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // New inline flow — fetch payment intent then show Elements
      if (data.nextStep === 'payment') {
        const piRes = await fetch('/api/venue-billing/payment-intent', { method: 'POST' });
        const pi = await piRes.json() as { clientToken?: string; environment?: string; amountCents?: number; trialEndsAt?: string; error?: string };
        if (!piRes.ok) throw new Error(pi.error || 'Could not load payment form');
        setIntent({
          clientToken: pi.clientToken!,
          environment: pi.environment!,
          amountCents: pi.amountCents!,
          trialEndsAt: pi.trialEndsAt!,
        });
        setStage('payment');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Success stage ──────────────────────────────────────────────────────────
  if (stage === 'success') {
    return (
      <div className="min-h-screen bg-gray-50">
        <SignupStepHeader step={3} />
        <div className="mx-auto max-w-xl px-4 py-20 sm:px-6 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50">
            <Check size={32} className="text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">You&apos;re all set!</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your 14-day free trial is active. First charge on {trialEnd}.
          </p>
          <div className="mt-8">
            <Loader2 size={18} className="mx-auto animate-spin text-gray-400" />
            <p className="mt-2 text-xs text-gray-400">Redirecting to your dashboard…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Payment stage ──────────────────────────────────────────────────────────
  if (stage === 'payment' && intent) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SignupStepHeader step={3} />
        <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
          <div className="mb-6 text-center">
            <p className="mb-1 text-sm font-medium text-emerald-600">No charge today!</p>
            <h1 className="text-2xl font-bold text-gray-900">Set up your free trial</h1>
            <p className="mt-2 text-sm text-gray-500">
              Enter your card details. You won&apos;t be charged until <strong>{trialEnd}</strong>.
            </p>
          </div>

          {/* Plan summary */}
          <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{planName}</span>
              <span className="font-semibold text-gray-900">{formatCentsExact(intent.amountCents)}/mo</span>
            </div>
            <p className="mt-1 text-xs text-emerald-600 flex items-center gap-1">
              <Sparkles size={11} />
              14-day free trial · First charge {trialEnd}
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            {error && (
              <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            )}
            <SaasPaymentForm
              intent={intent}
              trialEnd={trialEnd}
              onSuccess={() => {
                setStage('success');
                setTimeout(() => router.replace('/dashboard?welcome=1'), 2000);
              }}
              onError={(msg) => setError(msg)}
            />
          </div>

          <button
            type="button"
            onClick={() => { setStage('addons'); setError(''); setIntent(null); }}
            className="mt-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ChevronLeft size={14} />
            Back to add-ons
          </button>

          <p className="mt-3 text-center text-[11px] text-gray-400">
            <ShieldCheck size={11} className="mr-0.5 inline" />
            Secured &amp; encrypted · Cancel anytime before {trialEnd}
          </p>
        </div>
      </div>
    );
  }

  // ── Addons stage (default) ─────────────────────────────────────────────────
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
