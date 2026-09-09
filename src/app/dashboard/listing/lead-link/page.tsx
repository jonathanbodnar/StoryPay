'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Link2, Copy, Check, ExternalLink, Loader2, AlertCircle,
  Instagram, Facebook, Globe, Store, FileText, Share2, Sparkles,
  Link as LinkIcon, Calendar, Video, Play, Camera, Image as ImageIcon,
  Star, Heart, Gift, Music, MapPin, Phone, Mail, Utensils, Ticket,
  ShoppingBag, Users, Plus, Trash2, type LucideIcon,
} from 'lucide-react';
import {
  LEAD_LINK_ICON_KEYS, LEAD_LINK_MAX_LINKS,
  type LeadLinkIconKey, type LeadLinkCustomLink,
} from '@/lib/lead-link-icons';

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
  lead_link_links: LeadLinkCustomLink[] | null;
};

// Key → lucide icon. Must stay in sync with LEAD_LINK_ICON_KEYS and the public
// renderer in the weddingdirectory repo.
const LEAD_LINK_ICONS: Record<LeadLinkIconKey, LucideIcon> = {
  link: LinkIcon, calendar: Calendar, video: Video, play: Play,
  camera: Camera, image: ImageIcon, star: Star, heart: Heart, gift: Gift,
  music: Music, 'map-pin': MapPin, phone: Phone, mail: Mail, globe: Globe,
  'file-text': FileText, utensils: Utensils, ticket: Ticket,
  'shopping-bag': ShoppingBag, sparkles: Sparkles, users: Users,
};

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';

const SOCIAL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  website: 'Website',
};

// Brand marks that lucide-react no longer ships. Copied verbatim from the public
// listing page (src/components/directory/VenuePublicBlocks.tsx) so the social
// icons here match exactly.
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.343l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.009 12.017 24.009c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z" />
    </svg>
  );
}

function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  switch (platform) {
    case 'instagram': return <Instagram className={className} />;
    case 'facebook': return <Facebook className={className} />;
    case 'tiktok': return <TikTokIcon className={className} />;
    case 'pinterest': return <PinterestIcon className={className} />;
    case 'website': return <Globe className={className} />;
    default: return <Globe className={className} />;
  }
}

function coerceLinks(raw: unknown): LeadLinkCustomLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, LEAD_LINK_MAX_LINKS).map((r) => {
    const o = (r ?? {}) as Partial<LeadLinkCustomLink>;
    const icon = LEAD_LINK_ICON_KEYS.includes(o.icon as LeadLinkIconKey)
      ? (o.icon as LeadLinkIconKey)
      : 'link';
    return { label: String(o.label ?? ''), url: String(o.url ?? ''), icon };
  });
}

