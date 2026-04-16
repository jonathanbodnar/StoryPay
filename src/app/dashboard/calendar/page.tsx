'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Plus, X, Loader2, Calendar,
  AlertTriangle, ExternalLink, Download, Info,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────
interface VenueSpace { id: string; name: string; color: string; capacity?: number | null; }

interface CalEvent {
  id: string;
  title: string;
  event_type: string;
  status: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  space_id: string | null;
  customer_email: string | null;
  notes: string | null;
  venue_spaces: { id: string; name: string; color: string } | null;
}

interface ConflictInfo { id: string; title: string; start_at: string; end_at: string; }

const EVENT_TYPE_LABELS: Record<string, string> = {
  wedding: 'Wedding', reception: 'Reception', tour: 'Tour',
  tasting: 'Tasting', meeting: 'Meeting', rehearsal: 'Rehearsal',
  hold: 'Hold', blocked: 'Blocked', other: 'Other',
};

const EVENT_COLORS: Record<string, string> = {
  wedding: '#ec4899', reception: '#8b5cf6', tour: '#3b82f6',
  tasting: '#f59e0b', meeting: '#10b981', rehearsal: '#6366f1',
  hold: '#94a3b8', blocked: '#64748b', other: '#6b7280',
};

const REFERRAL_SOURCES = ['Instagram','Google','Wedding Wire','The Knot','Referral','Venue Website','Facebook','Other'];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Empty form ────────────────────────────────────────────────────────────────
const emptyForm = () => ({
  title: '',
  event_type: 'wedding',
  status: 'confirmed',
  space_id: '',
  customer_email: '',
  date: '',
  start_time: '10:00',
  end_time: '18:00',
  all_day: false,
  notes: '',
});

