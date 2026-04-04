'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { CheckCircle2, ArrowRight, Star, Shield, Zap, FileText, CreditCard, Users, ChevronDown, ChevronUp } from 'lucide-react';

// ─── Countdown ────────────────────────────────────────────────────────────────
function useCountdown(target: Date) {
  const [time, setTime] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  useEffect(() => {
    function update() {
      const diff = Math.max(0, target.getTime() - Date.now());
      setTime({
        days:    Math.floor(diff / 86400000),
        hours:   Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000)  / 60000),
        seconds: Math.floor((diff % 60000)    / 1000),
      });
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [target]);
  return time;
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-2xl sm:text-3xl font-bold tabular-nums" style={{ color: '#293745' }}>
        {String(value).padStart(2, '0')}
      </div>
      <div className="text-[10px] sm:text-xs uppercase tracking-widest text-gray-400 mt-1">{label}</div>
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: 'What is StoryPay?',
    a: 'StoryPay is a payment and proposal platform built specifically for wedding venues. Send contracts, collect signatures, and get paid — all in one place.',
  },
  {
    q: 'Who is StoryPay for?',
    a: 'StoryPay is designed for wedding venues, event spaces, and hospitality businesses that need to send proposals, collect client signatures, and process payments seamlessly.',
  },
  {
    q: 'What payment options does StoryPay support?',
    a: 'StoryPay supports full payments, installment plans, and recurring subscriptions — all processed securely through our payment partner, LunarPay (powered by Fortis).',
  },
  {
    q: 'Is my data secure?',
    a: 'Yes. StoryPay is PCI SAQ-A compliant. Card numbers never touch our servers — they go directly from your client\'s browser to our payment processor. All data is encrypted in transit and at rest.',
  },
  {
    q: 'When will StoryPay launch?',
    a: 'We\'re in active development and launching soon. Join the waitlist to be among the first to get access and receive exclusive early-adopter pricing.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Early access members will receive a free trial period and special founding member pricing. Sign up for the waitlist to lock in your spot.',
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden transition-all">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-5 text-left transition-colors hover:bg-gray-50"
      >
        <span className="text-sm sm:text-base font-semibold text-gray-900 pr-4">{q}</span>
        <div className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full border border-gray-200">
          {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </button>
      {open && (
        <div className="px-6 pb-5 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
          {a}
        </div>
      )}
    </div>
  );
}

// ─── Features ────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: FileText,   title: 'Smart Proposals',     desc: 'Send branded proposals with e-signatures. Clients review, sign, and pay in one seamless flow.' },
  { icon: CreditCard, title: 'Flexible Payments',    desc: 'Full payments, installment plans, or subscriptions. We support whatever works best for your clients.' },
  { icon: Users,      title: 'Customer Management',  desc: 'Keep all your clients organized in one place with complete proposal and payment history.' },
  { icon: Zap,        title: 'Instant Notifications', desc: 'Get notified the moment a client opens, signs, or pays a proposal. Never miss a beat.' },
  { icon: Shield,     title: 'PCI Compliant',         desc: 'Bank-grade security powered by Fortis. Card data never touches your servers.' },
  { icon: Star,       title: 'Built for Venues',      desc: 'Purpose-built for wedding venues — not a generic tool adapted for your industry.' },
];

// ─── Main page ────────────────────────────────────────────────────────────────
const LAUNCH_DATE = new Date('2026-05-01T00:00:00Z');