export default function LeadLinkPage() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Custom links editor
  const [links, setLinks] = useState<LeadLinkCustomLink[]>([]);
  const [savingLinks, setSavingLinks] = useState(false);
  const [linksSaved, setLinksSaved] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState<number | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/listing/me', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load your listing');
        const json = (await res.json()) as { listing: Listing };
        if (!cancelled) {
          setListing(json.listing);
          setLinks(coerceLinks(json.listing?.lead_link_links));
        }
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

  function addLink() {
    if (links.length >= LEAD_LINK_MAX_LINKS) return;
    setLinks((prev) => [...prev, { label: '', url: '', icon: 'link' }]);
  }

  function updateLink(i: number, patch: Partial<LeadLinkCustomLink>) {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
    setIconPickerOpen(null);
  }

  async function saveLinks() {
    setSavingLinks(true);
    setError('');
    try {
      const cleaned = links
        .map((l) => ({ label: l.label.trim(), url: normalizeUrl(l.url), icon: l.icon }))
        .filter((l) => l.label || l.url);
      const res = await fetch('/api/listing/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_link_links: cleaned }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to save your links');
      }
      const json = (await res.json()) as { listing: Listing };
      setLinks(coerceLinks(json.listing?.lead_link_links));
      setIconPickerOpen(null);
      setLinksSaved(true);
      setTimeout(() => setLinksSaved(false), 2200);
      setPreviewNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingLinks(false);
    }
  }

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

            {/* Custom links editor */}
            <div className={CARD}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                  <LinkIcon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-lg text-gray-900">Your own links</h2>
                  <p className="mt-0.5 text-sm text-gray-500">
                    Add up to {LEAD_LINK_MAX_LINKS} custom buttons — a booking calendar, video tour,
                    menu, anything. Every one opens in a new tab.
                  </p>

                  <div className="mt-4 space-y-3">
                    {links.length === 0 && (
                      <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
                        No custom links yet — add your first below.
                      </p>
                    )}

                    {links.map((l, i) => {
                      const Icon = LEAD_LINK_ICONS[l.icon] ?? LinkIcon;
                      return (
                        <div key={i} className="rounded-2xl border border-gray-200 p-3">
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setIconPickerOpen(iconPickerOpen === i ? null : i)}
                                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1b1b1b] text-white hover:bg-black"
                                aria-label="Choose icon"
                              >
                                <Icon size={18} />
                              </button>
                              {iconPickerOpen === i && (
                                <div className="absolute left-0 top-12 z-20 w-64 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
                                  <div className="grid grid-cols-5 gap-1">
                                    {LEAD_LINK_ICON_KEYS.map((key) => {
                                      const KIcon = LEAD_LINK_ICONS[key];
                                      const active = key === l.icon;
                                      return (
                                        <button
                                          key={key}
                                          type="button"
                                          onClick={() => { updateLink(i, { icon: key }); setIconPickerOpen(null); }}
                                          className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? 'bg-[#1b1b1b] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                                          aria-label={key}
                                        >
                                          <KIcon size={17} />
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>

                            <input
                              value={l.label}
                              onChange={(e) => updateLink(i, { label: e.target.value })}
                              maxLength={60}
                              placeholder="Button label (e.g. Book a Tour)"
                              className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                            />

                            <button
                              type="button"
                              onClick={() => removeLink(i)}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                              aria-label="Remove link"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          <input
                            value={l.url}
                            onChange={(e) => updateLink(i, { url: e.target.value })}
                            maxLength={500}
                            inputMode="url"
                            placeholder="https://…"
                            className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={addLink}
                      disabled={links.length >= LEAD_LINK_MAX_LINKS}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={15} /> Add link{links.length > 0 ? ` (${links.length}/${LEAD_LINK_MAX_LINKS})` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={saveLinks}
                      disabled={savingLinks}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                    >
                      {savingLinks ? <Loader2 size={15} className="animate-spin" /> : linksSaved ? <Check size={15} /> : null}
                      {savingLinks ? 'Saving…' : linksSaved ? 'Saved!' : 'Save links'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right column: live preview (iPhone mockup) ───────────── */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="mx-auto w-fit">
              {/* Titanium frame */}
              <div className="relative rounded-[3.2rem] bg-[#1b1b1b] p-[3px] shadow-2xl ring-1 ring-black/10">
                <div className="rounded-[3rem] bg-[#1b1b1b] p-2.5">
                  {/* Side buttons */}
                  <span className="absolute -left-[2px] top-28 h-7 w-[3px] rounded-l bg-[#3a3a3c]" />
                  <span className="absolute -left-[2px] top-40 h-12 w-[3px] rounded-l bg-[#3a3a3c]" />
                  <span className="absolute -left-[2px] top-56 h-12 w-[3px] rounded-l bg-[#3a3a3c]" />
                  <span className="absolute -right-[2px] top-44 h-16 w-[3px] rounded-r bg-[#3a3a3c]" />

                  {/* Screen (renders the page at true iPhone width, scaled to fit) */}
                  <div
                    className="relative overflow-hidden rounded-[2.4rem] bg-white"
                    style={{ width: 280, height: 606 }}
                  >
                    {/* Dynamic Island */}
                    <div className="pointer-events-none absolute left-1/2 top-2 z-10 h-[22px] w-[84px] -translate-x-1/2 rounded-full bg-black" />
                    <iframe
                      key={`${publicUrl}#${previewNonce}`}
                      src={previewNonce ? `${publicUrl}?v=${previewNonce}` : publicUrl}
                      title="Lead Link preview"
                      loading="lazy"
                      className="origin-top-left border-0"
                      style={{ width: 390, height: 844, transform: 'scale(0.7179)' }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-gray-400">Live preview — this is exactly what brides see.</p>
          </div>
        </div>
      )}
    </div>
  );
}
