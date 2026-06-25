'use client';

/**
 * InlineTrialCardForm — embeds the Fortis Elements card form (no redirect) to
 * vault a card for a 14-day trial subscription. Mirrors the proven signup
 * flow (src/app/signup/addons/AddonsClient.tsx): on tokenize success it POSTs
 * the ticketId to /api/venue-billing/signup-checkout/confirm, which saves the
 * card + creates the delayed-start subscription, then calls onSuccess().
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface FortisElements {
  create(opts: Record<string, unknown>): void;
  eventBus: { on(evt: string, cb: (d: unknown) => void): void };
}
function getFortisSDK(): { elements: new (token: string) => FortisElements } | undefined {
  return (window as unknown as { Commerce?: { elements: new (token: string) => FortisElements } }).Commerce;
}

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

function extractTicketId(payload: unknown): { ticketId?: string; paymentMethod?: string } {
  if (!payload) return {};
  if (typeof payload === 'string') return { ticketId: payload };
  if (typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  const nested = (p.data ?? p.result ?? p.payload ?? p.ticket ?? p.token ?? p.transaction) as Record<string, unknown> | undefined;
  const candidate =
    (p.ticketId as string | undefined) ??
    (p.ticket_id as string | undefined) ??
    (p.token as string | undefined) ??
    (p.tokenId as string | undefined) ??
    (p.id as string | undefined) ??
    (nested?.ticketId as string | undefined) ??
    (nested?.ticket_id as string | undefined) ??
    (nested?.token as string | undefined) ??
    (nested?.id as string | undefined);
  const paymentMethod =
    (p.payment_method as string | undefined) ??
    (p.paymentMethod as string | undefined) ??
    (nested?.payment_method as string | undefined) ??
    (nested?.paymentMethod as string | undefined);
  return { ticketId: candidate ? String(candidate) : undefined, paymentMethod };
}

export default function InlineTrialCardForm({
  clientToken,
  environment,
  onSuccess,
  onError,
}: {
  clientToken: string;
  environment: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const mountedRef = useRef(false);
  const handledRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const [ready, setReady] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const sdkUrl =
      environment === 'production'
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

    async function handleSuccess(payload: unknown, eventName: string) {
      if (handledRef.current) return;
      const { ticketId, paymentMethod } = extractTicketId(payload);
      if (!ticketId) {
        console.warn('[InlineTrialCardForm] success event without ticketId', eventName, payload);
        return;
      }
      handledRef.current = true;
      setSubmitted(true);
      try {
        const res = await fetch('/api/venue-billing/signup-checkout/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId, paymentMethod: paymentMethod || 'cc' }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || 'Failed to start your trial');
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
        const elements = new SDK.elements(clientToken);
        elements.create({
          container: '#onboarding-payment-form',
          environment,
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

        for (const evt of FORTIS_SUCCESS_EVENTS) {
          elements.eventBus.on(evt, (payload) => { void handleSuccess(payload, evt); });
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
        console.error('[InlineTrialCardForm] init failed:', err);
        const msg =
          err instanceof Error ? err.message :
          typeof err === 'string' ? err :
          (err as { message?: string } | null)?.message ?? null;
        onErrorRef.current(msg ? `Failed to initialize payment form: ${msg}` : 'Failed to initialize payment form');
      });

    function onPostMessage(ev: MessageEvent) {
      if (handledRef.current) return;
      let originHostname = '';
      try { originHostname = ev.origin ? new URL(ev.origin).hostname : ''; } catch { return; }
      if (!/(^|\.)fortis\.(tech|com)$/i.test(originHostname) && !/(^|\.)lunarpay\.com$/i.test(originHostname)) return;
      const data = ev.data;
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
      void handleSuccess(payload, `postMessage:${typeStr}`);
    }
    window.addEventListener('message', onPostMessage);

    return () => { window.removeEventListener('message', onPostMessage); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 size={24} className="animate-spin text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Starting your trial…</p>
        <p className="max-w-xs text-xs text-gray-500">Please don&apos;t close or refresh this window.</p>
      </div>
    );
  }

  return (
    <div>
      {!ready && (
        <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading secure payment form…</span>
        </div>
      )}
      <div id="onboarding-payment-form" className={ready ? '' : 'hidden'} style={{ minHeight: ready ? 280 : 0 }} />
    </div>
  );
}
