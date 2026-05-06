'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, ChevronRight, Plus, X, Loader2, Calendar,
  ExternalLink, Info, Repeat, Search,
  Settings, Sparkles,
} from 'lucide-react';
import { describeRule, type RecurrenceRule } from '@/lib/recurrence';
import { toTitleCase } from '@/lib/utils';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import {
  addCalendarDaysYmd,
  dateStrInTimeZone,
  DEFAULT_VENUE_TIMEZONE,
  hourFloatInTimeZone,
  resolveVenueTimezone,
  sun0WeekdayInTimeZone,
  venueDayBoundsUtc,
} from '@/lib/venue-timezone';
import EventEditorModal, {
  type EventEditorPrefill,
  type EventForEdit,
  type SavedEvent as EditorSavedEvent,
} from '@/components/calendar/EventEditorModal';

// ── Types ─────────────────────────────────────────────────────────────────────
interface VenueSpace { id: string; name: string; color: string; capacity?: number | null; }

interface TeamMemberLite {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status?: string;
  role?: string;
}

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
  assigned_team_member_id?: string | null;
  venue_team_members?: TeamMemberLite | null;
  // Recurrence fields (present after API expansion)
  recurrence_rule?: RecurrenceRule | null;
  parent_id?: string;
  is_occurrence?: boolean;
  // Google Calendar fields
  source?: 'google';
  read_only?: boolean;
  google_calendar_name?: string;
  html_link?: string;
  // Multi-calendar fields
  calendar_id?: string | null;
  calendar_color?: string | null;
}

interface VenueCalendarLite {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
}

function teamMemberLabel(m: { name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }) {
  const full = toTitleCase([m.first_name, m.last_name].filter(Boolean).join(' ').trim());
  return toTitleCase(m.name?.trim() || '') || full || m.email || 'Unnamed';
}

// Split notes text into segments; wrap URLs in <a> tags.
// Also trims repetitive separator lines (====) common in auto-generated descriptions.
function renderNotesWithLinks(text: string): React.ReactNode[] {
  // Strip lines that are just repeated = chars (scheduling tool separators)
  const cleaned = text
    .split('\n')
    .filter((line) => !/^={3,}$/.test(line.trim()))
    .join('\n')
    .trim();

  const URL_RE = /https?:\/\/[^\s<>)"]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(cleaned)) !== null) {
    if (match.index > last) {
      parts.push(cleaned.slice(last, match.index));
    }
    const url = match[0];
    // Shorten very long URLs for display
    const display = url.length > 50 ? url.slice(0, 47) + '…' : url;
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
        className="text-blue-600 hover:underline break-all">
        {display}
      </a>
    );
    last = match.index + url.length;
  }
  if (last < cleaned.length) parts.push(cleaned.slice(last));
  return parts;
}

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

