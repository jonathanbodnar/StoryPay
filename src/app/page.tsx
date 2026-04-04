'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { CheckCircle2, ChevronDown, X, Loader2 } from 'lucide-react';

const BRAND = '#293745';
const LAUNCH_DATE = new Date('2026-06-01T00:00:00Z');

// ─── Countdown ───────────────────────────────────────────────────────────────
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
    <div className="flex flex-col items-center gap-1 min-w-[48px]">
      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-gray-900">{String(v).padStart(2, '0')}</span>
      <span className="text-[9px] uppercase tracking-[0.15em] text-gray-400 font-medium">{label}</span>
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────
const FAQS = [
  { q: 'What is StoryPay?', a: 'StoryPay is a proposal and payment platform built specifically for wedding venues. Send beautiful contracts, collect e-signatures, and get paid — all from one dashboard.' },
  { q: "What's included in early access?", a: 'Early access members get full platform access, founding member pricing, priority onboarding, and a direct line to our team to shape the product roadmap.' },
  { q: 'How do I get started?', a: 'Simply request your early access invite using the form above. We\'ll send you your invite within 24–48 hours with everything you need to get set up.' },
  { q: 'Is support available?', a: 'Yes! We provide dedicated onboarding support for all early access members. Reach out to us at clients@storyvenuemarketing.com anytime.' },
  { q: 'How much will this cost?', a: 'Pricing will be announced at launch. Early access members will receive special founding member rates — significantly lower than standard pricing. Plus 0% processing fees.' },
];

