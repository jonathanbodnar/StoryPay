'use client';

import Image from 'next/image';
import Script from 'next/script';
import { CheckCircle2 } from 'lucide-react';

const BRAND = '#1b1b1b';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

const FORM_ID = 'FleeMY5JXKKZkmufZZv6';
const FORM_SRC = `https://api.leadconnectorhq.com/widget/form/${FORM_ID}`;

export default function BookStrategyCallPage() {
  return (
    <div
      className="min-h-screen text-gray-900"
      style={{ fontFamily: "'Open Sans', Arial, sans-serif", background: 'linear-gradient(180deg, #e4e9ec 0%, #eef1f3 8%, #f4f6f7 18%, #f8f9fa 30%, #ffffff 48%)' }}
    >
      <Script src="https://link.msgsndr.com/js/form_embed.js" strategy="afterInteractive" />

      {/* Nav */}
      <nav className="mx-auto max-w-5xl px-5 sm:px-8 py-5 flex items-center justify-between">
        <Image src="/storypay-logo-dark.png" alt="StoryPay" width={110} height={26} />
        <a
          href={`${DASHBOARD_URL}/login`}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all"
        >
          Log In
        </a>
      </nav>

      {/* Header */}
      <div className="mx-auto max-w-2xl px-5 sm:px-8 pt-6 sm:pt-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 mb-6">
          <CheckCircle2 size={15} className="text-emerald-600" />
          <span className="text-xs sm:text-sm font-semibold text-emerald-700">You&apos;re a great fit — let&apos;s talk!</span>
        </div>

        <h1
          className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 leading-tight"
          style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}
        >
          Pick a time for your call
        </h1>

        <p className="text-base text-gray-500 leading-relaxed mb-8 max-w-md mx-auto">
          Choose the time that works best for you below. You&apos;ll get a confirmation email with everything you need to join.
        </p>
      </div>

      {/* Calendar embed */}
      <div className="mx-auto max-w-3xl px-4 sm:px-8 pb-16">
        <div className="rounded-3xl bg-white border border-gray-100 shadow-sm overflow-hidden">
          <iframe
            src={FORM_SRC}
            style={{ width: '100%', height: '100%', minHeight: 720, border: 'none', borderRadius: 0 }}
            id={`inline-${FORM_ID}`}
            data-layout="{'id':'INLINE'}"
            data-trigger-type="alwaysShow"
            data-trigger-value=""
            data-activation-type="alwaysActivated"
            data-activation-value=""
            data-deactivation-type="neverDeactivate"
            data-deactivation-value=""
            data-form-name="Strategy Call Confirmed"
            data-height="574"
            data-layout-iframe-id={`inline-${FORM_ID}`}
            data-form-id={FORM_ID}
            title="Strategy Call Confirmed"
          />
        </div>
      </div>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-gray-100">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400">&copy; {new Date().getFullYear()} StoryPay&#8482; by <a href="https://storyvenue.com" target="_blank" rel="noreferrer" className="hover:text-gray-600 transition-colors underline">StoryVenue</a></p>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <a href="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</a>
            <a href="/terms" className="hover:text-gray-600 transition-colors">Terms of Use</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
