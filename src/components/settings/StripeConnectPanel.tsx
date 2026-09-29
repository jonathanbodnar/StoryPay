'use client';

/**
 * Venue payments setup on Stripe Connect: connect a Stripe account, finish
 * Stripe's signup, or see that payments are live. The signup itself is hosted
 * by Stripe (lib/stripe/connect.ts); this panel only sends the venue there and
 * shows the result.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { isNativeApp, openExternalBrowser } from '@/lib/platform';

interface ConnectState {
  available: boolean;
  status: 'none' | 'onboarding' | 'pending' | 'active';
  chargesEnabled: boolean;
  actionRequired: boolean;
  fees?: { cardPercent: number; bankPercent: number };
  error?: string;
}

const RETURN_NOTICES: Record<string, { text: string; tone: 'ok' | 'info' | 'warn' }> = {
  active: { text: 'You’re all set. Couples can now pay you online.', tone: 'ok' },
  pending: { text: 'Thanks! Stripe is reviewing your details. Payments turn on as soon as it approves.', tone: 'info' },
  incomplete: { text: 'Stripe still needs a few details. Pick up where you left off below.', tone: 'warn' },
  error: { text: 'We couldn’t reopen Stripe. Please try again.', tone: 'warn' },
};

export default function StripeConnectPanel({ onActivated }: { onActivated?: () => void }) {
  const [state, setState] = useState<ConnectState | null>(null);
  const [busy, setBusy] = useState<'open' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<(typeof RETURN_NOTICES)[string] | null>(null);
  const activatedRef = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/payments/stripe/connect', { cache: 'no-store' });
      const d = (await res.json().catch(() => ({}))) as ConnectState;
      if (!res.ok) throw new Error(d.error || 'Could not load your Stripe status.');
      setState(d);
      if (d.chargesEnabled && !activatedRef.current) {
        activatedRef.current = true;
        onActivated?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your Stripe status.');
    }
  }, [onActivated]);

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('stripe');
    if (flag && RETURN_NOTICES[flag]) setNotice(RETURN_NOTICES[flag]);
    void load();
  }, [load]);

  async function openStripe() {
    setBusy('open');
    setError(null);
    try {
      const res = await fetch('/api/payments/stripe/connect', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !d.url) throw new Error(d.error || 'Could not open Stripe.');
      window.location.href = d.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open Stripe.');
      setBusy(null);
    }
  }

  async function checkAgain() {
    setBusy('check');
    await load();
    setBusy(null);
  }

  // Financial onboarding stays in the browser (App Store rules).
  if (isNativeApp()) {
    return (
      <div className="text-sm text-gray-600">
        <p>Set up online payments from your web browser, then come back to the app.</p>
        <button
          type="button"
          onClick={() => void openExternalBrowser('/dashboard/payments/settings')}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#1b1b1b] px-4 py-2 text-sm font-semibold text-white"
        >
          Open in browser <ExternalLink size={14} />
        </button>
      </div>
    );
  }

  if (!state && !error) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Checking your payments setup…
      </div>
    );
  }

  const fees = state?.fees;
  const feeLine = fees
    ? `Cards ${fees.cardPercent}% + 30¢ · Bank transfers ${fees.bankPercent}%. The automatic service fee on your invoices helps cover it.`
    : null;
  const noticeClasses =
    notice?.tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : notice?.tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-blue-100 bg-blue-50 text-blue-800';

  return (
    <div className="space-y-4">
      {notice && <div className={`rounded-xl border px-4 py-3 text-sm ${noticeClasses}`}>{notice.text}</div>}

      {state?.status === 'active' ? (
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle2 size={18} /> Online payments are live
          </div>
          <p className="mt-1.5 text-sm text-gray-600">
            Couples can pay deposits and installments by card or bank transfer right from their proposal or invoice.
            Payouts, refunds and reports are in your own Stripe dashboard.
          </p>
          {feeLine && <p className="mt-2 text-xs text-gray-500">{feeLine}</p>}
          <a
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            Open your Stripe dashboard <ExternalLink size={14} />
          </a>
        </div>
      ) : state?.status === 'pending' ? (
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Clock size={18} className="text-amber-500" /> Stripe is reviewing your details
          </div>
          <p className="mt-1.5 text-sm text-gray-600">
            This usually takes a few minutes, occasionally a business day or two. Online payments turn on automatically as soon as Stripe approves.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void checkAgain()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
            >
              {busy === 'check' && <Loader2 size={14} className="animate-spin" />} Check again
            </button>
            <a
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900"
            >
              Open Stripe <ExternalLink size={14} />
            </a>
          </div>
        </div>
      ) : state?.status === 'onboarding' ? (
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <AlertCircle size={18} className="text-amber-500" /> Finish your Stripe setup
          </div>
          <p className="mt-1.5 text-sm text-gray-600">Stripe needs a few more details before you can take payments.</p>
          <button
            type="button"
            onClick={() => void openStripe()}
            disabled={busy !== null}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1b1b1b] px-5 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
          >
            {busy === 'open' && <Loader2 size={14} className="animate-spin" />} Continue setup
          </button>
        </div>
      ) : (
        <div>
          <h3 className="text-base font-semibold text-gray-900">Get paid online</h3>
          <p className="mt-1 text-sm text-gray-600">
            Connect a Stripe account so couples can pay deposits and installments by card or bank transfer, right from
            their proposal or invoice. Money goes straight to your bank account.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
            <li className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" /> Stripe verifies your business and keeps payments secure</li>
            <li className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" /> Installments charge automatically on their due dates</li>
            <li className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" /> Your own Stripe dashboard for payouts, refunds and reports</li>
          </ul>
          {feeLine && <p className="mt-3 text-xs text-gray-500">{feeLine}</p>}
          <button
            type="button"
            onClick={() => void openStripe()}
            disabled={busy !== null || state?.available === false}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1b1b1b] px-5 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
          >
            {busy === 'open' && <Loader2 size={14} className="animate-spin" />} Connect with Stripe
          </button>
          <p className="mt-2 text-xs text-gray-400">Takes about 10 minutes. Have your business details and bank account handy.</p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
