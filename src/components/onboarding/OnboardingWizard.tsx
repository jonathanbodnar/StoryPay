'use client';

/**
 * OnboardingWizard — full-screen, publish-first activation flow shown right
 * after registration. Goal: get the venue to a live, lead-generating URL in the
 * fewest steps.
 *
 *   Step 0  Connect Google      → import profile + photos + reviews
 *   Step 1  5 quick questions   → the things Google can't tell us
 *   Step 2  Review AI draft     → skim/edit; PRICING is the verify-carefully field
 *   Step 3  Publish             → live URL with copy/share
 *
 * Gated on onboarding state (shows only for unpublished, not-yet-completed
 * venues). Skip closes for the session; progress is saved every step so a
 * follow-up email can say "you're 1 step from going live".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, Link2, Check, Copy, Share2, Sparkles, Loader2, X,
  ArrowRight, ArrowLeft, MapPin, Star, PartyPopper, ImageIcon, RotateCcw,
  Mail, Send,
} from 'lucide-react';

const SKIP_KEY = 'sv_onboarding_skipped';
const BRAND = '#1b1b1b';

// Mirrors the venue-listing editor so selections carry over to the listing.
const FEATURE_OPTIONS = [
  'Ceremony site', 'Reception site', 'Bridal suite', "Groom's suite",
  'On-site parking', 'Wheelchair accessible', 'In-house catering',
  'BYO catering allowed', 'Bar service', 'Dance floor', 'Overnight accommodations',
  'Pet friendly', 'Outdoor ceremony', 'Tented options',
];
// Numeric inputs (capacity, price) store digits only but display with thousands
// separators (e.g. 10000 -> "10,000") so large numbers stay readable.
const onlyDigits = (s: string) => s.replace(/[^0-9]/g, '');
const withCommas = (s: string) => {
  const d = onlyDigits(s);
  return d ? Number(d).toLocaleString('en-US') : '';
};

const VENUE_TYPES = ['barn', 'ballroom', 'garden', 'winery', 'beach', 'estate', 'rustic', 'modern', 'historic', 'other'];
const INDOOR_OUTDOOR = ['indoor', 'outdoor', 'both'];
const SOCIAL_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'website', label: 'Website', placeholder: 'https://yourvenue.com' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/…' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/…' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@…' },
  { key: 'pinterest', label: 'Pinterest', placeholder: 'https://pinterest.com/…' },
];

type Candidate = {
  place_id: string;
  name: string;
  formatted_address: string;
  rating: number | null;
  user_ratings_total: number | null;
};

type ImportedProfile = {
  place_id: string;
  name: string;
  formatted_address: string;
  city: string | null;
  state: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  description: string | null;
  venue_type: string | null;
};

export default function OnboardingWizard() {
  const [checking, setChecking] = useState(true);
  const [complete, setComplete] = useState(false); // listing published + guide live, or onboarded
  const [open, setOpen] = useState(false);          // modal open
  const [step, setStep] = useState(0);

  // Gate on onboarding state. "Complete" = they published via the wizard, OR
  // they manually finished both the listing (is_published) and the pricing
  // guide (guide_enabled). Until then we keep a persistent launcher bubble.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Forced re-open (from the "Restart setup" button) — open immediately,
      // regardless of completion or the per-session skip flag.
      let forced = false;
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('onboarding') === '1') {
          forced = true;
          sessionStorage.removeItem(SKIP_KEY);
          params.delete('onboarding');
          const qs = params.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
        }
      } catch { /* ignore */ }

      try {
        const res = await fetch('/api/onboarding/state', { cache: 'no-store' });
        if (!res.ok) { setChecking(false); if (forced) setOpen(true); return; }
        const s = await res.json();
        if (cancelled) return;
        // Hide the wizard/pill once they've completed onboarding OR published
        // their listing manually — a live listing means they're done here.
        const isComplete = Boolean(s.completed) || Boolean(s.is_published);
        setComplete(isComplete);
        setStep(typeof s.last_step === 'number' ? Math.min(s.last_step, 3) : 0);

        if (forced) {
          setStep(0);
          setComplete(false); // override so render guard doesn't block a restarted wizard
          setOpen(true);
        } else if (!isComplete) {
          // Auto-open once per session; after that the bubble re-summons it.
          const skipped = (() => { try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } })();
          setOpen(!skipped);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Open when the in-flow launcher (top-left of content) is clicked.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('storyvenue:open-setup', onOpen);
    return () => window.removeEventListener('storyvenue:open-setup', onOpen);
  }, []);

  // Lock background scroll while the modal is open so the page (and the live
  // map behind it) doesn't scroll/shift. The dashboard scrolls on the document
  // element, so lock both <html> and <body> to be safe.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => { html.style.overflow = prevHtml; body.style.overflow = prevBody; };
  }, [open]);

  const saveStep = useCallback((n: number) => {
    void fetch('/api/onboarding/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'step', step: n }),
    }).catch(() => {});
  }, []);

  const go = useCallback((n: number) => { setStep(n); saveStep(n); }, [saveStep]);

  // Close the modal but keep the launcher bubble (until truly complete).
  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch {}
    setOpen(false);
  }, []);

  // The modal is the only thing this component renders; the persistent
  // launcher lives in <main> (OnboardingLauncher) so it aligns with the page.
  if (checking || complete || !open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center overscroll-contain bg-gray-900/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl sm:max-w-[52rem] max-h-[92vh] overflow-y-auto overscroll-contain rounded-2xl bg-white shadow-2xl">
        {step > 0 && step < 3 && (
          <button
            onClick={() => go(0)}
            className="absolute left-4 top-4 z-10 flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Start over"
          >
            <RotateCcw size={13} /> Start over
          </button>
        )}
        <button
          onClick={dismiss}
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <StepDots step={step} />

        <div className="px-6 pb-8 pt-7 sm:px-10">
          {step === 0 && <ConnectStep onNext={() => go(1)} />}
          {step === 1 && <QuestionsStep onBack={() => go(0)} onNext={() => go(2)} />}
          {step === 2 && <ReviewStep onBack={() => go(1)} onNext={() => go(3)} />}
          {step === 3 && <PublishStep onDone={() => {
            setComplete(true);
            setOpen(false);
            try { window.dispatchEvent(new CustomEvent('storyvenue:setup-complete')); } catch { /* ignore */ }
          }} />}
        </div>
      </div>
    </div>
  );
}

