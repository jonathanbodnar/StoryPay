'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Loader2, CheckCircle2, Copy, Check, ExternalLink, Upload, Trash2, Plus,
  QrCode, Eye, EyeOff, Globe,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import { LEAD_LINK_ICON_KEYS } from '@/lib/lead-link-icons';
import { LEAD_LINK_ICON_COMPONENTS } from '@/lib/lead-link-icon-map';

// UI cap only — the server (couple-sites.ts) enforces the real limit.
const COUPLE_SITE_MAX_LINKS = 6;

type Link = { label: string; url: string; icon: string };
type Site = {
  slug: string | null;
  is_published: boolean;
  headline: string | null;
  partner_name: string | null;
  story: string | null;
  photo_url: string | null;
  cover_url: string | null;
  custom_links: Link[] | null;
  show_countdown: boolean;
  show_venue: boolean;
  show_guestbook: boolean;
  show_registry: boolean;
  guestbook_moderated: boolean;
};
type GuestbookEntry = { id: string; guest_name: string; message: string; is_hidden: boolean; created_at: string };

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200';
const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

const DEFAULT_SITE: Site = {
  slug: null, is_published: false, headline: null, partner_name: null, story: null,
  photo_url: null, cover_url: null, custom_links: [],
  show_countdown: true, show_venue: true, show_guestbook: true, show_registry: true,
  guestbook_moderated: false,
};

