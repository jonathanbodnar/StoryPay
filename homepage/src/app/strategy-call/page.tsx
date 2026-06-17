'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Script from 'next/script';
import { X, CheckCircle2, TrendingUp, Calendar, MessageSquare, Sparkles } from 'lucide-react';

const BRAND = '#1b1b1b';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

const SURVEY_ID = 'foNEAvcN1Ecj7zm8gcoP';
const SURVEY_SRC = `https://api.leadconnectorhq.com/widget/survey/${SURVEY_ID}`;

const AVATARS = [
  { src: 'https://randomuser.me/api/portraits/women/44.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/women/65.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/women/68.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/women/90.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/men/32.jpg', alt: 'venue owner' },
];

const BENEFITS = [
  { icon: TrendingUp,    title: 'Book more weddings',      body: 'A proven system to turn more inquiries into booked tours and signed contracts.' },
  { icon: MessageSquare, title: 'Never miss a lead',       body: 'Automated follow-up so every couple gets a fast, personal response — day or night.' },
  { icon: Calendar,      title: 'Fill your calendar',      body: 'Stop chasing tire-kickers and fill your dates with couples who are ready to book.' },
];

// ── Survey Modal ──────────────────────────────────────────────────────────────
function SurveyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-3xl bg-white overflow-hidden flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles size={15} style={{ color: BRAND }} />
            <span className="text-sm font-semibold text-gray-900">Free Strategy Call — Quick Qualifier</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <iframe
            src={SURVEY_SRC}
            style={{ border: 'none', width: '100%', minHeight: 560 }}
            scrolling="no"
            id={SURVEY_ID}
            title="survey"
          />
        </div>
      </div>
    </div>
  );
}

export default function StrategyCallPage() {
  const [showSurvey, setShowSurvey] = useState(false);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    document.body.style.overflow = showSurvey ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showSurvey]);

  return (
    <div
      className="min-h-screen text-gray-900"
      style={{ fontFamily: "'Open Sans', Arial, sans-serif", background: 'linear-gradient(180deg, #e4e9ec 0%, #eef1f3 8%, #f4f6f7 18%, #f8f9fa 30%, #ffffff 48%)' }}
    >
      {/* LeadConnector embed script — powers survey auto-resize + redirects */}
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

      {/* Hero */}
      <div className="mx-auto max-w-3xl px-5 sm:px-8 pt-8 sm:pt-14 pb-4 text-center">
        <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 mb-7 whitespace-nowrap">
          <span className="text-xs sm:text-sm font-semibold text-emerald-700">For wedding venue owners ready to book more weddings</span>
        </div>

        <h1
          className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-5 sm:mb-6 leading-tight"
          style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}
        >
          Book a Free Strategy Call
        </h1>

        <p className="text-base sm:text-lg text-gray-500 leading-relaxed mb-9 sm:mb-10 max-w-md sm:max-w-lg mx-auto">
          In 30 minutes we&apos;ll map out exactly how to fill your calendar with more booked weddings — using the same system trusted by venues across the country.
        </p>

        <button
          onClick={() => setShowSurvey(true)}
          className="inline-flex items-center justify-center rounded-md px-8 sm:px-12 py-4 text-base font-bold text-white hover:opacity-90 hover:-translate-y-0.5 transition-all mb-9 sm:mb-10"
          style={{ backgroundColor: BRAND }}
        >
          Book A Free Strategy Call
        </button>

        {/* Social proof */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-4">
          <div className="flex -space-x-2.5">
            {AVATARS.map((av, i) => (
              <div key={i} className="h-9 w-9 rounded-full border-2 border-white overflow-hidden bg-gray-200 flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={av.src} alt={av.alt} className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
          <span className="text-sm text-gray-500 text-center sm:text-left">
            Trusted by venue owners all over the United States
          </span>
        </div>
      </div>

      {/* Benefits */}
      <div className="mx-auto max-w-4xl px-5 sm:px-8 py-12 sm:py-16">
        <div className="grid gap-4 sm:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl bg-white border border-gray-100 p-6 text-left shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl mb-4" style={{ backgroundColor: '#f5f5f5' }}>
                <Icon size={18} style={{ color: BRAND }} />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1.5">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        {/* What to expect */}
        <div className="mt-10 rounded-2xl bg-gray-50 p-6 sm:p-8">
          <h2 className="text-lg font-bold text-gray-900 mb-4">What happens on the call</h2>
          <ul className="space-y-3">
            {[
              'We review where your bookings are leaking and the fastest way to plug it.',
              'You get a clear, custom game plan for your venue — no fluff, no obligation.',
              'If we\u2019re a fit to help, we\u2019ll show you exactly what that looks like.',
            ].map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-gray-600">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Secondary CTA */}
        <div className="mt-10 text-center">
          <button
            onClick={() => setShowSurvey(true)}
            className="inline-flex items-center justify-center rounded-md px-10 py-4 text-base font-bold text-white hover:opacity-90 hover:-translate-y-0.5 transition-all"
            style={{ backgroundColor: BRAND }}
          >
            Book A Free Strategy Call
          </button>
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

      {showSurvey && <SurveyModal onClose={() => setShowSurvey(false)} />}
    </div>
  );
}
