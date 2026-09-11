'use client';

import { useEffect, useState } from 'react';
import { Check, X, Minus, Plus, Heart, PartyPopper } from 'lucide-react';

interface RsvpData {
  guest: {
    name: string;
    partySize: number;
    rsvpStatus: string;
    mealChoice: string | null;
    dietaryNotes: string | null;
    responded: boolean;
  };
  wedding: { coupleName: string; weddingDate: string | null };
  venue: { name: string | null; city: string | null; state: string | null; coverImageUrl: string | null };
  mealOptions: string[];
}

function formatDate(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export default function RsvpClient({ token }: { token: string }) {
  const [data, setData] = useState<RsvpData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [attending, setAttending] = useState<boolean | null>(null);
  const [headcount, setHeadcount] = useState(1);
  const [meal, setMeal] = useState('');
  const [dietary, setDietary] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<null | boolean>(null); // true=attending, false=declined

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rsvp/${token}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json?.error || 'This RSVP link is no longer valid.');
        } else {
          const d = json as RsvpData;
          setData(d);
          setHeadcount(Math.max(1, d.guest.partySize || 1));
          setMeal(d.guest.mealChoice || '');
          setDietary(d.guest.dietaryNotes || '');
          if (d.guest.rsvpStatus === 'attending') setAttending(true);
          else if (d.guest.rsvpStatus === 'declined') setAttending(false);
        }
      } catch {
        if (!cancelled) setLoadError('Something went wrong loading your invitation.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function submit() {
    if (attending === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/rsvp/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attending,
          headcount: attending ? headcount : undefined,
          meal_choice: attending ? (meal || null) : null,
          dietary_notes: attending ? (dietary || null) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json?.error || 'Could not save your RSVP.');
      } else {
        setDone(attending);
      }
    } catch {
      setSubmitError('Could not save your RSVP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Shell ──────────────────────────────────────────────────────────────
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen w-full bg-[#f6f4f0] flex items-start justify-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="animate-pulse rounded-3xl bg-white p-8 shadow-sm">
          <div className="mx-auto h-40 w-full rounded-2xl bg-gray-100" />
          <div className="mx-auto mt-6 h-6 w-2/3 rounded bg-gray-100" />
          <div className="mx-auto mt-3 h-4 w-1/2 rounded bg-gray-100" />
        </div>
      </Shell>
    );
  }

  if (loadError || !data) {
    return (
      <Shell>
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <X size={22} />
          </div>
          <h1 className="font-serif text-xl text-gray-900">Invitation not found</h1>
          <p className="mt-2 text-sm text-gray-500">{loadError}</p>
        </div>
      </Shell>
    );
  }

  const prettyDate = formatDate(data.wedding.weddingDate);
  const place = [data.venue.city, data.venue.state].filter(Boolean).join(', ');

  // ── Thank-you state ────────────────────────────────────────────────────
  if (done !== null) {
    return (
      <Shell>
        <div className="overflow-hidden rounded-3xl bg-white text-center shadow-sm">
          <div className="bg-gradient-to-br from-[#8b6f47] to-[#3f3a34] px-8 py-10 text-white">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/15">
              {done ? <PartyPopper size={26} /> : <Heart size={26} />}
            </div>
            <h1 className="font-serif text-2xl">{done ? 'Yay! See you there' : 'Thanks for letting us know'}</h1>
          </div>
          <div className="px-8 py-8">
            <p className="text-[15px] leading-relaxed text-gray-600">
              {done
                ? `Your RSVP is in${headcount > 1 ? ` for ${headcount} guests` : ''}. ${data.wedding.coupleName} can't wait to celebrate with you!`
                : `We'll miss you, but thank you for responding. ${data.wedding.coupleName} appreciates it.`}
            </p>
            <button
              type="button"
              onClick={() => setDone(null)}
              className="mt-6 text-sm font-medium text-[#8b6f47] underline underline-offset-4"
            >
              Change my response
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── RSVP form ──────────────────────────────────────────────────────────
  const canPickCount = data.guest.partySize > 1;

  return (
    <Shell>
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
        {/* Hero */}
        <div className="relative">
          {data.venue.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.venue.coverImageUrl} alt="" className="h-44 w-full object-cover" />
          ) : (
            <div className="h-44 w-full bg-gradient-to-br from-[#8b6f47] to-[#3f3a34]" />
          )}
          <div className="absolute inset-0 bg-black/25" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-center text-white">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/80">You&apos;re invited</p>
            <h1 className="font-serif text-3xl leading-tight drop-shadow-sm">{data.wedding.coupleName}</h1>
          </div>
        </div>

        <div className="px-6 py-7 sm:px-8">
          {(prettyDate || data.venue.name) && (
            <div className="mb-6 text-center">
              {prettyDate && <p className="text-[15px] font-medium text-gray-800">{prettyDate}</p>}
              {data.venue.name && (
                <p className="mt-0.5 text-sm text-gray-500">
                  {data.venue.name}{place ? ` · ${place}` : ''}
                </p>
              )}
            </div>
          )}

          <p className="text-center text-[15px] text-gray-700">
            Hi <span className="font-semibold">{data.guest.name.split(/\s+/)[0]}</span>, will you join us?
          </p>

          {/* Attend / decline */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setAttending(true)}
              className={`flex items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-semibold transition-colors ${
                attending === true
                  ? 'border-[#8b6f47] bg-[#8b6f47] text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <Check size={16} /> I&apos;ll be there
            </button>
            <button
              type="button"
              onClick={() => setAttending(false)}
              className={`flex items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3 text-sm font-semibold transition-colors ${
                attending === false
                  ? 'border-gray-800 bg-gray-800 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <X size={16} /> Can&apos;t make it
            </button>
          </div>

          {/* Attending extras */}
          {attending === true && (
            <div className="mt-6 space-y-5">
              {canPickCount && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    How many in your party?
                  </label>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setHeadcount((n) => Math.max(1, n - 1))}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                      aria-label="Decrease"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="min-w-[2ch] text-center text-lg font-semibold text-gray-900">{headcount}</span>
                    <button
                      type="button"
                      onClick={() => setHeadcount((n) => Math.min(data.guest.partySize, n + 1))}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                      aria-label="Increase"
                    >
                      <Plus size={16} />
                    </button>
                    <span className="text-xs text-gray-400">of {data.guest.partySize} reserved</span>
                  </div>
                </div>
              )}

              {data.mealOptions.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Meal choice
                  </label>
                  <select
                    value={meal}
                    onChange={(e) => setMeal(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-800 focus:border-[#8b6f47] focus:outline-none"
                  >
                    <option value="">No preference</option>
                    {data.mealOptions.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Dietary needs or allergies <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={dietary}
                  onChange={(e) => setDietary(e.target.value)}
                  placeholder="e.g. vegetarian, nut allergy"
                  className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-800 focus:border-[#8b6f47] focus:outline-none"
                />
              </div>
            </div>
          )}

          {submitError && <p className="mt-4 text-center text-sm text-rose-600">{submitError}</p>}

          <button
            type="button"
            disabled={attending === null || submitting}
            onClick={submit}
            className="mt-6 w-full rounded-full bg-[#1b1b1b] py-3.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          >
            {submitting ? 'Sending…' : data.guest.responded ? 'Update my RSVP' : 'Send RSVP'}
          </button>

          <p className="mt-4 text-center text-[11px] text-gray-300">Powered by StoryVenue</p>
        </div>
      </div>
    </Shell>
  );
}
