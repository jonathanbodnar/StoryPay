'use client';

/**
 * The "Send my guide" form on /get-guide/[token].
 *
 * One path, same as the main lead form: mobile + email (prefilled), one button
 * that sends the guide by text and email. The consent line sits directly under
 * the button — tapping it is the opt-in, so the wording must keep naming the
 * button ("By tapping Send my guide…").
 */

import { useState } from 'react';
import InlinePdfGuide from '@/components/public/InlinePdfGuide';
import { GuideViewTracker } from '@/components/public/GuideViewTracker';

interface Props {
  token: string;
  venueId: string;
  leadId: string;
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
  pdfUrl: string;
  downloadUrl: string;
  /** They already tapped before — go straight to the guide. */
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
      <div>
        <GuideViewTracker venueId={props.venueId} leadId={props.leadId} />
        <div className="mx-auto mb-5 max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center">
          <p className="text-base font-semibold text-emerald-900">On its way! Check your phone and inbox.</p>
          <p className="mt-1 text-sm text-emerald-800">Here&apos;s your guide in the meantime.</p>
        </div>
        <InlinePdfGuide pdfUrl={props.pdfUrl} downloadUrl={props.downloadUrl} venueName={props.venueName} />
      </div>
    );
  }

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 outline-none transition focus:border-gray-400';

  return (
    <form onSubmit={submit} className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-gray-900">
        {props.firstName ? `${props.firstName}, your` : 'Your'} {props.venueName} pricing guide is ready
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
