'use client';

/**
 * EventEditorModal — shared "New / Edit event" form used by the venue
 * calendar page AND the super-admin support inbox.
 *
 * Single source of truth: anything we change about how events are booked
 * (new fields, new validations, new availability behavior, etc.) ships in
 * one place and both surfaces pick it up. There is no admin-side clone.
 *
 * Cross-context wiring:
 *
 *   • When `actingAsVenueId` is set (super-admin support inbox) every fetch
 *     adds the `X-Acting-As-Venue: <id>` header. The server's
 *     `getEffectiveVenueId()` honors it iff the caller has an admin/support
 *     session — so this is safe to ship and impossible to abuse from a
 *     normal venue cookie.
 *   • When `actingAsVenueId` is NOT set the modal behaves exactly like the
 *     venue's original modal: no header, requests are scoped by the venue's
 *     own session cookie.
 *
 * The component owns ALL its state (form, contacts, slots, recurrence,
 * spaces, calendars, team) so callers don't have to thread a dozen props.
 * Parents that already loaded these lists for their own UI can pass them
 * in via `dataSources` to skip the duplicate fetch.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Loader2, AlertTriangle, Search, Pencil, Trash2, Check, Plus, User, Repeat, Info,
} from 'lucide-react';
import { toTitleCase } from '@/lib/utils';
import {
  DEFAULT_VENUE_TIMEZONE,
  dateStrInTimeZone,
  resolveVenueTimezone,
  timeStrInTimeZone,
  venueDayBoundsUtc,
  wallClockToUtc,
} from '@/lib/venue-timezone';
import { toDate } from 'date-fns-tz';
import type { RecurrenceRule } from '@/lib/recurrence';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VenueSpace { id: string; name: string; color: string; capacity?: number | null; }
export interface VenueCalendarLite { id: string; name: string; color: string; is_default: boolean; }
export interface TeamMemberLite {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status?: string;
  role?: string;
}
interface ContactLite {
  id: string;
  first_name: string | null;
  last_name: string | null;
  customer_email: string | null;
  phone: string | null;
}
interface ConflictInfo { id: string; title: string; start_at: string; end_at: string; }

/** Minimal shape returned by /api/calendar after a save. We don't enumerate
 *  every column — callers usually only care about the id + start_at. */
export interface SavedEvent {
  id:        string;
  start_at:  string;
  end_at:    string;
  [key: string]: unknown;
}

/** Subset of an existing event needed to seed the form for edit mode. */
export interface EventForEdit {
  id: string;
  title: string;
  event_type: string;
  status: string;
  space_id: string | null;
  customer_email: string | null;
  notes: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  assigned_team_member_id?: string | null;
  calendar_id?: string | null;
  recurrence_rule?: RecurrenceRule | null;
}

export interface EventEditorPrefill {
  customerEmail?: string;
  customerName?:  string;
  title?:         string;
  date?:          string;   // YYYY-MM-DD in venue tz
  endDate?:       string;
  startTime?:     string;   // HH:mm
  endTime?:       string;
  allDay?:        boolean;
  notes?:         string;
}

export interface EventEditorDataSources {
  /** Already-loaded venue spaces. When provided, the modal skips the GET
   *  /api/spaces call. CRUD on spaces from inside the modal still calls the
   *  API — the parent will need to refetch its own spaces afterwards if it
   *  cares about reflecting changes elsewhere. */
  spaces?:         VenueSpace[];
  venueCalendars?: VenueCalendarLite[];
  teamMembers?:    TeamMemberLite[];
}

export interface EventEditorModalProps {
  open:    boolean;
  onClose: () => void;
  /** Called after a successful save with the API's response row. */
  onSaved: (saved: SavedEvent) => void;

  /** When set, every fetch adds the `X-Acting-As-Venue` header so the venue
   *  endpoints operate on this venue id — used by the super-admin support
   *  inbox. When undefined the modal uses the venue cookie session. */
  actingAsVenueId?: string;

  /** IANA timezone used for date ↔ wall-clock conversions. Defaults to UTC
   *  if the parent doesn't pass one. */
  venueTimezone?: string;