export default function LandingPage() {
  const [email, setEmail]       = useState('');
  const [status, setStatus]     = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicate'>('idle');
  const [message, setMessage]   = useState('');
  const [count, setCount]       = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const countdown = useCountdown(LAUNCH_DATE);

  useEffect(() => {
    fetch('/api/waitlist').then(r => r.json()).then(d => setCount(d.count)).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.status === 201) {
        setStatus('success');
        setMessage("You're on the list! We'll be in touch soon.");
        setEmail('');
        setCount(c => (c ?? 0) + 1);
      } else if (res.status === 200) {
        setStatus('duplicate');
        setMessage(data.message);
      } else {
        setStatus('error');
        setMessage(data.error || 'Something went wrong. Try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please try again.');
    }
  }

  return (
    <div className="min-h-screen bg-white font-body">

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <Image src="/StoryPay-Light-Logo.png" alt="StoryPay" width={130} height={32} className="invert" />
          <a
            href="/admin"
            className="text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
          >
            Admin
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-32 pb-20 px-4 sm:px-6 text-center">
        <div className="mx-auto max-w-2xl">

          {/* Logo mark */}
          <div className="flex justify-center mb-8">
            <div className="h-16 w-16 rounded-2xl shadow-lg flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#293745' }}>
              <Image src="/StoryPay-Light-Logo.png" alt="StoryPay" width={48} height={48} className="object-contain p-1" />
            </div>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-xs font-medium text-gray-500 mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Now in active development
          </div>

          <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl text-gray-900 leading-tight mb-6" style={{ fontWeight: 300 }}>
            Proposals & payments<br />
            <span style={{ color: '#293745' }}>built for wedding venues</span>
          </h1>

          <p className="text-base sm:text-lg text-gray-500 leading-relaxed mb-10 max-w-xl mx-auto">
            Send beautiful contracts, collect e-signatures, and get paid — all in one place. StoryPay is the payment platform wedding venues have been waiting for.
          </p>

          {/* Signup form */}
          {status === 'success' ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 size={24} className="text-emerald-500" />
              </div>
              <p className="text-sm font-semibold text-gray-900">{message}</p>
              {count !== null && (
                <p className="text-xs text-gray-400">You&apos;re #{count} on the waitlist</p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                ref={inputRef}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Your email address"
                required
                className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60 whitespace-nowrap shadow-sm"
                style={{ backgroundColor: '#293745' }}
              >
                {status === 'loading' ? 'Joining...' : <>Join waitlist <ArrowRight size={14} /></>}
              </button>
            </form>
          )}

          {(status === 'error' || status === 'duplicate') && (
            <p className={`mt-3 text-xs ${status === 'duplicate' ? 'text-gray-500' : 'text-red-500'}`}>{message}</p>
          )}

          {count !== null && count > 0 && status !== 'success' && (
            <p className="mt-4 text-xs text-gray-400">
              Join <span className="font-semibold text-gray-600">{count.toLocaleString()}+</span> venues already on the waitlist
            </p>
          )}
        </div>
      </section>

      {/* ── Countdown ── */}
      <section className="py-12 px-4 border-y border-gray-100 bg-gray-50/60">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-6">Launching in</p>
          <div className="flex items-center justify-center gap-6 sm:gap-10">
            <CountdownUnit value={countdown.days}    label="Days"    />
            <span className="text-2xl font-bold text-gray-300 mb-4">:</span>
            <CountdownUnit value={countdown.hours}   label="Hours"   />
            <span className="text-2xl font-bold text-gray-300 mb-4">:</span>
            <CountdownUnit value={countdown.minutes} label="Minutes" />
            <span className="text-2xl font-bold text-gray-300 mb-4">:</span>
            <CountdownUnit value={countdown.seconds} label="Seconds" />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <h2 className="font-heading text-3xl sm:text-4xl text-gray-900 mb-4" style={{ fontWeight: 300 }}>
              Everything you need to get paid
            </h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              StoryPay handles the entire client journey from proposal to payment so you can focus on creating unforgettable events.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border border-gray-100 bg-white p-6 hover:shadow-md transition-shadow">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl mb-4" style={{ backgroundColor: '#29374512' }}>
                  <Icon size={18} style={{ color: '#293745' }} />
                </div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof strip ── */}
      <section className="py-14 px-4 bg-gray-50 border-y border-gray-100">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-8">Why venues choose StoryPay</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { stat: '100%', label: 'Digital — no printing or scanning ever again' },
              { stat: '2 min', label: 'Average time to send a signed proposal' },
              { stat: '3×',   label: 'Faster payment collection vs traditional methods' },
            ].map(({ stat, label }) => (
              <div key={stat} className="flex flex-col items-center gap-2">
                <span className="text-4xl font-bold" style={{ color: '#293745' }}>{stat}</span>
                <span className="text-sm text-gray-500 text-center">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 px-4 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-12">
            <h2 className="font-heading text-3xl sm:text-4xl text-gray-900 mb-4" style={{ fontWeight: 300 }}>
              Frequently asked questions
            </h2>
            <p className="text-gray-500">Everything you need to know about StoryPay.</p>
          </div>
          <div className="space-y-3">
            {FAQS.map(faq => <FAQItem key={faq.q} {...faq} />)}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-4 text-center" style={{ backgroundColor: '#293745' }}>
        <div className="mx-auto max-w-xl">
          <h2 className="font-heading text-3xl sm:text-4xl text-white mb-4" style={{ fontWeight: 300 }}>
            Be first in line
          </h2>
          <p className="text-gray-300 mb-8 text-sm sm:text-base">
            Early access members get founding member pricing and priority onboarding. Don&apos;t miss your spot.
          </p>
          {status === 'success' ? (
            <div className="flex items-center justify-center gap-2 text-emerald-400">
              <CheckCircle2 size={18} />
              <span className="text-sm font-semibold">You&apos;re on the list!</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Your email address"
                required
                className="flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-white/40 transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold transition-all hover:bg-gray-100 disabled:opacity-60 whitespace-nowrap"
                style={{ color: '#293745' }}
              >
                {status === 'loading' ? 'Joining...' : <>Get early access <ArrowRight size={14} /></>}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-8 px-4 border-t border-gray-100">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <Image src="/storypay-logo-dark.png" alt="StoryPay" width={100} height={24} className="opacity-60" />
          <div className="flex items-center gap-6 text-xs text-gray-400">
            <a href="/admin" className="hover:text-gray-600 transition-colors">Admin</a>
            <a href="mailto:clients@storyvenuemarketing.com" className="hover:text-gray-600 transition-colors">Contact</a>
          </div>
          <p className="text-xs text-gray-400">&copy; StoryVenue 2026</p>
        </div>
      </footer>

    </div>
  );
}