export default function CoupleSitePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [site, setSite] = useState<Site>(DEFAULT_SITE);
  const [profile, setProfile] = useState<{ first_name?: string | null; display_name?: string | null; wedding_date?: string | null } | null>(null);
  const [hasVenue, setHasVenue] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://storyvenue.com');

  // slug availability
  const [slugInput, setSlugInput] = useState('');
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');

  // QR
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  // guestbook
  const [gb, setGb] = useState<GuestbookEntry[]>([]);

  const publicUrl = site.slug ? `${baseUrl}/${site.slug}` : '';

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/couple/login'); return; }

    const res = await coupleAuthedFetch('/api/couple/site');
    if (res.status === 401) { router.replace('/couple/login'); return; }
    const data = await res.json().catch(() => ({}));
    if (data.site) setSite({ ...DEFAULT_SITE, ...data.site, custom_links: data.site.custom_links ?? [] });
    if (data.profile) setProfile(data.profile);
    setHasVenue(Boolean(data.hasVenue));
    if (typeof data.publicBaseUrl === 'string') setBaseUrl(data.publicBaseUrl.replace(/\/$/, ''));
    if (data.site?.slug) setSlugInput(data.site.slug);
    setLoading(false);

    const gbRes = await coupleAuthedFetch('/api/couple/site/guestbook');
    const gbData = await gbRes.json().catch(() => ({}));
    if (Array.isArray(gbData.entries)) setGb(gbData.entries);
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  function set<K extends keyof Site>(key: K, value: Site[K]) {
    setSite((prev) => ({ ...prev, [key]: value }));
  }

  // ── slug availability (debounced) ──────────────────────────────────────
  useEffect(() => {
    const raw = slugInput.trim();
    if (!raw || raw === site.slug) { setSlugState('idle'); return; }
    setSlugState('checking');
    const t = setTimeout(async () => {
      const res = await coupleAuthedFetch(`/api/couple/site/slug-check?slug=${encodeURIComponent(raw)}`);
      const data = await res.json().catch(() => ({}));
      if (!data.ok) setSlugState('invalid');
      else setSlugState(data.available ? 'ok' : 'taken');
    }, 450);
    return () => clearTimeout(t);
  }, [slugInput, site.slug]);

  async function uploadImage(field: 'photo_url' | 'cover_url', file: File) {
    setError('');
    try {
      const signRes = await coupleAuthedFetch('/api/couple/site/image', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
      });
      const sign = await signRes.json().catch(() => ({}));
      if (!signRes.ok) { setError(sign.error ?? 'Upload failed'); return; }
      const put = await fetch(sign.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) { setError('Upload failed'); return; }
      set(field, sign.publicUrl);
    } catch {
      setError('Upload failed');
    }
  }

  function buildPayload(overrides: Partial<Site> = {}): Partial<Site> {
    const merged = { ...site, ...overrides };
    return {
      slug: (slugInput.trim() || null) as string | null,
      headline: merged.headline,
      partner_name: merged.partner_name,
      story: merged.story,
      photo_url: merged.photo_url,
      cover_url: merged.cover_url,
      custom_links: merged.custom_links ?? [],
      show_countdown: merged.show_countdown,
      show_venue: merged.show_venue,
      show_guestbook: merged.show_guestbook,
      show_registry: merged.show_registry,
      guestbook_moderated: merged.guestbook_moderated,
    };
  }

  async function save(overrides: Partial<Site> = {}) {
    setError(''); setFlash(''); setSaving(true);
    try {
      const res = await coupleAuthedFetch('/api/couple/site', {
        method: 'PUT',
        body: JSON.stringify(buildPayload(overrides)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? 'Save failed'); return false; }
      if (data.site) { setSite({ ...DEFAULT_SITE, ...data.site, custom_links: data.site.custom_links ?? [] }); if (data.site.slug) setSlugInput(data.site.slug); }
      setFlash('Saved.');
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    setError(''); setPublishing(true);
    try {
      const res = await coupleAuthedFetch('/api/couple/site', {
        method: 'PUT',
        body: JSON.stringify({ ...buildPayload(), is_published: !site.is_published }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? 'Could not update'); return; }
      if (data.site) setSite({ ...DEFAULT_SITE, ...data.site, custom_links: data.site.custom_links ?? [] });
      setFlash(data.site?.is_published ? 'Your site is live!' : 'Your site is now private.');
    } finally {
      setPublishing(false);
    }
  }

  async function generateQr() {
    if (!publicUrl) return;
    const QRCode = (await import('qrcode')).default;
    const url = await QRCode.toDataURL(publicUrl, { width: 400, margin: 2, color: { dark: '#111827', light: '#ffffff' } });
    setQr(url);
  }

  function copyUrl() {
    if (!publicUrl) return;
    void navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // ── custom links ───────────────────────────────────────────────────────
  const links = site.custom_links ?? [];
  function updateLink(i: number, patch: Partial<Link>) {
    const next = links.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    set('custom_links', next);
  }
  function addLink() {
    if (links.length >= COUPLE_SITE_MAX_LINKS) return;
    set('custom_links', [...links, { label: '', url: '', icon: 'link' }]);
  }
  function removeLink(i: number) {
    set('custom_links', links.filter((_, idx) => idx !== i));
  }

  async function moderate(id: string, is_hidden: boolean) {
    const res = await coupleAuthedFetch(`/api/couple/site/guestbook/${id}`, {
      method: 'PATCH', body: JSON.stringify({ is_hidden }),
    });
    if (res.ok) setGb((prev) => prev.map((e) => (e.id === id ? { ...e, is_hidden } : e)));
  }
  async function removeEntry(id: string) {
    const res = await coupleAuthedFetch(`/api/couple/site/guestbook/${id}`, { method: 'DELETE' });
    if (res.ok) setGb((prev) => prev.filter((e) => e.id !== id));
  }

  if (loading) {
    return <div className="flex justify-center py-20 text-gray-400"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  const coupleName = [profile?.first_name || profile?.display_name, site.partner_name].filter(Boolean).join(' & ') || 'Your names';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Your wedding website</h1>
        <p className="mt-1 text-sm text-gray-500">
          A simple, beautiful page to share your day — countdown, links, RSVP and a guestbook. One link for everything.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {flash && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={14} /> {flash}
        </div>
      )}

      {/* Publish + URL + QR */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{site.is_published ? 'Live' : 'Not published'}</p>
            <p className="text-xs text-gray-500">
              {site.is_published ? 'Anyone with your link can view it.' : 'Only you can see it until you publish.'}
            </p>
          </div>
          <button
            onClick={() => void togglePublish()}
            disabled={publishing}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-60 ${site.is_published ? 'bg-gray-700 hover:opacity-85' : 'bg-[#1b1b1b] hover:opacity-85'}`}
          >
            {publishing ? <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> : null}
            {site.is_published ? 'Unpublish' : 'Publish'}
          </button>
        </div>

        {site.slug && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 hover:bg-gray-100">
              <Globe size={14} /> {publicUrl} <ExternalLink size={13} className="text-gray-400" />
            </a>
            <button onClick={copyUrl} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              {copied ? <><Check size={14} className="text-emerald-600" /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
            <button onClick={() => void generateQr()} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <QrCode size={14} /> QR code
            </button>
          </div>
        )}
        {qr && (
          <div className="mt-4">
            <Image src={qr} alt="QR code" width={140} height={140} unoptimized className="rounded-xl border border-gray-100" />
          </div>
        )}
      </div>

      {/* Basics */}
      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-gray-900">The basics</h2>

        <div>
          <label className={LABEL}>Your link (storyvenue.com/…)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">{baseUrl.replace(/^https?:\/\//, '')}/</span>
            <input
              className={INPUT}
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              placeholder="jenny-and-mike"
            />
          </div>
          <p className="mt-1 text-[11px] h-4">
            {slugState === 'checking' && <span className="text-gray-400">Checking…</span>}
            {slugState === 'ok' && <span className="text-emerald-600">Available</span>}
            {slugState === 'taken' && <span className="text-red-600">Already taken — try another</span>}
            {slugState === 'invalid' && <span className="text-red-600">Use at least 3 letters/numbers; avoid reserved words</span>}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Your name</label>
            <input className={INPUT} value={profile?.first_name || profile?.display_name || ''} disabled placeholder="From your profile" />
            <p className="mt-1 text-[11px] text-gray-400">Set on your profile.</p>
          </div>
          <div>
            <label className={LABEL}>Partner&rsquo;s name</label>
            <input className={INPUT} value={site.partner_name ?? ''} onChange={(e) => set('partner_name', e.target.value || null)} placeholder="Mike" />
          </div>
        </div>

        <div>
          <label className={LABEL}>Headline</label>
          <input className={INPUT} value={site.headline ?? ''} onChange={(e) => set('headline', e.target.value || null)} placeholder="We're getting married!" />
        </div>

        <div>
          <label className={LABEL}>Your story</label>
          <textarea className={`${INPUT} min-h-[110px]`} value={site.story ?? ''} onChange={(e) => set('story', e.target.value || null)} placeholder="Tell your guests how you met, what to expect, or anything you'd like them to know." />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ImageField label="Main photo" value={site.photo_url} onPick={(f) => void uploadImage('photo_url', f)} onClear={() => set('photo_url', null)} rounded />
          <ImageField label="Cover / banner (optional)" value={site.cover_url} onPick={(f) => void uploadImage('cover_url', f)} onClear={() => set('cover_url', null)} />
        </div>
      </section>

      {/* Links */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Links</h2>
          <span className="text-xs text-gray-400">{links.length}/{COUPLE_SITE_MAX_LINKS}</span>
        </div>
        <p className="text-xs text-gray-500 -mt-1">Registry, hotel block, travel, livestream, schedule — anything. These open in a new tab.</p>
        {links.map((l, i) => {
          const Icon = LEAD_LINK_ICON_COMPONENTS[(l.icon as keyof typeof LEAD_LINK_ICON_COMPONENTS)] ?? LEAD_LINK_ICON_COMPONENTS.link;
          return (
            <div key={i} className="rounded-2xl border border-gray-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gray-100 text-gray-600"><Icon size={16} /></div>
                <input className={INPUT} value={l.label} onChange={(e) => updateLink(i, { label: e.target.value })} placeholder="Label (e.g. Our Registry)" />
                <button onClick={() => removeLink(i)} className="flex-none rounded-xl border border-gray-200 p-2 text-gray-400 hover:text-red-600 hover:border-red-200"><Trash2 size={16} /></button>
              </div>
              <input className={`${INPUT} mt-2`} value={l.url} onChange={(e) => updateLink(i, { url: e.target.value })} placeholder="https://" />
              <div className="mt-2 flex flex-wrap gap-1 max-h-24 overflow-y-auto rounded-xl border border-gray-100 p-2">
                {LEAD_LINK_ICON_KEYS.map((key) => {
                  const K = LEAD_LINK_ICON_COMPONENTS[key];
                  return (
                    <button
                      key={key}
                      onClick={() => updateLink(i, { icon: key })}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${l.icon === key ? 'bg-[#1b1b1b] text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                      title={key}
                      type="button"
                    >
                      <K size={15} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {links.length < COUPLE_SITE_MAX_LINKS && (
          <button onClick={addLink} className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
            <Plus size={15} /> Add link
          </button>
        )}
      </section>

      {/* Sections */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Show on your page</h2>
        <Toggle label="Countdown to your day" checked={site.show_countdown} onChange={(v) => set('show_countdown', v)} />
        {hasVenue && <Toggle label="Your venue" checked={site.show_venue} onChange={(v) => set('show_venue', v)} />}
        <Toggle label="Guestbook (well-wishes from guests)" checked={site.show_guestbook} onChange={(v) => set('show_guestbook', v)} />
        {site.show_guestbook && (
          <Toggle label="Review guestbook posts before they show" checked={site.guestbook_moderated} onChange={(v) => set('guestbook_moderated', v)} indent />
        )}
      </section>

      {/* Guestbook moderation */}
      {gb.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Guestbook messages</h2>
          <div className="space-y-2">
            {gb.map((e) => (
              <div key={e.id} className={`rounded-2xl border p-3 ${e.is_hidden ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{e.guest_name}{e.is_hidden && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">Hidden</span>}</p>
                    <p className="text-sm text-gray-600">{e.message}</p>
                  </div>
                  <div className="flex flex-none gap-1">
                    <button onClick={() => void moderate(e.id, !e.is_hidden)} title={e.is_hidden ? 'Show' : 'Hide'} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100">
                      {e.is_hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button onClick={() => void removeEntry(e.id)} title="Delete" className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:text-red-600 hover:border-red-200">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Save bar */}
      <div className="sticky bottom-4 flex justify-end">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white shadow-lg hover:opacity-85 transition-opacity disabled:opacity-60"
        >
          {saving ? <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> : null} Save changes
        </button>
      </div>

      <p className="pb-6 text-center text-xs text-gray-400">Previewing as {coupleName}</p>
    </div>
  );
}

function Toggle({ label, checked, onChange, indent }: { label: string; checked: boolean; onChange: (v: boolean) => void; indent?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 ${indent ? 'ml-4' : ''}`}>
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-none rounded-full transition-colors ${checked ? 'bg-[#1b1b1b]' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

function ImageField({ label, value, onPick, onClear, rounded }: { label: string; value: string | null; onPick: (f: File) => void; onClear: () => void; rounded?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          <Image src={value} alt="" width={64} height={64} unoptimized className={`h-16 w-16 flex-none object-cover ${rounded ? 'rounded-full' : 'rounded-xl'}`} />
        ) : (
          <div className={`flex h-16 w-16 flex-none items-center justify-center bg-gray-100 text-gray-300 ${rounded ? 'rounded-full' : 'rounded-xl'}`}><Upload size={18} /></div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => ref.current?.click()} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Upload</button>
          {value && <button type="button" onClick={onClear} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-400 hover:text-red-600 hover:border-red-200">Remove</button>}
        </div>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}
