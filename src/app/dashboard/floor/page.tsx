'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Search, Calendar, ListTodo, MapPin, RefreshCw, WifiOff,
} from 'lucide-react';

const CACHE_KEY = 'storypay_floor_v1';

type FloorPayload = {
  venue_date: string;
  timezone: string;
  leads: Array<{
    id: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
    wedding_date: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    due_at: string | null;
    lead_id: string;
    lead: { id: string; name: string; email: string } | null;
  }>;
  tours_today: Array<Record<string, unknown>>;
  agenda_today: Array<Record<string, unknown>>;
};

export default function FloorModePage() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<FloorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setOffline(false);
    try {
      const url = debounced ? `/api/floor?q=${encodeURIComponent(debounced)}` : '/api/floor';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      const j = (await res.json()) as FloorPayload;
      setData(j);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(j));
      } catch {
        /* ignore */
      }
    } catch {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          setData(JSON.parse(raw) as FloorPayload);
          setOffline(true);
        }
      } catch {
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-[100dvh] bg-gray-50 pb-24">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <Link href="/dashboard/leads" className="text-gray-500 hover:text-gray-800">
            <ArrowLeft size={20} />
          </Link>
          <p className="text-sm font-semibold text-gray-900">Floor</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Refresh"
          >
            <RefreshCw size={18} />
          </button>
        </div>
        {offline ? (
          <div className="mx-auto mt-2 flex max-w-lg items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <WifiOff size={14} />
            Showing saved snapshot — reconnect to refresh.
          </div>
        ) : null}
        <div className="mx-auto mt-3 max-w-lg">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search leads…"
              className="w-full rounded-2xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm"
              style={{ fontSize: 16 }}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-6 px-4 py-4">
        {loading && !data ? (
          <div className="flex justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : null}

        {data ? (
          <>
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Calendar size={14} />
                Today · {data.venue_date}{' '}
                <span className="font-normal normal-case text-gray-400">({data.timezone})</span>
              </div>
              <div className="space-y-2">
                {data.tours_today.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
                    No tours on the calendar today.
                  </p>
                ) : (
                  data.tours_today.map((ev) => (
                    <div key={String(ev.id)} className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm">
                      <p className="font-medium text-gray-900">{String(ev.title ?? 'Tour')}</p>
                      <p className="text-xs text-gray-500">
                        {String(ev.start_at ?? '').replace('T', ' ').slice(0, 16)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <ListTodo size={14} />
                Next tasks
              </div>
              <div className="space-y-2">
                {data.tasks.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
                    No open tasks.
                  </p>
                ) : (
                  data.tasks.map((t) => (
                    <Link
                      key={t.id}
                      href="/dashboard/leads"
                      className="block rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm hover:border-gray-300"
                    >
                      <p className="font-medium text-gray-900">{t.title}</p>
                      <p className="text-xs text-gray-500">
                        {t.lead?.name || 'Lead'} · {t.due_at ? new Date(t.due_at).toLocaleString() : 'No due date'}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <MapPin size={14} />
                Leads
              </div>
              <div className="space-y-2">
                {data.leads.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
                    No leads match.
                  </p>
                ) : (
                  data.leads.map((l) => (
                    <Link
                      key={l.id}
                      href="/dashboard/leads"
                      className="block rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm hover:border-gray-300"
                    >
                      <p className="font-medium text-gray-900">{l.name}</p>
                      <p className="text-xs text-gray-500">{l.email}</p>
                    </Link>
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
