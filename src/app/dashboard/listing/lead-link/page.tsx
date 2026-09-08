'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Link2, Copy, Check, ExternalLink, Loader2, AlertCircle,
  Instagram, Facebook, Globe, Store, FileText, Share2, Sparkles,
} from 'lucide-react';

const DIRECTORY_SITE = (
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
  process.env.NEXT_PUBLIC_DIRECTORY_URL ||
  'https://storyvenue.com'
).replace(/\/$/, '');

type Listing = {
  slug: string | null;
  name: string | null;
  is_published: boolean | null;
  social_links: Record<string, string> | null;
};

const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';

const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  website: 'Website',
};

function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  switch (platform) {
    case 'instagram': return <Instagram className={className} />;
    case 'facebook': return <Facebook className={className} />;
    case 'website': return <Globe className={className} />;
    default: return <Globe className={className} />;
  }
}

export default function LeadLinkPage() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/listing/me', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load your listing');
        const json = (await res.json()) as { listing: Listing };
        if (!cancelled) setListing(json.listing);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const slug = listing?.slug ?? '';
  const publicUrl = slug ? `${DIRECTORY_SITE}/venue/${slug}/links` : '';
  const displayUrl = publicUrl.replace(/^https?:\/\//, '');

  const socials = useMemo(
    () =>
      Object.entries(listing?.social_links ?? {}).filter(
        ([key, u]) => key in SOCIAL_LABELS && typeof u === 'string' && /^https?:\/\//i.test(u),
      ),
    [listing],
  );

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-6 sm:py-8">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/listing" className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700">
            <ArrowLeft size={14} /> Back to listing
          </Link>
          <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
            <Link2 size={22} /> Lead Link&trade;
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            One link for your Instagram, TikTok, and Facebook bios. It turns your organic social
            following into booked tours — every visitor lands on your social handles, your venue
            listing, and your pricing &amp; availability guide.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── No slug / not published yet ────────────────────────────── */}
      {!slug ? (
        <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <div>
            <h2 className="font-heading text-lg text-amber-900">Publish your listing to activate your link</h2>
            <p className="mt-1 text-sm text-amber-800">
              Your Lead Link uses your venue&apos;s public URL. Set your listing live (and choose your
              URL) in the{' '}
              <Link href="/dashboard/listing/venue-listing" className="font-semibold underline">
                Venue Listing editor
              </Link>{' '}
              and your link will appear here automatically.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          {/* ── Left column: link + what's on it ─────────────────────── */}
          <div className="space-y-6">
            {/* Shareable link */}
            <div className={CARD}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                  <Share2 size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-lg text-gray-900">Your link in bio</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Paste this into your Instagram, TikTok, Facebook, and Pinterest profiles.
                  </p>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5">
                      <Link2 size={15} className="shrink-0 text-gray-400" />
                      <span className="truncate text-sm font-medium text-gray-800">{displayUrl}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={copyLink}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
                      >
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                      >
                        <ExternalLink size={15} /> Open
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* What auto-populates */}
            <div className={CARD}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                  <Sparkles size={18} />
                </div>
                <div className="flex-1">
                  <h2 className="font-heading text-lg text-gray-900">What&apos;s on your page</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Everything here fills in automatically from your venue profile — no setup needed.
                  </p>

                  {/* Cards that always show */}
                  <ul className="mt-4 space-y-2.5">
                    <li className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
                        <Store size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">Venue Listing</p>
                        <p className="text-xs text-gray-500">Sends visitors to your public listing page</p>
                      </div>
                    </li>
                    <li className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
                        <FileText size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">Download Pricing &amp; Availability</p>
                        <p className="text-xs text-gray-500">Captures the lead and delivers your guide</p>
                      </div>
                    </li>
                  </ul>

                  {/* Social handles */}
                  <div className="mt-5">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Social handles
                    </p>
                    {socials.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {socials.map(([key]) => (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
                          >
                            <SocialIcon platform={key} className="h-3.5 w-3.5" />
                            {SOCIAL_LABELS[key]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">
                        No social profiles connected yet. Add them in the{' '}
                        <Link href="/dashboard/listing/venue-listing" className="font-medium text-gray-900 underline">
                          Venue Listing editor
                        </Link>{' '}
                        and they&apos;ll appear on your Lead Link automatically.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right column: live preview ───────────────────────────── */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[2.5rem] border-[10px] border-[#1b1b1b] bg-[#1b1b1b] shadow-xl">
              <div className="overflow-hidden rounded-[1.8rem] bg-white">
                <iframe
                  key={publicUrl}
                  src={publicUrl}
                  title="Lead Link preview"
                  className="h-[640px] w-full"
                  loading="lazy"
                />
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-gray-400">Live preview — this is exactly what brides see.</p>
          </div>
        </div>
      )}
    </div>
  );
}