  /** Pre-fill the form when opening in create mode. */
  prefill?: EventEditorPrefill;

  /** When set, the modal opens in edit mode for this event. */
  editingEvent?: EventForEdit | null;

  /** Optional already-loaded venue data so we can skip duplicate fetches. */
  dataSources?: EventEditorDataSources;
}

type RepeatOpt = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type RepeatEnd = 'never' | 'on' | 'after';

const EVENT_TYPE_ORDER = [
  'wedding','reception','tour','phone_call','tasting','meeting','rehearsal','hold','blocked','other',
] as const;
const EVENT_TYPE_LABELS: Record<(typeof EVENT_TYPE_ORDER)[number], string> = {
  wedding: 'Wedding', reception: 'Reception', tour: 'Tour', phone_call: 'Phone call',
  tasting: 'Tasting', meeting: 'Meeting', rehearsal: 'Rehearsal',
  hold: 'Hold', blocked: 'Blocked', other: 'Other',
};

function emptyForm() {
  return {
    title: '', event_type: 'wedding', status: 'confirmed',
    space_id: '', customer_email: '',
    assigned_team_member_id: '',
    calendar_id: '' as string,
    date: '', end_date: '',
    start_time: '10:00', end_time: '18:00', all_day: false, notes: '',
    repeat: 'none' as RepeatOpt,
    repeat_interval: 1,
    repeat_end: 'never' as RepeatEnd,
    repeat_until: '',
    repeat_count: 10,
  };
}

function fmtConflict(iso: string, tz: string) {
  const z = resolveVenueTimezone(tz);
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: z });
}