// ── Calendar Page ─────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  const [events, setEvents]   = useState<CalEvent[]>([]);
  const [spaces, setSpaces]   = useState<VenueSpace[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeSpaceFilter, setActiveSpaceFilter] = useState<string>('all');
  const [view, setView] = useState<'month' | 'revenue'>('month');

  // Modal state
  const [showModal,   setShowModal]   = useState(false);
  const [form,        setForm]        = useState(emptyForm());
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState('');
  const [conflicts,   setConflicts]   = useState<ConflictInfo[]>([]);
  const [overrideMode, setOverrideMode] = useState(false);

  // Edit/detail modal
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Space management
  const [showSpaceModal, setShowSpaceModal] = useState(false);
  const [spaceForm, setSpaceForm] = useState({ name: '', color: '#6366f1', capacity: '' });
  const [savingSpace, setSavingSpace] = useState(false);

  // iCal copied
  const [icalCopied, setIcalCopied] = useState(false);

  // Load data
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const from = new Date(year, month, 1).toISOString();
    const to   = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    const [evRes, spRes] = await Promise.all([
      fetch(`/api/calendar?from=${from}&to=${to}`),
      fetch('/api/spaces'),
    ]);
    if (evRes.ok) setEvents(await evRes.json());
    if (spRes.ok) setSpaces(await spRes.json());
    setLoading(false);
  }, [year, month]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  // ── Build calendar grid ──────────────────────────────────────────────────────
  const firstDay  = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function eventsForDay(day: number): CalEvent[] {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter(e => {
      if (activeSpaceFilter !== 'all' && e.space_id !== activeSpaceFilter) return false;
      return e.start_at.slice(0, 10) === dateStr;
    });
  }

  // ── Revenue view data ────────────────────────────────────────────────────────
  const revenueByMonth: { label: string; projected: number; confirmed: number }[] = Array.from({ length: 12 }, (_, i) => {
    const m = (month - 5 + i + 12) % 12;
    const y = year + Math.floor((month - 5 + i) / 12);
    const label = `${MONTHS[m].slice(0, 3)} '${String(y).slice(2)}`;
    const monthEvents = events.filter(e => {
      const d = new Date(e.start_at);
      return d.getFullYear() === y && d.getMonth() === m && (e.event_type === 'wedding' || e.event_type === 'reception');
    });
    const projected  = monthEvents.reduce((s, _e) => s + 0, 0); // placeholder
    const confirmed  = monthEvents.filter(e => e.status === 'confirmed').length;
    return { label, projected, confirmed };
  });

  // ── Save event ───────────────────────────────────────────────────────────────
  async function handleSave(override = false) {
    setSaving(true);
    setSaveError('');
    setConflicts([]);

    const startIso = form.all_day
      ? `${form.date}T00:00:00.000Z`
      : `${form.date}T${form.start_time}:00.000Z`;
    const endIso = form.all_day
      ? `${form.date}T23:59:59.999Z`
      : `${form.date}T${form.end_time}:00.000Z`;

    const res = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        event_type: form.event_type,
        status: form.status,
        space_id: form.space_id || null,
        customer_email: form.customer_email || null,
        start_at: startIso,
        end_at: endIso,
        all_day: form.all_day,
        notes: form.notes || null,
        override_conflict: override,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      if (json.error === 'conflict') {
        setConflicts(json.conflicts ?? []);
        setOverrideMode(true);
      } else {
        setSaveError(json.error ?? 'Failed to save');
      }
      setSaving(false);
      return;
    }

    setEvents(prev => [...prev, json]);
    setShowModal(false);
    setForm(emptyForm());
    setConflicts([]);
    setOverrideMode(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
    setEvents(prev => prev.filter(e => e.id !== id));
    setSelectedEvent(null);
    setDeleting(false);
  }

  function openNewEvent(day?: number) {
    const date = day
      ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : '';
    setForm({ ...emptyForm(), date });
    setConflicts([]);
    setOverrideMode(false);
    setSaveError('');
    setShowModal(true);
  }

  async function copyIcal() {
    try {
      const res = await fetch('/api/venues/me');
      if (res.ok) {
        const venue = await res.json();
        const url = `${window.location.origin}/api/calendar/ical?token=${venue.id}`;
        await navigator.clipboard.writeText(url);
      }
    } catch { /* ignore */ }
    setIcalCopied(true);
    setTimeout(() => setIcalCopied(false), 2500);
  }

  const currentMonthEventCount = events.filter(e => activeSpaceFilter === 'all' || e.space_id === activeSpaceFilter).length;
  const weddingCount = events.filter(e => e.event_type === 'wedding' && (activeSpaceFilter === 'all' || e.space_id === activeSpaceFilter)).length;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Calendar</h1>
          <p className="mt-1 text-sm text-gray-500">
            {currentMonthEventCount} event{currentMonthEventCount !== 1 ? 's' : ''} this month
            {weddingCount > 0 && ` · ${weddingCount} wedding${weddingCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={copyIcal}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Download size={13} />
            {icalCopied ? 'Copied!' : 'iCal Link'}
          </button>
          <button
            onClick={() => setShowSpaceModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Manage Spaces
          </button>
          <button
            onClick={() => openNewEvent()}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            <Plus size={15} /> Add Event
          </button>
        </div>
      </div>

      {/* View toggle + month nav */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 transition-colors"><ChevronLeft size={16} /></button>
          <span className="text-base font-semibold text-gray-900 w-36 text-center">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 transition-colors"><ChevronRight size={16} /></button>
          <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">Today</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gray-200 overflow-hidden">
            <button onClick={() => setView('month')} className={`px-4 py-2 text-sm font-medium transition-colors ${view === 'month' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Month</button>
            <button onClick={() => setView('revenue')} className={`px-4 py-2 text-sm font-medium border-l border-gray-200 transition-colors ${view === 'revenue' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Revenue View</button>
          </div>
        </div>
      </div>

      {/* Space filters */}
      {spaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setActiveSpaceFilter('all')}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${activeSpaceFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >All Spaces</button>
          {spaces.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSpaceFilter(activeSpaceFilter === s.id ? 'all' : s.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${activeSpaceFilter === s.id ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              style={activeSpaceFilter === s.id ? { backgroundColor: s.color, borderColor: s.color } : {}}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: s.color }} />
              {s.name}
              {s.capacity ? ` (${s.capacity})` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Revenue view */}
      {view === 'revenue' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 mb-6">
          <h2 className="font-heading text-lg text-gray-900 mb-4">Year-at-a-Glance — Bookings</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: 12 }, (_, i) => {
              const m = i;
              const y = year;
              const monthEvts = events.filter(e => {
                const d = new Date(e.start_at);
                return d.getFullYear() === y && d.getMonth() === m;
              });
              const weddings = monthEvts.filter(e => e.event_type === 'wedding' || e.event_type === 'reception');
              const tours    = monthEvts.filter(e => e.event_type === 'tour');
              const isCurrentMonth = m === today.getMonth() && y === today.getFullYear();
              return (
                <button
                  key={m}
                  onClick={() => { setMonth(m); setView('month'); }}
                  className={`rounded-xl border p-3 text-left transition-colors hover:border-gray-400 ${isCurrentMonth ? 'border-gray-900' : 'border-gray-200'}`}
                >
                  <p className={`text-xs font-semibold mb-1.5 ${isCurrentMonth ? 'text-gray-900' : 'text-gray-500'}`}>{MONTHS[m].slice(0,3)}</p>
                  {weddings.length > 0 && (
                    <p className="text-[11px] font-medium text-pink-600">{weddings.length} wedding{weddings.length !== 1 ? 's' : ''}</p>
                  )}
                  {tours.length > 0 && (
                    <p className="text-[11px] text-blue-600">{tours.length} tour{tours.length !== 1 ? 's' : ''}</p>
                  )}
                  {monthEvts.length === 0 && <p className="text-[11px] text-gray-300">—</p>}
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-gray-400 flex items-center gap-1.5"><Info size={12} /> Click a month to jump to it. Revenue projections will appear here once proposals are linked to events.</p>
        </div>
      )}

      {/* Month calendar grid */}
      {view === 'month' && (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-200">
            {DAYS.map(d => (
              <div key={d} className="py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400">{d}</div>
            ))}
          </div>
          {/* Grid cells */}
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
          ) : (
            <div className="grid grid-cols-7">
              {cells.map((day, idx) => {
                const dayEvents = day ? eventsForDay(day) : [];
                const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                const isWeekend = (idx % 7 === 0) || (idx % 7 === 6);
                return (
                  <div
                    key={idx}
                    className={`min-h-[96px] border-b border-r border-gray-100 p-1 ${!day ? 'bg-gray-50/40' : 'cursor-pointer hover:bg-gray-50/60 transition-colors'} ${isWeekend && day ? 'bg-stone-50/30' : ''}`}
                    onClick={() => day && openNewEvent(day)}
                  >
                    {day && (
                      <>
                        <div className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'text-white' : 'text-gray-700'}`}
                          style={isToday ? { backgroundColor: '#1b1b1b' } : {}}>
                          {day}
                        </div>
                        <div className="space-y-0.5">
                          {dayEvents.slice(0, 3).map(evt => (
                            <button
                              key={evt.id}
                              onClick={e => { e.stopPropagation(); setSelectedEvent(evt); }}
                              className="w-full text-left rounded px-1.5 py-0.5 text-[11px] font-medium text-white truncate leading-tight"
                              style={{ backgroundColor: evt.venue_spaces?.color ?? EVENT_COLORS[evt.event_type] ?? '#6b7280' }}
                            >
                              {evt.title}
                            </button>
                          ))}
                          {dayEvents.length > 3 && (
                            <p className="text-[10px] text-gray-400 pl-1">+{dayEvents.length - 3} more</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-3">
        {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: EVENT_COLORS[key] }} />
            {label}
          </div>
        ))}
      </div>

      {/* ── Add Event Modal ───────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 max-h-[90vh] overflow-y-auto">
            <button onClick={() => { setShowModal(false); setConflicts([]); setOverrideMode(false); }}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">New Event</h2>

            {/* Conflict warning */}
            {conflicts.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Booking Conflict Detected</p>
                    <p className="text-xs text-amber-700 mt-0.5">This space already has an event during this time:</p>
                    {conflicts.map(c => (
                      <p key={c.id} className="text-xs text-amber-700 font-medium mt-1">— {c.title} ({fmt(c.start_at)} → {fmt(c.end_at)})</p>
                    ))}
                    <button onClick={() => handleSave(true)}
                      className="mt-2 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 transition-colors">
                      Override & Book Anyway
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Event Title *</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="Smith & Johnson Wedding"
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Type</label>
                  <select value={form.event_type} onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none transition-colors">
                    {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none transition-colors">
                    <option value="confirmed">Confirmed</option>
                    <option value="tentative">Tentative / Hold</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Space</label>
                <select value={form.space_id} onChange={e => setForm(p => ({ ...p, space_id: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none transition-colors">
                  <option value="">No specific space</option>
                  {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Customer Email</label>
                <input type="email" value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))}
                  placeholder="couple@example.com"
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Date *</label>
                <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="allday" checked={form.all_day} onChange={e => setForm(p => ({ ...p, all_day: e.target.checked }))} className="rounded" />
                <label htmlFor="allday" className="text-sm text-gray-700">All day</label>
              </div>
              {!form.all_day && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Start Time</label>
                    <input type="time" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">End Time</label>
                    <input type="time" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors" />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors resize-none" />
              </div>
            </div>

            {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}

            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setShowModal(false); setConflicts([]); setOverrideMode(false); }}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleSave(false)} disabled={saving || !form.title || !form.date}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#1b1b1b' }}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Event detail modal ────────────────────────────────────────────── */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6">
            <button onClick={() => setSelectedEvent(null)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: selectedEvent.venue_spaces?.color ?? EVENT_COLORS[selectedEvent.event_type] ?? '#6b7280' }}>
                <Calendar size={16} className="text-white" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{selectedEvent.title}</p>
                <p className="text-xs text-gray-400 capitalize">{EVENT_TYPE_LABELS[selectedEvent.event_type]} · {selectedEvent.status}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              <p><span className="text-gray-400">Date:</span> {new Date(selectedEvent.start_at).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })}</p>
              {!selectedEvent.all_day && (
                <p><span className="text-gray-400">Time:</span> {new Date(selectedEvent.start_at).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })} – {new Date(selectedEvent.end_at).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })}</p>
              )}
              {selectedEvent.venue_spaces && <p><span className="text-gray-400">Space:</span> {selectedEvent.venue_spaces.name}</p>}
              {selectedEvent.customer_email && (
                <p>
                  <span className="text-gray-400">Customer:</span>{' '}
                  <Link href={`/dashboard/customers?search=${encodeURIComponent(selectedEvent.customer_email)}`}
                    className="text-blue-600 hover:underline inline-flex items-center gap-1">
                    {selectedEvent.customer_email} <ExternalLink size={11} />
                  </Link>
                </p>
              )}
              {selectedEvent.notes && <p><span className="text-gray-400">Notes:</span> {selectedEvent.notes}</p>}
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => handleDelete(selectedEvent.id)} disabled={deleting}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                {deleting ? <Loader2 size={13} className="animate-spin" /> : null}
                Delete Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Space management modal ────────────────────────────────────────── */}
      {showSpaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6">
            <button onClick={() => setShowSpaceModal(false)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">Manage Spaces</h2>

            <div className="space-y-2 mb-5">
              {spaces.length === 0 && <p className="text-sm text-gray-400">No spaces yet. Add your first space below.</p>}
              {spaces.map(s => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-3.5 h-3.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.name}</p>
                      {s.capacity && <p className="text-xs text-gray-400">Capacity: {s.capacity}</p>}
                    </div>
                  </div>
                  <button onClick={async () => {
                    await fetch(`/api/spaces/${s.id}`, { method: 'DELETE' });
                    setSpaces(prev => prev.filter(sp => sp.id !== s.id));
                  }} className="text-xs text-red-500 hover:text-red-700 transition-colors">Remove</button>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Add New Space</p>
              <div className="space-y-3">
                <input value={spaceForm.name} onChange={e => setSpaceForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Barn, Garden, Ballroom"
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors" />
                <div className="flex gap-3">
                  <div className="flex items-center gap-2 flex-1">
                    <label className="text-xs text-gray-500">Color</label>
                    <input type="color" value={spaceForm.color} onChange={e => setSpaceForm(p => ({ ...p, color: e.target.value }))}
                      className="h-8 w-12 rounded border border-gray-200 cursor-pointer" />
                  </div>
                  <input type="number" value={spaceForm.capacity} onChange={e => setSpaceForm(p => ({ ...p, capacity: e.target.value }))}
                    placeholder="Capacity (optional)"
                    className="flex-1 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors" />
                </div>
                <button
                  disabled={!spaceForm.name.trim() || savingSpace}
                  onClick={async () => {
                    setSavingSpace(true);
                    const res = await fetch('/api/spaces', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: spaceForm.name, color: spaceForm.color, capacity: spaceForm.capacity ? Number(spaceForm.capacity) : null }),
                    });
                    if (res.ok) {
                      const s = await res.json();
                      setSpaces(prev => [...prev, s]);
                      setSpaceForm({ name: '', color: '#6366f1', capacity: '' });
                    }
                    setSavingSpace(false);
                  }}
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#1b1b1b' }}>
                  {savingSpace ? 'Adding...' : 'Add Space'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

