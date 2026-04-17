'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Plus, X, Loader2, Calendar,
  AlertTriangle, ExternalLink, Download, Info, Printer, Repeat,
} from 'lucide-react';
import { describeRule, type RecurrenceRule } from '@/lib/recurrence';

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
  // Recurrence fields (present after API expansion)
  recurrence_rule?: RecurrenceRule | null;
  parent_id?: string;
  is_occurrence?: boolean;
}

interface ConflictInfo { id: string; title: string; start_at: string; end_at: string; }

/** Dropdown + legend order (keep phone_call after tour). */
const EVENT_TYPE_ORDER = [
  'wedding',
  'reception',
  'tour',
  'phone_call',
  'tasting',
  'meeting',
  'rehearsal',
  'hold',
  'blocked',
  'other',
] as const;

const EVENT_TYPE_LABELS: Record<(typeof EVENT_TYPE_ORDER)[number], string> = {
  wedding: 'Wedding',
  reception: 'Reception',
  tour: 'Tour',
  phone_call: 'Phone call',
  tasting: 'Tasting',
  meeting: 'Meeting',
  rehearsal: 'Rehearsal',
  hold: 'Hold',
  blocked: 'Blocked',
  other: 'Other',
};

const EVENT_COLORS: Record<(typeof EVENT_TYPE_ORDER)[number], string> = {
  wedding: '#ec4899',
  reception: '#8b5cf6',
  tour: '#3b82f6',
  phone_call: '#0891b2',
  tasting: '#f59e0b',
  meeting: '#10b981',
  rehearsal: '#6366f1',
  hold: '#94a3b8',
  blocked: '#64748b',
  other: '#6b7280',
};

const MONTHS    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Hours shown in week/day views (6 AM – 10 PM)
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6..22

