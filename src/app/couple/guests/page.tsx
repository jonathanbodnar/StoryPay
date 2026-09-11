'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Plus,
  Trash2,
  X,
  Users,
  UtensilsCrossed,
  Pencil,
  Check,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Rsvp = 'pending' | 'attending' | 'declined';

type Guest = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  party_size: number;
  rsvp_status: Rsvp;
  meal_choice: string | null;
  dietary_notes: string | null;
  guest_group: string | null;
  notes: string | null;
};

type Summary = {
  total: number;
  attending: number;
  declined: number;
  pending: number;
  headcount: number;
  mealCounts: Record<string, number>;
};

const INPUT =
  'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200';

const RSVP_OPTIONS: { value: Rsvp; label: string }[] = [
  { value: 'pending', label: 'Awaiting' },
  { value: 'attending', label: 'Attending' },
  { value: 'declined', label: 'Declined' },
];

const emptyForm = {
  full_name: '',
  email: '',
  phone: '',
  party_size: 1,
  guest_group: '',
  meal_choice: '',
  dietary_notes: '',
  rsvp_status: 'pending' as Rsvp,
};

export default function CoupleGuestsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [error, setError] = useState('');

  const [guests, setGuests] = useState<Guest[]>([]);
  const [mealOptions, setMealOptions] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);

  const [newMeal, setNewMeal] = useState('');
  const [savingMeals, setSavingMeals] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Guest>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const res = await coupleAuthedFetch('/api/couple/guests');
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    if (res.status === 409) {
      setNeedsLink(true);
      setLoading(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'Failed to load');
      setLoading(false);
      return;
    }
    setGuests(Array.isArray(data.guests) ? data.guests : []);
    setMealOptions(Array.isArray(data.mealOptions) ? data.mealOptions : []);
    setSummary(data.summary ?? null);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setAdding(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/guests', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not add guest');
        return;
      }
      setForm(emptyForm);
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function patchGuest(id: string, changes: Partial<Guest>) {
    setBusyId(id);
    // Optimistic update for snappy inline selects.
    setGuests((prev) => prev.map((g) => (g.id === id ? { ...g, ...changes } : g)));
    try {
      const res = await coupleAuthedFetch(`/api/couple/guests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        await load();
        return;
      }
      // Refresh summary/meal tallies.
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function removeGuest(id: string) {
    setBusyId(id);
    try {
      const res = await coupleAuthedFetch(`/api/couple/guests/${id}`, { method: 'DELETE' });
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  }

  async function saveMeals(next: string[]) {
    setSavingMeals(true);
    try {
      const res = await coupleAuthedFetch('/api/couple/wedding/meal-options', {
        method: 'PUT',
        body: JSON.stringify({ options: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setMealOptions(Array.isArray(data.options) ? data.options : next);
    } finally {
      setSavingMeals(false);
    }
  }

  function startEdit(g: Guest) {
    setEditingId(g.id);
    setEditForm({
      full_name: g.full_name,
      email: g.email ?? '',
      phone: g.phone ?? '',
      guest_group: g.guest_group ?? '',
      dietary_notes: g.dietary_notes ?? '',
    });
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    setError('');
    try {
      const res = await coupleAuthedFetch(`/api/couple/guests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not save');
        return;
      }
      setEditingId(null);
      setEditForm({});
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (needsLink) {
    return (
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Guest list</h1>
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <Users className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Connect with your venue to start building your guest list.</p>
          <Link
            href="/couple/wedding"
            className="mt-4 inline-flex rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
          >
            Go to My wedding
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Guest list</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track your guests, RSVPs and meal choices. Your venue sees the headcount and meal tallies — your guests&apos;
          contact details stay private to you.
        </p>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Summary */}
      {summary && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Attending" value={summary.attending} tone="emerald" />
          <SummaryCard label="Awaiting" value={summary.pending} tone="amber" />
          <SummaryCard label="Declined" value={summary.declined} tone="gray" />
          <SummaryCard label="Headcount" value={summary.headcount} tone="rose" />
        </div>
      )}

      {/* Meal options */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Meal options</h2>
          {savingMeals && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-300" />}
        </div>
        <p className="mt-1 text-xs text-gray-400">Add the meal choices your guests can pick from.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {mealOptions.map((m) => (
            <span key={m} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700">
              {m}
              <button
                type="button"
                onClick={() => void saveMeals(mealOptions.filter((x) => x !== m))}
                className="text-gray-300 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = newMeal.trim();
              if (!t || mealOptions.some((x) => x.toLowerCase() === t.toLowerCase())) return;
              void saveMeals([...mealOptions, t]);
              setNewMeal('');
            }}
            className="flex items-center gap-2"
          >
            <input
              value={newMeal}
              onChange={(e) => setNewMeal(e.target.value)}
              placeholder="Add a meal…"
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
            />
            <button type="submit" className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </form>
        </div>
      </section>

      {/* Add guest */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Add a guest</h2>
        </div>
        <form onSubmit={addGuest} className="mt-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input required className={INPUT} placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <input className={INPUT} placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className={INPUT} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className={INPUT} placeholder="Group / table (optional)" value={form.guest_group} onChange={(e) => setForm({ ...form, guest_group: e.target.value })} />
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Party of</label>
              <input
                type="number"
                min={1}
                max={30}
                className={`${INPUT} w-24`}
                value={form.party_size}
                onChange={(e) => setForm({ ...form, party_size: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
              />
            </div>
            <select className={INPUT} value={form.meal_choice} onChange={(e) => setForm({ ...form, meal_choice: e.target.value })}>
              <option value="">Meal choice (optional)</option>
              {mealOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input className={`${INPUT} sm:col-span-2`} placeholder="Dietary notes / allergies (optional)" value={form.dietary_notes} onChange={(e) => setForm({ ...form, dietary_notes: e.target.value })} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <select className={`${INPUT} w-40`} value={form.rsvp_status} onChange={(e) => setForm({ ...form, rsvp_status: e.target.value as Rsvp })}>
              {RSVP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={adding || !form.full_name.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add guest
            </button>
          </div>
        </form>
      </section>

      {/* Guest list */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Guests {guests.length > 0 && <span className="text-gray-400">({guests.length})</span>}
          </h2>
        </div>
        {guests.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No guests yet. Add your first guest above.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {guests.map((g) => (
              <li key={g.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                {editingId === g.id ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className={INPUT} placeholder="Full name" value={editForm.full_name ?? ''} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
                    <input className={INPUT} placeholder="Group / table" value={editForm.guest_group ?? ''} onChange={(e) => setEditForm({ ...editForm, guest_group: e.target.value })} />
                    <input className={INPUT} placeholder="Email" value={editForm.email ?? ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                    <input className={INPUT} placeholder="Phone" value={editForm.phone ?? ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                    <input className={`${INPUT} sm:col-span-2`} placeholder="Dietary notes" value={editForm.dietary_notes ?? ''} onChange={(e) => setEditForm({ ...editForm, dietary_notes: e.target.value })} />
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <button
                        type="button"
                        disabled={busyId === g.id}
                        onClick={() => void saveEdit(g.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white hover:opacity-85 disabled:opacity-60"
                      >
                        {busyId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setEditForm({}); }} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">
                        {g.full_name}
                        {g.party_size > 1 && <span className="ml-1.5 text-xs text-gray-400">party of {g.party_size}</span>}
                        {g.guest_group && <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{g.guest_group}</span>}
                      </p>
                      {(g.email || g.phone) && (
                        <p className="truncate text-xs text-gray-500">{[g.email, g.phone].filter(Boolean).join(' · ')}</p>
                      )}
                      {g.dietary_notes && <p className="mt-0.5 text-xs text-amber-600">Dietary: {g.dietary_notes}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={g.rsvp_status}
                        disabled={busyId === g.id}
                        onChange={(e) => void patchGuest(g.id, { rsvp_status: e.target.value as Rsvp })}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
                      >
                        {RSVP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <select
                        value={g.meal_choice ?? ''}
                        disabled={busyId === g.id || mealOptions.length === 0}
                        onChange={(e) => void patchGuest(g.id, { meal_choice: e.target.value || null })}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs focus:border-gray-400 focus:outline-none disabled:opacity-50"
                      >
                        <option value="">Meal…</option>
                        {mealOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => startEdit(g)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === g.id}
                        onClick={() => void removeGuest(g.id)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'gray' | 'rose' }) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    gray: 'border-gray-200 bg-white text-gray-600',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tones[tone]}`}>
      <p className="text-2xl font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}
