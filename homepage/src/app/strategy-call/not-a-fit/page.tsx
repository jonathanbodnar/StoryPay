'use client';

import Image from 'next/image';
import { TrendingUp, MessageSquare, Calendar, FileText, Sparkles, Globe, ArrowRight, CheckCircle2 } from 'lucide-react';

const BRAND = '#1b1b1b';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';
const SIGNUP_URL = `${DASHBOARD_URL}/signup`;

const FEATURES = [
  { icon: Globe,         title: 'Get found by couples',   body: 'A premium directory listing puts your venue in front of couples actively searching for a place to say "I do."' },
  { icon: MessageSquare, title: 'AI Concierge follow-up', body: 'Every inquiry gets an instant, on-brand reply and smart follow-up — so no lead ever slips through the cracks.' },
  { icon: Calendar,      title: 'Fill your calendar',     body: 'Turn more inquiries into booked tours with automated reminders and a pipeline built for venues.' },
  { icon: FileText,      title: 'Proposals & contracts',  body: 'Send beautiful branded proposals, collect e-signatures, and lock in the booking in minutes.' },
  { icon: TrendingUp,    title: 'Get paid faster',        body: 'Collect deposits and payments online with 0% processing fees — you keep 100% of every dollar.' },
  { icon: Sparkles,      title: 'All in one place',       body: 'Leads, conversations, payments, and marketing automations — finally under one roof, built just for venues.' },
];

export default function NotAFitPage() {
  return (
    <div
      className="min-h-screen text-gray-900"
      style={{ fontFamily: "'Open Sans', Arial, sans-serif", background: 'linear-gradient(180deg, #e4e9ec 0%, #eef1f3 8%, #f4f6f7 18%, #f8f9fa 30%, #ffffff 48%)' }}
    >
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
        <div className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 mb-7">
          <span className="text-xs sm:text-sm font-semibold text-violet-700">The all-in-one platform for wedding venues</span>
        </div>

        <h1
          className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-5 sm:mb-6 leading-tight"
          style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}
        >
          Book More Weddings
        </h1>

        <p className="text-base sm:text-lg text-gray-500 leading-relaxed mb-9 sm:mb-10 max-w-md sm:max-w-lg mx-auto">
          Get discovered by more couples, respond to every lead instantly, and turn inquiries into booked weddings — all from one beautiful dashboard built for venues like yours.
        </p>

        <a
          href={SIGNUP_URL}
          className="group inline-flex items-center justify-center gap-2 rounded-md px-8 sm:px-12 py-4 text-base font-bold text-white hover:opacity-90 hover:-translate-y-0.5 transition-all mb-4"
          style={{ backgroundColor: BRAND }}
        >
          Start Free Today
          <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
        </a>
        <p className="text-xs text-gray-400">14-day free trial · No card required · 0% processing fees</p>
      </div>

      {/* Feature grid */}
      <div className="mx-auto max-w-5xl px-5 sm:px-8 py-12 sm:py-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl bg-white border border-gray-100 p-6 text-left shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl mb-4" style={{ backgroundColor: '#f5f5f5' }}>
                <Icon size={18} style={{ color: BRAND }} />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1.5">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Value strip */}
      <div className="mx-auto max-w-4xl px-5 sm:px-8 pb-14">
        <div className="rounded-3xl p-8 sm:p-10 text-center" style={{ backgroundColor: BRAND }}>
          <h2
            className="text-2xl sm:text-3xl font-bold text-white mb-4"
            style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}
          >
            Everything your venue needs to grow
          </h2>
          <div className="mx-auto mb-7 flex max-w-xl flex-col gap-2.5 text-left">
            {[
              'Premium directory listing to get found by couples',
              'AI Concierge that replies and follows up 24/7',
              'Proposals, contracts & e-signatures',
              '0% payment processing fees',
            ].map((line) => (
              <div key={line} className="flex items-center gap-3 text-sm text-white/90">
                <CheckCircle2 size={17} className="shrink-0 text-emerald-400" />
                <span>{line}</span>
              </div>
            ))}
          </div>
          <a
            href={SIGNUP_URL}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-9 py-3.5 text-base font-bold hover:opacity-90 hover:-translate-y-0.5 transition-all"
            style={{ color: BRAND }}
          >
            Start Free Today
            <ArrowRight size={18} />
          </a>
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
