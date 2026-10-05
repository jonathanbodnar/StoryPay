'use client';

/**
 * Web Form: the venue's inquiry form for its own website, on a page of its
 * own under the Bride Booking System (owner's ask, Oct 5 2026). The code to
 * copy and how to add it are on the left; the form, exactly as a visitor to
 * the venue's website will see it, is on the right.
 *
 * The same code is still offered from the Pricing Guide page ("Get Embed
 * Code"): the owner wants it in both places.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Check, Code2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { webFormEmbedCode, webFormSrc } from '@/lib/web-form-embed';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';

const STEPS: Array<{ title: string; body: string }> = [
  { title: 'Copy the code', body: 'Press Copy code. You don’t need to change anything in it.' },
  {
    title: 'Open the page on your website where the form should go',
    body: 'Your contact page or your pricing page works best. In your website builder, add a block for custom code: it’s called Custom HTML in WordPress, Code in Squarespace, Embed HTML in Wix and Embed in Webflow.',
  },
  { title: 'Paste the code and publish', body: 'Paste it into that block, save, and publish the page. The form appears right where you put the block.' },
  { title: 'Send yourself a test', body: 'Fill in the form on your website once. Your inquiry shows up in your Lead Inbox within a moment.' },
];

export default function WebFormPage() {
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/listing/me', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load your listing');
        const json = (await res.json()) as { listing?: { slug?: string | null } };
        if (!cancelled) setSlug((json.listing?.slug || '').trim() || null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const code = slug ? webFormEmbedCode(webFormSrc(APP_URL, slug)) : '';
  // The preview is the venue's own form, served by this app.
  const previewSrc = slug ? `/api/embed/${encodeURIComponent(slug)}` : '';
  const copyCode = () => {
    if (!code) return;
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    }).catch(() => { /* clipboard blocked: the code is selectable text either way */ });
  };

  return (
    <div className="space-y-6 py-6 sm:py-8" data-testid="web-form-page">
      <div>
        <Link href="/dashboard/listing" className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700">
          <ArrowLeft size={14} /> Back to listing
        </Link>
        <h1 className="font-heading flex items-center gap-2 text-2xl text-gray-900">
          <Code2 size={22} /> Web Form
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Put your inquiry form on your own website. Every bride who fills it in lands in your Lead Inbox,
          gets your pricing guide right away, and is followed up for you.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!slug ? (
        <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <div>
            <h2 className="font-heading text-lg text-amber-900">Publish your listing to get your form</h2>
            <p className="mt-1 text-sm text-amber-800">
              Your form uses your venue&apos;s public address. Set your listing live in the{' '}
              <Link href="/dashboard/listing/venue-listing" className="font-semibold underline">
                Venue Listing editor
              </Link>{' '}
              and your code will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
          {/* ── Left: the code, and how to add it ─────────────────────── */}
          <div className="min-w-0 space-y-6">
            <div className={CARD}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg text-gray-900">Your form code</h2>
                  <p className="mt-0.5 text-sm text-gray-500">Copy this and paste it into your website.</p>
                </div>
                <button
                  type="button"
                  onClick={copyCode}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied!' : 'Copy code'}
                </button>
              </div>
              <pre
                data-testid="web-form-code"
                className="mt-4 max-h-64 overflow-auto whitespace-pre rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 font-mono text-[11px] leading-relaxed text-gray-700"
              >
{code}
              </pre>
              <p className="mt-3 text-xs text-gray-500">
                If someone else looks after your website, send this code to them. It works with WordPress,
                Squarespace, Wix, Webflow and any other website.
              </p>
            </div>

            <div className={CARD}>
              <h2 className="font-heading text-lg text-gray-900">How to add it to your website</h2>
              <ol className="mt-4 space-y-4">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <ul className="mt-5 space-y-1.5 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-500">
                <li>
                  The form uses your colors from{' '}
                  <Link href="/dashboard/settings/branding" className="font-medium text-gray-800 underline underline-offset-2">
                    Settings → Branding
                  </Link>
                  . Change them there and the form on your website updates by itself.
                </li>
                <li>
                  Leads from this form show as <strong className="text-gray-700">Web Form</strong> on your Bride Booking System™
                  dashboard, so you can see how many your website brings in.
                </li>
              </ul>
            </div>
          </div>

          {/* ── Right: the form as visitors see it ────────────────────── */}
          <div className="min-w-0">
            <div className={`${CARD} lg:sticky lg:top-6`}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-heading text-lg text-gray-900">Preview</h2>
                <a
                  href={previewSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-800"
                >
                  <ExternalLink size={12} /> Open in a new tab
                </a>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                <iframe
                  src={previewSrc}
                  title="Web form preview"
                  data-testid="web-form-preview"
                  loading="lazy"
                  className="block h-[720px] w-full border-0 bg-white"
                />
              </div>
              <p className="mt-3 text-center text-xs text-gray-400">This is the form brides see on your website.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
