'use client';

/**
 * What a venue sees in Payment settings before StoryPay™ (powered by Stripe)
 * is switched on for it: what's coming, what it costs and how signup works,
 * plus a demo booking. Once Stripe Connect is available to the venue,
 * PaymentsOnboarding shows StripeConnectPanel instead.
 *
 * Keep this in step with StripeConnectPanel and the fee schedule. Never
 * promise "0% processing fees" or that the venue keeps its full price: the
 * service fee helps cover processing, but it doesn't always cover all of it.
 */

import { useEffect, useState } from 'react';
import { CalendarClock, CreditCard, LayoutDashboard, Receipt, Repeat, ShieldCheck, Sparkles } from 'lucide-react';
import DashboardBookingModal from '@/components/DashboardBookingModal';

const FEATURES = [
  { icon: ShieldCheck, title: 'Secured by Stripe', desc: 'Card and bank details go straight to Stripe' },
  { icon: CreditCard, title: 'Cards + bank transfers', desc: 'Credit, debit, Apple Pay, Google Pay and ACH' },
  { icon: Repeat, title: 'Automatic installments', desc: 'Payment plans charge on their due dates' },
  { icon: LayoutDashboard, title: 'Your own Stripe dashboard', desc: 'Payouts, refunds and reports' },
];

const STEPS = [
  'Click “Connect with Stripe” in Payment settings',
  'Enter your business details and payout bank account on Stripe’s secure signup (about 10 minutes)',
  'Stripe verifies your business, usually within minutes',
  'Send proposals and invoices. Couples pay by card or bank transfer right on the page',
  'Stripe deposits the money in your bank account automatically',
];

export default function StoryPayComingSoon() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [fees, setFees] = useState<{ cardPercent: number; bankPercent: number } | null>(null);

  // This venue's rates (its plan's tier or an admin override).
  useEffect(() => {
    fetch('/api/payments/stripe/connect', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { fees?: { cardPercent: number; bankPercent: number } } | null) => { if (d?.fees) setFees(d.fees); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">StoryPay™ is getting a big update</h3>
            <p className="text-xs text-gray-500">Now powered by Stripe</p>
          </div>
        </div>

        <div className="mb-5 flex items-start gap-3 rounded-xl border border-indigo-200 bg-white px-4 py-3.5">
          <Sparkles size={18} className="mt-0.5 shrink-0 text-indigo-500" />
          <div>
            <p className="text-sm font-semibold text-indigo-900">Stay tuned, signups open soon!</p>
            <p className="mt-0.5 text-xs leading-relaxed text-indigo-800">
              We&apos;re moving StoryPay™ to Stripe. Everything below is what&apos;s coming. If you&apos;d like a
              walkthrough in the meantime, schedule a demo and we&apos;ll show you.
            </p>
          </div>
        </div>

        <p className="mb-5 text-sm text-gray-600">
          Take payments right inside StoryVenue. Couples pay deposits and installments by card or bank transfer, right
          from their proposal or invoice, and the money goes to your own Stripe account and on to your bank.
        </p>

        <div className="mb-4 flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <Receipt size={20} className="mt-0.5 shrink-0 text-indigo-500" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Simple pricing</p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
              {fees
                ? `Cards ${fees.cardPercent}% + 30¢ and bank transfers ${fees.bankPercent}% per payment, with no setup or monthly fees. `
                : 'You pay a small fee per payment, with no setup or monthly fees. '}
              An automatic service fee on your invoices (3.5% by default) helps cover it, and you can change or remove
              it on any invoice.
            </p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-white p-3">
              <Icon size={16} className="mt-0.5 shrink-0 text-indigo-500" />
              <div>
                <p className="text-xs font-semibold text-gray-800">{title}</p>
                <p className="text-[11px] text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">How it will work</p>
          <ol className="space-y-2">
            {STEPS.map((text, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">
                  {i + 1}
                </span>
                {text}
              </li>
            ))}
          </ol>
        </div>

        <button
          type="button"
          onClick={() => setDemoOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          <CalendarClock size={16} /> Schedule a demo
        </button>
      </div>

      <DashboardBookingModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
