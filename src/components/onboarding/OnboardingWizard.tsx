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

import { useCallback, useEffect, useState } from 'react';
import {
  Search, Link2, Check, Copy, Share2, Sparkles, Loader2, X,
  ArrowRight, ArrowLeft, MapPin, Star, PartyPopper, ImageIcon, RotateCcw,
} from 'lucide-react';

const SKIP_KEY = 'sv_onboarding_skipped';
const BRAND = '#1b1b1b';

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

type Draft = {
  congratulatory_message: string;
  about_venue: string;
  pricing_intro: string;
  availability_text: string;
  cta_headline: string;
  cta_body: string;
  cta_button_label: string;
  price_label: string;
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
        const isComplete = Boolean(s.completed) || (Boolean(s.is_published) && Boolean(s.guide_enabled));
        setComplete(isComplete);
        setStep(typeof s.last_step === 'number' ? Math.min(s.last_step, 3) : 0);

        if (forced) {
          setStep(0);
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
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

        <div className="px-6 pb-8 pt-2 sm:px-10">
          {step === 0 && <ConnectStep onNext={() => go(1)} onSkip={dismiss} />}
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
function ConnectStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [mode, setMode] = useState<'search' | 'link'>('search');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [imported, setImported] = useState<{ profile: ImportedProfile; photos: string[]; review_count: number } | null>(null);

  const find = async () => {
    setError(null); setCandidates([]); setLoading(true);
    try {
      const looksLikeUrl = /https?:\/\/|maps\.|goo\.gl/i.test(input);
      if (mode === 'link' || looksLikeUrl) {
        const res = await fetch('/api/listing/google-reviews/resolve-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: input }),
        });
        const d = await res.json();
        if (!res.ok) { setError(d.error || 'Could not resolve that link.'); return; }
        setCandidates([d]);
      } else {
        const res = await fetch('/api/listing/google-reviews/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: input }),
        });
        const d = await res.json();
        if (!res.ok) { setError(d.error || 'Search failed.'); return; }
        if (!d.candidates?.length) { setError('No matches — try adding your city, or paste your Google Maps link.'); return; }
        setCandidates(d.candidates);
      }
    } catch { setError('Something went wrong. Try again.'); }
    finally { setLoading(false); }
  };

  const importProfile = async (placeId: string) => {
    setImporting(true); setError(null);
    try {
      const res = await fetch('/api/listing/google-reviews/import-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ place_id: placeId }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Import failed.'); return; }
      setImported(d);
    } catch { setError('Import failed. Try again.'); }
    finally { setImporting(false); }
  };

  if (imported) {
    const p = imported.profile;
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: `${BRAND}1a` }}>
          <Check size={24} style={{ color: BRAND }} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Imported from Google</h2>
        <p className="mt-1 text-sm text-gray-500">We pulled your details so you don&apos;t have to type them.</p>

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
        <h2 className="text-xl font-semibold text-gray-900">Let&apos;s build your booking system</h2>
        <p className="mt-1 text-sm text-gray-500">Connect Google and we&apos;ll auto-fill your venue — name, photos, reviews and more. No typing.</p>
      </div>

      <div className="mt-5 flex gap-2">
        <button onClick={() => setMode('search')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium ${mode === 'search' ? 'border-transparent text-white' : 'border-gray-200 text-gray-600'}`} style={mode === 'search' ? { backgroundColor: BRAND } : {}}>
          <Search size={14} /> Search by name
        </button>
        <button onClick={() => setMode('link')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium ${mode === 'link' ? 'border-transparent text-white' : 'border-gray-200 text-gray-600'}`} style={mode === 'link' ? { backgroundColor: BRAND } : {}}>
          <Link2 size={14} /> Paste Google link
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) find(); }}
          placeholder={mode === 'search' ? 'Your venue name + city' : 'Paste your Google Maps link'}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400"
        />
        <button onClick={find} disabled={loading || !input.trim()} className="rounded-lg px-4 text-sm font-medium text-white disabled:opacity-40" style={{ backgroundColor: BRAND }}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : 'Find'}
        </button>
      </div>

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
                {importing ? <Loader2 size={16} className="animate-spin text-gray-400" /> : <ArrowRight size={16} className="text-gray-400" />}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600">I&apos;ll do this later</button>
        <button onClick={onNext} className="text-sm font-medium text-gray-500 hover:text-gray-800">Enter manually →</button>
      </div>
    </div>
  );
}

