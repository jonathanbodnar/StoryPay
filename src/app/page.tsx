'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { CheckCircle2, ChevronDown, X, Loader2, TrendingUp, Bell, CreditCard, FileText } from 'lucide-react';

const BRAND = '#293745';
const LAUNCH_DATE = new Date('2026-06-01T00:00:00Z');

// ── Countdown ─────────────────────────────────────────────────────────────────
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
    <div className="flex flex-col items-center gap-1 min-w-[44px] sm:min-w-[52px]">
      <span className="text-3xl sm:text-4xl font-bold tabular-nums text-gray-900">{String(v).padStart(2, '0')}</span>
      <span className="text-[9px] uppercase tracking-[0.18em] text-gray-400 font-medium">{label}</span>
    </div>
  );
}

// ── FAQ — all closed by default ───────────────────────────────────────────────
const FAQS = [
  {
    q: 'What is StoryPay\u2122?',
    a: 'StoryPay\u2122 is a proposal and payment platform built specifically for wedding venues. Send beautiful contracts, collect e-signatures, and get paid, all from one dashboard.',
  },
  {
    q: "What's included in early access?",
    a: 'Early access members get full platform access, founding member pricing, priority onboarding, and a direct line to our team to shape the product roadmap.',
  },
  {
    q: 'How do I get started?',
    a: "Simply request your early access invite using the button above. We will send you your invite within 24 to 48 hours with everything you need to get set up.",
  },
  {
    q: 'Is support available?',
    a: 'Yes! We provide dedicated onboarding support for all early access members. Reach out to us at clients@storyvenuemarketing.com anytime.',
  },
  {
    q: 'How much will this cost?',
    a: 'Pricing will be announced at launch. Early access members will receive special founding member rates, significantly lower than standard pricing. Plus 0% processing fees.',
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-gray-50 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className="text-sm font-semibold text-gray-900 pr-4 leading-snug">{q}</span>
        <div className={`flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full transition-all ${open ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
          <ChevronDown size={12} className={`transition-transform duration-200 ${open ? 'rotate-180 text-white' : 'text-gray-400'}`} />
        </div>
      </button>
      {open && (
        <div className="px-5 sm:px-6 pb-5 text-sm text-gray-500 leading-relaxed border-t border-gray-100 pt-4">
          {a}
        </div>
      )}
    </div>
  );
}

// ── Request Modal ─────────────────────────────────────────────────────────────
function RequestModal({ onClose }: { onClose: () => void }) {
  const [form, setForm]     = useState({ firstName: '', lastName: '', email: '', phone: '', venueName: '', referralSource: '' });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicate'>('idle');
  const [msg, setMsg]       = useState('');

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    try {
      const res  = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.status === 201)      setStatus('success');
      else if (res.status === 200) { setStatus('duplicate'); setMsg(data.message); }
      else                         { setStatus('error');     setMsg(data.error || 'Something went wrong.'); }
    } catch {
      setStatus('error');
      setMsg('Network error. Please try again.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors z-10"
        >
          <X size={14} />
        </button>

        {status === 'success' ? (
          <div className="flex flex-col items-center justify-center gap-4 px-8 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 size={30} className="text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-gray-900">You are on the list!</h3>
            <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
              Look out for your invite via email in the next 24 to 48 hours. We are excited to have you on board.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: BRAND }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="px-6 sm:px-8 pt-8 pb-5">
              <h3 className="text-xl font-bold text-gray-900 mb-1">Request Early Access Invite</h3>
              <p className="text-sm text-gray-400">We will send your invite within 24 to 48 hours.</p>
            </div>
            <form onSubmit={submit} className="px-6 sm:px-8 pb-8 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text" required value={form.firstName} onChange={upd('firstName')} placeholder="Jane"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Last Name</label>
                  <input
                    type="text" value={form.lastName} onChange={upd('lastName')} placeholder="Smith"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email" required value={form.email} onChange={upd('email')} placeholder="jane@yourvenue.com"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Phone</label>
                <input
                  type="tel" value={form.phone} onChange={upd('phone')} placeholder="(555) 000-0000"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Venue Name</label>
                <input
                  type="text" value={form.venueName} onChange={upd('venueName')} placeholder="The Grand Estate"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">How did you hear about us?</label>
                <select
                  value={form.referralSource}
                  onChange={upd('referralSource')}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors appearance-none"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center' }}
                >
                  <option value="" disabled>Select an option...</option>
                  <option value="A Friend">A Friend</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Instagram">Instagram</option>
                  <option value="Instagram Ad">Instagram Ad</option>
                  <option value="Facebook Ad">Facebook Ad</option>
                  <option value="Google Search">Google Search</option>
                  <option value="Email">Email</option>
                  <option value="Current Client">Current Client</option>
                  <option value="StoryVenue">StoryVenue</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {(status === 'error' || status === 'duplicate') && (
                <p className="text-xs text-center text-red-500 bg-red-50 rounded-xl py-2 px-3">{msg}</p>
              )}
              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 mt-1"
                style={{ backgroundColor: BRAND }}
              >
                {status === 'loading'
                  ? <><Loader2 size={14} className="animate-spin" /> Submitting...</>
                  : 'Request My Invite'}
              </button>
              <p className="text-center text-xs text-gray-400">No spam, ever. Invite arrives within 24 to 48 hours.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── iPhone Dashboard Screen ───────────────────────────────────────────────────
function DashboardScreen() {
  return (
    <div className="w-full h-full bg-white overflow-hidden flex flex-col">
      <div className="px-4 pt-2 pb-2 flex items-center justify-between border-b border-gray-100" style={{ backgroundColor: BRAND }}>
        <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">StoryPay</span>
        <div className="flex items-center gap-2">
          <Bell size={11} className="text-white/60" />
          <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center text-[8px] font-bold text-white">JW</div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-3 py-2 space-y-2" style={{ backgroundColor: '#f8fafc' }}>
        <div>
          <p className="text-[9px] text-gray-400">Good morning</p>
          <p className="text-[11px] font-bold text-gray-800">Grand Estate</p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Revenue',   value: '$48.2k', trend: '+12%', up: true },
            { label: 'Proposals', value: '24',      trend: '+4',   up: true },
            { label: 'Customers', value: '18',      trend: '+3',   up: true },
            { label: 'Pending',   value: '5',       trend: '-2',   up: false },
          ].map(c => (
            <div key={c.label} className="rounded-xl bg-white border border-gray-100 p-2 shadow-sm">
              <p className="text-[7px] text-gray-400 font-semibold uppercase tracking-wider">{c.label}</p>
              <p className="text-[13px] font-bold mt-0.5" style={{ color: BRAND }}>{c.value}</p>
              <div className={`flex items-center gap-0.5 mt-0.5 ${c.up ? 'text-emerald-500' : 'text-red-400'}`}>
                <TrendingUp size={8} />
                <span className="text-[7px] font-semibold">{c.trend}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-white border border-gray-100 p-2.5 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[8px] font-bold text-gray-500 uppercase tracking-wider">Revenue Trend</p>
            <span className="text-[7px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded-full">Trending Up</span>
          </div>
          <svg viewBox="0 0 220 55" className="w-full" style={{ height: 44 }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#293745" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#293745" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {[10, 25, 40].map(y => (
              <line key={y} x1="0" y1={y} x2="220" y2={y} stroke="#f1f5f9" strokeWidth="0.5" />
            ))}
            <path d="M0,48 C25,44 45,35 70,28 C95,22 115,30 140,18 C165,8 185,12 220,5 L220,55 L0,55Z" fill="url(#chartGrad)" />
            <path d="M0,48 C25,44 45,35 70,28 C95,22 115,30 140,18 C165,8 185,12 220,5" fill="none" stroke="#293745" strokeWidth="2" strokeLinecap="round" />
            {([[0,48],[70,28],[140,18],[220,5]] as [number,number][]).map(([x,y],i) => (
              <circle key={i} cx={x} cy={y} r="2.5" fill="white" stroke="#293745" strokeWidth="1.5" />
            ))}
            {['Nov','Jan','Mar','Apr'].map((l,i) => (
              <text key={l} x={[5,70,140,210][i]} y="54" fontSize="5" fill="#94a3b8" textAnchor="middle">{l}</text>
            ))}
          </svg>
        </div>

        <div className="rounded-xl bg-white border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-gray-50 flex items-center justify-between">
            <p className="text-[8px] font-bold text-gray-500 uppercase tracking-wider">Recent Payments</p>
            <CreditCard size={9} className="text-gray-300" />
          </div>
          {[
            { name: 'Johnson Wedding',  amount: '$4,500', status: 'Paid',   color: '#10b981', bg: '#d1fae5' },
            { name: 'Miller Reception', amount: '$3,200', status: 'Signed', color: '#8b5cf6', bg: '#ede9fe' },
            { name: 'Davis Ceremony',   amount: '$2,800', status: 'Sent',   color: '#3b82f6', bg: '#dbeafe' },
          ].map(p => (
            <div key={p.name} className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-1.5">
                <FileText size={8} style={{ color: BRAND }} />
                <div>
                  <p className="text-[8px] font-semibold text-gray-700 leading-none">{p.name}</p>
                  <p className="text-[7px] font-bold mt-0.5" style={{ color: BRAND }}>{p.amount}</p>
                </div>
              </div>
              <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: p.bg, color: p.color }}>{p.status}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-white border border-gray-100 p-2.5 shadow-sm">
          <p className="text-[8px] font-bold text-gray-500 uppercase tracking-wider mb-2">Proposal Status</p>
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 40 40" className="w-10 h-10 flex-shrink-0">
              <circle cx="20" cy="20" r="14" fill="none" stroke="#f1f5f9" strokeWidth="6" />
              <circle cx="20" cy="20" r="14" fill="none" stroke="#10b981" strokeWidth="6" strokeDasharray="35 53" strokeDashoffset="-5" strokeLinecap="round" />
              <circle cx="20" cy="20" r="14" fill="none" stroke="#8b5cf6" strokeWidth="6" strokeDasharray="18 70" strokeDashoffset="-40" strokeLinecap="round" />
              <circle cx="20" cy="20" r="14" fill="none" stroke="#3b82f6" strokeWidth="6" strokeDasharray="15 73" strokeDashoffset="-58" strokeLinecap="round" />
              <text x="20" y="23" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#293745">24</text>
            </svg>
            <div className="flex flex-col gap-1">
              {[
                { label: 'Paid',   color: '#10b981', pct: '46%' },
                { label: 'Signed', color: '#8b5cf6', pct: '25%' },
                { label: 'Sent',   color: '#3b82f6', pct: '20%' },
                { label: 'Draft',  color: '#94a3b8', pct: '9%' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-[7px] text-gray-500">{s.label}</span>
                  <span className="text-[7px] font-bold text-gray-700 ml-auto pl-2">{s.pct}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Face avatars: 4 smiling women, 1 smiling man ─────────────────────────────
// Using randomuser.me with fixed seeds for consistent, professional portraits
const AVATARS = [
  { src: 'https://randomuser.me/api/portraits/women/44.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/women/65.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/women/68.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/women/90.jpg', alt: 'venue owner' },
  { src: 'https://randomuser.me/api/portraits/men/32.jpg',   alt: 'venue owner' },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [showModal, setShowModal] = useState(false);
  const [count, setCount]         = useState(247);
  const countdown                 = useCountdown(LAUNCH_DATE);

  useEffect(() => {
    fetch('/api/waitlist').then(r => r.json()).then(d => {
      if (d.count > 0) setCount(d.count + 242);
    }).catch(() => {});
  }, []);

  return (
    <div className="text-gray-900" style={{ fontFamily: "'Open Sans', Arial, sans-serif" }}>

      {/* ── Hero ── */}
      <div className="relative bg-white overflow-hidden">

        {/* Grey gradient pinned to top only — fades fully to white before the iPhone */}
        <div
          className="absolute top-0 left-0 right-0 z-0 pointer-events-none"
          style={{
            height: '70%',
            background: 'linear-gradient(180deg, #e4e9ec 0%, #eaeef0 12%, #f0f2f4 28%, #f5f7f8 45%, #f9fafb 62%, #ffffff 100%)',
          }}
        />
        {/* Extra white bleed at bottom to guarantee no line */}
        <div
          className="absolute bottom-0 left-0 right-0 z-0 pointer-events-none"
          style={{
            height: '30%',
            background: 'linear-gradient(180deg, transparent 0%, #ffffff 60%)',
          }}
        />

        {/* All hero content sits above the background layers */}
        <div className="relative z-10">

        {/* Nav */}
        <nav className="mx-auto max-w-5xl px-5 sm:px-8 py-5 flex items-center justify-between">
          <Image src="/storypay-logo-dark.png" alt="StoryPay" width={110} height={26} />
          <a href="/admin" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Admin</a>
        </nav>

        {/* Hero content */}
        <div className="mx-auto max-w-3xl px-5 sm:px-8 pt-8 sm:pt-12 pb-0 text-center">

          {/* Headline */}
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-5 sm:mb-6 leading-tight"
            style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}
          >
            Introducing StoryPay<sup className="text-[0.4em] align-super font-normal tracking-normal">TM</sup>
          </h1>

          {/* Subheadline */}
          <p className="text-base sm:text-lg text-gray-500 leading-relaxed mb-8 sm:mb-10 max-w-sm sm:max-w-md mx-auto">
            The modern way for wedding venues to send proposals, collect signatures, and get paid.
          </p>

          {/* CTA */}
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center rounded-2xl px-8 sm:px-12 py-4 text-base font-bold text-white shadow-md hover:opacity-90 hover:-translate-y-0.5 transition-all mb-8 sm:mb-10"
            style={{ backgroundColor: BRAND }}
          >
            Request Early Access Invite
          </button>

          {/* Social proof */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-8 sm:mb-10">
            <div className="flex -space-x-2.5">
              {AVATARS.map((av, i) => (
                <div key={i} className="h-9 w-9 rounded-full border-2 border-white overflow-hidden shadow-sm bg-gray-200 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={av.src}
                    alt={av.alt}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
            <span className="text-sm text-gray-500 text-center sm:text-left">
              Trusted by venue owners all over the United States
            </span>
          </div>

          {/* Countdown */}
          <div className="flex items-center justify-center gap-3 sm:gap-6 mb-8 sm:mb-10">
            <CDUnit v={countdown.days}    label="Days"    />
            <span className="text-2xl sm:text-3xl font-light text-gray-300 pb-5">:</span>
            <CDUnit v={countdown.hours}   label="Hours"   />
            <span className="text-2xl sm:text-3xl font-light text-gray-300 pb-5">:</span>
            <CDUnit v={countdown.minutes} label="Minutes" />
            <span className="text-2xl sm:text-3xl font-light text-gray-300 pb-5">:</span>
            <CDUnit v={countdown.seconds} label="Seconds" />
          </div>

          {/* 0% fee badge — single line on all devices */}
          <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 mb-10 sm:mb-14 whitespace-nowrap">
            <span className="text-xs sm:text-sm font-semibold text-emerald-700">0% processing fees. You keep 100% of every payment.</span>
          </div>

          {/* iPhone mockup */}
          <div className="relative mx-auto w-full" style={{ maxWidth: 340 }}>

            {/* Floating payment notification */}
            <div className="absolute -left-4 sm:-left-14 top-16 sm:top-20 z-10 rounded-2xl bg-white shadow-xl border border-gray-100 px-3 sm:px-3.5 py-2.5 sm:py-3 text-left w-36 sm:w-44">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="h-5 sm:h-6 w-5 sm:w-6 rounded-full flex items-center justify-center text-white text-[8px] sm:text-[9px] font-bold flex-shrink-0" style={{ backgroundColor: BRAND }}>S</div>
                <span className="text-[9px] sm:text-[10px] font-semibold text-gray-500">New Payment</span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-gray-900">$4,500.00</p>
              <p className="text-[9px] sm:text-[10px] text-gray-400 mt-0.5">The Grand Estate</p>
            </div>

            {/* Floating trend card */}
            <div className="hidden sm:block absolute -right-10 top-1/3 z-10 rounded-2xl bg-white shadow-xl border border-gray-100 px-3 py-2.5 text-left w-36">
              <p className="text-[9px] text-gray-400 font-medium mb-1">Monthly Revenue</p>
              <p className="text-sm font-bold text-gray-900">$48,200</p>
              <div className="flex items-center gap-1 mt-1">
                <TrendingUp size={11} className="text-emerald-500" />
                <span className="text-[10px] font-bold text-emerald-600">+12% this month</span>
              </div>
            </div>

            {/* iPhone */}
            <div
              className="relative mx-auto rounded-[3.2rem] overflow-hidden"
              style={{
                width: '100%',
                maxWidth: 300,
                aspectRatio: '300 / 620',
                backgroundColor: '#1a1a1a',
                border: '8px solid #1a1a1a',
                boxShadow: '0 0 0 1px #333, 0 30px 80px rgba(0,0,0,0.35)',
              }}
            >
              {/* Side buttons */}
              <div className="absolute -left-[10px] top-[18%] w-[4px] h-8 rounded-l-lg" style={{ backgroundColor: '#111' }} />
              <div className="absolute -left-[10px] top-[27%] w-[4px] h-10 rounded-l-lg" style={{ backgroundColor: '#111' }} />
              <div className="absolute -left-[10px] top-[36%] w-[4px] h-10 rounded-l-lg" style={{ backgroundColor: '#111' }} />
              <div className="absolute -right-[10px] top-[23%] w-[4px] h-14 rounded-r-lg" style={{ backgroundColor: '#111' }} />

              <div className="w-full h-full rounded-[2.6rem] overflow-hidden relative">
                {/* Dynamic island */}
                <div
                  className="absolute top-3 left-1/2 -translate-x-1/2 w-24 h-7 rounded-full z-30 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#1a1a1a' }}
                >
                  <div className="h-2 w-2 rounded-full bg-gray-700" />
                  <div className="h-3 w-3 rounded-full bg-gray-700" />
                </div>

                {/* Status bar */}
                <div
                  className="absolute top-0 left-0 right-0 h-12 z-20 px-5 flex items-start pt-2 justify-between"
                  style={{ backgroundColor: BRAND }}
                >
                  <span className="text-[10px] font-semibold text-white/70 mt-1">9:41</span>
                  <div className="flex items-center gap-1 mt-1">
                    <div className="flex gap-px items-end h-3">
                      {[3,4,5,4].map((h,i) => (
                        <div key={i} className="w-0.5 rounded-full bg-white/70" style={{ height: h * 2 }} />
                      ))}
                    </div>
                    <svg className="w-3 h-3 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M1.5 8.5a13 13 0 0121 0M5.5 12.5a9 9 0 0113 0M9.5 16.5a5 5 0 015 0M12 20.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/>
                    </svg>
                    <div className="flex items-center gap-0.5">
                      <div className="h-2.5 rounded-sm border border-white/60 p-px" style={{ width: 16 }}>
                        <div className="h-full rounded-sm bg-white/80" style={{ width: '75%' }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="w-full h-full pt-12">
                  <DashboardScreen />
                </div>

                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-24 h-1 rounded-full bg-gray-800/60" />
              </div>
            </div>
          </div>

          <div className="h-6 sm:h-10" />
        </div>
        </div>{/* end relative z-10 */}
      </div>{/* end relative overflow-hidden hero */}

      {/* ── FAQ ── */}
      <div className="bg-white py-16 sm:py-20 px-5 sm:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="text-center mb-10">
            <h2
              className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3"
              style={{ fontFamily: "'Playfair Display', serif", fontWeight: 400 }}
            >
              Frequently asked questions
            </h2>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              Everything you need to know about StoryPay&#8482;. Find answers to the most common questions below.
            </p>
          </div>
          <div className="space-y-2">
            {FAQS.map(f => <FAQItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="py-8 px-4 border-t border-gray-100 bg-white text-center">
        <p className="text-xs text-gray-400">&copy; 2026 StoryPay&#8482; by StoryVenue</p>
      </footer>

      {showModal && <RequestModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
