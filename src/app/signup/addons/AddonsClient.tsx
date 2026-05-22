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

// Every event Fortis Commerce.js might emit on a successful tokenize/save.
// We listen to ALL of them and dedupe via a ref because the exact event name
// varies between SDK versions and intention types. Better to catch every
// possible signal than miss one and leave the user stranded on the iframe's
// "Payment Information Received" success screen.
const FORTIS_SUCCESS_EVENTS = [
  'ticket_success',
  'tokenization_form_submit_success',
  'tokenization_success',
  'token_success',
  'transaction_success',
  'payment_success',
  'done',
  'success',
];

// Try to extract a ticketId / tokenId from any of the payload shapes the
// Fortis SDK has shipped over the years.
function extractTicketId(payload: unknown): { ticketId?: string; paymentMethod?: string } {
  if (!payload) return {};
  if (typeof payload === 'string') return { ticketId: payload };
  if (typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  const nested = (p.data ?? p.result ?? p.payload ?? p.ticket ?? p.token ?? p.transaction) as Record<string, unknown> | undefined;
  const candidate =
    (p.ticketId      as string | undefined) ??
    (p.ticket_id     as string | undefined) ??
    (p.token         as string | undefined) ??
    (p.tokenId       as string | undefined) ??
    (p.id            as string | undefined) ??
    (nested?.ticketId  as string | undefined) ??
    (nested?.ticket_id as string | undefined) ??
    (nested?.token     as string | undefined) ??
    (nested?.id        as string | undefined);
  const paymentMethod =
    (p.payment_method as string | undefined) ??
    (p.paymentMethod  as string | undefined) ??
    (nested?.payment_method as string | undefined) ??
    (nested?.paymentMethod  as string | undefined);
  return {
    ticketId: candidate ? String(candidate) : undefined,
    paymentMethod,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────--

type Stage = 'addons' | 'payment';

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
  onSuccess,
  onError,
}: {
  intent: IntentData;
  trialEnd: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const mountedRef   = useRef(false);
  // Guards against double-processing when multiple Fortis events fire in a row
  // (we listen to a wide net of success events to cover SDK-version drift).
  const handledRef   = useRef(false);
  // Keep refs to callbacks so the event-listener closure is never stale.
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef   = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current  = onError;    }, [onError]);

  const [ready,     setReady]     = useState(false);
  // Once any success event fires we replace the Fortis iframe with our own
  // spinner so the button can never flash back to Fortis's default teal.
  const [submitted, setSubmitted] = useState(false);

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

    // The shared success path. Called by every Fortis "success-ish" event we
    // know about. Dedupes via handledRef so confirm only runs once.
    async function handleSuccess(payload: unknown, eventName: string) {
      if (handledRef.current) return;
      const { ticketId, paymentMethod } = extractTicketId(payload);
      if (!ticketId) {
        console.warn('[SaasPaymentForm] success event without ticketId', eventName, payload);
        // Don't lock the form yet — wait for an event that includes the id.
        return;
      }
      handledRef.current = true;

      // Immediately swap out the Fortis form for our own spinner so the
      // Fortis button can't flash back to its default teal colour and the
      // "Payment Information Received" iframe state is hidden instantly.
      setSubmitted(true);

      try {
        const res = await fetch('/api/venue-billing/signup-checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId, paymentMethod: paymentMethod || 'cc' }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || 'Failed to activate trial');
        // Success — let the parent navigate; keep spinner showing until
        // the page actually unloads so the user never sees the Fortis form again.
        onSuccessRef.current();
      } catch (err: unknown) {
        handledRef.current = false;
        setSubmitted(false);
        onErrorRef.current(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      }
    }

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
            colorButtonActionBackground: '#1B1B1B',
            colorButtonActionText: '#ffffff',
            colorButtonSelectedBackground: '#1B1B1B',
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

        // Wide net of success events — exact event name varies between SDK
        // versions and intention types. handleSuccess() dedupes for us.
        for (const evt of FORTIS_SUCCESS_EVENTS) {
          elements.eventBus.on(evt, (payload) => {
            console.log('[Fortis event]', evt, payload);
            void handleSuccess(payload, evt);
          });
        }

        elements.eventBus.on('validationError', (errPayload) => {
          const e = (errPayload ?? {}) as { message?: string };
          onErrorRef.current(e.message || 'Please check your card details and try again.');
        });
        elements.eventBus.on('error', (errPayload) => {
          const e = (errPayload ?? {}) as { message?: string };
          onErrorRef.current(e.message || 'Payment error. Please try again.');
        });

        setReady(true);
      })
      .catch((err: unknown) => {
        console.error('[SaasPaymentForm] init failed:', err);
        const msg =
          err instanceof Error                              ? err.message :
          typeof err === 'string'                           ? err :
          (err as { message?: string } | null)?.message ?? null;
        onErrorRef.current(msg ? `Failed to initialize payment form: ${msg}` : 'Failed to initialize payment form');
      });

    // ── Safety net: window.postMessage from the Fortis iframe ─────────────
    // The Fortis Elements iframe posts messages directly to the parent
    // window in addition to firing eventBus events. If eventBus fails for
    // any reason (SDK drift, race condition, etc.), this listener will
    // catch the tokenization and complete the flow anyway.
    function onPostMessage(ev: MessageEvent) {
      if (handledRef.current) return;
      // Only trust messages from Fortis-hosted iframes (defensive check).
      let originHostname = '';
      try {
        originHostname = ev.origin ? new URL(ev.origin).hostname : '';
      } catch { return; }
      if (
        !/(^|\.)fortis\.(tech|com)$/i.test(originHostname) &&
        !/(^|\.)lunarpay\.com$/i.test(originHostname)
      ) {
        return;
      }
      const data = ev.data;
      // Try common shapes:
      //   { type: 'ticket_success', payload: {...} }
      //   { event: 'ticket_success', data: {...} }
      //   raw payload object with id / ticketId / token
      const typeStr =
        (data as { type?: string; event?: string; name?: string } | null)?.type ??
        (data as { type?: string; event?: string; name?: string } | null)?.event ??
        (data as { type?: string; event?: string; name?: string } | null)?.name ??
        '';
      const payload =
        (data as { payload?: unknown; data?: unknown } | null)?.payload ??
        (data as { payload?: unknown; data?: unknown } | null)?.data ??
        data;
      const looksLikeSuccess =
        FORTIS_SUCCESS_EVENTS.some((e) => typeStr === e) ||
        /token|ticket|success|paymentMethod|payment_method/i.test(JSON.stringify(data || ''));
      if (!looksLikeSuccess) return;
      const { ticketId } = extractTicketId(payload);
      if (!ticketId) return;
      console.log('[Fortis postMessage] caught', typeStr, payload);
      void handleSuccess(payload, `postMessage:${typeStr}`);
    }
    window.addEventListener('message', onPostMessage);

    return () => {
      window.removeEventListener('message', onPostMessage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After ticket_success hide the Fortis iframe entirely and show a spinner.
  // This prevents the Fortis button from ever reverting to its idle (teal) state.
  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <Loader2 size={24} className="animate-spin text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Setting up your dashboard…</p>
        <p className="text-xs text-gray-500 max-w-xs">
          Please wait while we activate your trial. Do&nbsp;not navigate away or refresh this page.
        </p>
      </div>
    );
  }

  return (
    <div>
      {!ready && (
        <div className="flex items-center justify-center py-10 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading secure payment form…</span>
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

  // ── Payment stage ──────────────────────────────────────────────────────────
  if (stage === 'payment' && intent) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SignupStepHeader step={4} />
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
                // Hard navigation — picks up fresh session state and triggers
                // Route through the conversion tracking page before dashboard.
                window.location.href = '/signup/success?plan=paid';
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
            Back to upgrades
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
          <h1 className="text-2xl font-bold text-gray-900">Boost your listing with upgrades</h1>
          <p className="mt-2 text-sm text-gray-500">
            Add optional upgrades to your <strong>{planName}</strong> plan. You can add or remove these anytime from your dashboard.
          </p>
        </div>

        {/* Upgrade cards */}
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

          {/* Show as "Included in plan" when bundled (All-Inclusive), or as a
              toggleable add-on when available but not included (Booking System) */}
          {(inclusion.concierge || conciergeAvailable) && (
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
                {inclusion.verified
                  ? <Check size={14} className="text-emerald-500 shrink-0" />
                  : <span>{formatCents(addonPrices.verified_cents)}/mo</span>}
              </div>
            )}
            {effectiveSponsored && (
              <div className="flex items-center justify-between text-purple-600">
                <span>Sponsored Listing{inclusion.sponsored ? ' (included)' : ''}</span>
                {inclusion.sponsored
                  ? <Check size={14} className="text-emerald-500 shrink-0" />
                  : <span>{formatCents(addonPrices.sponsored_cents)}/mo</span>}
              </div>
            )}
            {effectiveConcierge && (
              <div className="flex items-center justify-between text-violet-600">
                <span>Venue Concierge{inclusion.concierge ? ' (included)' : ''}</span>
                {inclusion.concierge
                  ? <Check size={14} className="text-emerald-500 shrink-0" />
                  : <span>{formatCents(addonPrices.concierge_cents)}/mo</span>}
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
