'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Loader2, CheckCircle2, Copy, Check, ExternalLink, Upload, Trash2, Plus,
  QrCode, Eye, EyeOff, Globe, Lock, Video, Bold, AlignLeft, AlignCenter, AlignRight,
  GripVertical, ChevronDown, Clock, Type, Images, Link2, MapPin,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import { LEAD_LINK_ICON_KEYS } from '@/lib/lead-link-icons';
import { LEAD_LINK_ICON_COMPONENTS } from '@/lib/lead-link-icon-map';

// UI cap only — the server (couple-sites.ts) enforces the real limit.
const COUPLE_SITE_MAX_LINKS = 6;
const MAX_GALLERY = 9;

// Reorderable public-page blocks (kept in sync with couple-sites.ts server-side).
const SECTION_KEYS = ['countdown', 'story', 'gallery', 'links', 'embed'] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
const DEFAULT_ORDER: SectionKey[] = [...SECTION_KEYS];

function sanitizeOrder(raw: unknown): SectionKey[] {
  const known = new Set<string>(SECTION_KEYS);
  const seen = new Set<string>();
  const out: SectionKey[] = [];
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (typeof k === 'string' && known.has(k) && !seen.has(k)) { seen.add(k); out.push(k as SectionKey); }
    }
  }
  for (const k of DEFAULT_ORDER) if (!seen.has(k)) out.push(k);
  return out;
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function plainToHtml(s: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
function htmlToPreview(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

type Link = { label: string; url: string; icon: string };
type Site = {
  slug: string | null;
  is_published: boolean;
  headline: string | null;
  partner_name: string | null;
  story: string | null;
  story_html: string | null;
  photo_url: string | null;
  cover_url: string | null;
  custom_links: Link[] | null;
  gallery: string[] | null;
  embed_html: string | null;
  embed_enabled: boolean;
  embed_title: string | null;
  section_order: string[] | null;
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
  slug: null, is_published: false, headline: null, partner_name: null, story: null, story_html: null,
  photo_url: null, cover_url: null, custom_links: [], gallery: [],
  embed_html: null, embed_enabled: false, embed_title: null, section_order: DEFAULT_ORDER,
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
  const [profile, setProfile] = useState<{ first_name?: string | null; display_name?: string | null; partner_first_name?: string | null; wedding_date?: string | null } | null>(null);
  const [hasVenue, setHasVenue] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://storyvenue.com');

  // Section order + accordion open/close + drag state
  const [order, setOrder] = useState<SectionKey[]>(DEFAULT_ORDER);
  const [openKey, setOpenKey] = useState<SectionKey | null>(null);
  const [dragKey, setDragKey] = useState<SectionKey | null>(null);
  const [galleryDrag, setGalleryDrag] = useState<number | null>(null);
  const [linkDrag, setLinkDrag] = useState<number | null>(null);

  // Story editor seed (set once from loaded data)
  const [storySeed, setStorySeed] = useState('');

  // Private password gate
  const [hasPassword, setHasPassword] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwFlash, setPwFlash] = useState('');

  // slug availability
  const [slugInput, setSlugInput] = useState('');
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');

  // QR
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);

  // guestbook + gallery upload
  const [gb, setGb] = useState<GuestbookEntry[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);

  const publicUrl = site.slug ? `${baseUrl}/${site.slug}` : '';

  const applySite = useCallback((incoming: Record<string, unknown>) => {
    setSite({
      ...DEFAULT_SITE,
      ...(incoming as Partial<Site>),
      custom_links: (incoming.custom_links as Link[]) ?? [],
      gallery: (incoming.gallery as string[]) ?? [],
    });
    setOrder(sanitizeOrder(incoming.section_order));
  }, []);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/couple/login'); return; }

    const res = await coupleAuthedFetch('/api/couple/site');
    if (res.status === 401) { router.replace('/couple/login'); return; }
    const data = await res.json().catch(() => ({}));
    if (data.site) {
      applySite(data.site);
      const seed = (data.site.story_html as string) || (data.site.story ? plainToHtml(data.site.story as string) : '');
      setStorySeed(seed);
      if (data.site.slug) setSlugInput(data.site.slug);
    }
    if (data.profile) setProfile(data.profile);
    setHasVenue(Boolean(data.hasVenue));
    setHasPassword(Boolean(data.hasPassword));
    if (typeof data.publicBaseUrl === 'string') setBaseUrl(data.publicBaseUrl.replace(/\/$/, ''));
    setLoading(false);

    const gbRes = await coupleAuthedFetch('/api/couple/site/guestbook');
    const gbData = await gbRes.json().catch(() => ({}));
    if (Array.isArray(gbData.entries)) setGb(gbData.entries);
  }, [router, applySite]);

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
    const url = await uploadOne(file);
    if (url) set(field, url);
  }

  async function uploadOne(file: File): Promise<string | null> {
    const signRes = await coupleAuthedFetch('/api/couple/site/image', {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
    });
    const sign = await signRes.json().catch(() => ({}));
    if (!signRes.ok) { setError(sign.error ?? 'Upload failed'); return null; }
    const put = await fetch(sign.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!put.ok) { setError('Upload failed'); return null; }
    return sign.publicUrl as string;
  }

  async function addGalleryFiles(files: FileList) {
    setError('');
    setGalleryBusy(true);
    try {
      for (const file of Array.from(files)) {
        if ((site.gallery ?? []).length >= MAX_GALLERY) break;
        const url = await uploadOne(file);
        if (url) setSite((prev) => ({ ...prev, gallery: [...(prev.gallery ?? []), url].slice(0, MAX_GALLERY) }));
      }
    } finally {
      setGalleryBusy(false);
    }
  }

  function removeGalleryImage(i: number) {
    set('gallery', (site.gallery ?? []).filter((_, idx) => idx !== i));
  }

  function reorderGallery(to: number) {
    if (galleryDrag === null || galleryDrag === to) return;
    set('gallery', arrayMove(site.gallery ?? [], galleryDrag, to));
    setGalleryDrag(null);
  }

  async function savePassword(value: string | null) {
    setPwFlash(''); setError(''); setPwSaving(true);
    try {
      const res = await coupleAuthedFetch('/api/couple/site', {
        method: 'PUT',
        body: JSON.stringify({ site_password: value ?? '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? 'Could not update password'); return; }
      setHasPassword(Boolean(data.hasPassword));
      setPwInput('');
      setPwFlash(value ? 'Password set — your page is now private.' : 'Password removed — your page is public again.');
    } finally {
      setPwSaving(false);
    }
  }

  function buildPayload(overrides: Partial<Site> = {}): Partial<Site> {
    const merged = { ...site, ...overrides };
    return {
      slug: (slugInput.trim() || null) as string | null,
      headline: merged.headline,
      partner_name: merged.partner_name,
      story_html: merged.story_html,
      photo_url: merged.photo_url,
      cover_url: merged.cover_url,
      custom_links: merged.custom_links ?? [],
      gallery: merged.gallery ?? [],
      embed_html: merged.embed_html,
      embed_enabled: merged.embed_enabled,
      embed_title: merged.embed_title,
      section_order: order,
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
      if (data.site) { applySite(data.site); if (data.site.slug) setSlugInput(data.site.slug); }
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
      if (data.site) applySite(data.site);
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
    set('custom_links', links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLink() {
    if (links.length >= COUPLE_SITE_MAX_LINKS) return;
    set('custom_links', [...links, { label: '', url: '', icon: 'link' }]);
  }
  function removeLink(i: number) {
    set('custom_links', links.filter((_, idx) => idx !== i));
  }
  function reorderLink(to: number) {
    if (linkDrag === null || linkDrag === to) return;
    set('custom_links', arrayMove(links, linkDrag, to));
    setLinkDrag(null);
  }

  // ── section drag/drop ────────────────────────────────────────────────────
  function reorderSection(target: SectionKey) {
    if (!dragKey || dragKey === target) { setDragKey(null); return; }
    const from = order.indexOf(dragKey);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) { setDragKey(null); return; }
    setOrder(arrayMove(order, from, to));
    setDragKey(null);
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

  const coupleName = [profile?.first_name || profile?.display_name, profile?.partner_first_name || site.partner_name].filter(Boolean).join(' & ') || 'Your names';

  const sectionMeta: Record<SectionKey, { title: string; icon: React.ReactNode; summary: string }> = {
    countdown: { title: 'Countdown', icon: <Clock size={16} />, summary: site.show_countdown ? 'Shown' : 'Hidden' },
    story: { title: 'Your story', icon: <Type size={16} />, summary: htmlToPreview(site.story_html || storySeed).slice(0, 60) || 'Not added yet' },
    gallery: { title: 'Photo gallery', icon: <Images size={16} />, summary: `${(site.gallery ?? []).length} photo${(site.gallery ?? []).length === 1 ? '' : 's'}` },
    links: { title: 'Links', icon: <Link2 size={16} />, summary: `${hasVenue && site.show_venue ? 'Venue + ' : ''}${links.length} link${links.length === 1 ? '' : 's'}` },
    embed: { title: 'Livestream / embed', icon: <Video size={16} />, summary: site.embed_enabled ? (site.embed_title || 'On') : 'Off' },
  };

  function renderSectionBody(key: SectionKey) {
    switch (key) {
      case 'countdown':
        return (
          <div className="space-y-2">
            <Toggle label="Show a live countdown to your day" checked={site.show_countdown} onChange={(v) => set('show_countdown', v)} />
            <p className="text-xs text-gray-400">Uses your wedding date from your profile{profile?.wedding_date ? '' : ' — add one to show the countdown'}.</p>
          </div>
        );
      case 'story':
        return (
          <StoryEditor
            seed={storySeed}
            onChange={(html) => set('story_html', html)}
          />
        );
      case 'gallery':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Drag to reorder — the first photos lead your gallery.</p>
              <span className="text-xs text-gray-400">{(site.gallery ?? []).length}/{MAX_GALLERY}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {(site.gallery ?? []).map((url, i) => (
                <div
                  key={`${url}-${i}`}
                  draggable
                  onDragStart={() => setGalleryDrag(i)}
                  onDragEnd={() => setGalleryDrag(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => reorderGallery(i)}
                  className={`group relative aspect-square cursor-grab overflow-hidden rounded-xl border bg-gray-50 active:cursor-grabbing ${galleryDrag === i ? 'border-gray-900 opacity-60' : 'border-gray-200'}`}
                >
                  <Image src={url} alt={`Photo ${i + 1}`} fill unoptimized sizes="180px" className="object-cover" />
                  <button
                    type="button"
                    onClick={() => removeGalleryImage(i)}
                    className="absolute right-1.5 top-1.5 rounded-lg bg-black/55 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                    title="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {(site.gallery ?? []).length < MAX_GALLERY && (
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  disabled={galleryBusy}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 bg-white text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-600 disabled:opacity-60"
                >
                  {galleryBusy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                  <span className="text-[11px] font-medium">{galleryBusy ? 'Uploading…' : 'Add photos'}</span>
                </button>
              )}
            </div>
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => { const fs = e.target.files; if (fs && fs.length) void addGalleryFiles(fs); e.currentTarget.value = ''; }}
            />
          </div>
        );
      case 'links':
        return (
          <div className="space-y-3">
            {hasVenue && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#1b1b1b] text-white"><MapPin size={16} /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">Our Venue</p>
                      <p className="text-[11px] text-gray-500">Always shown first · name &amp; address from your venue · taps open Google Maps.</p>
                    </div>
                  </div>
                  <Toggle label="" checked={site.show_venue} onChange={(v) => set('show_venue', v)} />
                </div>
              </div>
            )}

            <p className="text-xs text-gray-500">Registry, hotel block, travel, schedule — anything. Drag to reorder.</p>
            {links.map((l, i) => {
              const Icon = LEAD_LINK_ICON_COMPONENTS[(l.icon as keyof typeof LEAD_LINK_ICON_COMPONENTS)] ?? LEAD_LINK_ICON_COMPONENTS.link;
              return (
                <div
                  key={i}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => reorderLink(i)}
                  className={`rounded-2xl border bg-white p-3 ${linkDrag === i ? 'border-gray-900 opacity-70' : 'border-gray-200'}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setLinkDrag(i)}
                      onDragEnd={() => setLinkDrag(null)}
                      className="flex-none cursor-grab rounded-lg p-1 text-gray-300 hover:text-gray-500 active:cursor-grabbing"
                      title="Drag to reorder"
                    >
                      <GripVertical size={16} />
                    </button>
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gray-100 text-gray-600"><Icon size={16} /></div>
                    <input className={INPUT} value={l.label} onChange={(e) => updateLink(i, { label: e.target.value })} placeholder="Label (e.g. Our Registry)" />
                    <button onClick={() => removeLink(i)} className="flex-none rounded-xl border border-gray-200 p-2 text-gray-400 hover:border-red-200 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                  <input className={`${INPUT} mt-2`} value={l.url} onChange={(e) => updateLink(i, { url: e.target.value })} placeholder="https://" />
                  <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-xl border border-gray-100 p-2">
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
          </div>
        );
      case 'embed':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Paste an embed from YouTube, Vimeo, Zoom, StreamYard, and more. We keep only the safe player, so scripts can never run on your page.
            </p>
            <div>
              <label className={LABEL}>Section title (optional)</label>
              <input className={INPUT} value={site.embed_title ?? ''} onChange={(e) => set('embed_title', e.target.value || null)} placeholder="Watch our livestream" />
            </div>
            <div>
              <label className={LABEL}>Embed code</label>
              <textarea
                className={`${INPUT} min-h-[90px] font-mono text-xs`}
                value={site.embed_html ?? ''}
                onChange={(e) => set('embed_html', e.target.value || null)}
                placeholder='<iframe src="https://..." allowfullscreen></iframe>'
              />
            </div>
            <Toggle label="Show the livestream / embed on my page" checked={site.embed_enabled} onChange={(v) => set('embed_enabled', v)} />
          </div>
        );
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Your wedding website</h1>
        <p className="mt-1 text-sm text-gray-500">
          Build your page block by block. Drag the <GripVertical size={13} className="inline align-[-2px] text-gray-400" /> handles to reorder, tap a section to edit, then Save.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {flash && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
            {publishing ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
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

      {/* Private password */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Lock size={16} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Private password</h2>
          {hasPassword && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              <Check size={12} /> On
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Optional. Share your wedding details only with your guests — visitors must enter this password before your page shows anything.
        </p>
        {pwFlash && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 size={14} /> {pwFlash}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            className={`${INPUT} max-w-xs`}
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder={hasPassword ? 'Enter a new password' : 'Choose a password'}
          />
          <button
            type="button"
            onClick={() => void savePassword(pwInput)}
            disabled={pwSaving || pwInput.trim().length < 3}
            className="rounded-2xl bg-[#1b1b1b] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
          >
            {pwSaving ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null} {hasPassword ? 'Update' : 'Set password'}
          </button>
          {hasPassword && (
            <button
              type="button"
              onClick={() => void savePassword(null)}
              disabled={pwSaving}
              className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Basics */}
      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-gray-900">The basics</h2>

        <div>
          <label className={LABEL}>Your link (storyvenue.com/…)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">{baseUrl.replace(/^https?:\/\//, '')}/</span>
            <input className={INPUT} value={slugInput} onChange={(e) => setSlugInput(e.target.value)} placeholder="jenny-and-mike" />
          </div>
          <p className="mt-1 h-4 text-[11px]">
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
            <input className={INPUT} value={profile?.partner_first_name || site.partner_name || ''} disabled placeholder="From your profile" />
            <p className="mt-1 text-[11px] text-gray-400">Set on your profile.</p>
          </div>
        </div>

        <div>
          <label className={LABEL}>Headline</label>
          <input className={INPUT} value={site.headline ?? ''} onChange={(e) => set('headline', e.target.value || null)} placeholder="We're getting married!" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ImageField label="Main photo" value={site.photo_url} onPick={(f) => void uploadImage('photo_url', f)} onClear={() => set('photo_url', null)} rounded />
        </div>

        <CoverField value={site.cover_url} onPick={(f) => void uploadImage('cover_url', f)} onClear={() => set('cover_url', null)} />
      </section>

      {/* Reorderable page blocks */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Your page sections</h2>
        <div className="space-y-2">
          {order.map((key) => {
            const meta = sectionMeta[key];
            const isOpen = openKey === key;
            return (
              <div
                key={key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => reorderSection(key)}
                className={`rounded-2xl border bg-white transition-shadow ${dragKey === key ? 'border-gray-900 opacity-70' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-1 p-2">
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragKey(key)}
                    onDragEnd={() => setDragKey(null)}
                    className="flex-none cursor-grab rounded-lg p-1.5 text-gray-300 hover:text-gray-500 active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? null : key)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-gray-50"
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-600">{meta.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900">{meta.title}</span>
                      <span className="block truncate text-xs text-gray-400">{meta.summary}</span>
                    </span>
                    <ChevronDown size={16} className={`flex-none text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                {isOpen && <div className="border-t border-gray-100 p-4">{renderSectionBody(key)}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Guestbook */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Guestbook</h2>
        <Toggle label="Guestbook (well-wishes from guests)" checked={site.show_guestbook} onChange={(v) => set('show_guestbook', v)} />
        {site.show_guestbook && (
          <Toggle label="Review guestbook posts before they show" checked={site.guestbook_moderated} onChange={(v) => set('guestbook_moderated', v)} indent />
        )}
        {gb.length > 0 && (
          <div className="space-y-2 pt-1">
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
                    <button onClick={() => void removeEntry(e.id)} title="Delete" className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:border-red-200 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 flex justify-end">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white shadow-lg transition-opacity hover:opacity-85 disabled:opacity-60"
        >
          {saving ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null} Save changes
        </button>
      </div>

      <p className="pb-6 text-center text-xs text-gray-400">Previewing as {coupleName}</p>
    </div>
  );
}

function StoryEditor({ seed, onChange }: { seed: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (ref.current && !seeded.current) {
      ref.current.innerHTML = seed || '';
      seeded.current = true;
    }
  }, [seed]);

  function emit() {
    const html = ref.current?.innerHTML ?? '';
    onChange(html === '<br>' ? '' : html);
  }
  function cmd(command: string, arg?: string) {
    ref.current?.focus();
    try {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(command, false, arg);
    } catch { /* execCommand unsupported — no-op */ }
    emit();
  }

  const btn = 'flex h-8 min-w-[2rem] items-center justify-center rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-100';
  const sizes: { label: string; val: string }[] = [
    { label: 'S', val: '2' }, { label: 'M', val: '3' }, { label: 'L', val: '5' }, { label: 'XL', val: '6' },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <style>{`.story-ce:empty:before{content:attr(data-placeholder);color:#9ca3af}`}</style>
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 p-1.5">
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')} title="Bold"><Bold size={15} /></button>
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Size</span>
        {sizes.map((s) => (
          <button key={s.val} type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('fontSize', s.val)} title={`Size ${s.label}`}>{s.label}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('justifyLeft')} title="Align left"><AlignLeft size={15} /></button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('justifyCenter')} title="Center"><AlignCenter size={15} /></button>
        <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('justifyRight')} title="Align right"><AlignRight size={15} /></button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder="Tell your guests how you met, what to expect, or anything you'd like them to know."
        className="story-ce min-h-[150px] px-3 py-2.5 text-left text-sm leading-relaxed text-gray-900 focus:outline-none [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange, indent }: { label: string; checked: boolean; onChange: (v: boolean) => void; indent?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-4 ${label ? 'rounded-2xl border border-gray-200 bg-white px-4 py-3' : ''} ${indent ? 'ml-4' : ''}`}>
      {label && <span className="text-sm text-gray-700">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-1 ${checked ? 'bg-[#1b1b1b]' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
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
          {value && <button type="button" onClick={onClear} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-400 hover:border-red-200 hover:text-red-600">Remove</button>}
        </div>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ''; }} />
      </div>
    </div>
  );
}

function CoverField({ value, onPick, onClear }: { value: string | null; onPick: (f: File) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label className={LABEL}>Cover / banner (optional)</label>
      <div
        onClick={() => ref.current?.click()}
        className="relative flex h-36 w-full cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-gray-50 hover:border-gray-400"
      >
        {value ? (
          <Image src={value} alt="Cover" fill unoptimized sizes="600px" className="object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400">
            <Upload size={20} />
            <span className="text-xs font-medium">Upload a wide banner photo</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => ref.current?.click()} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">{value ? 'Replace' : 'Upload'}</button>
        {value && <button type="button" onClick={onClear} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-400 hover:border-red-200 hover:text-red-600">Remove</button>}
      </div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ''; }} />
    </div>
  );
}
