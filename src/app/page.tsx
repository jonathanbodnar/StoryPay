'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { CheckCircle2, ChevronDown, ChevronUp, X, Loader2 } from 'lucide-react';

// ─── Brand ────────────────────────────────────────────────────────────────────
const BRAND = '#293745';
const LAUNCH_DATE = new Date('2026-06-01T00:00:00Z');

// ─── Countdown ────────────────────────────────────────────────────────────────
function useCountdown(target: Date) {
  const [t, setT] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  useEffect(() => {
    const tick = () => {
      const d = Math.max(0, target.getTime() - Date.now());
      setT({
        days:    Math.floor(d / 86400000),
        hours:   Math.floor((d % 86400000) / 3600000),
        minutes: Math.floor((d % 3600000) / 60000),
        seconds: Math.floor((d % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  return t;
}

function CDUnit({ v, label }: { v: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-2xl sm:text-3xl font-bold tabular-nums" style={{ color: BRAND }}>
        {String(v).padStart(2, '0')}
      </span>
      <span className="text-[10px] uppercase tracking-widest text-gray-400">{label}</span>
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────
const FAQS = [
  { q: 'What is StoryPay?', a: 'StoryPay is a proposal and payment platform built specifically for wedding venues. Send beautiful contracts, collect e-signatures, and get paid — all from one dashboard.' },
  { q: "What's included in early access?", a: "Early access members get full platform access, founding member pricing, priority onboarding, and a direct line to our team to shape the product roadmap." },
  { q: 'What payment options does StoryPay support?', a: 'We support full payments, installment schedules, and recurring subscriptions — with 0% processing fees passed to clients at checkout.' },
  { q: 'Is my data secure?', a: "Yes. StoryPay is PCI SAQ-A compliant. Card numbers go directly from your client's browser to our payment processor — they never touch our servers." },
  { q: 'When does StoryPay launch?', a: "We're launching June 1st, 2026. Request your invite now to be among the first venues onboarded with exclusive early-access pricing." },
  { q: 'How much does it cost?', a: 'Pricing will be announced at launch. Early access members will receive special founding member rates — significantly lower than standard pricing.' },
];

function FAQCard({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-2xl bg-white border border-gray-200 overflow-hidden transition-all cursor-pointer select-none"
      onClick={() => setOpen(v => !v)}
    >
      <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5">
        <span className="text-sm sm:text-base font-semibold text-gray-900 pr-4 leading-snug">{q}</span>
        <div
          className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full transition-colors"
          style={{ backgroundColor: open ? BRAND : '#f3f4f6' }}
        >
          {open
            ? <ChevronUp size={13} className="text-white" />
            : <ChevronDown size={13} className="text-gray-500" />}
        </div>
      </div>
      {open && (
        <div className="px-5 sm:px-6 pb-5 text-sm text-gray-500 leading-relaxed border-t border-gray-100 pt-4">
          {a}
        </div>
      )}
    </div>
  );
}

// ─── Request Access Modal ─────────────────────────────────────────────────────
function RequestModal({ onClose }: { onClose: () => void }) {
  const [form, setForm]     = useState({ firstName: '', lastName: '', email: '', phone: '', venueName: '' });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicate'>('idle');
  const [msg, setMsg]       = useState('');

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.status === 201) { setStatus('success'); }
      else if (res.status === 200) { setStatus('duplicate'); setMsg(data.message); }
      else { setStatus('error'); setMsg(data.error || 'Something went wrong.'); }
    } catch {
      setStatus('error'); setMsg('Network error. Please try again.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden">

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
        >
          <X size={15} />
        </button>

        {status === 'success' ? (
          <div className="flex flex-col items-center justify-center gap-4 px-8 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 size={32} className="text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-gray-900">Request received!</h3>
            <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
              Look out for your invite via email in the next <strong>24–48 hours</strong>. We&apos;re excited to have you on board.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: BRAND }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-8 pt-8 pb-6">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Limited spots available</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">Request Early Access</h3>
              <p className="text-sm text-gray-500 mt-1">Fill in your details and we&apos;ll send your invite within 24–48 hours.</p>
            </div>

            <form onSubmit={submit} className="px-8 pb-8 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">First Name <span className="text-red-400">*</span></label>
                  <input
                    type="text" required value={form.firstName} onChange={update('firstName')}
                    placeholder="Jane"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Last Name</label>
                  <input
                    type="text" value={form.lastName} onChange={update('lastName')}
                    placeholder="Smith"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Email <span className="text-red-400">*</span></label>
                <input
                  type="email" required value={form.email} onChange={update('email')}
                  placeholder="jane@yourvenue.com"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Phone</label>
                <input
                  type="tel" value={form.phone} onChange={update('phone')}
                  placeholder="(555) 000-0000"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Venue Name</label>
                <input
                  type="text" value={form.venueName} onChange={update('venueName')}
                  placeholder="The Grand Estate"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                />
              </div>

              {(status === 'error' || status === 'duplicate') && (
                <p className="text-xs text-center text-red-500 bg-red-50 rounded-xl py-2 px-3">{msg}</p>
              )}

              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-60 mt-2"
                style={{ backgroundColor: BRAND }}
              >
                {status === 'loading' ? <><Loader2 size={15} className="animate-spin" /> Submitting...</> : 'Request My Invite'}
              </button>
              <p className="text-center text-xs text-gray-400">We respect your privacy. No spam, ever.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Social proof avatars ─────────────────────────────────────────────────────
const AVATAR_COLORS = ['#293745', '#354859', '#4a6280', '#2f3e4e', '#6b8aab'];
const INITIALS = ['J', 'M', 'S', 'R', 'A'];

function AvatarStack({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {INITIALS.map((init, i) => (
          <div
            key={i}
            className="h-8 w-8 rounded-full border-2 border-white flex items-center justify-center text-white text-[11px] font-bold"
            style={{ backgroundColor: AVATAR_COLORS[i] }}
          >
            {init}
          </div>
        ))}
      </div>
      {count > 0 && (
        <span className="text-sm text-gray-500">
          Join <span className="font-semibold text-gray-900">{count}+</span> venues on the waitlist
        </span>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [showModal, setShowModal] = useState(false);
  const [count, setCount]         = useState<number>(247);
  const countdown                 = useCountdown(LAUNCH_DATE);
  const heroRef                   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/waitlist').then(r => r.json()).then(d => {
      if (d.count > 0) setCount(d.count + 242); // seed social proof offset
    }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Open Sans', sans-serif" }}>

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="mx-auto max-w-5xl px-5 h-14 flex items-center justify-between">
          <Image src="/storypay-logo-dark.png" alt="StoryPay" width={110} height={28} />
          <button
            onClick={() => setShowModal(true)}
            className="text-xs font-semibold px-4 py-2 rounded-xl text-white transition-all hover:opacity-90"
            style={{ backgroundColor: BRAND }}
          >
            Request Access
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section ref={heroRef} className="pt-28 pb-0 px-4 text-center overflow-hidden" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 60%)' }}>
        <div className="mx-auto max-w-2xl">

          {/* App icon */}
          <div className="flex justify-center mb-6">
            <div className="h-20 w-20 rounded-3xl shadow-xl flex items-center justify-center overflow-hidden" style={{ backgroundColor: BRAND }}>
              <Image src="/StoryPay-Light-Logo.png" alt="StoryPay" width={56} height={56} className="object-contain p-2" />
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight mb-4" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}>
            Get early access
          </h1>
          <p className="text-gray-500 text-sm sm:text-base leading-relaxed mb-3 max-w-md mx-auto">
            We&apos;re getting close. Request your invite to be among the first venues to use StoryPay and transform how you close bookings.
          </p>

          {/* 0% fee badge */}
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 mb-8 text-sm font-bold" style={{ backgroundColor: '#293745', color: '#fff' }}>
            <span className="text-lg">🎉</span>
            <span>0% processing fees — passed directly to your clients</span>
          </div>

          <div className="flex flex-col items-center gap-5">
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 rounded-2xl px-8 py-4 text-base font-bold text-white shadow-lg transition-all hover:opacity-90 hover:shadow-xl hover:-translate-y-0.5"
              style={{ backgroundColor: BRAND }}
            >
              Request Early Access Invite
            </button>

            <AvatarStack count={count} />
          </div>

          {/* Countdown */}
          <div className="mt-10 flex items-center justify-center gap-5 sm:gap-8">
            <CDUnit v={countdown.days}    label="Days"    />
            <span className="text-xl font-bold text-gray-300 pb-4">:</span>
            <CDUnit v={countdown.hours}   label="Hours"   />
            <span className="text-xl font-bold text-gray-300 pb-4">:</span>
            <CDUnit v={countdown.minutes} label="Minutes" />
            <span className="text-xl font-bold text-gray-300 pb-4">:</span>
            <CDUnit v={countdown.seconds} label="Seconds" />
          </div>

          {/* Phone mockup */}
          <div className="relative mt-12 mx-auto max-w-xs sm:max-w-sm">
            {/* Floating notification card */}
            <div className="absolute -left-4 sm:-left-10 top-12 z-10 rounded-2xl bg-white shadow-xl border border-gray-100 px-4 py-3 text-left w-44">
              <p className="text-[10px] text-gray-400 font-medium mb-1">New payment received</p>
              <p className="text-sm font-bold text-gray-900">$4,500.00</p>
              <p className="text-[10px] text-gray-400 mt-0.5">The Grand Estate · just now</p>
            </div>

            {/* Phone shell */}
            <div className="relative rounded-[2.5rem] overflow-hidden shadow-2xl border-4 border-gray-900 bg-gray-900">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-gray-900 rounded-b-2xl z-10" />
              {/* Dashboard screenshot placeholder — styled to look like the dashboard */}
              <div className="bg-white pt-6">
                <div className="px-4 py-3 border-b border-gray-100">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Home</div>
                  <div className="text-xs font-semibold text-gray-900">Your venue payment dashboard</div>
                </div>
                {/* KPI mini cards */}
                <div className="grid grid-cols-2 gap-2 p-3">
                  {[
                    { label: 'Revenue', val: '$12,450' },
                    { label: 'Proposals', val: '8' },
                    { label: 'Customers', val: '24' },
                    { label: 'Pending', val: '3' },
                  ].map(c => (
                    <div key={c.label} className="rounded-xl border border-gray-100 p-2.5">
                      <div className="text-[9px] uppercase tracking-wider font-bold mb-1" style={{ color: '#6b8aab' }}>{c.label}</div>
                      <div className="text-sm font-bold" style={{ color: BRAND }}>{c.val}</div>
                    </div>
                  ))}
                </div>
                {/* Mini chart */}
                <div className="mx-3 mb-3 rounded-xl border border-gray-100 p-3">
                  <div className="text-[9px] uppercase tracking-wider font-bold mb-2" style={{ color: '#6b8aab' }}>Revenue</div>
                  <svg viewBox="0 0 200 60" className="w-full h-10">
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#293745" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#293745" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0,50 C30,45 50,20 80,18 C110,16 140,30 170,10 L200,5 L200,60 L0,60Z" fill="url(#g)" />
                    <path d="M0,50 C30,45 50,20 80,18 C110,16 140,30 170,10 L200,5" fill="none" stroke="#293745" strokeWidth="1.5" />
                  </svg>
                </div>
                {/* Recent proposals mini list */}
                <div className="mx-3 mb-4 rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-50 flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: '#6b8aab' }}>Recent Proposals</span>
                  </div>
                  {[
                    { name: 'The Johnson Wedding', status: 'Paid', amount: '$4,500' },
                    { name: 'Miller Reception', status: 'Signed', amount: '$3,200' },
                    { name: 'Davis Ceremony', status: 'Sent', amount: '$2,800' },
                  ].map(p => (
                    <div key={p.name} className="flex items-center justify-between px-3 py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <div className="text-[9px] font-semibold text-gray-700">{p.name}</div>
                        <div className="text-[8px] font-medium" style={{ color: BRAND }}>{p.amount}</div>
                      </div>
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: p.status === 'Paid' ? '#d1fae5' : p.status === 'Signed' ? '#ede9fe' : '#dbeafe',
                          color: p.status === 'Paid' ? '#065f46' : p.status === 'Signed' ? '#5b21b6' : '#1e40af',
                        }}>
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 0% fee highlight ── */}
      <section className="py-14 px-4" style={{ background: 'linear-gradient(135deg, #293745 0%, #354859 100%)' }}>
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}>
            0% processing fees
          </h2>
          <p className="text-gray-300 text-sm sm:text-base max-w-lg mx-auto leading-relaxed">
            Unlike other platforms that take a cut of every booking, StoryPay passes processing fees directly to your clients. You keep 100% of every payment.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-6 max-w-lg mx-auto">
            {[
              { label: 'You keep', val: '100%' },
              { label: 'Platform cut', val: '$0' },
              { label: 'Hidden fees', val: 'None' },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center gap-1">
                <span className="text-3xl font-bold text-white">{s.val}</span>
                <span className="text-xs text-gray-400 uppercase tracking-wider">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 px-4 sm:px-6" style={{ backgroundColor: '#f8fafc' }}>
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}>
              Frequently asked questions
            </h2>
            <p className="text-gray-500 text-sm">
              Everything you need to know about StoryPay. Can&apos;t find an answer?{' '}
              <a href="mailto:clients@storyvenuemarketing.com" className="underline" style={{ color: BRAND }}>Email us</a>.
            </p>
          </div>
          <div className="space-y-3">
            {FAQS.map(f => <FAQCard key={f.q} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="py-20 px-4 text-center bg-white">
        <div className="mx-auto max-w-xl">
          <div className="flex justify-center mb-6">
            <div className="h-14 w-14 rounded-2xl shadow-lg flex items-center justify-center overflow-hidden" style={{ backgroundColor: BRAND }}>
              <Image src="/StoryPay-Light-Logo.png" alt="StoryPay" width={40} height={40} className="object-contain p-1" />
            </div>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}>
            Ready to transform how you get paid?
          </h2>
          <p className="text-gray-500 text-sm mb-8 max-w-md mx-auto">
            Limited early access spots available. Request your invite today and lock in founding member pricing before we launch.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-2xl px-8 py-4 text-base font-bold text-white shadow-lg transition-all hover:opacity-90 hover:-translate-y-0.5"
            style={{ backgroundColor: BRAND }}
          >
            Request Early Access Invite
          </button>
          <p className="mt-4 text-xs text-gray-400">Invite sent within 24–48 hours · No credit card required</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-8 px-4 border-t border-gray-100 bg-white">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <Image src="/storypay-logo-dark.png" alt="StoryPay" width={100} height={24} className="opacity-50" />
          <div className="flex items-center gap-6 text-xs text-gray-400">
            <a href="/admin" className="hover:text-gray-600 transition-colors">Admin Login</a>
            <a href="mailto:clients@storyvenuemarketing.com" className="hover:text-gray-600 transition-colors">Contact</a>
          </div>
          <p className="text-xs text-gray-400">&copy; StoryVenue 2026. All rights reserved.</p>
        </div>
      </footer>

      {/* ── Modal ── */}
      {showModal && <RequestModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
