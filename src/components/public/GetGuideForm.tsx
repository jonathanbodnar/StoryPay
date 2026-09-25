'use client';

/**
 * The "Send my guide" form on /get-guide/[token].
 *
 * One path, same as the main lead form: mobile + email (prefilled), one button
 * that sends the guide by text and email. The consent line sits directly under
 * the button — tapping it is the opt-in, so the wording must keep naming the
 * button ("By tapping Send my guide…").
 *
 * After the tap the page does NOT show the guide: it says the guide is on its
 * way to their phone and inbox, so couples learn to look there — which is
 * where the venue's follow-up will reach them.
 */

import { useState } from 'react';

interface Props {
  token: string;
  venueName: string;
  firstName: string | null;
  initialPhone: string;
  initialEmail: string;
  /** Ask for the date only when we don't have it. */
  askWeddingDate: boolean;
  consentText: string;
  privacyUrl: string;
  termsUrl: string;
  buttonColor: string;
  /** They already tapped before — just confirm it went out. */
  alreadySent: boolean;
}

export default function GetGuideForm(props: Props) {
  const [phone, setPhone] = useState(props.initialPhone);
  const [email, setEmail] = useState(props.initialEmail);
  const [weddingDate, setWeddingDate] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>(props.alreadySent ? 'sent' : 'idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch('/api/public/get-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: props.token, phone, email, weddingDate: weddingDate || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      setStatus('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStatus('idle');
    }
  }

  if (status === 'sent') {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <p className="text-3xl" aria-hidden>📱</p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Your guide is on its way!</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          {`We just sent your ${props.venueName} pricing guide to your phone and your email. Check your texts and your inbox — that's where we'll follow up with you too.`}
        </p>
      </div>
    );
  }

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 outline-none transition focus:border-gray-400';

  return (
    <form onSubmit={submit} className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">
        {`${props.firstName ? `${props.firstName}, your` : 'Your'} ${props.venueName} pricing guide is ready`}
      </h1>
      <p className="mt-1 text-sm text-gray-500">Confirm where to send it.</p>

      <div className="mt-5 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-700">Mobile phone</span>
          <input
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputCls}
          />
        </label>
        {props.askWeddingDate && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-700">
              Wedding date <span className="font-normal text-gray-400">(optional — we&apos;ll check availability)</span>
            </span>
            <input type="date" value={weddingDate} onChange={(e) => setWeddingDate(e.target.value)} className={inputCls} />
          </label>
        )}
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="mt-5 w-full rounded-2xl py-4 text-base font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
        style={{ background: props.buttonColor }}
      >
        {status === 'sending' ? 'Sending…' : 'Send my guide'}
      </button>

      <p className="mt-3 text-xs leading-relaxed text-gray-600">
        {props.consentText}{' '}
        <a href={props.privacyUrl} target="_blank" rel="noopener noreferrer" className="underline">Privacy</a>
        {' · '}
        <a href={props.termsUrl} target="_blank" rel="noopener noreferrer" className="underline">Terms</a>
      </p>
    </form>
  );
}