function fmtTime(iso: string, tz: string) {
  const z = resolveVenueTimezone(tz);
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: z });
}
function fmtHour(h: number) {
  if (h === 0)  return '12 AM';
  if (h < 12)  return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

// Event color helper
function evtColor(evt: CalEvent) {
  if (evt.source === 'google') return '#4285F4';
  // Calendar color takes highest priority when set
  if (evt.calendar_color) return evt.calendar_color;
  const typeColor = EVENT_COLORS[evt.event_type as keyof typeof EVENT_COLORS];
  return evt.venue_spaces?.color ?? typeColor ?? '#6b7280';
}

function eventSpansDate(e: CalEvent, dateStr: string, tz: string): boolean {
  const z = resolveVenueTimezone(tz);
  const s = dateStrInTimeZone(e.start_at, z);
  const end = dateStrInTimeZone(e.end_at, z);
  return dateStr >= s && dateStr <= end;
}

type CalView = 'month' | 'week' | 'day' | 'revenue';

// ── Calendar Page ─────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const today     = new Date();
  const printRef  = useRef<HTMLDivElement>(null);
  const didInitCalFromVenue = useRef(false);
  const tzSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  // For week/day views: the anchor date
  const [anchorDate, setAnchorDate] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));

  const [events,  setEvents]  = useState<CalEvent[]>([]);
  const [spaces,  setSpaces]  = useState<VenueSpace[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeSpaceFilter, setActiveSpaceFilter] = useState<string>('all');
  const [view, setView] = useState<CalView>('month');

  const [venueTz, setVenueTz] = useState(DEFAULT_VENUE_TIMEZONE);
  const [venueLoaded, setVenueLoaded] = useState(false);

  // Venue calendars (multi-calendar support)
  const [venueCalendars, setVenueCalendars] = useState<VenueCalendarLite[]>([]);

  // Event editor modal — create + edit share the same component. The modal
  // owns its own form state internally; we only track the shell here.
  const [showModal,    setShowModal]    = useState(false);
  const [editorEvent,  setEditorEvent]  = useState<EventForEdit | null>(null);
  const [editorPrefill, setEditorPrefill] = useState<EventEditorPrefill | undefined>(undefined);

  // Detail modal
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [selectedEventContactId, setSelectedEventContactId] = useState<string | null>(null);

  // Team members for the "assigned to" selector — kept here so the detail
  // modal can also resolve a member name; the editor modal fetches its own.
  const [teamMembers, setTeamMembers] = useState<TeamMemberLite[]>([]);

  // AI / search panel
  const [aiPanelOpen,    setAiPanelOpen]    = useState(false);
  const [aiQuery,        setAiQuery]        = useState('');
  const [aiSearching,    setAiSearching]    = useState(false);
  const [aiAnswer,       setAiAnswer]       = useState<string | null>(null);
  const [aiEvents,       setAiEvents]       = useState<CalEvent[]>([]);
  const [aiRan,          setAiRan]          = useState(false);
  const aiInputRef = useRef<HTMLInputElement>(null);


  const tzResolved = resolveVenueTimezone(venueTz);

  useEffect(() => {
    fetch('/api/venues/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.timezone != null) setVenueTz(resolveVenueTimezone(d.timezone));
      })
      .finally(() => setVenueLoaded(true));
  }, []);

  useEffect(() => {
    if (!venueLoaded || didInitCalFromVenue.current) return;
    didInitCalFromVenue.current = true;
    const tz = resolveVenueTimezone(venueTz);
    const now = new Date();
    const y = Number(formatInTimeZone(now, tz, 'yyyy'));
    const m = Number(formatInTimeZone(now, tz, 'M')) - 1;
    const d = Number(formatInTimeZone(now, tz, 'd'));
    setYear(y);
    setMonth(m);
    setAnchorDate(new Date(y, m, d));
  }, [venueLoaded, venueTz]);

  function patchVenueTimezone(next: string) {
    setVenueTz(next);
    if (tzSaveTimer.current) clearTimeout(tzSaveTimer.current);
    tzSaveTimer.current = setTimeout(() => {
      fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: next }),
      }).catch(() => {});
    }, 500);
  }

  // ── Data fetch — widens range for week/day views ─────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const tz = resolveVenueTimezone(venueTz);
    let from: string, to: string;
    if (view === 'week') {
      const anchorYmd = formatInTimeZone(anchorDate, tz, 'yyyy-MM-dd');
      const dow = sun0WeekdayInTimeZone(toDate(`${anchorYmd}T12:00:00`, { timeZone: tz }), tz);
      const weekStartYmd = addCalendarDaysYmd(anchorYmd, -dow, tz);
      const weekEndYmd = addCalendarDaysYmd(weekStartYmd, 6, tz);
      from = toDate(`${weekStartYmd}T00:00:00`, { timeZone: tz }).toISOString();
      to = toDate(`${weekEndYmd}T23:59:59.999`, { timeZone: tz }).toISOString();
    } else if (view === 'day') {
      const dayYmd = formatInTimeZone(anchorDate, tz, 'yyyy-MM-dd');
      from = toDate(`${dayYmd}T00:00:00`, { timeZone: tz }).toISOString();
      to = toDate(`${dayYmd}T23:59:59.999`, { timeZone: tz }).toISOString();
    } else {
      const ymdStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastD = new Date(year, month + 1, 0).getDate();
      const ymdEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
      from = toDate(`${ymdStart}T00:00:00`, { timeZone: tz }).toISOString();
      to = toDate(`${ymdEnd}T23:59:59.999`, { timeZone: tz }).toISOString();
    }
    const [evRes, spRes, gRes, calRes] = await Promise.all([
      fetch(`/api/calendar?from=${from}&to=${to}`),
      fetch('/api/spaces'),
      fetch(`/api/calendar/google/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      fetch('/api/venue-calendars'),
    ]);
    const localEvents: CalEvent[] = evRes.ok ? await evRes.json() : [];
    const googleEvents: CalEvent[] = gRes.ok ? await gRes.json() : [];

    // Build a calendar color map so we can apply colors to events
    const vcals: VenueCalendarLite[] = calRes.ok ? await calRes.json() : [];
    setVenueCalendars(vcals);
    const calColorMap = Object.fromEntries(vcals.map((c) => [c.id, c.color]));

    // Enrich local events with their calendar color
    const enriched = localEvents.map((e) => ({
      ...e,
      calendar_color: e.calendar_id ? (calColorMap[e.calendar_id] ?? null) : null,
    }));

    // Merge: local events take precedence; Google events are appended
    setEvents([...enriched, ...googleEvents]);
    if (spRes.ok) setSpaces(await spRes.json());
    setLoading(false);
  }, [year, month, view, anchorDate, venueTz]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Deep-link: /dashboard/calendar?new=1&email=...&name=... opens the new
  // event modal pre-filled with the lead's contact info (used by the lead
  // card SMS icon).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1') return;
    const email = params.get('email') ?? '';
    const name  = params.get('name') ?? '';
    // Strip the query string so refreshing doesn't re-open the modal.
    window.history.replaceState({}, '', '/dashboard/calendar');
    setEditorEvent(null);
    setEditorPrefill({ customerEmail: email, customerName: name });
    setShowModal(true);
  }, []);

  // Load the team-member list once on mount. The "Assigned to" dropdown is
  // only rendered when the list is non-empty so venues without team members
  // see the form unchanged.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/team', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TeamMemberLite[]) => {
        if (cancelled) return;
        setTeamMembers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (!cancelled) setTeamMembers([]); });
    return () => { cancelled = true; };
  }, []);

  // ── Resolve contact ID for the event detail modal ─────────────────────────
  useEffect(() => {
    setSelectedEventContactId(null);
    if (!selectedEvent?.customer_email) return;
    let cancelled = false;
    fetch('/api/venue-customers/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: selectedEvent.customer_email }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((contact) => { if (!cancelled && contact?.id) setSelectedEventContactId(contact.id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedEvent?.customer_email]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  function prev() {
    const tz = tzResolved;
    if (view === 'month' || view === 'revenue') {
      if (month === 0) { setYear(y => y - 1); setMonth(11); }
      else setMonth(m => m - 1);
    } else if (view === 'week') {
      setAnchorDate((d) => {
        const ymd = formatInTimeZone(d, tz, 'yyyy-MM-dd');
        const prevYmd = addCalendarDaysYmd(ymd, -7, tz);
        const [yy, mm, dd] = prevYmd.split('-').map(Number);
        return new Date(yy, mm - 1, dd);
      });
    } else {
      setAnchorDate((d) => {
        const ymd = formatInTimeZone(d, tz, 'yyyy-MM-dd');
        const prevYmd = addCalendarDaysYmd(ymd, -1, tz);
        const [yy, mm, dd] = prevYmd.split('-').map(Number);
        return new Date(yy, mm - 1, dd);
      });
    }
  }
  function next() {
    const tz = tzResolved;
    if (view === 'month' || view === 'revenue') {
      if (month === 11) { setYear(y => y + 1); setMonth(0); }
      else setMonth(m => m + 1);
    } else if (view === 'week') {
      setAnchorDate((d) => {
        const ymd = formatInTimeZone(d, tz, 'yyyy-MM-dd');
        const nextYmd = addCalendarDaysYmd(ymd, 7, tz);
        const [yy, mm, dd] = nextYmd.split('-').map(Number);
        return new Date(yy, mm - 1, dd);
      });
    } else {
      setAnchorDate((d) => {
        const ymd = formatInTimeZone(d, tz, 'yyyy-MM-dd');
        const nextYmd = addCalendarDaysYmd(ymd, 1, tz);
        const [yy, mm, dd] = nextYmd.split('-').map(Number);
        return new Date(yy, mm - 1, dd);
      });
    }
  }
  function goToday() {
    const tz = tzResolved;
    const now = new Date();
    const y = Number(formatInTimeZone(now, tz, 'yyyy'));
    const m = Number(formatInTimeZone(now, tz, 'M')) - 1;
    const d = Number(formatInTimeZone(now, tz, 'd'));
    setYear(y);
    setMonth(m);
    setAnchorDate(new Date(y, m, d));
  }

  // Keep month/year in sync with anchorDate when switching views.
  // For week/day, always anchor to today in the venue's timezone so the
  // view opens on the current day rather than the 1st of the displayed month.
  function switchView(v: CalView) {
    if (v === 'week' || v === 'day') {
      const tz = tzResolved;
      const now = new Date();
      const y = Number(formatInTimeZone(now, tz, 'yyyy'));
      const m = Number(formatInTimeZone(now, tz, 'M')) - 1;
      const d = Number(formatInTimeZone(now, tz, 'd'));
      setYear(y);
      setMonth(m);
      setAnchorDate(new Date(y, m, d));
    }
    setView(v);
  }

  // ── Month grid helpers ─────────────────────────────────────────────────────
  const firstDay    = (() => {
    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const noon = toDate(`${ymd}T12:00:00`, { timeZone: tzResolved });
    return sun0WeekdayInTimeZone(noon, tzResolved);
  })();
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
      return eventSpansDate(e, dateStr, tzResolved);
    });
  }

  // ── Week view helpers (venue-local week, Sunday–Saturday) ─────────────────
  const anchorYmdWeek = formatInTimeZone(anchorDate, tzResolved, 'yyyy-MM-dd');
  const weekDowVenue = sun0WeekdayInTimeZone(toDate(`${anchorYmdWeek}T12:00:00`, { timeZone: tzResolved }), tzResolved);
  const weekStartYmd = addCalendarDaysYmd(anchorYmdWeek, -weekDowVenue, tzResolved);
  const weekDaysYmd = Array.from({ length: 7 }, (_, i) => addCalendarDaysYmd(weekStartYmd, i, tzResolved));

  function eventsForDayYmd(dateStr: string): CalEvent[] {
    return events.filter(e => {
      if (activeSpaceFilter !== 'all' && e.space_id !== activeSpaceFilter) return false;
      return eventSpansDate(e, dateStr, tzResolved);
    });
  }

  // ── Post-save handler ─────────────────────────────────────────────────────
  // The shared <EventEditorModal> owns all the validation + payload-shaping
  // logic. After the API call returns we just navigate the grid to the saved
  // event's date and refetch (for recurring events that expand at GET time).
  function handleEditorSaved(saved: EditorSavedEvent) {
    const z = tzResolved;
    const y = Number(formatInTimeZone(new Date(saved.start_at), z, 'yyyy'));
    const m = Number(formatInTimeZone(new Date(saved.start_at), z, 'M')) - 1;
    const d = Number(formatInTimeZone(new Date(saved.start_at), z, 'd'));
    setYear(y);
    setMonth(m);
    setAnchorDate(new Date(y, m, d));

    setShowModal(false);
    setEditorEvent(null);
    setEditorPrefill(undefined);
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
    const gone = events.find(e => e.id === id);
    const parent = gone?.parent_id ?? id;
    setEvents(prev => prev.filter(e => e.id !== id && e.parent_id !== parent));
    setSelectedEvent(null);
    setDeleting(false);
  }

  async function handleStatusChange(id: string, newStatus: string) {
    setStatusChanging(true);
    const res = await fetch(`/api/calendar/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const updated = await res.json() as CalEvent;
      setEvents(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
      setSelectedEvent(prev => prev ? { ...updated, status: newStatus } : prev);
    }
    setStatusChanging(false);
  }

  function openNewEvent(dateStr?: string, time?: string) {
    setEditorEvent(null);
    const prefill: EventEditorPrefill = {};
    if (dateStr) { prefill.date = dateStr; prefill.endDate = dateStr; }
    if (time)    {
      prefill.startTime = time;
      prefill.endTime   = `${String(Math.min(23, parseInt(time) + 1)).padStart(2, '0')}:00`;
    }
    setEditorPrefill(prefill);
    setShowModal(true);
  }

  // Open the modal in Edit mode for an existing event. We always edit the
  // parent of the series (never a single occurrence) — the API enforces this
  // by stripping the `@YYYY-MM-DD` suffix server-side.
  function openEditEvent(e: CalEvent) {
    setSelectedEvent(null);
    setEditorEvent({
      id: e.id,
      title: e.title,
      event_type: e.event_type,
      status: e.status,
      space_id: e.space_id,
      customer_email: e.customer_email,
      notes: e.notes,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: !!e.all_day,
      assigned_team_member_id: e.assigned_team_member_id ?? null,
      calendar_id: e.calendar_id ?? null,
      recurrence_rule: e.recurrence_rule ?? null,
    });
    setEditorPrefill(undefined);
    setShowModal(true);
  }


  // ── AI / keyword search ───────────────────────────────────────────────────
  async function runAiSearch() {
    if (!aiQuery.trim()) return;
    setAiSearching(true);
    setAiRan(true);
    setAiAnswer(null);
    setAiEvents([]);
    try {
      const res = await fetch('/api/calendar/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: aiQuery.trim() }),
      });
      if (res.ok) {
        const d = await res.json();
        setAiAnswer(d.answer ?? null);
        setAiEvents(d.events ?? []);
      }
    } catch {
      // silently ignore
    }
    setAiSearching(false);
  }

  function openAiPanel() {
    setAiPanelOpen(true);
    setAiQuery('');
    setAiAnswer(null);
    setAiEvents([]);
    setAiRan(false);
    setTimeout(() => aiInputRef.current?.focus(), 80);
  }

  // ── Derived counts ────────────────────────────────────────────────────────
  const visibleCount  = events.filter(e => activeSpaceFilter === 'all' || e.space_id === activeSpaceFilter).length;
  const weddingCount  = events.filter(e => e.event_type === 'wedding' && (activeSpaceFilter === 'all' || e.space_id === activeSpaceFilter)).length;

  // Title label for navigation
  function navLabel() {
    const tz = tzResolved;
    if (view === 'month' || view === 'revenue') return `${MONTHS[month]} ${year}`;
    if (view === 'week') {
      const start = weekDaysYmd[0];
      const end = weekDaysYmd[6];
      const d0 = toDate(`${start}T12:00:00`, { timeZone: tz });
      const d6 = toDate(`${end}T12:00:00`, { timeZone: tz });
      if (start.slice(0, 7) === end.slice(0, 7)) {
        return `${formatInTimeZone(d0, tz, 'MMM')} ${formatInTimeZone(d0, tz, 'd')}–${formatInTimeZone(d6, tz, 'd')}, ${formatInTimeZone(d0, tz, 'yyyy')}`;
      }
      return `${formatInTimeZone(d0, tz, 'MMM d')} – ${formatInTimeZone(d6, tz, 'MMM d, yyyy')}`;
    }
    const dayYmd = formatInTimeZone(anchorDate, tz, 'yyyy-MM-dd');
    const ad = toDate(`${dayYmd}T12:00:00`, { timeZone: tz });
    return formatInTimeZone(ad, tz, 'EEEE, MMMM d, yyyy');
  }

  // ── Shared hour grid (week + day) ─────────────────────────────────────────
  function HourGrid({ cols }: { cols: { dateStr: string; dow: number; dom: number; events: CalEvent[] }[] }) {
    const SLOT_H = 60; // px per hour
    const tz = tzResolved;
    const todayYmd = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
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
        {cols.map(({ dateStr, dow, dom, events: dayEvts }, ci) => {
          const isToday = dateStr === todayYmd;
          const { start: dayStart, end: dayEnd } = venueDayBoundsUtc(dateStr, tz);
          return (
            <div key={ci} className="flex-1 min-w-0 border-r border-gray-100 last:border-r-0">
              {/* Day header */}
              <div className={`h-8 flex items-center justify-center gap-1 border-b border-gray-100 text-xs font-semibold ${isToday ? 'text-white' : 'text-gray-600'}`}
                style={isToday ? { backgroundColor: '#1b1b1b' } : {}}>
                {cols.length > 1 && <span className="text-[10px] font-normal">{DAYS_SHORT[dow]}</span>}
                <span>{dom}</span>
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
                  const winStart = evStart < dayStart ? dayStart : evStart;
                  const winEnd   = evEnd   > dayEnd   ? dayEnd   : evEnd;
                  const startH = hourFloatInTimeZone(winStart, tz);
                  const endH   = hourFloatInTimeZone(winEnd, tz);
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
                      style={{
                        top, height, zIndex: 2,
                        backgroundColor: evtColor(e),
                        ...(e.source === 'google' ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.15) 3px, rgba(255,255,255,0.15) 4px)' } : {}),
                      }}
                    >
                      <span className="block truncate">
                        {e.source === 'google' && '📅 '}{isContinuation && '← '}{e.title}{endsLater && ' →'}
                      </span>
                      {height > 28 && <span className="block text-[9px] opacity-80 truncate">{fmtTime(e.start_at, tz)} – {fmtTime(e.end_at, tz)}</span>}
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
          /* Force white background for print */
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
            <button
              onClick={openAiPanel}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              title="AI Calendar Search"
            >
              <Sparkles size={15} className="text-violet-500" /> Search &amp; Ask AI
            </button>
            <Link
              href="/dashboard/settings/calendar"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              <Settings size={15} /> Calendar Settings
            </Link>
            <button
              onClick={() => openNewEvent()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
            >
              <Plus size={18} /> Create event
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


        {/* Calendar legend — shown when venue has 2+ calendars */}
        {venueCalendars.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3" data-noprint="">
            {venueCalendars.map((cal) => (
              <span key={cal.id} className="flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-2.5 py-1">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cal.color }} />
                {cal.name}
                {cal.is_default && <span className="text-[10px] text-gray-400">(default)</span>}
              </span>
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
                  const dateStrToday = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                  const isToday = !!day && dateStrToday === formatInTimeZone(new Date(), tzResolved, 'yyyy-MM-dd');
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
                                className={`w-full text-left rounded px-1.5 py-0.5 text-[11px] font-medium truncate leading-tight ${evt.source === 'google' ? 'text-white opacity-85' : 'text-white'}`}
                                style={{
                                  backgroundColor: evtColor(evt),
                                  ...(evt.source === 'google' ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.15) 3px, rgba(255,255,255,0.15) 4px)' } : {}),
                                }}>
                                {evt.source === 'google' && '📅 '}{evt.title}
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
              <HourGrid cols={weekDaysYmd.map((ymd) => {
                const noon = toDate(`${ymd}T12:00:00`, { timeZone: tzResolved });
                return {
                  dateStr: ymd,
                  dow: sun0WeekdayInTimeZone(noon, tzResolved),
                  dom: parseInt(formatInTimeZone(noon, tzResolved, 'd'), 10),
                  events: eventsForDayYmd(ymd),
                };
              })} />
            )}
          </div>
        )}

        {/* ── DAY VIEW ── */}
        {view === 'day' && (
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
            ) : (
              <HourGrid cols={(() => {
                const ymd = formatInTimeZone(anchorDate, tzResolved, 'yyyy-MM-dd');
                const noon = toDate(`${ymd}T12:00:00`, { timeZone: tzResolved });
                return [{
                  dateStr: ymd,
                  dow: sun0WeekdayInTimeZone(noon, tzResolved),
                  dom: parseInt(formatInTimeZone(noon, tzResolved, 'd'), 10),
                  events: eventsForDayYmd(ymd),
                }];
              })()} />
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
                const monthEvts = events.filter(e => {
                  const z = tzResolved;
                  return formatInTimeZone(new Date(e.start_at), z, 'yyyy') === String(y)
                    && Number(formatInTimeZone(new Date(e.start_at), z, 'M')) - 1 === m;
                });
                const weddings  = monthEvts.filter(e => e.event_type === 'wedding' || e.event_type === 'reception');
                const tours     = monthEvts.filter(e => e.event_type === 'tour');
                const phoneCalls = monthEvts.filter(e => e.event_type === 'phone_call');
                const isCurrent = formatInTimeZone(new Date(), tzResolved, 'yyyy-MM')
                  === `${y}-${String(m + 1).padStart(2, '0')}`;
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

      </div>{/* end cal-print-area */}

      {/* ── Create / Edit Event Modal ── */}
      <EventEditorModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditorEvent(null); setEditorPrefill(undefined); }}
        onSaved={handleEditorSaved}
        venueTimezone={tzResolved}
        prefill={editorPrefill}
        editingEvent={editorEvent}
        dataSources={{ spaces, venueCalendars, teamMembers }}
      />

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
                  {selectedEvent.source === 'google'
                    ? `Google Calendar · ${selectedEvent.google_calendar_name ?? 'Google'}`
                    : `${EVENT_TYPE_LABELS[selectedEvent.event_type as keyof typeof EVENT_TYPE_LABELS] ?? selectedEvent.event_type} · ${selectedEvent.status}`}
                </p>
              </div>
            </div>
            {selectedEvent.source === 'google' && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                <span>📅</span>
                <span>From Google Calendar — read only in StoryVenue.</span>
              </div>
            )}
            <div className="space-y-2 text-sm text-gray-700">
              {dateStrInTimeZone(selectedEvent.start_at, tzResolved) === dateStrInTimeZone(selectedEvent.end_at, tzResolved) ? (
                <p><span className="text-gray-400">Date:</span> {new Date(selectedEvent.start_at).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone: tzResolved })}</p>
              ) : (
                <p><span className="text-gray-400">Dates:</span>{' '}
                  {new Date(selectedEvent.start_at).toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone: tzResolved })}
                  {' – '}
                  {new Date(selectedEvent.end_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', timeZone: tzResolved })}
                </p>
              )}
              {!selectedEvent.all_day && (
                <p><span className="text-gray-400">Time:</span> {fmtTime(selectedEvent.start_at, tzResolved)} – {fmtTime(selectedEvent.end_at, tzResolved)}</p>
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
              {selectedEvent.calendar_id && (() => {
                const cal = venueCalendars.find((c) => c.id === selectedEvent.calendar_id);
                return cal ? (
                  <p className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cal.color }} />
                    <span className="text-gray-400">Calendar:</span> {cal.name}
                  </p>
                ) : null;
              })()}
              {selectedEvent.venue_team_members && (
                <p><span className="text-gray-400">Assigned to:</span> {teamMemberLabel(selectedEvent.venue_team_members)}</p>
              )}
              {selectedEvent.customer_email && (
                <p>
                  <span className="text-gray-400">Customer:</span>{' '}
                  <Link
                    href={
                      selectedEventContactId
                        ? `/dashboard/contacts/${selectedEventContactId}`
                        : `/dashboard/contacts?search=${encodeURIComponent(selectedEvent.customer_email)}`
                    }
                    className="text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    {selectedEvent.customer_email} <ExternalLink size={11} />
                  </Link>
                </p>
              )}
              {selectedEvent.notes && (
                <div>
                  <span className="text-gray-400">Notes:</span>
                  <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
                    {renderNotesWithLinks(selectedEvent.notes)}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-5 space-y-2">
              {selectedEvent.source === 'google' ? (
                <a
                  href={selectedEvent.html_link ?? 'https://calendar.google.com'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Open in Google Calendar <ExternalLink size={12} />
                </a>
              ) : (
                <>
                  {/* Status quick-actions row */}
                  <div className="flex items-center gap-2">
                    {selectedEvent.status !== 'confirmed' && (
                      <button
                        onClick={() => handleStatusChange(selectedEvent.id, 'confirmed')}
                        disabled={statusChanging}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50">
                        {statusChanging ? <Loader2 size={12} className="animate-spin" /> : null}
                        Confirm Event
                      </button>
                    )}
                    {selectedEvent.status !== 'cancelled' && (
                      <button
                        onClick={() => {
                          if (window.confirm('Cancel this event? A cancellation notification will be sent to the contact.')) {
                            handleStatusChange(selectedEvent.id, 'cancelled');
                          }
                        }}
                        disabled={statusChanging}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50">
                        {statusChanging ? <Loader2 size={12} className="animate-spin" /> : null}
                        Cancel Event
                      </button>
                    )}
                  </div>

                  {/* Edit + Delete row */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditEvent(selectedEvent)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        const msg = selectedEvent.recurrence_rule
                          ? 'This is a repeating event. Deleting it will remove every occurrence in the series. A cancellation notification will be sent. Continue?'
                          : 'Delete this event? A cancellation notification will be sent to the contact.';
                        if (window.confirm(msg)) handleDelete(selectedEvent.id);
                      }}
                      disabled={deleting}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                      {deleting && <Loader2 size={13} className="animate-spin" />}
                      {selectedEvent.recurrence_rule ? 'Delete Series' : 'Delete Event'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AI Calendar Search Panel ── */}
      {aiPanelOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setAiPanelOpen(false)}
          />
          {/* Panel */}
          <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-violet-500" />
                <div>
                  <p className="font-semibold text-sm text-gray-900">Calendar Search</p>
                  <p className="text-[11px] text-gray-400">Ask questions or search events</p>
                </div>
              </div>
              <button
                onClick={() => setAiPanelOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search input */}
            <div className="px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    ref={aiInputRef}
                    type="text"
                    placeholder={`"How many tours this month?" or "Jennifer Smith"`}
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runAiSearch(); } }}
                    className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => void runAiSearch()}
                  disabled={aiSearching || !aiQuery.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-40 shrink-0"
                >
                  {aiSearching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Ask
                </button>
              </div>

              {/* Quick-suggest prompts */}
              {!aiRan && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {[
                    'What\'s happening this week?',
                    'How many tours are scheduled?',
                    'Any events this weekend?',
                    'Who has an appointment tomorrow?',
                    'Upcoming weddings',
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => { setAiQuery(prompt); void runAiSearch(); }}
                      className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600 hover:border-gray-400 hover:bg-white transition"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {aiSearching && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
                  <Loader2 size={24} className="animate-spin text-violet-400" />
                  <p className="text-sm">Searching your calendar…</p>
                </div>
              )}

              {!aiSearching && aiRan && (
                <>
                  {/* AI Answer */}
                  {aiAnswer && (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={13} className="text-violet-500 shrink-0" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-600">AI Summary</span>
                      </div>
                      <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{aiAnswer}</p>
                    </div>
                  )}

                  {/* Matching events */}
                  {aiEvents.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                        Matching Events ({aiEvents.length})
                      </p>
                      <div className="space-y-2">
                        {aiEvents.map((e) => {
                          const cal = venueCalendars.find((c) => c.id === e.calendar_id);
                          const color = cal?.color ?? evtColor(e);
                          return (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => { setSelectedEvent(e); setAiPanelOpen(false); }}
                              className="w-full text-left rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-gray-300 hover:bg-gray-50/60 transition"
                            >
                              <div className="flex items-start gap-2.5">
                                <div
                                  className="mt-0.5 w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-900 truncate">{e.title}</p>
                                  <p className="text-[11px] text-gray-500 mt-0.5">
                                    {new Date(e.start_at).toLocaleDateString('en-US', {
                                      weekday: 'short', month: 'short', day: 'numeric',
                                      timeZone: venueTz,
                                    })}
                                    {!e.all_day && ` · ${fmtTime(e.start_at, venueTz)}`}
                                  </p>
                                  {e.customer_email && (
                                    <p className="text-[11px] text-gray-400 truncate">{e.customer_email}</p>
                                  )}
                                </div>
                                <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                  e.status === 'confirmed' ? 'bg-green-50 text-green-700' :
                                  e.status === 'cancelled' ? 'bg-red-50 text-red-600' :
                                  'bg-gray-100 text-gray-500'
                                }`}>{e.status}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    !aiAnswer && (
                      <div className="text-center py-10 text-gray-400">
                        <Calendar size={28} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No matching events found.</p>
                      </div>
                    )
                  )}
                </>
              )}

              {/* Empty state before search */}
              {!aiRan && !aiSearching && (
                <div className="text-center py-12 text-gray-400">
                  <Sparkles size={28} className="mx-auto mb-2 opacity-40 text-violet-300" />
                  <p className="text-sm font-medium text-gray-500">Ask anything about your calendar</p>
                  <p className="text-xs mt-1">Try a question or search by contact name, event type, or date range.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </>
  );
}
