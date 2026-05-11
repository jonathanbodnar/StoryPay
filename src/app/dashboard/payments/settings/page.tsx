'use client';

import { useEffect, useState } from 'react';
import {
  CreditCard,
  Landmark,
  Check,
  CheckCircle2,
  Loader2,
  Info,
} from 'lucide-react';
import LunarPayOnboarding from '@/components/settings/LunarPayOnboarding';
import PaymentGate from '@/components/PaymentGate';

interface VenueInfo {
  id: string;
  onboarding_status: string | null;
  accept_ach: boolean | null;
  service_fee_rate: number;
}

function PaymentSettingsInner() {
  const [venue, setVenue] = useState<VenueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [achSaving, setAchSaving] = useState(false);
  const [achSaved, setAchSaved] = useState(false);

  async function loadVenue(showSpinner = false) {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch('/api/venues/me');
      if (res.ok) setVenue(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVenue(true);
  }, []);

  const toggleAcceptAch = async (next: boolean) => {
    if (!venue) return;
    setAchSaving(true);
    try {
      const res = await fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept_ach: next }),
      });
      if (res.ok) {
        setVenue((prev) => prev ? { ...prev, accept_ach: next } : prev);
        setAchSaved(true);
        setTimeout(() => setAchSaved(false), 2500);
      }
    } finally {
      setAchSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={22} />
      </div>
    );
  }

  const isActive = venue?.onboarding_status === 'active';
  const achEnabled = venue?.accept_ach !== false;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Payment Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure your StoryPay merchant account and customer payment options
        </p>
      </div>

      <div className="space-y-6">

        {/* Payment Processing */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
            <CreditCard size={18} className="text-gray-400" />
            <div>
              <h2 className="font-heading text-base font-semibold text-gray-900">Payment Processing</h2>
              <p className="text-xs text-gray-400 mt-0.5">Powered by StoryPay&apos;s merchant platform</p>
            </div>
          </div>
          <div className="px-6 py-6">
            <LunarPayOnboarding onActivated={() => void loadVenue()} />
          </div>
        </section>

        {/* Customer Payment Methods */}
        {isActive && (
          <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
              <Landmark size={18} className="text-gray-400" />
              <div>
                <h2 className="font-heading text-base font-semibold text-gray-900">Customer Payment Methods</h2>
                <p className="text-xs text-gray-400 mt-0.5">Choose which payment methods your clients can use at checkout</p>
              </div>
            </div>
            <div className="px-6 py-6 space-y-5">

              {/* Card — always on */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <CreditCard size={18} className="mt-0.5 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Credit &amp; Debit Cards</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Always enabled. Visa, Mastercard, Amex, and Discover accepted.
                      Funds settle to your account in 1–2 business days.
                    </p>
                  </div>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 size={12} /> Always on
                </span>
              </div>

              {/* ACH / Bank Transfer */}
              <div className="flex items-start justify-between gap-4 border-t border-gray-100 pt-5">
                <div className="flex items-start gap-3">
                  <Landmark size={18} className="mt-0.5 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      ACH / Bank Transfer
                      {achEnabled && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <CheckCircle2 size={10} /> Enabled
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Clients pay directly from a bank account using routing &amp; account numbers.
                      Funds settle in 3–5 business days. Lower processing costs for large payments.
                    </p>
                    <div className="mt-2 flex items-start gap-1.5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                      <Info size={12} className="mt-0.5 shrink-0 text-blue-500" />
                      <p className="text-[11px] text-blue-700">
                        ACH appears at checkout only when both this toggle <em>and</em> your StoryPay
                        merchant account have ACH enabled. Contact StoryPay support if you need merchant-level ACH activation.
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={achSaving}
                  onClick={() => toggleAcceptAch(!achEnabled)}
                  className={[
                    'shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50',
                    achEnabled ? 'bg-emerald-500' : 'bg-gray-200',
                  ].join(' ')}
                  aria-label="Toggle ACH"
                >
                  <span
                    className={[
                      'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                      achEnabled ? 'translate-x-6' : 'translate-x-1',
                    ].join(' ')}
                  />
                </button>
              </div>

              {achSaved && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <Check size={12} /> Saved
                </div>
              )}
            </div>
          </section>
        )}

        {/* ACH info when payments not yet active */}
        {!isActive && (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 flex items-start gap-3">
            <Info size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <div>
              <p className="text-sm font-medium text-gray-700">Payment methods available after setup</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Once your StoryPay merchant account is active, you can enable ACH / Bank Transfer
                so clients can pay directly from their bank account — in addition to standard card payments.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function PaymentSettingsPage() {
  return <PaymentGate><PaymentSettingsInner /></PaymentGate>;
}