/* ── Step 1: The 5 questions ────────────────────────────────────────────── */
function QuestionsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [maxCapacity, setMaxCapacity] = useState('');
  const [startingPrice, setStartingPrice] = useState('');
  const [inclusivity, setInclusivity] = useState('');
  const [seasonality, setSeasonality] = useState('');
  const [differentiators, setDifferentiators] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/onboarding/draft-guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_capacity: maxCapacity,
          starting_price: startingPrice,
          inclusivity,
          seasonality,
          differentiators,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not draft your guide.'); return; }
      onNext();
    } catch { setError('Something went wrong. Try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900">A few things Google can&apos;t tell us</h2>
      <p className="mt-1 text-sm text-gray-500">Just the essentials — we&apos;ll write the rest for you.</p>

      <div className="mt-5 space-y-4">
        <Field label="Max guest capacity">
          <input value={maxCapacity} onChange={(e) => setMaxCapacity(e.target.value)} type="number" placeholder="e.g. 200" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </Field>

        <Field label="Starting price (per event)">
          <div className="flex items-center rounded-lg border border-gray-200 px-3 focus-within:border-gray-400">
            <span className="text-gray-400">$</span>
            <input value={startingPrice} onChange={(e) => setStartingPrice(e.target.value)} type="number" placeholder="e.g. 5000" className="w-full bg-transparent px-2 py-2.5 text-sm outline-none" />
          </div>
        </Field>

        <Field label="What do you offer?">
          <div className="flex gap-2">
            {[['venue_only', 'Venue only'], ['all_inclusive', 'All-inclusive']].map(([val, label]) => (
              <button key={val} onClick={() => setInclusivity(val)} className={`flex-1 rounded-lg border py-2 text-sm font-medium ${inclusivity === val ? 'border-transparent text-white' : 'border-gray-200 text-gray-600'}`} style={inclusivity === val ? { backgroundColor: BRAND } : {}}>
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Availability / busy season (optional)">
          <input value={seasonality} onChange={(e) => setSeasonality(e.target.value)} placeholder="e.g. May–October books fast" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </Field>

        <Field label="What makes you special? (top 2–3)">
          <textarea value={differentiators} onChange={(e) => setDifferentiators(e.target.value)} rows={2} placeholder="e.g. waterfront ceremony site, on-site suites, in-house catering" className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"><ArrowLeft size={14} /> Back</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-2 rounded-xl px-6 py-3 font-medium text-white disabled:opacity-50" style={{ backgroundColor: BRAND }}>
          {saving ? <><Loader2 size={16} className="animate-spin" /> Writing your guide…</> : <>Draft my guide <Sparkles size={16} /></>}
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [about, setAbout] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/listing/pricing-guide', { cache: 'no-store' });
        const d = await res.json();
        const g = d.guide ?? {};
        const firstPkg = (g.packages ?? [])[0];
        const draftObj: Draft = {
          congratulatory_message: g.congratulatory_message ?? '',
          about_venue: g.about_venue ?? '',
          pricing_intro: g.pricing_intro ?? '',
          availability_text: g.availability_text ?? '',
          cta_headline: g.cta_headline ?? '',
          cta_body: g.cta_body ?? '',
          cta_button_label: g.cta_button_label ?? 'Schedule a tour',
          price_label: firstPkg?.price_label ?? '',
        };
        setDraft(draftObj);
        setAbout(draftObj.about_venue);
        setPrice(draftObj.price_label);
      } catch { setError('Could not load your draft.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await fetch('/api/onboarding/draft-guide', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ about_venue: about, price_label: price }),
      });
      onNext();
    } catch { setError('Could not save. Try again.'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex h-48 items-center justify-center text-gray-400"><Loader2 size={24} className="animate-spin" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900">Here&apos;s your guide — take a look</h2>
      <p className="mt-1 text-sm text-gray-500">We wrote it for you. Skim it, tweak anything, but <strong>double-check your price</strong> — that&apos;s the promise to the bride.</p>

      {draft?.congratulatory_message && (
        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm italic text-gray-600">“{draft.congratulatory_message}”</div>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">About your venue</label>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={4} className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </div>

        <div className="rounded-xl border-2 p-3" style={{ borderColor: `${BRAND}66`, backgroundColor: `${BRAND}0d` }}>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold" style={{ color: BRAND }}>
            <Star size={14} /> Verify your pricing
          </label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Starting at $5,000" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
          <p className="mt-1.5 text-xs text-gray-500">This is what brides see first. Make sure it&apos;s accurate.</p>
        </div>

        {draft?.pricing_intro && <PreviewLine label="Pricing intro" text={draft.pricing_intro} />}
        {draft?.availability_text && <PreviewLine label="Availability" text={draft.availability_text} />}
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"><ArrowLeft size={14} /> Back</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-xl px-6 py-3 font-medium text-white disabled:opacity-50" style={{ backgroundColor: BRAND }}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <>Looks good <ArrowRight size={16} /></>}
        </button>
      </div>
    </div>
  );
}

function PreviewLine({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm text-gray-600">{text}</p>
    </div>
  );
}

/* ── Step 3: Publish ────────────────────────────────────────────────────── */
function PublishStep({ onDone }: { onDone: () => void }) {
  const [publishing, setPublishing] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <p className="mt-1 text-sm text-gray-500">Your booking system is published. Share this link and start collecting leads.</p>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
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
      <p className="mt-1 text-sm text-gray-500">Publishing makes your guide live at your public venue URL. Brides who land there get your guide instantly — that&apos;s your lead loop.</p>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <button onClick={publish} disabled={publishing} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-semibold text-white disabled:opacity-50" style={{ backgroundColor: BRAND }}>
        {publishing ? <><Loader2 size={18} className="animate-spin" /> Publishing…</> : <>Publish &amp; go live <ArrowRight size={18} /></>}
      </button>
    </div>
  );
}
