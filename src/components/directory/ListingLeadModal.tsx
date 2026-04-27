'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

const TOURING_OPTIONS = [
  'Immediately — within the next month',
  'Soon — 1 to 3 months',
  'Planning ahead — 3 to 6 months',
  'Just exploring — 6+ months out',
];


interface Props {
  venueName: string;
  venueId: string;
  venueSlug?: string;
  apiBase: string; // e.g. "https://app.storyvenue.com"
  confirmationBase?: string; // e.g. "https://storyvenue.com"
}

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function ListingLeadModal({ venueName, venueId, venueSlug, apiBase, confirmationBase = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    booking_timeline: '',
    venue_matters: '',
    message: '',
  });

  function set(key: keyof typeof form, val: string) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErrMsg('');

    try {
      const res = await fetch(`${apiBase}/api/public/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id:         venueId,
          first_name:       form.first_name.trim(),
          last_name:        form.last_name.trim(),
          phone:            form.phone.trim(),
          email:            form.email.trim().toLowerCase(),
          booking_timeline: form.booking_timeline,
          venue_matters:    form.venue_matters,
          message:          form.message.trim() || undefined,
          source:           'directory',
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error || 'Something went wrong. Please try again.');
      }

      const data = await res.json().catch(() => ({})) as { venue_slug?: string };
      const slug = data.venue_slug ?? venueSlug ?? '';
      // Redirect to the venue-specific thank-you page — clean URL for Meta Pixel tracking.
      window.location.href = `${confirmationBase}/venue/${slug}/thankyou`;
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : 'Something went wrong.');
      setStatus('error');
    }
  }

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors';

  return (
    <>
      {/* CTA trigger button */}
      <button
        type="button"
        onClick={() => { setOpen(true); setStatus('idle'); setErrMsg(''); }}
        className="w-full rounded-2xl bg-[#1b1b1b] px-6 py-4 text-sm font-semibold text-white transition hover:bg-[#2d2d2d] active:scale-[0.98]"
      >
        Download Pricing &amp; Availability Guide
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
            style={{ maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-6 py-5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
              <h2 className="text-lg font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                Get Pricing &amp; Check Availability
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">{venueName}</p>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              {status === 'success' ? (
                <div className="py-10 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={28} height={28}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                    You&apos;re all set!
                  </h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {venueName} will be in touch soon with pricing and availability.
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="mt-6 rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#2d2d2d]"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
                  {/* First + Last name — half width */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-700">First Name <span className="text-red-400">*</span></label>
                      <input
                        type="text"
                        required
                        autoComplete="given-name"
                        placeholder="Jane"
                        value={form.first_name}
                        onChange={(e) => set('first_name', e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-gray-700">Last Name <span className="text-red-400">*</span></label>
                      <input
                        type="text"
                        required
                        autoComplete="family-name"
                        placeholder="Doe"
                        value={form.last_name}
                        onChange={(e) => set('last_name', e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">Phone <span className="text-red-400">*</span></label>
                    <input
                      type="tel"
                      required
                      autoComplete="tel"
                      placeholder="(555) 555-5555"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">Email <span className="text-red-400">*</span></label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="jane@example.com"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  {/* Touring timeline */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      When do you plan to start touring? <span className="text-red-400">*</span>
                    </label>
                    <select
                      required
                      value={form.booking_timeline}
                      onChange={(e) => set('booking_timeline', e.target.value)}
                      className={inputCls}
                    >
                      <option value="" disabled>Select timeline</option>
                      {TOURING_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>

                  {/* What matters most */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      What matters most when choosing a venue? <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. outdoor ceremony space, all-inclusive pricing…"
                      value={form.venue_matters}
                      onChange={(e) => set('venue_matters', e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  {/* Optional message */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      Anything you&apos;d like the venue to know?{' '}
                      <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="We'd love an outdoor ceremony..."
                      value={form.message}
                      onChange={(e) => set('message', e.target.value)}
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  {errMsg && (
                    <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{errMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={status === 'submitting'}
                    className="w-full rounded-2xl bg-[#1b1b1b] py-4 text-sm font-semibold text-white transition hover:bg-[#2d2d2d] disabled:opacity-60 active:scale-[0.98]"
                  >
                    {status === 'submitting' ? 'Sending…' : 'Download Pricing & Availability Guide'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