function StepDots({ step }: { step: number }) {
  const labels = ['Connect', 'Details', 'Review', 'Go live'];
  return (
    <div className="flex items-center justify-center gap-2 px-6 pt-7">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <div
            className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: i <= step ? `${BRAND}1a` : '#f3f4f6',
              color: i <= step ? BRAND : '#9ca3af',
            }}
          >
            {i < step ? <Check size={13} /> : <span className="font-semibold">{i + 1}</span>}
            <span className="hidden sm:inline">{l}</span>
          </div>
          {i < labels.length - 1 && <div className="h-px w-3 bg-gray-200 sm:w-5" />}
        </div>
      ))}
    </div>
  );
}

/* ── Step 0: Connect Google ─────────────────────────────────────────────── */
function ConnectStep({ onNext }: { onNext: () => void }) {
  const [mode, setMode] = useState<'search' | 'link'>('search');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const importing = importingId !== null;
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [imported, setImported] = useState<{ profile: ImportedProfile; photos: string[]; review_count: number } | null>(null);
  const reqIdRef = useRef(0);

  const looksLikeUrl = (s: string) => /https?:\/\/|maps\.|goo\.gl/i.test(s);

  // Live, debounced search-as-you-type for the "Search by name" mode. Results
  // refine the more you type. Stale responses are dropped via a request id.
  useEffect(() => {
    if (mode !== 'search') return;
    const q = input.trim();
    if (looksLikeUrl(q)) return;
    if (q.length < 3) { setCandidates([]); setError(null); setLoading(false); return; }
    const id = ++reqIdRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/listing/google-reviews/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        });
        const d = await res.json();
        if (id !== reqIdRef.current) return; // a newer keystroke superseded this
        if (!res.ok) { setError(d.error || 'Search failed.'); setCandidates([]); return; }
        setError(null);
        setCandidates(d.candidates ?? []);
      } catch {
        if (id === reqIdRef.current) setError('Something went wrong. Try again.');
      } finally {
        if (id === reqIdRef.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [input, mode]);

  // Used by the "Paste Google link" mode (explicit submit).
  const resolveLink = async () => {
    setError(null); setCandidates([]); setLoading(true);
    try {
      const res = await fetch('/api/listing/google-reviews/resolve-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not resolve that link.'); return; }
      setCandidates([d]);
    } catch { setError('Something went wrong. Try again.'); }
    finally { setLoading(false); }
  };

  const importProfile = async (placeId: string) => {
    setImportingId(placeId); setError(null);
    try {
      const res = await fetch('/api/listing/google-reviews/import-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place_id: placeId }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Import failed.'); return; }
      setImported(d);
    } catch { setError('Import failed. Try again.'); }
    finally { setImportingId(null); }
  };

  if (imported) {
    const p = imported.profile;
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: `${BRAND}1a` }}>
          <Check size={24} style={{ color: BRAND }} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Imported from Google</h2>
        <p className="mt-1 text-sm text-gray-500">We pulled your details so you don&apos;t have to.</p>

        <div className="mt-5 rounded-xl border border-gray-200 p-4 text-left">
          <p className="font-medium text-gray-900">{p.name}</p>
          {p.formatted_address && <p className="mt-0.5 flex items-center gap-1 text-sm text-gray-500"><MapPin size={13} />{p.formatted_address}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            {p.rating != null && <span className="flex items-center gap-1"><Star size={13} className="fill-amber-400 text-amber-400" />{p.rating} ({p.user_ratings_total ?? 0})</span>}
            {imported.review_count > 0 && <span>{imported.review_count} reviews imported</span>}
            <span className="flex items-center gap-1"><ImageIcon size={13} />{imported.photos.length} photos</span>
          </div>
          {imported.photos.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {imported.photos.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
              ))}
            </div>
          )}
        </div>

        <button onClick={onNext} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium text-white transition-opacity hover:opacity-90" style={{ backgroundColor: BRAND }}>
          Continue <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: `${BRAND}1a` }}>
          <Sparkles size={24} style={{ color: BRAND }} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Let&apos;s Build Your Bride Booking System&trade;</h2>
        <p className="mt-1 text-sm text-gray-500">Connect Google and we&apos;ll auto-fill your venue. Name, photos, reviews, and more.</p>
      </div>

      <div className="mt-5 flex gap-2">
        <button onClick={() => { setMode('search'); setCandidates([]); setError(null); }} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium ${mode === 'search' ? 'border-transparent text-white' : 'border-gray-200 text-gray-600'}`} style={mode === 'search' ? { backgroundColor: BRAND } : {}}>
          <Search size={14} /> Search by name
        </button>
        <button onClick={() => { setMode('link'); setCandidates([]); setError(null); }} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium ${mode === 'link' ? 'border-transparent text-white' : 'border-gray-200 text-gray-600'}`} style={mode === 'link' ? { backgroundColor: BRAND } : {}}>
          <Link2 size={14} /> Paste Google link
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          {mode === 'search' && <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && mode === 'link' && input.trim()) resolveLink(); }}
            placeholder={mode === 'search' ? 'Start typing your venue name…' : 'Paste your Google Maps link'}
            className={`w-full rounded-lg border border-gray-200 py-2.5 pr-9 text-sm outline-none focus:border-gray-400 ${mode === 'search' ? 'pl-9' : 'pl-3'}`}
          />
          {loading && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
        </div>
        {mode === 'link' && (
          <button onClick={resolveLink} disabled={loading || !input.trim()} className="rounded-lg px-4 text-sm font-medium text-white disabled:opacity-40" style={{ backgroundColor: BRAND }}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Find'}
          </button>
        )}
      </div>
      {mode === 'search' && input.trim().length >= 3 && !loading && candidates.length === 0 && !error && (
        <p className="mt-2 text-sm text-gray-400">No matches yet. Keep typing, add your city, or paste your Google link.</p>
      )}

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {candidates.length > 0 && (
        <div className="mt-4 space-y-2">
          {candidates.map((c) => (
            <button key={c.place_id} onClick={() => importProfile(c.place_id)} disabled={importing}
              className="flex w-full items-center justify-between rounded-xl border border-gray-200 p-3 text-left hover:border-gray-300 disabled:opacity-50">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{c.name}</p>
                <p className="truncate text-xs text-gray-500">{c.formatted_address}</p>
              </div>
              <div className="ml-3 flex flex-shrink-0 items-center gap-2">
                {c.rating != null && <span className="flex items-center gap-0.5 text-xs text-gray-600"><Star size={12} className="fill-amber-400 text-amber-400" />{c.rating}</span>}
                {importingId === c.place_id ? <Loader2 size={16} className="animate-spin text-gray-400" /> : <ArrowRight size={16} className="text-gray-400" />}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end">
        <button onClick={onNext} className="text-sm font-medium text-gray-500 hover:text-gray-800">Enter manually →</button>
      </div>
    </div>
  );
}

/* ── Step 1: The 5 questions ────────────────────────────────────────────── */
function QuestionsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [minGuests, setMinGuests] = useState('');
  const [maxGuests, setMaxGuests] = useState('');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [differentiators, setDifferentiators] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [venueType, setVenueType] = useState('');
  const [indoorOutdoor, setIndoorOutdoor] = useState('');
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preload anything already set on the listing so it stays in sync.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/venues/me', { cache: 'no-store' });
        if (!res.ok) return;
        const d = await res.json();
        if (Array.isArray(d.features)) setFeatures(d.features.filter((f: unknown): f is string => typeof f === 'string'));
        if (typeof d.venue_type === 'string') setVenueType(d.venue_type);
        if (typeof d.indoor_outdoor === 'string') setIndoorOutdoor(d.indoor_outdoor);
        // Capacity & price range share one source of truth with the listing.
        if (d.capacity_min != null) setMinGuests(String(d.capacity_min));
        if (d.capacity_max != null) setMaxGuests(String(d.capacity_max));
        if (d.price_min != null) setPriceFrom(String(d.price_min));
        if (d.price_max != null) setPriceTo(String(d.price_max));
        if (d.social_links && typeof d.social_links === 'object' && !Array.isArray(d.social_links)) {
          const s: Record<string, string> = {};
          for (const { key } of SOCIAL_FIELDS) {
            const v = (d.social_links as Record<string, unknown>)[key];
            if (typeof v === 'string') s[key] = v;
          }
          setSocials(s);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const toggleFeature = (f: string) =>
    setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/onboarding/draft-guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Guide labels read the upper/lower bounds…
          max_capacity: maxGuests,
          starting_price: priceFrom,
          // …and the raw range is persisted to the venue (single source of truth).
          capacity_min: minGuests,
          capacity_max: maxGuests,
          price_min: priceFrom,
          price_max: priceTo,
          differentiators,
          features,
          venue_type: venueType || undefined,
          indoor_outdoor: indoorOutdoor || undefined,
          social_links: socials,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not draft your guide.'); return; }
      onNext();
    } catch { setError('Something went wrong. Try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900">A few things Google doesn&apos;t know</h2>
      <p className="mt-1 text-sm text-gray-500">Answer these and we&apos;ll write your guide for you.</p>

      <div className="mt-5 space-y-4">
        <Field label="Guest capacity">
          <div className="grid grid-cols-2 gap-3">
            <input value={withCommas(minGuests)} onChange={(e) => setMinGuests(onlyDigits(e.target.value))} inputMode="numeric" placeholder="Min, e.g. 50" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
            <input value={withCommas(maxGuests)} onChange={(e) => setMaxGuests(onlyDigits(e.target.value))} inputMode="numeric" placeholder="Max, e.g. 200" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
          </div>
        </Field>

        <Field label="Price range (per event)">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center rounded-lg border border-gray-200 px-3 focus-within:border-gray-400">
              <span className="text-gray-400">$</span>
              <input value={withCommas(priceFrom)} onChange={(e) => setPriceFrom(onlyDigits(e.target.value))} inputMode="numeric" placeholder="From, e.g. 5,000" className="w-full bg-transparent px-2 py-2.5 text-sm outline-none" />
            </div>
            <div className="flex items-center rounded-lg border border-gray-200 px-3 focus-within:border-gray-400">
              <span className="text-gray-400">$</span>
              <input value={withCommas(priceTo)} onChange={(e) => setPriceTo(onlyDigits(e.target.value))} inputMode="numeric" placeholder="To, e.g. 12,000" className="w-full bg-transparent px-2 py-2.5 text-sm outline-none" />
            </div>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Venue type">
            <select value={venueType} onChange={(e) => setVenueType(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gray-400">
              <option value="">Select</option>
              {VENUE_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Indoor / outdoor">
            <select value={indoorOutdoor} onChange={(e) => setIndoorOutdoor(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gray-400">
              <option value="">Select</option>
              {INDOOR_OUTDOOR.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Features (select all that apply)">
          <div className="flex flex-wrap gap-2">
            {FEATURE_OPTIONS.map((f) => {
              const active = features.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFeature(f)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  style={active ? { backgroundColor: BRAND } : {}}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Describe 3–4 things that make your venue special?">
          <textarea value={differentiators} onChange={(e) => setDifferentiators(e.target.value)} rows={4} placeholder="e.g. waterfront ceremony site, on-site suites, in-house catering" className="w-full resize-y min-h-[96px] rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </Field>

        <Field label="Social & website links (optional)">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
              <input
                key={key}
                value={socials[key] ?? ''}
                onChange={(e) => setSocials((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={`${label}: ${placeholder}`}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400"
              />
            ))}
          </div>
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"><ArrowLeft size={14} /> Back</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-2 rounded-xl px-6 py-3 font-medium text-white disabled:opacity-50" style={{ backgroundColor: BRAND }}>
          {saving ? <><Loader2 size={16} className="animate-spin" /> Writing your guide…</> : <>Write my guide <Sparkles size={16} /></>}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}

/* ── Step 2: Review the draft ───────────────────────────────────────────── */
function ReviewStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [loading, setLoading] = useState(true);
  // Every field is editable so the owner can override or simply confirm.
  const [congrats, setCongrats] = useState('');
  const [about, setAbout] = useState('');
  const [price, setPrice] = useState('');
  const [pricingIntro, setPricingIntro] = useState('');
  const [availability, setAvailability] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/listing/pricing-guide', { cache: 'no-store' });
        const d = await res.json();
        const g = d.guide ?? {};
        const firstPkg = (g.packages ?? [])[0];
        // Clamp to each field's limit on load so an over-length AI draft never
        // shows a red over-limit counter or gets published past the cap.
        setCongrats((g.congratulatory_message ?? '').slice(0, 500));
        setAbout((g.about_venue ?? '').slice(0, 700));
        setPrice(firstPkg?.price_label ?? '');
        setPricingIntro((g.pricing_intro ?? '').slice(0, 400));
        setAvailability((g.availability_text ?? '').slice(0, 400));
      } catch { setError('Could not load your draft.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      // Hard-clamp to each field's limit. AI/Google-sourced drafts can exceed the
      // maxLength (which only constrains typing), so trim before publishing.
      await fetch('/api/onboarding/draft-guide', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          congratulatory_message: congrats.slice(0, 500),
          about_venue: about.slice(0, 700),
          pricing_intro: pricingIntro.slice(0, 400),
          availability_text: availability.slice(0, 400),
          price_label: price,
        }),
      });
      onNext();
    } catch { setError('Could not save. Try again.'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex h-48 items-center justify-center text-gray-400"><Loader2 size={24} className="animate-spin" /></div>;
  }

  // Block publishing while any field exceeds its limit. maxLength caps typing,
  // but AI/Google drafts loaded in can exceed it, so guard the continue button.
  const overCongrats = congrats.length > 500;
  const overAbout = about.length > 700;
  const overPricingIntro = pricingIntro.length > 400;
  const overAvailability = availability.length > 400;
  const anyOver = overCongrats || overAbout || overPricingIntro || overAvailability;

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900">This becomes the guide brides see</h2>
      <p className="mt-1 text-sm text-gray-500">We wrote it from your answers. Edit anything now or later. Just <strong>double-check your price</strong>.</p>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Welcome message</label>
          <textarea value={congrats} maxLength={500} onChange={(e) => setCongrats(e.target.value)} rows={4} className="w-full resize-y min-h-[96px] rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
          <div className={`mt-1 text-right text-xs font-mono tabular-nums ${congrats.length >= 500 ? 'text-red-500' : 'text-gray-400'}`}>{congrats.length}/500</div>
          {overCongrats && <p className="mt-1 text-xs font-medium text-red-500">Trim to 500 characters to continue.</p>}
        </div>

        {/* Most important input on the screen: the price brides see first. */}
        <div className="rounded-xl border-2 p-4 shadow-sm" style={{ borderColor: BRAND, backgroundColor: `${BRAND}0d` }}>
          <label className="mb-2 flex items-center gap-1.5 text-base font-semibold" style={{ color: BRAND }}>
            <Star size={16} /> Verify your pricing
          </label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Starting at $5,000" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base font-medium outline-none focus:border-gray-400" />
          <p className="mt-2 text-xs text-gray-500">This is what brides see first. Make sure it&apos;s accurate.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">About your venue</label>
          <textarea value={about} maxLength={700} onChange={(e) => setAbout(e.target.value)} rows={6} className="w-full resize-y min-h-[136px] rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
          <div className={`mt-1 text-right text-xs font-mono tabular-nums ${about.length >= 700 ? 'text-red-500' : 'text-gray-400'}`}>{about.length}/700</div>
          {overAbout && <p className="mt-1 text-xs font-medium text-red-500">Trim to 700 characters to continue.</p>}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Pricing intro</label>
          <textarea value={pricingIntro} maxLength={400} onChange={(e) => setPricingIntro(e.target.value)} rows={4} className="w-full resize-y min-h-[96px] rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
          <div className={`mt-1 text-right text-xs font-mono tabular-nums ${pricingIntro.length >= 400 ? 'text-red-500' : 'text-gray-400'}`}>{pricingIntro.length}/400</div>
          {overPricingIntro && <p className="mt-1 text-xs font-medium text-red-500">Trim to 400 characters to continue.</p>}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Availability</label>
          <textarea value={availability} maxLength={400} onChange={(e) => setAvailability(e.target.value)} rows={4} className="w-full resize-y min-h-[96px] rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
          <div className={`mt-1 text-right text-xs font-mono tabular-nums ${availability.length >= 400 ? 'text-red-500' : 'text-gray-400'}`}>{availability.length}/400</div>
          {overAvailability && <p className="mt-1 text-xs font-medium text-red-500">Trim to 400 characters to continue.</p>}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"><ArrowLeft size={14} /> Back</button>
        <button onClick={save} disabled={saving || anyOver} className="flex items-center gap-2 rounded-xl px-6 py-3 font-medium text-white disabled:opacity-50" style={{ backgroundColor: BRAND }}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <>Looks good <ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  );
}

/* ── Step 3: Publish ────────────────────────────────────────────────────── */
type TestLead = { id: string; name: string; email: string; phone: string | null; message: string; booking_timeline: string | null };

function PublishStep({ onDone }: { onDone: () => void }) {
  const [publishing, setPublishing] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The activation moment: fire a test lead through their own live page.
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [testLead, setTestLead] = useState<TestLead | null>(null);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testError, setTestError] = useState<string | null>(null);

  const sendTest = async () => {
    setTestStatus('sending'); setTestError(null);
    try {
      const res = await fetch('/api/onboarding/test-inquiry', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) { setTestError(d.error || 'Could not send the test inquiry. Try again.'); setTestStatus('idle'); return; }
      setTestLead(d.lead ?? null);
      setTestEmailTo(d.email_to || '');
      setTestStatus('done');
    } catch { setTestError('Something went wrong. Try again.'); setTestStatus('idle'); }
  };

  const publish = async () => {
    setPublishing(true); setError(null);
    try {
      const res = await fetch('/api/onboarding/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Publish failed.'); return; }
      setLiveUrl(d.live_url || null);
    } catch { setError('Publish failed. Try again.'); }
    finally { setPublishing(false); }
  };

  const copy = () => {
    if (!liveUrl) return;
    navigator.clipboard.writeText(liveUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const share = () => {
    if (!liveUrl) return;
    if (navigator.share) navigator.share({ title: 'My venue', url: liveUrl }).catch(() => {});
    else copy();
  };

  if (liveUrl) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: `${BRAND}1a` }}>
          <PartyPopper size={28} style={{ color: BRAND }} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">You&apos;re live!</h2>
        <p className="mt-1 text-sm text-gray-500">Your Bride Booking System is on. Add this link to your Instagram bio, TikTok bio, email signature, and website. The second a bride requests your pricing, she&apos;s in your inbox. Call her first.</p>

        {/* ── The activation moment (primary) ───────────────────────────── */}
        {testStatus === 'done' && testLead ? (
          <div className="mt-5">
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> New lead
                </span>
                <span className="text-xs text-gray-400">just now</span>
              </div>
              <p className="mt-2 font-medium text-gray-900">{testLead.name}</p>
              <p className="text-sm text-gray-500">{testLead.email}{testLead.phone ? ` · ${testLead.phone}` : ''}</p>
              <p className="mt-2 text-sm text-gray-600">&ldquo;{testLead.message}&rdquo;</p>
            </div>
            {testEmailTo && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-600">
                <Mail size={14} /> Welcome email sent to {testEmailTo}
              </p>
            )}
            <p className="mt-2 text-sm text-gray-500">That&apos;s your Bride Booking System working. Every real bride who taps your link does this automatically.</p>
          </div>
        ) : (
          <>
            <button
              onClick={sendTest}
              disabled={testStatus === 'sending'}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {testStatus === 'sending'
                ? <><Loader2 size={18} className="animate-spin" /> Sending your test inquiry…</>
                : <><Send size={18} /> Send yourself a test inquiry</>}
            </button>
            {testError && <p className="mt-2 text-sm text-red-500">{testError}</p>}
          </>
        )}

        {/* ── Share your link (secondary, below the proof) ──────────────── */}
        <div className="mt-7 border-t border-gray-100 pt-5">
          <p className="text-sm text-gray-500">Your machine is on. Now point brides at it, paste this link in your Instagram &amp; TikTok bio, your email signature, and your website.</p>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
            <span className="flex-1 truncate px-2 text-sm text-gray-700">{liveUrl}</span>
            <button onClick={copy} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ backgroundColor: BRAND }}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <a href={liveUrl} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              View my page <ArrowRight size={14} />
            </a>
            <button onClick={share} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Share2 size={14} /> Share
            </button>
          </div>
        </div>

        <button onClick={onDone} className="mt-6 text-sm text-gray-400 hover:text-gray-600">Go to my dashboard</button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: `${BRAND}1a` }}>
        <Sparkles size={24} style={{ color: BRAND }} />
      </div>
      <h2 className="text-xl font-semibold text-gray-900">One click from going live</h2>
      <p className="mt-1 text-sm text-gray-500">Publish to switch on your Bride Booking System. The second a bride requests your pricing, she&apos;s in your inbox. Call her first.</p>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <button onClick={publish} disabled={publishing} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BRAND }}>
        {publishing ? <><Loader2 size={18} className="animate-spin" /> Publishing…</> : <>Publish &amp; go live <ArrowRight size={18} /></>}
      </button>
    </div>
  );
}