function fmtConflict(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtHour(h: number) {
  if (h === 0)  return '12 AM';
  if (h < 12)  return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

// Event color helper
function evtColor(evt: CalEvent) {
  const typeColor = EVENT_COLORS[evt.event_type as keyof typeof EVENT_COLORS];
  return evt.venue_spaces?.color ?? typeColor ?? '#6b7280';
}

// Fractional hour position (0 = top of hour slot)
function topPct(iso: string) {
  const d = new Date(iso);
  return (d.getMinutes() / 60) * 100;
}
function heightPct(start: string, end: string) {
  const s = new Date(start), e = new Date(end);
  const mins = Math.max(30, (e.getTime() - s.getTime()) / 60000);
  return (mins / 60) * 100;
}

type RepeatOpt  = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type RepeatEnd  = 'never' | 'on' | 'after';

const emptyForm = () => ({
  title: '', event_type: 'wedding', status: 'confirmed',
  space_id: '', customer_email: '',
  // start & end dates — end defaults to start for single-day events
  date: '', end_date: '',
  start_time: '10:00', end_time: '18:00', all_day: false, notes: '',
  // recurrence
  repeat:          'none'  as RepeatOpt,
  repeat_interval: 1,
  repeat_end:      'never' as RepeatEnd,
  repeat_until:    '',
  repeat_count:    10,
});

// Local-time date string (YYYY-MM-DD) from an ISO. Using this instead of
// iso.slice(0, 10) avoids the timezone off-by-one that bit us before: an
// event at 10 PM local on the 15th is stored as 02:00 UTC on the 16th, and
// .slice(0,10) would then bucket it on the wrong day.
function localDateStr(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Does this event occupy the given YYYY-MM-DD (local)? Handles multi-day by
// checking whether the date sits within [localStartDate, localEndDate].
function eventSpansDate(e: CalEvent, dateStr: string): boolean {
  const s = localDateStr(e.start_at);
  const end = localDateStr(e.end_at);
  return dateStr >= s && dateStr <= end;
}

type CalView = 'month' | 'week' | 'day' | 'revenue';

// ── Calendar Page ─────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const today     = new Date();
  const printRef  = useRef<HTMLDivElement>(null);

  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  // For week/day views: the anchor date
  const [anchorDate, setAnchorDate] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));

  const [events,  setEvents]  = useState<CalEvent[]>([]);
  const [spaces,  setSpaces]  = useState<VenueSpace[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeSpaceFilter, setActiveSpaceFilter] = useState<string>('all');
  const [view, setView] = useState<CalView>('month');

  // Event modal (create + edit share the same form). When editingId is set,
  // the modal is in "Edit" mode and the save handler PATCHes instead of POSTs.
  const [showModal,    setShowModal]    = useState(false);
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [form,         setForm]         = useState(emptyForm());
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState('');
  const [conflicts,    setConflicts]    = useState<ConflictInfo[]>([]);

  // Detail modal
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [deleting,      setDeleting]      = useState(false);

  // Space management (spaces managed in Customer Profile → Overview → Venue Spaces)

  const [icalCopied, setIcalCopied] = useState(false);

  // ── Data fetch — widens range for week/day views ─────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    let from: string, to: string;
    if (view === 'week') {
      const dow  = anchorDate.getDay();
      const sun  = new Date(anchorDate); sun.setDate(sun.getDate() - dow);
      const sat  = new Date(sun);        sat.setDate(sat.getDate() + 6);
      from = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate()).toISOString();
      to   = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate(), 23, 59, 59).toISOString();
    } else if (view === 'day') {
      from = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()).toISOString();
      to   = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate(), 23, 59, 59).toISOString();
    } else {
      from = new Date(year, month, 1).toISOString();
      to   = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    }
    const [evRes, spRes] = await Promise.all([
      fetch(`/api/calendar?from=${from}&to=${to}`),
      fetch('/api/spaces'),
    ]);
    if (evRes.ok) setEvents(await evRes.json());
    if (spRes.ok) setSpaces(await spRes.json());
    setLoading(false);
  }, [year, month, view, anchorDate]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  function prev() {
    if (view === 'month' || view === 'revenue') {
      if (month === 0) { setYear(y => y - 1); setMonth(11); }
      else setMonth(m => m - 1);
    } else if (view === 'week') {
      setAnchorDate(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
    } else {
      setAnchorDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
    }
  }
  function next() {
    if (view === 'month' || view === 'revenue') {
      if (month === 11) { setYear(y => y + 1); setMonth(0); }
      else setMonth(m => m + 1);
    } else if (view === 'week') {
      setAnchorDate(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
    } else {
      setAnchorDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });
    }
  }
  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setAnchorDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  }

  // Keep month/year in sync with anchorDate when switching views
  function switchView(v: CalView) {
    if (v === 'week' || v === 'day') {
      setAnchorDate(new Date(year, month, 1));
    }
    setView(v);
  }

  // ── Month grid helpers ─────────────────────────────────────────────────────
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function eventsForDay(y: number, m: number, d: number): CalEvent[] {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return events.filter(e => {
      if (activeSpaceFilter !== 'all' && e.space_id !== activeSpaceFilter) return false;
      return eventSpansDate(e, dateStr);
    });
  }

  // ── Week view helpers ──────────────────────────────────────────────────────
  const weekDow    = anchorDate.getDay();
  const weekStart  = new Date(anchorDate); weekStart.setDate(weekStart.getDate() - weekDow);
  const weekDays   = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });

  function eventsForWeekDay(d: Date): CalEvent[] {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return events.filter(e => {
      if (activeSpaceFilter !== 'all' && e.space_id !== activeSpaceFilter) return false;
      return eventSpansDate(e, dateStr);
    });
  }

  // ── Save event ─────────────────────────────────────────────────────────────
  async function handleSave(override = false) {
    setSaving(true);
    setSaveError('');
    setConflicts([]);

    // Build start/end as LOCAL times, then serialize to UTC ISO. Previously we
    // were appending "Z" to the raw form values, which silently interpreted a
    // 10:00 AM form entry as 10:00 AM UTC (6 AM EDT).
    const [yy, mm, dd] = form.date.split('-').map(Number);
    // End date defaults to start date (single-day); multi-day users set it
    // explicitly. We always validate that end >= start before building the
    // Date objects so timezone math can't produce a negative duration.
    const endDateStr = form.end_date || form.date;
    const [ey, em_, ed] = endDateStr.split('-').map(Number);
    let startLocal: Date;
    let endLocal:   Date;
    if (form.all_day) {
      startLocal = new Date(yy,      (mm  || 1) - 1, dd || 1,  0,  0,  0);
      endLocal   = new Date(ey || yy,(em_ || mm || 1) - 1, ed || dd || 1, 23, 59, 59);
    } else {
      const [sh, sm] = form.start_time.split(':').map(Number);
      const [eh, en] = form.end_time.split(':').map(Number);
      startLocal = new Date(yy,      (mm  || 1) - 1, dd || 1,  sh || 0, sm || 0, 0);
      endLocal   = new Date(ey || yy,(em_ || mm || 1) - 1, ed || dd || 1, eh || 0, en || 0, 0);
    }

    if (endLocal <= startLocal) {
      setSaveError('End must be after start.');
      setSaving(false);
      return;
    }

    // Build recurrence_rule from the form. We only send a rule when the user
    // actually picked a frequency — a missing/null rule keeps the event one-off.
    let recurrence_rule: RecurrenceRule | null = null;
    if (form.repeat !== 'none') {
      // Validate the end-condition BEFORE we build the rule, otherwise a
      // half-filled form (e.g. "Ends on" radio selected but no date picked)
      // silently produces a never-ending series.
      if (form.repeat_end === 'on' && !form.repeat_until) {
        setSaveError('Pick an end date for the recurrence, or change "Ends" to Never or After.');
        setSaving(false);
        return;
      }
      if (form.repeat_end === 'after' && (!form.repeat_count || form.repeat_count < 1)) {
        setSaveError('Enter how many times the event should repeat, or change "Ends" to Never or On.');
        setSaving(false);
        return;
      }
      if (form.repeat_end === 'on' && form.repeat_until < (form.end_date || form.date)) {
        setSaveError('Recurrence end date must be on or after the event end date.');
        setSaving(false);
        return;
      }

      const rule: RecurrenceRule = { freq: form.repeat };
      if (form.repeat_interval && form.repeat_interval > 1) {
        rule.interval = Math.floor(form.repeat_interval);
      }
      if (form.repeat_end === 'on' && form.repeat_until) {
        rule.until = form.repeat_until;
      } else if (form.repeat_end === 'after' && form.repeat_count > 0) {
        rule.count = Math.floor(form.repeat_count);
      }
      recurrence_rule = rule;
    }

    const payload = {
      title: form.title, event_type: form.event_type, status: form.status,
      space_id: form.space_id || null, customer_email: form.customer_email || null,
      start_at: startLocal.toISOString(), end_at: endLocal.toISOString(), all_day: form.all_day,
      notes: form.notes || null, override_conflict: override,
      recurrence_rule,
    };

    // POST to create, PATCH when editing an existing event. PATCH always
    // targets the parent id (edit affects the whole series), which matches
    // the "MVP contract" on the API side.
    const res = editingId
      ? await fetch(`/api/calendar/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

    const json = await res.json();
    if (!res.ok) {
      if (json.error === 'conflict') { setConflicts(json.conflicts ?? []); }
      else setSaveError(json.error ?? 'Failed to save');
      setSaving(false);
      return;
    }

    // Jump the view to wherever the saved event lives so the user immediately
    // sees the block — otherwise future-dated events disappear silently.
    const eventDate = new Date(json.start_at);
    setYear(eventDate.getFullYear());
    setMonth(eventDate.getMonth());
    setAnchorDate(new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()));

    // For recurring events the API expands occurrences at GET time, so a
    // local splice of just the base row would miss every occurrence past the
    // current month. Refetch to let the server hand back the whole series.
    // The view state changed above will retrigger fetchAll via the useEffect
    // dependency on year/month/anchor, so we don't call it manually here.

    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm());
    setConflicts([]);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
    // Occurrences share a parent_id; stripping by parent_id removes the
    // whole series in one pass, and also handles the non-recurring case
    // because we set parent_id === id for those in the API.
    const gone = events.find(e => e.id === id);
    const parent = gone?.parent_id ?? id;
    setEvents(prev => prev.filter(e => e.id !== id && e.parent_id !== parent));
    setSelectedEvent(null);
    setDeleting(false);
  }

  function openNewEvent(dateStr?: string, time?: string) {
    const f = emptyForm();
    if (dateStr) { f.date = dateStr; f.end_date = dateStr; }
    if (time)    { f.start_time = time; f.end_time = `${String(Math.min(23, parseInt(time) + 1)).padStart(2, '0')}:00`; }
    setEditingId(null);
    setForm(f);
    setConflicts([]);
    setSaveError('');
    setShowModal(true);
  }

  // Open the modal in Edit mode, pre-populated from an existing event. We
  // always edit the parent of the series (never a single occurrence) — the
  // API enforces this by stripping the `@YYYY-MM-DD` suffix server-side.
  function openEditEvent(e: CalEvent) {
    const s = new Date(e.start_at);
    const en = new Date(e.end_at);
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const rule = e.recurrence_rule ?? null;
    setForm({
      title: e.title,
      event_type: e.event_type,
      status: e.status,
      space_id: e.space_id ?? '',
      customer_email: e.customer_email ?? '',
      date:     localDateStr(e.start_at),
      end_date: localDateStr(e.end_at),
      start_time: hhmm(s),
      end_time:   hhmm(en),
      all_day: !!e.all_day,
      notes: e.notes ?? '',
      repeat:          (rule?.freq ?? 'none') as RepeatOpt,
      repeat_interval: rule?.interval ?? 1,
      repeat_end:      (rule?.until ? 'on' : rule?.count ? 'after' : 'never') as RepeatEnd,
      repeat_until:    rule?.until ?? '',
      repeat_count:    rule?.count ?? 10,
    });
    // Edit always targets the parent row — occurrence ids contain an `@`.
    const parentId = e.id.includes('@') ? e.id.split('@')[0] : e.id;
    setEditingId(parentId);
    setSelectedEvent(null);
    setConflicts([]);
    setSaveError('');
    setShowModal(true);
  }

  // ── Print ──────────────────────────────────────────────────────────────────
  function handlePrint() {
    window.print();
  }

  // ── iCal ──────────────────────────────────────────────────────────────────
  async function copyIcal() {
    try {
      const res = await fetch('/api/venues/me');
      if (res.ok) {
        const venue = await res.json();
        await navigator.clipboard.writeText(`${window.location.origin}/api/calendar/ical?token=${venue.id}`);
      }
    } catch { /* ignore */ }
    setIcalCopied(true);
    setTimeout(() => setIcalCopied(false), 2500);
  }

  // ── Derived counts ────────────────────────────────────────────────────────
  const visibleCount  = events.filter(e => activeSpaceFilter === 'all' || e.space_id === activeSpaceFilter).length;
  const weddingCount  = events.filter(e => e.event_type === 'wedding' && (activeSpaceFilter === 'all' || e.space_id === activeSpaceFilter)).length;

  // Title label for navigation
  function navLabel() {
    if (view === 'month' || view === 'revenue') return `${MONTHS[month]} ${year}`;
    if (view === 'week') {
      const sat = weekDays[6];
      if (weekDays[0].getMonth() === sat.getMonth())
        return `${MONTHS[weekDays[0].getMonth()].slice(0,3)} ${weekDays[0].getDate()}–${sat.getDate()}, ${year}`;
      return `${MONTHS[weekDays[0].getMonth()].slice(0,3)} ${weekDays[0].getDate()} – ${MONTHS[sat.getMonth()].slice(0,3)} ${sat.getDate()}, ${year}`;
    }
    return `${DAYS_LONG[anchorDate.getDay()]}, ${MONTHS[anchorDate.getMonth()]} ${anchorDate.getDate()}, ${anchorDate.getFullYear()}`;
  }

  // ── Shared hour grid (week + day) ─────────────────────────────────────────
  function HourGrid({ cols }: { cols: { date: Date; events: CalEvent[] }[] }) {
    const SLOT_H = 60; // px per hour
    return (
      <div className="flex overflow-auto" style={{ maxHeight: '70vh' }}>
        {/* Time gutter */}
        <div className="flex-shrink-0 w-14 border-r border-gray-100">
          <div className="h-8 border-b border-gray-100" /> {/* header spacer */}
          {HOURS.map(h => (
            <div key={h} style={{ height: SLOT_H }} className="relative border-b border-gray-50 pr-2">
              <span className="absolute -top-2 right-2 text-[10px] text-gray-400">{fmtHour(h)}</span>
            </div>
          ))}
        </div>
        {/* Day columns */}
        {cols.map(({ date: d, events: dayEvts }, ci) => {
          const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
          const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          return (
            <div key={ci} className="flex-1 min-w-0 border-r border-gray-100 last:border-r-0">
              {/* Day header */}
              <div className={`h-8 flex items-center justify-center gap-1 border-b border-gray-100 text-xs font-semibold ${isToday ? 'text-white' : 'text-gray-600'}`}
                style={isToday ? { backgroundColor: '#1b1b1b' } : {}}>
                {cols.length > 1 && <span className="text-[10px] font-normal">{DAYS_SHORT[d.getDay()]}</span>}
                <span>{d.getDate()}</span>
              </div>
              {/* Hour slots + events */}
              <div className="relative">
                {HOURS.map(h => (
                  <div key={h} style={{ height: SLOT_H }}
                    className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
                    onClick={() => openNewEvent(dateStr, `${String(h).padStart(2,'0')}:00`)} />
                ))}
                {/* Position events absolutely. For multi-day events, we clip
                    the render window to this specific day: day 1 renders
                    start→midnight, middle days render full 0–24, last day
                    renders 0→end. */}
                {dayEvts.filter(e => !e.all_day).map(e => {
                  const evStart  = new Date(e.start_at);
                  const evEnd    = new Date(e.end_at);
                  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
                  const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
                  const winStart = evStart < dayStart ? dayStart : evStart;
                  const winEnd   = evEnd   > dayEnd   ? dayEnd   : evEnd;
                  const startH = winStart.getHours() + winStart.getMinutes() / 60;
                  const endH   = winEnd.getHours()   + winEnd.getMinutes()   / 60;
                  const clampedStart = Math.max(HOURS[0], startH);
                  const clampedEnd   = Math.min(HOURS[HOURS.length - 1] + 1, endH);
                  const top    = (clampedStart - HOURS[0]) * SLOT_H;
                  const height = Math.max(22, (clampedEnd - clampedStart) * SLOT_H - 2);
                  const isContinuation = evStart < dayStart;
                  const endsLater = evEnd > dayEnd;
                  return (
                    <button
                      key={`${e.id}-${dateStr}`}
                      onClick={ev => { ev.stopPropagation(); setSelectedEvent(e); }}
                      className="absolute left-0.5 right-0.5 rounded text-white text-[10px] font-medium px-1 py-0.5 text-left overflow-hidden leading-tight hover:opacity-90 transition-opacity"
                      style={{ top, height, backgroundColor: evtColor(e), zIndex: 2 }}
                    >
                      <span className="block truncate">
                        {isContinuation && '← '}{e.title}{endsLater && ' →'}
                      </span>
                      {height > 28 && <span className="block text-[9px] opacity-80 truncate">{fmtTime(e.start_at)} – {fmtTime(e.end_at)}</span>}
                    </button>
                  );
                })}
                {/* All-day events at top */}
                {dayEvts.filter(e => e.all_day).map(e => (
                  <button key={e.id} onClick={ev => { ev.stopPropagation(); setSelectedEvent(e); }}
                    className="absolute top-0 left-0.5 right-0.5 h-5 rounded text-white text-[10px] font-medium px-1 truncate text-left"
                    style={{ backgroundColor: evtColor(e), zIndex: 3 }}>
                    {e.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {/* ── Print styles injected in <head> via a style tag ─────────────── */}
      <style>{`
        @media print {
          /* Hide everything except the calendar print area */
          body > * { display: none !important; }
          #cal-print-area { display: block !important; }
          #cal-print-area * { display: revert; }
          /* Force white background, remove shadows */
          #cal-print-area { background: white; padding: 0; }
          /* Hide buttons inside the print area */
          #cal-print-area button,
          #cal-print-area [data-noprint] { display: none !important; }
          @page { margin: 1cm; }
        }
      `}</style>

      <div id="cal-print-area" ref={printRef}>
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3" data-noprint="">
          <div>
            <h1 className="font-heading text-2xl text-gray-900">Calendar</h1>
            <p className="mt-1 text-sm text-gray-500">
              {visibleCount} event{visibleCount !== 1 ? 's' : ''}
              {weddingCount > 0 && ` · ${weddingCount} wedding${weddingCount !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={copyIcal}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              <Download size={13} />{icalCopied ? 'Copied!' : 'iCal Link'}
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              <Printer size={13} /> Print
            </button>
            <button onClick={() => openNewEvent()}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: '#1b1b1b' }}>
              <Plus size={15} /> Add Event
            </button>
          </div>
        </div>

        {/* Print title (hidden on screen) */}
        <div className="hidden print:block mb-4">
          <h1 className="text-xl font-bold text-gray-900">Calendar — {navLabel()}</h1>
        </div>

        {/* Nav + view switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <button onClick={prev} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 transition-colors"><ChevronLeft size={16} /></button>
            <span className="text-base font-semibold text-gray-900 min-w-[180px] text-center">{navLabel()}</span>
            <button onClick={next} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 transition-colors"><ChevronRight size={16} /></button>
            <button onClick={goToday}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">Today</button>
          </div>
          <div className="flex rounded-xl border border-gray-200 overflow-hidden" data-noprint="">
            {(['month','week','day','revenue'] as CalView[]).map((v, i) => (
              <button key={v} onClick={() => switchView(v)}
                className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${i > 0 ? 'border-l border-gray-200' : ''} ${view === v ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {v === 'revenue' ? 'Year' : v}
              </button>
            ))}
          </div>
        </div>

        {/* Space filters */}
        {spaces.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4" data-noprint="">
            <button onClick={() => setActiveSpaceFilter('all')}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${activeSpaceFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              All Spaces
            </button>
            {spaces.map(s => (
              <button key={s.id} onClick={() => setActiveSpaceFilter(activeSpaceFilter === s.id ? 'all' : s.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${activeSpaceFilter === s.id ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                style={activeSpaceFilter === s.id ? { backgroundColor: s.color, borderColor: s.color } : {}}>
                <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: s.color }} />
                {s.name}{s.capacity ? ` (${s.capacity})` : ''}
              </button>
            ))}
          </div>
        )}

        {/* ── MONTH VIEW ── */}
        {view === 'month' && (
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-200">
              {DAYS_SHORT.map(d => (
                <div key={d} className="py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400">{d}</div>
              ))}
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
            ) : (
              <div className="grid grid-cols-7">
                {cells.map((day, idx) => {
                  const dayEvts = day ? eventsForDay(year, month, day) : [];
                  const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                  const isWeekend = (idx % 7 === 0) || (idx % 7 === 6);
                  const dateStr = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                  return (
                    <div key={idx}
                      className={`min-h-[96px] border-b border-r border-gray-100 p-1 ${!day ? 'bg-gray-50/40' : 'cursor-pointer hover:bg-gray-50/60 transition-colors'} ${isWeekend && day ? 'bg-stone-50/30' : ''}`}
                      onClick={() => day && openNewEvent(dateStr)}>
                      {day && (
                        <>
                          <div className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'text-white' : 'text-gray-700'}`}
                            style={isToday ? { backgroundColor: '#1b1b1b' } : {}}>
                            {day}
                          </div>
                          <div className="space-y-0.5">
                            {dayEvts.slice(0, 3).map(evt => (
                              <button key={evt.id}
                                onClick={e => { e.stopPropagation(); setSelectedEvent(evt); }}
                                className="w-full text-left rounded px-1.5 py-0.5 text-[11px] font-medium text-white truncate leading-tight"
                                style={{ backgroundColor: evtColor(evt) }}>
                                {evt.title}
                              </button>
                            ))}
                            {dayEvts.length > 3 && <p className="text-[10px] text-gray-400 pl-1">+{dayEvts.length - 3} more</p>}
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

        {/* ── WEEK VIEW ── */}
        {view === 'week' && (
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
            ) : (
              <HourGrid cols={weekDays.map(d => ({ date: d, events: eventsForWeekDay(d) }))} />
            )}
          </div>
        )}

        {/* ── DAY VIEW ── */}
        {view === 'day' && (
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
            ) : (
              <HourGrid cols={[{ date: anchorDate, events: eventsForWeekDay(anchorDate) }]} />
            )}
          </div>
        )}

        {/* ── YEAR / REVENUE VIEW ── */}
        {view === 'revenue' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 mb-6">
            <h2 className="font-heading text-lg text-gray-900 mb-4">Year-at-a-Glance — Bookings</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 12 }, (_, i) => {
                const m = i, y = year;
                const monthEvts = events.filter(e => { const d = new Date(e.start_at); return d.getFullYear() === y && d.getMonth() === m; });
                const weddings  = monthEvts.filter(e => e.event_type === 'wedding' || e.event_type === 'reception');
                const tours     = monthEvts.filter(e => e.event_type === 'tour');
                const phoneCalls = monthEvts.filter(e => e.event_type === 'phone_call');
                const isCurrent = m === today.getMonth() && y === today.getFullYear();
                return (
                  <button key={m}
                    onClick={() => { setMonth(m); setView('month'); }}
                    className={`rounded-xl border p-3 text-left transition-colors hover:border-gray-400 ${isCurrent ? 'border-gray-900' : 'border-gray-200'}`}>
                    <p className={`text-xs font-semibold mb-1.5 ${isCurrent ? 'text-gray-900' : 'text-gray-500'}`}>{MONTHS[m].slice(0,3)}</p>
                    {weddings.length > 0 && <p className="text-[11px] font-medium text-pink-600">{weddings.length} wedding{weddings.length !== 1 ? 's' : ''}</p>}
                    {tours.length    > 0 && <p className="text-[11px] text-blue-600">{tours.length} tour{tours.length !== 1 ? 's' : ''}</p>}
                    {phoneCalls.length > 0 && <p className="text-[11px] text-cyan-600">{phoneCalls.length} phone call{phoneCalls.length !== 1 ? 's' : ''}</p>}
                    {monthEvts.length === 0 && <p className="text-[11px] text-gray-300">—</p>}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-gray-400 flex items-center gap-1.5"><Info size={12} /> Click a month to jump to it.</p>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3">
          {EVENT_TYPE_ORDER.map((key) => (
            <div key={key} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: EVENT_COLORS[key] }} />
              {EVENT_TYPE_LABELS[key]}
            </div>
          ))}
        </div>
      </div>{/* end cal-print-area */}

      {/* ── Create / Edit Event Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 max-h-[90vh] overflow-y-auto">
            <button onClick={() => { setShowModal(false); setEditingId(null); setConflicts([]); setSaveError(''); }}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">{editingId ? 'Edit Event' : 'New Event'}</h2>
            {editingId && form.repeat !== 'none' && (
              <p className="-mt-3 mb-4 text-[11px] text-gray-500 flex items-center gap-1.5">
                <Info size={12} /> Changes apply to the entire series.
              </p>
            )}

            {conflicts.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Booking Conflict Detected</p>
                    <p className="text-xs text-amber-700 mt-0.5">This space already has an event during this time:</p>
                    {conflicts.map(c => (
                      <p key={c.id} className="text-xs text-amber-700 font-medium mt-1">— {c.title} ({fmtConflict(c.start_at)} → {fmtConflict(c.end_at)})</p>
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
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Type</label>
                  <select value={form.event_type} onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none">
                    {EVENT_TYPE_ORDER.map((k) => (
                      <option key={k} value={k}>{EVENT_TYPE_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none">
                    <option value="confirmed">Confirmed</option>
                    <option value="tentative">Tentative / Hold</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Space</label>
                <select value={form.space_id} onChange={e => setForm(p => ({ ...p, space_id: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none">
                  <option value="">No specific space</option>
                  {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Customer Email</label>
                <input type="email" value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))}
                  placeholder="couple@example.com"
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Start Date *</label>
                  <input type="date" value={form.date}
                    onChange={e => setForm(p => ({
                      ...p,
                      date: e.target.value,
                      // Snap end date forward if the new start is after it,
                      // and also auto-fill end_date on first pick.
                      end_date: (!p.end_date || p.end_date < e.target.value) ? e.target.value : p.end_date,
                    }))}
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">End Date</label>
                  <input type="date" value={form.end_date} min={form.date || undefined}
                    onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                </div>
              </div>
              {form.end_date && form.date && form.end_date !== form.date && (
                <p className="-mt-2 text-[11px] text-gray-500">
                  Multi-day event spanning {(() => {
                    const a = new Date(form.date);
                    const b = new Date(form.end_date);
                    return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
                  })()} days.
                </p>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" id="allday" checked={form.all_day} onChange={e => setForm(p => ({ ...p, all_day: e.target.checked }))} className="rounded" />
                <label htmlFor="allday" className="text-sm text-gray-700">All day</label>
              </div>
              {!form.all_day && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Start Time</label>
                    <input type="time" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">End Time</label>
                    <input type="time" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none" />
                  </div>
                </div>
              )}

              {/* ── Recurrence ──────────────────────────────────────────── */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3.5 space-y-3">
                <div className="flex items-center gap-2">
                  <Repeat size={14} className="text-gray-500" />
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Repeats</label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select value={form.repeat}
                    onChange={e => setForm(p => {
                      const next = e.target.value as RepeatOpt;
                      // When the user FIRST picks a frequency (from "none"),
                      // flip the default end condition from Never to On and
                      // pre-fill a sensible end date so they can't forget and
                      // accidentally create a forever-series. Daily defaults
                      // to +3 months, weekly/monthly/yearly default to +1 year.
                      if (p.repeat === 'none' && next !== 'none' && p.repeat_end === 'never' && !p.repeat_until) {
                        const base = new Date(p.end_date || p.date || new Date().toISOString().slice(0, 10));
                        if (next === 'daily') base.setMonth(base.getMonth() + 3);
                        else if (next === 'weekly')  base.setMonth(base.getMonth() + 12);
                        else if (next === 'monthly') base.setFullYear(base.getFullYear() + 2);
                        else                          base.setFullYear(base.getFullYear() + 5);
                        const defaultUntil = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
                        return { ...p, repeat: next, repeat_end: 'on' as RepeatEnd, repeat_until: defaultUntil };
                      }
                      return { ...p, repeat: next };
                    })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none">
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                  {form.repeat !== 'none' && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">every</span>
                      <input type="number" min={1} max={99} value={form.repeat_interval}
                        onChange={e => setForm(p => ({ ...p, repeat_interval: Math.max(1, parseInt(e.target.value) || 1) }))}
                        className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none" />
                      <span className="text-xs text-gray-500">
                        {form.repeat === 'daily'   ? (form.repeat_interval === 1 ? 'day'   : 'days')
                        : form.repeat === 'weekly'  ? (form.repeat_interval === 1 ? 'week'  : 'weeks')
                        : form.repeat === 'monthly' ? (form.repeat_interval === 1 ? 'month' : 'months')
                        : (form.repeat_interval === 1 ? 'year' : 'years')}
                      </span>
                    </div>
                  )}
                </div>
                {form.repeat !== 'none' && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ends</p>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="radio" id="end-never" name="repeat-end" checked={form.repeat_end === 'never'}
                        onChange={() => setForm(p => ({ ...p, repeat_end: 'never' }))} />
                      <label htmlFor="end-never">Never</label>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="radio" id="end-on" name="repeat-end" checked={form.repeat_end === 'on'}
                        onChange={() => setForm(p => ({ ...p, repeat_end: 'on' }))} />
                      <label htmlFor="end-on">On</label>
                      <input type="date" value={form.repeat_until}
                        min={form.end_date || form.date || undefined}
                        disabled={form.repeat_end !== 'on'}
                        onChange={e => setForm(p => ({ ...p, repeat_until: e.target.value, repeat_end: 'on' }))}
                        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none disabled:opacity-40" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="radio" id="end-after" name="repeat-end" checked={form.repeat_end === 'after'}
                        onChange={() => setForm(p => ({ ...p, repeat_end: 'after' }))} />
                      <label htmlFor="end-after">After</label>
                      <input type="number" min={1} max={500} value={form.repeat_count}
                        disabled={form.repeat_end !== 'after'}
                        onChange={e => setForm(p => ({ ...p, repeat_count: Math.max(1, parseInt(e.target.value) || 1), repeat_end: 'after' }))}
                        className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none disabled:opacity-40" />
                      <span className="text-xs text-gray-500">occurrences</span>
                    </div>
                    {form.repeat_end === 'never' && (
                      <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                        This event will repeat forever. Pick "On" or "After" to set an end.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none resize-none" />
              </div>
            </div>

            {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setShowModal(false); setEditingId(null); setConflicts([]); setSaveError(''); }}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={() => handleSave(false)} disabled={saving || !form.title || !form.date}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#1b1b1b' }}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Save Changes' : 'Save Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Event detail modal ── */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6">
            <button onClick={() => setSelectedEvent(null)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: evtColor(selectedEvent) }}>
                <Calendar size={16} className="text-white" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{selectedEvent.title}</p>
                <p className="text-xs text-gray-400 capitalize">
                  {EVENT_TYPE_LABELS[selectedEvent.event_type as keyof typeof EVENT_TYPE_LABELS] ?? selectedEvent.event_type} · {selectedEvent.status}
                </p>
              </div>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              {localDateStr(selectedEvent.start_at) === localDateStr(selectedEvent.end_at) ? (
                <p><span className="text-gray-400">Date:</span> {new Date(selectedEvent.start_at).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })}</p>
              ) : (
                <p><span className="text-gray-400">Dates:</span>{' '}
                  {new Date(selectedEvent.start_at).toLocaleDateString('en-US', { month:'short', day:'numeric' })}
                  {' – '}
                  {new Date(selectedEvent.end_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
                </p>
              )}
              {!selectedEvent.all_day && (
                <p><span className="text-gray-400">Time:</span> {fmtTime(selectedEvent.start_at)} – {fmtTime(selectedEvent.end_at)}</p>
              )}
              {selectedEvent.recurrence_rule && (
                <p className="flex items-center gap-1.5">
                  <Repeat size={12} className="text-gray-400" />
                  <span className="text-gray-400">Repeats:</span>{' '}
                  {describeRule(selectedEvent.recurrence_rule)}
                  {selectedEvent.is_occurrence && <span className="text-[10px] text-gray-400">(occurrence)</span>}
                </p>
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
            <div className="flex justify-between items-center mt-5 gap-3">
              <button
                onClick={() => openEditEvent(selectedEvent)}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Edit
              </button>
              <button
                onClick={() => {
                  if (selectedEvent.recurrence_rule) {
                    // Deleting the parent nukes every occurrence. Warn the
                    // user before they accidentally wipe a weekly series.
                    const ok = window.confirm('This is a repeating event. Deleting it will remove every occurrence in the series. Continue?');
                    if (!ok) return;
                  }
                  handleDelete(selectedEvent.id);
                }}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                {deleting && <Loader2 size={13} className="animate-spin" />}
                {selectedEvent.recurrence_rule ? 'Delete Series' : 'Delete Event'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