function FAQItem({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-gray-50 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-sm font-semibold text-gray-900">{q}</span>
        <div className={`flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full transition-colors ${open ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180 text-white' : 'text-gray-400'}`} />
        </div>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-gray-500 leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}

// ─── Request Modal ────────────────────────────────────────────────────────────
function RequestModal({ prefillEmail, onClose }: { prefillEmail: string; onClose: () => void }) {
  const [form, setForm]     = useState({ firstName: '', lastName: '', email: prefillEmail, phone: '', venueName: '' });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicate'>('idle');
  const [msg, setMsg]       = useState('');

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
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
      if (res.status === 201)     { setStatus('success'); }
      else if (res.status === 200){ setStatus('duplicate'); setMsg(data.message); }
      else                        { setStatus('error'); setMsg(data.error || 'Something went wrong.'); }
    } catch {
      setStatus('error'); setMsg('Network error. Please try again.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
        >
          <X size={14} />
        </button>

        {status === 'success' ? (
          <div className="flex flex-col items-center justify-center gap-4 px-8 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 size={30} className="text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-gray-900">You&apos;re on the list!</h3>
            <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
              Look out for your invite via email in the next <strong>24–48 hours</strong>. We&apos;re excited to have you on board.
            </p>
            <button onClick={onClose} className="mt-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: BRAND }}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="px-8 pt-8 pb-5">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Request Early Access Invite</h3>
              <p className="text-sm text-gray-400">We&apos;ll send your invite within 24–48 hours.</p>
            </div>
            <form onSubmit={submit} className="px-8 pb-8 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">First Name <span className="text-red-400">*</span></label>
                  <input type="text" required value={form.firstName} onChange={upd('firstName')} placeholder="Jane"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Last Name</label>
                  <input type="text" value={form.lastName} onChange={upd('lastName')} placeholder="Smith"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Email <span className="text-red-400">*</span></label>
                <input type="email" required value={form.email} onChange={upd('email')} placeholder="jane@yourvenue.com"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Phone</label>
                <input type="tel" value={form.phone} onChange={upd('phone')} placeholder="(555) 000-0000"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Venue Name</label>
                <input type="text" value={form.venueName} onChange={upd('venueName')} placeholder="The Grand Estate"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors" />
              </div>
              {(status === 'error' || status === 'duplicate') && (
                <p className="text-xs text-center text-red-500 bg-red-50 rounded-xl py-2 px-3">{msg}</p>
              )}
              <button type="submit" disabled={status === 'loading'}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-60 mt-1"
                style={{ backgroundColor: BRAND }}>
                {status === 'loading' ? <><Loader2 size={14} className="animate-spin" /> Submitting...</> : 'Request My Invite'}
              </button>
              <p className="text-center text-xs text-gray-400">No spam, ever. Invite arrives within 24–48 hours.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Avatar stack ─────────────────────────────────────────────────────────────
const AVATAR_INITIALS = ['J','M','S','R','A'];
const AVATAR_BG       = ['#293745','#354859','#4a6280','#2f3e4e','#6b8aab'];

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [email, setEmail]         = useState('');
  const [showModal, setShowModal] = useState(false);
  const [count, setCount]         = useState(247);
  const countdown                 = useCountdown(LAUNCH_DATE);

  useEffect(() => {
    fetch('/api/waitlist').then(r => r.json()).then(d => {
      if (d.count > 0) setCount(d.count + 242);
    }).catch(() => {});
  }, []);

  function openModal(e?: React.FormEvent) {
    e?.preventDefault();
    setShowModal(true);
  }

  return (
    <div className="min-h-screen text-gray-900" style={{ fontFamily: "'Open Sans', Arial, sans-serif" }}>

      {/* ── HERO — light gradient bg matching reference ── */}
      <div style={{ background: 'linear-gradient(180deg, #dff0f8 0%, #ffffff 55%)' }}>

        {/* Nav */}
        <nav className="mx-auto max-w-4xl px-5 py-5 flex items-center justify-between">
          <Image src="/storypay-logo-dark.png" alt="StoryPay" width={100} height={24} />
          <a href="/admin" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Admin</a>
        </nav>

        {/* Hero content */}
        <div className="mx-auto max-w-lg px-5 pt-6 pb-0 text-center">

          {/* App icon — dark rounded square, exactly like reference */}
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 rounded-[22px] shadow-lg flex items-center justify-center overflow-hidden" style={{ backgroundColor: BRAND }}>
              <Image src="/StoryPay-Light-Logo.png" alt="StoryPay" width={44} height={44} className="object-contain p-1.5" />
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}>
            Get early access
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed mb-6 max-w-xs mx-auto">
            We&apos;re getting close. Request your invite to be among the first venues to use StoryPay and transform how you close bookings.
          </p>

          {/* Email + button row — exactly like reference */}
          <form onSubmit={openModal} className="flex items-center gap-2 mb-5 max-w-sm mx-auto">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Your email address"
              className="flex-1 rounded-xl border border-gray-200 bg-white/80 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-300 shadow-sm"
            />
            <button
              type="submit"
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white whitespace-nowrap shadow-sm hover:opacity-90 transition-opacity"
              style={{ backgroundColor: BRAND }}
            >
              Request Early Access Invite
            </button>
          </form>

          {/* Avatar + social proof — exactly like reference */}
          <div className="flex items-center justify-center gap-2.5 mb-8">
            <div className="flex -space-x-2">
              {AVATAR_INITIALS.map((init, i) => (
                <div key={i} className="h-7 w-7 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ backgroundColor: AVATAR_BG[i] }}>
                  {init}
                </div>
              ))}
            </div>
            <span className="text-xs text-gray-500">
              Join <span className="font-semibold text-gray-700">{count.toLocaleString()}+</span> others on the waitlist
            </span>
          </div>

          {/* Countdown — exactly like reference: numbers with colons */}
          <div className="flex items-center justify-center gap-3 sm:gap-5 mb-10">
            <CDUnit v={countdown.days}    label="Days"    />
            <span className="text-xl font-light text-gray-300 pb-4">:</span>
            <CDUnit v={countdown.hours}   label="Hours"   />
            <span className="text-xl font-light text-gray-300 pb-4">:</span>
            <CDUnit v={countdown.minutes} label="Minutes" />
            <span className="text-xl font-light text-gray-300 pb-4">:</span>
            <CDUnit v={countdown.seconds} label="Seconds" />
          </div>

          {/* 0% fee badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700 mb-10">
            🎉 0% processing fees — you keep 100% of every payment
          </div>

          {/* Phone mockup — centered, large, like reference */}
          <div className="relative mx-auto" style={{ width: 260, height: 480 }}>
            {/* Floating notification card — left side */}
            <div className="absolute -left-8 top-16 z-10 rounded-2xl bg-white shadow-xl border border-gray-100 px-3.5 py-2.5 text-left w-40">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold" style={{ backgroundColor: BRAND }}>S</div>
                <span className="text-[10px] font-medium text-gray-500">StoryPay</span>
              </div>
              <p className="text-xs font-bold text-gray-900">New payment</p>
              <p className="text-[10px] text-gray-400">$4,500 · just now</p>
            </div>

            {/* Phone shell */}
            <div className="absolute inset-0 rounded-[2.8rem] overflow-hidden border-[5px] border-gray-800 bg-gray-800 shadow-2xl">
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-gray-800 rounded-b-2xl z-20" />
              {/* Status bar dots */}
              <div className="absolute top-2 right-4 z-20 flex items-center gap-1">
                <div className="h-1 w-3 rounded-full bg-white/40" />
                <div className="h-1 w-1 rounded-full bg-white/40" />
                <div className="h-1 w-1 rounded-full bg-white/40" />
              </div>

              {/* Screen content */}
              <div className="w-full h-full bg-white pt-5 overflow-hidden">
                {/* Mini dashboard */}
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-[8px] text-gray-400 font-semibold uppercase tracking-wider">Home</p>
                  <p className="text-[10px] font-bold text-gray-800 mt-0.5">My Tasks</p>
                </div>
                <div className="px-3 pt-2">
                  <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mb-2">TOP PRIORITY</p>
                  {/* Task card */}
                  <div className="rounded-xl border border-gray-100 bg-white p-2.5 mb-2 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-emerald-400" />
                      <div>
                        <p className="text-[9px] font-bold text-gray-800">Final Design Review</p>
                        <p className="text-[8px] text-gray-400">Produlis App</p>
                      </div>
                    </div>
                    <div className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[7px] font-bold text-blue-600">Feb 20</div>
                  </div>
                  {/* KPI row */}
                  <div className="grid grid-cols-2 gap-1.5 mb-2">
                    {[{ l:'Revenue', v:'$12.4k' },{ l:'Proposals', v:'8' }].map(c=>(
                      <div key={c.l} className="rounded-xl border border-gray-100 p-2">
                        <p className="text-[8px] text-gray-400 font-semibold">{c.l}</p>
                        <p className="text-[11px] font-bold mt-0.5" style={{ color: BRAND }}>{c.v}</p>
                      </div>
                    ))}
                  </div>
                  {/* Mini chart */}
                  <div className="rounded-xl border border-gray-100 p-2 mb-2">
                    <p className="text-[7px] text-gray-400 font-semibold mb-1.5">REVENUE</p>
                    <svg viewBox="0 0 180 40" className="w-full h-8">
                      <defs>
                        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#293745" stopOpacity="0.15" />
                          <stop offset="100%" stopColor="#293745" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d="M0,35 C20,32 40,18 70,14 C100,10 130,22 160,6 L180,2 L180,40 L0,40Z" fill="url(#lg)" />
                      <path d="M0,35 C20,32 40,18 70,14 C100,10 130,22 160,6 L180,2" fill="none" stroke="#293745" strokeWidth="1.5" />
                    </svg>
                  </div>
                  {/* Landing page label */}
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[9px] text-gray-400">Landing page</p>
                    <p className="text-[7px] text-gray-300">Apr 17</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Spacer after phone */}
          <div className="h-12" />
        </div>
      </div>

      {/* ── FAQ section — light grey bg, centered, card style ── */}
      <div className="bg-white py-16 px-4 sm:px-6">
        <div className="mx-auto max-w-xl">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2" style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}>
              Frequently asked questions
            </h2>
            <p className="text-sm text-gray-400">
              Everything you need to know about StoryPay. Find answers to the most common questions below.
            </p>
          </div>

          <div className="space-y-2">
            {FAQS.map((f, i) => <FAQItem key={f.q} {...f} defaultOpen={i < 2} />)}
          </div>
        </div>
      </div>

      {/* ── Footer — minimal, like reference ── */}
      <footer className="py-8 px-4 border-t border-gray-100 bg-white">
        <div className="mx-auto max-w-xl flex flex-col items-center gap-3">
          <div className="flex items-center gap-6 text-xs text-gray-400">
            <a href="https://storyvenuemarketing.com" className="hover:text-gray-600 transition-colors">StoryVenue</a>
            <a href="/admin" className="hover:text-gray-600 transition-colors">Admin Login</a>
            <a href="mailto:clients@storyvenuemarketing.com" className="hover:text-gray-600 transition-colors">clients@storyvenuemarketing.com</a>
          </div>
          <p className="text-xs text-gray-400">&copy; 2026 StoryPay by <span className="font-semibold">StoryVenue</span></p>
        </div>
      </footer>

      {/* Modal */}
      {showModal && <RequestModal prefillEmail={email} onClose={() => setShowModal(false)} />}
    </div>
  );
}
