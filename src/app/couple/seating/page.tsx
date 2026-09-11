'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  Trash2,
  Users,
  Armchair,
  Pencil,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import RoomCanvas from '@/components/wedding-layout/RoomCanvas';
import { EMPTY_LAYOUT, type WeddingLayout } from '@/lib/wedding-layout';

type Rsvp = 'pending' | 'attending' | 'declined';

type Guest = {
  id: string;
  full_name: string;
  party_size: number;
  rsvp_status: Rsvp;
  guest_group: string | null;
  table_id: string | null;
};

type Table = {
  id: string;
  name: string;
  capacity: number;
  sort_order: number;
};

const RSVP_DOT: Record<Rsvp, string> = {
  attending: 'bg-emerald-500',
  pending: 'bg-amber-400',
  declined: 'bg-gray-300',
};

export default function CoupleSeatingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [error, setError] = useState('');

  const [guests, setGuests] = useState<Guest[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [view, setView] = useState<'seating' | 'layout'>('seating');
  const [layout, setLayout] = useState<WeddingLayout>(EMPTY_LAYOUT);

  const [newName, setNewName] = useState('');
  const [newCap, setNewCap] = useState(8);
  const [creating, setCreating] = useState(false);

  const [busyGuestId, setBusyGuestId] = useState<string | null>(null);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCap, setEditCap] = useState(8);
  const [busyTableId, setBusyTableId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const [tRes, gRes, lRes] = await Promise.all([
      coupleAuthedFetch('/api/couple/tables'),
      coupleAuthedFetch('/api/couple/guests'),
      coupleAuthedFetch('/api/couple/layout'),
    ]);
    if (tRes.status === 401 || gRes.status === 401) {
      router.replace('/couple/login');
      return;
    }
    if (tRes.status === 409 || gRes.status === 409) {
      setNeedsLink(true);
      setLoading(false);
      return;
    }
    const tData = await tRes.json().catch(() => ({}));
    const gData = await gRes.json().catch(() => ({}));
    const lData = await lRes.json().catch(() => ({}));
    setTables(Array.isArray(tData.tables) ? tData.tables : []);
    setGuests(Array.isArray(gData.guests) ? gData.guests : []);
    if (lData.layout) setLayout(lData.layout);
    setLoading(false);
  }, [router]);

  async function saveLayout(next: WeddingLayout) {
    const res = await coupleAuthedFetch('/api/couple/layout', {
      method: 'PUT',
      body: JSON.stringify({ layout: next }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      if (data.layout) setLayout(data.layout);
      return { ok: false, conflict: true, layout: data.layout };
    }
    if (!res.ok) return { ok: false };
    if (data.layout) setLayout(data.layout);
    return { ok: true, layout: data.layout };
  }

  useEffect(() => {
    void load();
  }, [load]);

  const seatedByTable = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of guests) {
      if (g.table_id) map[g.table_id] = (map[g.table_id] ?? 0) + Math.max(1, g.party_size || 1);
    }
    return map;
  }, [guests]);

  const unassigned = guests.filter((g) => !g.table_id);

  async function createTable(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/tables', {
        method: 'POST',
        body: JSON.stringify({ name, capacity: newCap }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not add table');
        return;
      }
      setNewName('');
      setNewCap(8);
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function assignGuest(guestId: string, tableId: string | null) {
    setBusyGuestId(guestId);
    // Optimistic move.
    setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, table_id: tableId } : g)));
    try {
      const res = await coupleAuthedFetch(`/api/couple/guests/${guestId}`, {
        method: 'PATCH',
        body: JSON.stringify({ table_id: tableId }),
      });
      if (!res.ok) await load();
    } finally {
      setBusyGuestId(null);
    }
  }

  function startEditTable(t: Table) {
    setEditingTableId(t.id);
    setEditName(t.name);
    setEditCap(t.capacity);
  }

  async function saveTable(id: string) {
    setBusyTableId(id);
    setError('');
    try {
      const res = await coupleAuthedFetch(`/api/couple/tables/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim(), capacity: editCap }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not save table');
        return;
      }
      setEditingTableId(null);
      await load();
    } finally {
      setBusyTableId(null);
    }
  }

  async function deleteTable(id: string) {
    setBusyTableId(id);
    try {
      const res = await coupleAuthedFetch(`/api/couple/tables/${id}`, { method: 'DELETE' });
      if (res.ok) await load();
    } finally {
      setBusyTableId(null);
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
        <h1 className="font-heading text-2xl text-gray-900">Seating chart</h1>
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <Armchair className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Connect with your venue to start your seating chart.</p>
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
        <h1 className="font-heading text-2xl text-gray-900">Seating chart</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create your tables and seat each guest party. Seats fill by party size, and your venue sees the layout for
          day-of setup.
        </p>
      </div>

      <div className="mt-4 inline-flex rounded-xl border border-gray-200 bg-white p-1 text-sm">
        <button
          type="button"
          onClick={() => setView('seating')}
          className={`rounded-lg px-3 py-1.5 font-medium ${view === 'seating' ? 'bg-[#1b1b1b] text-white' : 'text-gray-600 hover:text-gray-900'}`}
        >
          Seating
        </button>
        <button
          type="button"
          onClick={() => setView('layout')}
          className={`rounded-lg px-3 py-1.5 font-medium ${view === 'layout' ? 'bg-[#1b1b1b] text-white' : 'text-gray-600 hover:text-gray-900'}`}
        >
          Room layout
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {view === 'layout' && (
        <div className="mt-6">
          <RoomCanvas initialLayout={layout} tables={tables} seatedByTable={seatedByTable} onSave={saveLayout} />
        </div>
      )}

      {view === 'seating' && (<>

      {/* Add table */}
      <form onSubmit={createTable} className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-gray-500">Table name</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Head Table, Table 1"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Seats</label>
          <input
            type="number"
            min={1}
            max={100}
            value={newCap}
            onChange={(e) => setNewCap(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="w-24 rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add table
        </button>
      </form>

      {/* Tables */}
      {tables.length === 0 ? (
        <p className="mt-8 text-sm text-gray-400">No tables yet. Add your first table above.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {tables.map((t) => {
            const seated = seatedByTable[t.id] ?? 0;
            const over = seated > t.capacity;
            const seatedGuests = guests.filter((g) => g.table_id === t.id);
            return (
              <div key={t.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                {editingTableId === t.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 min-w-[140px] rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                    />
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={editCap}
                      onChange={(e) => setEditCap(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                      className="w-20 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={busyTableId === t.id}
                      onClick={() => void saveTable(t.id)}
                      className="rounded-lg bg-[#1b1b1b] p-1.5 text-white hover:opacity-85 disabled:opacity-60"
                      title="Save"
                    >
                      {busyTableId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingTableId(null)}
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{t.name}</h3>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          over ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {over && <AlertTriangle className="h-3 w-3" />}
                        {seated}/{t.capacity} seats
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditTable(t)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="Edit table"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyTableId === t.id}
                        onClick={() => void deleteTable(t.id)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                        title="Delete table"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Assigned guests */}
                <ul className="mt-3 space-y-1.5">
                  {seatedGuests.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
                      No one seated here yet.
                    </li>
                  ) : (
                    seatedGuests.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${RSVP_DOT[g.rsvp_status]}`} />
                          <span className="truncate">{g.full_name}</span>
                          {g.party_size > 1 && <span className="text-xs text-gray-400">+{g.party_size - 1}</span>}
                        </span>
                        <GuestTableSelect
                          value={g.table_id}
                          tables={tables}
                          disabled={busyGuestId === g.id}
                          onChange={(tid) => void assignGuest(g.id, tid)}
                        />
                      </li>
                    ))
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Unassigned */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Not seated {unassigned.length > 0 && <span className="text-gray-400">({unassigned.length})</span>}
          </h2>
        </div>
        {guests.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">
            No guests yet. Add guests on the{' '}
            <Link href="/couple/guests" className="underline">Guests</Link> page first.
          </p>
        ) : unassigned.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">Everyone has a seat. 🎉</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {unassigned.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5">
                <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${RSVP_DOT[g.rsvp_status]}`} />
                  <span className="truncate font-medium">{g.full_name}</span>
                  {g.party_size > 1 && <span className="text-xs text-gray-400">party of {g.party_size}</span>}
                  {g.guest_group && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{g.guest_group}</span>
                  )}
                </span>
                {tables.length === 0 ? (
                  <span className="text-xs text-gray-400">Add a table first</span>
                ) : (
                  <GuestTableSelect
                    value={g.table_id}
                    tables={tables}
                    disabled={busyGuestId === g.id}
                    onChange={(tid) => void assignGuest(g.id, tid)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      </>)}
    </div>
  );
}

function GuestTableSelect({
  value,
  tables,
  disabled,
  onChange,
}: {
  value: string | null;
  tables: Table[];
  disabled: boolean;
  onChange: (tableId: string | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className="shrink-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none disabled:opacity-50"
    >
      <option value="">Not seated</option>
      {tables.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}