function teamMemberLabel(m: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }) {
  const full = toTitleCase([m.first_name, m.last_name].filter(Boolean).join(' ').trim());
  return toTitleCase(m.name?.trim() || '') || full || m.email || 'Unnamed';
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function EventEditorModal({
  open,
  onClose,
  onSaved,
  actingAsVenueId,
  venueTimezone,
  prefill,
  editingEvent,
  dataSources,
}: EventEditorModalProps) {
  const tz = resolveVenueTimezone(venueTimezone || DEFAULT_VENUE_TIMEZONE);
  const editingId = editingEvent?.id ? (editingEvent.id.includes('@') ? editingEvent.id.split('@')[0] : editingEvent.id) : null;

  // Build a fetch wrapper that adds the act-as-venue header when configured.
  // Memoized so its identity is stable across renders.
  const apiFetch = useMemo(() => {
    return (input: RequestInfo, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (actingAsVenueId) headers.set('X-Acting-As-Venue', actingAsVenueId);
      return fetch(input, { ...init, headers });
    };
  }, [actingAsVenueId]);

  const modalBodyRef = useRef<HTMLDivElement>(null);
  const modalScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);

  // Slots
  const [timeMode, setTimeMode] = useState<'default' | 'custom'>('default');
  const [availSlots, setAvailSlots] = useState<{ time: string; label: string; available: boolean }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState('');

  // Lookups
  const [spaces, setSpaces] = useState<VenueSpace[]>(dataSources?.spaces ?? []);
  const [venueCalendars, setVenueCalendars] = useState<VenueCalendarLite[]>(dataSources?.venueCalendars ?? []);
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>(dataSources?.teamMembers ?? []);

  // Contact search
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<ContactLite[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);

  // Spaces management UI
  const [manageSpaces, setManageSpaces] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceColor, setNewSpaceColor] = useState('#6366f1');
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editSpaceDraft, setEditSpaceDraft] = useState<{ name: string; color: string }>({ name: '', color: '#6366f1' });
  const [spaceBusy, setSpaceBusy] = useState(false);

  // ── Reset / seed when opening ───────────────────────────────────────────
  // Track the "open transition" so we only seed when transitioning from
  // closed → open, not on every prop change while already open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;

    if (editingEvent) {
      const z = tz;
      const rule = editingEvent.recurrence_rule ?? null;
      setForm({
        title: editingEvent.title,
        event_type: editingEvent.event_type,
        status: editingEvent.status,
        space_id: editingEvent.space_id ?? '',
        customer_email: editingEvent.customer_email ?? '',
        assigned_team_member_id: editingEvent.assigned_team_member_id ?? '',
        date:     dateStrInTimeZone(editingEvent.start_at, z),
        end_date: dateStrInTimeZone(editingEvent.end_at, z),
        start_time: timeStrInTimeZone(editingEvent.start_at, z),
        end_time:   timeStrInTimeZone(editingEvent.end_at, z),
        all_day: !!editingEvent.all_day,
        notes: editingEvent.notes ?? '',
        repeat:          (rule?.freq ?? 'none') as RepeatOpt,
        repeat_interval: rule?.interval ?? 1,
        repeat_end:      (rule?.until ? 'on' : rule?.count ? 'after' : 'never') as RepeatEnd,
        repeat_until:    rule?.until ?? '',
        repeat_count:    rule?.count ?? 10,
        calendar_id:     editingEvent.calendar_id ?? '',
      });
      setContactQuery(editingEvent.customer_email ?? '');
    } else {
      const f = emptyForm();
      if (prefill?.customerEmail) f.customer_email = prefill.customerEmail;
      if (prefill?.title)         f.title          = prefill.title;
      else if (prefill?.customerName) f.title      = `Appointment — ${prefill.customerName}`;
      if (prefill?.date)          { f.date         = prefill.date; f.end_date = prefill.endDate || prefill.date; }
      if (prefill?.endDate)       f.end_date       = prefill.endDate;
      if (prefill?.startTime)     f.start_time     = prefill.startTime;
      if (prefill?.endTime)       f.end_time       = prefill.endTime;
      if (prefill?.allDay)        f.all_day        = !!prefill.allDay;
      if (prefill?.notes)         f.notes          = prefill.notes;
      setForm(f);
      setContactQuery(
        prefill?.customerName && prefill?.customerEmail
          ? `${prefill.customerName} <${prefill.customerEmail}>`
          : prefill?.customerEmail ?? '',
      );
    }
    setTimeMode('default');
    setAvailSlots([]);
    setSelectedSlot('');
    setContactResults([]);
    setContactDropdownOpen(false);
    setManageSpaces(false);
    setEditingSpaceId(null);
    setConflicts([]);
    setSaveError('');
    setSaving(false);
    setSpaceBusy(false);
  }, [open, editingEvent, prefill, tz]);

  // ── Lookup loaders (only fetch if parent didn't pass them) ──────────────
  useEffect(() => {
    if (!open) return;
    if (dataSources?.spaces) return;
    let cancelled = false;
    apiFetch('/api/spaces').then(r => r.ok ? r.json() : []).then((rows: VenueSpace[]) => {
      if (!cancelled) setSpaces(Array.isArray(rows) ? rows : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, dataSources?.spaces, apiFetch]);

  useEffect(() => {
    if (!open) return;
    if (dataSources?.venueCalendars) return;
    let cancelled = false;
    apiFetch('/api/venue-calendars').then(r => r.ok ? r.json() : []).then((rows: VenueCalendarLite[]) => {
      if (!cancelled) setVenueCalendars(Array.isArray(rows) ? rows : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, dataSources?.venueCalendars, apiFetch]);

  useEffect(() => {
    if (!open) return;
    if (dataSources?.teamMembers) return;
    let cancelled = false;
    apiFetch('/api/team').then(r => r.ok ? r.json() : []).then((rows: TeamMemberLite[]) => {
      if (!cancelled) setTeamMembers(Array.isArray(rows) ? rows : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, dataSources?.teamMembers, apiFetch]);

  // ── Slots fetch ─────────────────────────────────────────────────────────
  const fetchSlots = useCallback((dateStr: string) => {
    setLoadingSlots(true);
    setAvailSlots([]);
    apiFetch(`/api/calendar/slots?date=${dateStr}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { slots?: { time: string; label: string; available: boolean }[] } | null) => {
        if (d?.slots) {
          setAvailSlots(d.slots);
          const first = d.slots.find((s) => s.available);
          if (first) {
            setSelectedSlot(first.time);
            setForm((f) => {
              const [h, m] = first.time.split(':').map(Number);
              const endH = Math.min(23, h + 1);
              return { ...f, start_time: first.time, end_time: `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}` };
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSlots(false));
  }, [apiFetch]);

  // Re-fetch slots when the date changes in default mode (and not editing).
  useEffect(() => {
    if (!open) return;
    if (editingId) return;
    if (timeMode !== 'default') return;
    if (!form.date) return;
    fetchSlots(form.date);
  }, [open, editingId, timeMode, form.date, fetchSlots]);

  // ── Contact search (debounced) ──────────────────────────────────────────
  useEffect(() => {
    const q = contactQuery.trim();
    if (!contactDropdownOpen) return;
    if (q.length < 2) { setContactResults([]); setContactSearching(false); return; }
    setContactSearching(true);
    const t = setTimeout(() => {
      apiFetch(`/api/venue-customers?search=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: ContactLite[]) => setContactResults(Array.isArray(rows) ? rows.slice(0, 20) : []))
        .catch(() => setContactResults([]))
        .finally(() => setContactSearching(false));
    }, 220);
    return () => clearTimeout(t);
  }, [contactQuery, contactDropdownOpen, apiFetch]);

  function pickContact(c: ContactLite) {
    const display = toTitleCase([c.first_name, c.last_name].filter(Boolean).join(' ').trim());
    const email = c.customer_email ?? '';
    setForm((p) => ({ ...p, customer_email: email }));
    setContactQuery(display ? `${display}${email ? ` <${email}>` : ''}` : email);
    setContactDropdownOpen(false);
  }

  // ── Space CRUD ──────────────────────────────────────────────────────────
  async function createSpace() {
    const name = newSpaceName.trim();
    if (!name) return;
    setSpaceBusy(true);
    try {
      const res = await apiFetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: newSpaceColor }),
      });
      if (res.ok) {
        const row = await res.json();
        setSpaces((prev) => [...prev, row]);
        setForm((p) => ({ ...p, space_id: row.id }));
        setNewSpaceName('');
      }
    } finally {
      setSpaceBusy(false);
    }
  }

  async function saveSpaceEdit(id: string) {
    const name = editSpaceDraft.name.trim();
    if (!name) return;
    setSpaceBusy(true);
    try {
      const res = await apiFetch(`/api/spaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: editSpaceDraft.color }),
      });
      if (res.ok) {
        const row = await res.json();
        setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, ...row } : s)));
        setEditingSpaceId(null);
      }
    } finally {
      setSpaceBusy(false);
    }
  }

  async function deleteSpace(id: string) {
    const space = spaces.find((s) => s.id === id);
    const ok = window.confirm(
      `Delete space${space ? ` "${space.name}"` : ''}? Events assigned to this space will keep their date/time but lose the space label.`,
    );
    if (!ok) return;
    setSpaceBusy(true);
    try {
      const res = await apiFetch(`/api/spaces/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSpaces((prev) => prev.filter((s) => s.id !== id));
        setForm((p) => (p.space_id === id ? { ...p, space_id: '' } : p));
      }
    } finally {
      setSpaceBusy(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (override = false) => {
    setSaving(true);
    setSaveError('');
    setConflicts([]);

    const endDateStr = form.end_date || form.date;
    let startLocal: Date;
    let endLocal:   Date;
    if (form.all_day) {
      startLocal = toDate(`${form.date}T00:00:00`, { timeZone: tz });
      endLocal = venueDayBoundsUtc(endDateStr, tz).end;
    } else {
      startLocal = wallClockToUtc(form.date, form.start_time, tz);
      endLocal = wallClockToUtc(endDateStr, form.end_time, tz);
    }
    if (endLocal <= startLocal) {
      setSaveError('End must be after start.');
      setSaving(false);
      return;
    }

    let recurrence_rule: RecurrenceRule | null = null;
    if (form.repeat !== 'none') {
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
      if (form.repeat_interval && form.repeat_interval > 1) rule.interval = Math.floor(form.repeat_interval);
      if (form.repeat_end === 'on' && form.repeat_until) rule.until = form.repeat_until;
      else if (form.repeat_end === 'after' && form.repeat_count > 0) rule.count = Math.floor(form.repeat_count);
      recurrence_rule = rule;
    }

    const payload = {
      title: form.title, event_type: form.event_type, status: form.status,
      space_id: form.space_id || null, customer_email: form.customer_email || null,
      assigned_team_member_id: form.assigned_team_member_id || null,
      calendar_id: form.calendar_id || null,
      start_at: startLocal.toISOString(), end_at: endLocal.toISOString(), all_day: form.all_day,
      notes: form.notes || null, override_conflict: override,
      recurrence_rule,
    };

    const res = editingId
      ? await apiFetch(`/api/calendar/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await apiFetch('/api/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

    const json = await res.json();
    if (!res.ok) {
      if (json.error === 'conflict') setConflicts(json.conflicts ?? []);
      else setSaveError(json.error ?? 'Failed to save');
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved(json as SavedEvent);
  }, [form, tz, editingId, apiFetch, onSaved]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4">
      <div
        ref={modalBodyRef}
        className="relative w-full max-w-lg rounded-2xl bg-white p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
        onScroll={() => {
          const el = modalBodyRef.current;
          if (!el) return;
          el.classList.add('is-scrolling');
          if (modalScrollTimer.current) clearTimeout(modalScrollTimer.current);
          modalScrollTimer.current = setTimeout(() => el.classList.remove('is-scrolling'), 800);
        }}
      >
        <button
          onClick={() => { onClose(); }}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          <X size={20} />
        </button>
        <h2 className="font-heading text-lg font-semibold text-gray-900 mb-5">
          {editingId ? 'Edit Event' : 'New Event'}
        </h2>
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
                  <p key={c.id} className="text-xs text-amber-700 font-medium mt-1">— {c.title} ({fmtConflict(c.start_at, tz)} → {fmtConflict(c.end_at, tz)})</p>
                ))}
                <button
                  onClick={() => handleSave(true)}
                  className="mt-2 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 transition-colors"
                >
                  Override & Book Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Event Title *</label>
            <input
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Smith & Johnson Wedding"
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Type</label>
              <select
                value={form.event_type}
                onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                {EVENT_TYPE_ORDER.map((k) => (
                  <option key={k} value={k}>{EVENT_TYPE_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                <option value="confirmed">Confirmed</option>
                <option value="tentative">Tentative / Hold</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {venueCalendars.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Calendar</label>
              <select
                value={form.calendar_id}
                onChange={(e) => setForm((p) => ({ ...p, calendar_id: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                <option value="">Default calendar</option>
                {venueCalendars.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Space + Manage */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400">Space</label>
              <button
                type="button"
                onClick={() => setManageSpaces((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-900 transition-colors"
              >
                {manageSpaces ? <><X size={11} /> Done</> : <><Pencil size={11} /> Manage</>}
              </button>
            </div>
            <select
              value={form.space_id}
              onChange={e => setForm(p => ({ ...p, space_id: e.target.value }))}
              className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
            >
              <option value="">No specific space</option>
              {spaces.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.capacity ? ` (cap ${s.capacity})` : ''}
                </option>
              ))}
            </select>

            {manageSpaces && (
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Customize spaces</p>
                {spaces.length === 0 && (
                  <p className="text-[11px] text-gray-500">No spaces yet. Add one below.</p>
                )}
                {spaces.map((s) => {
                  const isEditing = editingSpaceId === s.id;
                  return (
                    <div key={s.id} className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <input
                            type="color"
                            value={editSpaceDraft.color}
                            onChange={(e) => setEditSpaceDraft((d) => ({ ...d, color: e.target.value }))}
                            className="h-7 w-7 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                            aria-label="Space color"
                          />
                          <input
                            value={editSpaceDraft.name}
                            onChange={(e) => setEditSpaceDraft((d) => ({ ...d, name: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveSpaceEdit(s.id); } }}
                            className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => saveSpaceEdit(s.id)}
                            disabled={spaceBusy || !editSpaceDraft.name.trim()}
                            className="rounded-lg border border-gray-300 bg-white p-1.5 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                            aria-label="Save"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSpaceId(null)}
                            className="rounded-lg border border-gray-300 bg-white p-1.5 text-gray-700 hover:bg-gray-100"
                            aria-label="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="inline-block h-3 w-3 flex-shrink-0 rounded-full border border-white shadow" style={{ backgroundColor: s.color }} />
                          <span className="flex-1 truncate text-sm text-gray-800">
                            {s.name}
                            {s.capacity ? <span className="ml-1 text-[11px] text-gray-400">cap {s.capacity}</span> : null}
                          </span>
                          <button
                            type="button"
                            onClick={() => { setEditingSpaceId(s.id); setEditSpaceDraft({ name: s.name, color: s.color || '#6366f1' }); }}
                            className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                            aria-label="Edit space"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSpace(s.id)}
                            disabled={spaceBusy}
                            className="rounded-lg border border-red-200 bg-white p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40"
                            aria-label="Delete space"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="color"
                    value={newSpaceColor}
                    onChange={(e) => setNewSpaceColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                    aria-label="New space color"
                  />
                  <input
                    value={newSpaceName}
                    onChange={(e) => setNewSpaceName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createSpace(); } }}
                    placeholder="New space name"
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={createSpace}
                    disabled={spaceBusy || !newSpaceName.trim()}
                    className="flex items-center gap-1 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Contact search */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Contact</label>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={contactQuery}
                onFocus={() => setContactDropdownOpen(true)}
                onChange={(e) => {
                  const v = e.target.value;
                  setContactQuery(v);
                  setContactDropdownOpen(true);
                  const match = v.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
                  setForm((p) => ({ ...p, customer_email: match ? match[0] : '' }));
                }}
                onBlur={() => setTimeout(() => setContactDropdownOpen(false), 150)}
                placeholder="Search by name, email, or phone"
                className="w-full rounded-xl border border-gray-200 pl-9 pr-9 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              />
              {contactQuery && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setContactQuery('');
                    setForm((p) => ({ ...p, customer_email: '' }));
                    setContactResults([]);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Clear contact"
                >
                  <X size={13} />
                </button>
              )}
              {contactDropdownOpen && (contactQuery.trim().length >= 2) && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                  {contactSearching && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
                      <Loader2 size={12} className="animate-spin" /> Searching…
                    </div>
                  )}
                  {!contactSearching && contactResults.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-500">
                      No matching contacts.
                      {form.customer_email && (
                        <span className="block mt-0.5 text-gray-400">
                          Will use <span className="font-mono text-[10px]">{form.customer_email}</span> as the customer email.
                        </span>
                      )}
                    </div>
                  )}
                  {!contactSearching && contactResults.map((c) => {
                    const display = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.customer_email || 'Unnamed';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); pickContact(c); }}
                        className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                      >
                        <p className="text-sm font-medium text-gray-900 truncate">{display}</p>
                        {(c.customer_email || c.phone) && (
                          <p className="text-[11px] text-gray-500 truncate">
                            {c.customer_email}{c.customer_email && c.phone ? ' · ' : ''}{c.phone}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {form.customer_email && (
              <p className="mt-1 text-[11px] text-gray-500">Email: <span className="font-mono">{form.customer_email}</span></p>
            )}
          </div>

          {/* Assigned team member */}
          {teamMembers.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                <span className="inline-flex items-center gap-1"><User size={11} /> Assigned To</span>
              </label>
              <select
                value={form.assigned_team_member_id}
                onChange={(e) => setForm((p) => ({ ...p, assigned_team_member_id: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {teamMemberLabel(m)}
                    {m.role ? ` — ${m.role}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Start Date *</label>
              <input
                type="date"
                value={form.date}
                onChange={e => {
                  const d = e.target.value;
                  setForm(p => ({
                    ...p,
                    date: d,
                    end_date: (!p.end_date || p.end_date < d) ? d : p.end_date,
                  }));
                }}
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">End Date</label>
              <input
                type="date"
                value={form.end_date}
                min={form.date || undefined}
                onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              />
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
            <input
              type="checkbox" id="ee-allday"
              checked={form.all_day}
              onChange={e => setForm(p => ({ ...p, all_day: e.target.checked }))}
              className="rounded"
            />
            <label htmlFor="ee-allday" className="text-sm text-gray-700">All day</label>
          </div>

          {!form.all_day && (
            <div className="space-y-3">
              {!editingId && (
                <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit">
                  {(['default','custom'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setTimeMode(mode);
                        if (mode === 'default' && form.date && availSlots.length === 0) {
                          fetchSlots(form.date);
                        }
                      }}
                      className={`px-4 py-1.5 text-xs font-medium transition-colors capitalize ${timeMode === mode ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              )}

              {timeMode === 'default' && !editingId ? (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Available Slot</label>
                  {loadingSlots ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Loader2 size={13} className="animate-spin" /> Loading available times…
                    </div>
                  ) : availSlots.length === 0 ? (
                    <p className="text-xs text-gray-400">
                      {form.date ? 'No available slots — this day may be marked unavailable in Calendar Settings.' : 'Pick a date to see available slots.'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {availSlots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={!slot.available}
                          onClick={() => {
                            setSelectedSlot(slot.time);
                            const [h, m] = slot.time.split(':').map(Number);
                            const endH = Math.min(23, h + 1);
                            setForm((f) => ({ ...f, start_time: slot.time, end_time: `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}` }));
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            !slot.available
                              ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed line-through'
                              : selectedSlot === slot.time
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                          }`}
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-1.5 text-[10px] text-gray-400">
                    Based on your <a href="/dashboard/settings/calendar?tab=availability" target="_blank" className="underline hover:text-gray-600">availability settings</a>. Greyed slots are already booked or blocked by Google Calendar.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Start Time</label>
                    <input
                      type="time"
                      value={form.start_time}
                      onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">End Time</label>
                    <input
                      type="time"
                      value={form.end_time}
                      onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recurrence */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3.5 space-y-3">
            <div className="flex items-center gap-2">
              <Repeat size={14} className="text-gray-500" />
              <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Repeats</label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={form.repeat}
                onChange={e => setForm(p => {
                  const next = e.target.value as RepeatOpt;
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
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              {form.repeat !== 'none' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">every</span>
                  <input
                    type="number" min={1} max={99}
                    value={form.repeat_interval}
                    onChange={e => setForm(p => ({ ...p, repeat_interval: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
                  />
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
                  <input type="radio" id="ee-end-never" name="ee-repeat-end" checked={form.repeat_end === 'never'}
                    onChange={() => setForm(p => ({ ...p, repeat_end: 'never' }))} />
                  <label htmlFor="ee-end-never">Never</label>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="radio" id="ee-end-on" name="ee-repeat-end" checked={form.repeat_end === 'on'}
                    onChange={() => setForm(p => ({ ...p, repeat_end: 'on' }))} />
                  <label htmlFor="ee-end-on">On</label>
                  <input
                    type="date"
                    value={form.repeat_until}
                    min={form.end_date || form.date || undefined}
                    disabled={form.repeat_end !== 'on'}
                    onChange={e => setForm(p => ({ ...p, repeat_until: e.target.value, repeat_end: 'on' }))}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none disabled:opacity-40"
                  />
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="radio" id="ee-end-after" name="ee-repeat-end" checked={form.repeat_end === 'after'}
                    onChange={() => setForm(p => ({ ...p, repeat_end: 'after' }))} />
                  <label htmlFor="ee-end-after">After</label>
                  <input
                    type="number" min={1} max={500}
                    value={form.repeat_count}
                    disabled={form.repeat_end !== 'after'}
                    onChange={e => setForm(p => ({ ...p, repeat_count: Math.max(1, parseInt(e.target.value) || 1), repeat_end: 'after' }))}
                    className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none disabled:opacity-40"
                  />
                  <span className="text-xs text-gray-500">occurrences</span>
                </div>
                {form.repeat_end === 'never' && (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                    This event will repeat forever. Pick &ldquo;On&rdquo; or &ldquo;After&rdquo; to set an end.
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none resize-none"
            />
          </div>
        </div>

        {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
        <div className="flex justify-end gap-3 mt-5">
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving || !form.title || !form.date}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editingId ? 'Save Changes' : 'Save Event'}
          </button>
        </div>
      </div>
    </div>
  );
}
