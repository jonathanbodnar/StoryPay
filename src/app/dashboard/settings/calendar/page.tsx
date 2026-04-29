'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Clock, Globe, Link2, CalendarDays, Bell, Settings2,
  ChevronRight, CheckCircle2, XCircle, RefreshCw, Plus,
  Trash2, Edit3, Info, Check, X, AlertTriangle, Loader2, Save,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarSettings {
  timezone: string;
  meeting_duration_min: number;
  meeting_interval_min: number;
  min_scheduling_notice_hrs: number;
  date_range_days: number;
  pre_buffer_min: number;
  post_buffer_min: number;
  max_bookings_per_day: number;
  max_bookings_per_slot: number;
  google_connected: boolean;
  google_account_email?: string | null;
  google_linked_calendar_id?: string | null;
  hide_event_details: boolean;
}

interface AvailRow {
  id?: string;
  venue_id?: string;
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
}

interface DateOverride {
  id: string;
  override_date: string;
  is_available: boolean;
  start_time?: string | null;
  end_time?: string | null;
  label?: string | null;
}

interface ConflictCal {
  id: string;
  google_calendar_id: string;
  calendar_name?: string | null;
  account_email?: string | null;
}

interface GoogleCal {
  id: string;
  name: string;
  primary: boolean;
}

interface NotifRow {
  notification_type: string;
  channel: string;
  enabled: boolean;
  notify_contact: boolean;
  notify_assigned: boolean;
  notify_guests: boolean;
  subject?: string | null;
  body?: string | null;
  offset_minutes?: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIMEZONE_LIST = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

function tzLabel(tz: string): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    });
    const parts = fmt.formatToParts(now);
    const abbr = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const offsetMs = -new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime()
      + now.getTime();
    // Use Intl offset trick
    const offsetMin = (new Date().getTimezoneOffset()) - (new Date(
      new Date().toLocaleString('en-US', { timeZone: tz })
    ).getTime() - new Date().getTime()) / 60000;
    void offsetMs; void offsetMin;
    // Simpler: extract from shortOffset
    const fmtOffset = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const offsetStr = fmtOffset.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
    return `${offsetStr} ${city} (${abbr})`;
  } catch {
    return tz;
  }
}

const NOTIF_TYPES = [
  { type: 'booked_unconfirmed', label: 'Appointment Booked (Unconfirmed)', desc: 'Notifies when an appointment is booked with an unconfirmed status.' },
  { type: 'booked_confirmed', label: 'Appointment Booked (Confirmed)', desc: 'Notifies when an appointment is successfully confirmed.' },
  { type: 'cancellation', label: 'Cancellation', desc: 'Alerts when an appointment is canceled.' },
  { type: 'reschedule', label: 'Reschedule', desc: 'Notifies when an appointment is rescheduled.' },
  { type: 'reminder', label: 'Reminder', desc: 'Sends a reminder before the appointment.' },
  { type: 'follow_up', label: 'Follow-Up', desc: 'Sends a follow-up message after the appointment is completed.' },
];

const CHANNELS = ['email', 'sms', 'in_app'] as const;

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const INTERVAL_OPTIONS = [15, 30, 45, 60, 90, 120];
const NOTICE_OPTIONS = [0, 1, 2, 4, 8, 12, 24, 48, 72];
const RANGE_OPTIONS = [7, 14, 30, 60, 90, 180, 365];
const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeLabel(minutes: number) {
  if (minutes === 0) return 'None';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${m.toString().padStart(2, '0')} ${ampm}`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CalendarSettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabParam = searchParams.get('tab') ?? 'general';
  const [activeTab, setActiveTab] = useState(tabParam);

  useEffect(() => { setActiveTab(searchParams.get('tab') ?? 'general'); }, [searchParams]);

  const setTab = (t: string) => {
    router.replace(`/dashboard/settings/calendar?tab=${t}`, { scroll: false });
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'connections', label: 'Connections', icon: Link2 },
    { id: 'availability', label: 'Availability', icon: CalendarDays },
    { id: 'booking-rules', label: 'Booking Rules', icon: Clock },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl text-gray-900">Calendar Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your availability, Google Calendar sync, booking rules, and notification preferences.
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'connections' && <ConnectionsTab />}
      {activeTab === 'availability' && <AvailabilityTab />}
      {activeTab === 'booking-rules' && <BookingRulesTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
    </div>
  );
}

// ── General Tab ───────────────────────────────────────────────────────────────

function GeneralTab() {
  const [settings, setSettings] = useState<Partial<CalendarSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/calendar/settings')
      .then((r) => r.json())
      .then((d) => { setSettings(d); setLoading(false); });
  }, []);

  const save = async () => {
    setSaving(true);
    await fetch('/api/calendar/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <LoadingCard />;

  return (
    <div className="max-w-2xl">
      <Card title="Timezone" description="Set the timezone used to display all appointments and availability.">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
          <select
            value={settings.timezone ?? 'America/New_York'}
            onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {TIMEZONE_LIST.map((tz) => (
              <option key={tz} value={tz}>{tzLabel(tz)}</option>
            ))}
          </select>
        </div>
      </Card>

      <Card title="Privacy" description="Control how synced events appear to others.">
        <label className="flex items-center gap-3 cursor-pointer">
          <Toggle
            checked={settings.hide_event_details ?? false}
            onChange={(v) => setSettings((s) => ({ ...s, hide_event_details: v }))}
          />
          <div>
            <p className="text-sm font-medium text-gray-900">Hide event details</p>
            <p className="text-xs text-gray-500">When on, only you can see details of synced calendar events.</p>
          </div>
        </label>
      </Card>

      <div className="flex justify-end">
        <SaveButton saving={saving} saved={saved} onClick={save} />
      </div>
    </div>
  );
}

// ── Connections Tab ───────────────────────────────────────────────────────────

function ConnectionsTab() {
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<Partial<CalendarSettings>>({});
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [googleCals, setGoogleCals] = useState<GoogleCal[]>([]);
  const [loadingCals, setLoadingCals] = useState(false);
  const [conflictCals, setConflictCals] = useState<ConflictCal[]>([]);
  const [saving, setSaving] = useState(false);
  const [linkedCalId, setLinkedCalId] = useState<string>('');

  const successMsg = searchParams.get('connected') === '1';
  const errorMsg = searchParams.get('error');

  const loadSettings = useCallback(() => {
    fetch('/api/calendar/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setSettings(d);
        setLinkedCalId(d.google_linked_calendar_id ?? '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadConflictCals = useCallback(() => {
    fetch('/api/calendar/conflict-calendars')
      .then((r) => r.json())
      .then(setConflictCals);
  }, []);

  useEffect(() => {
    loadSettings();
    loadConflictCals();
  }, [loadSettings, loadConflictCals]);

  const loadGoogleCals = useCallback(() => {
    setLoadingCals(true);
    fetch('/api/calendar/google/calendars')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setGoogleCals(d); })
      .finally(() => setLoadingCals(false));
  }, []);

  useEffect(() => {
    if (settings.google_connected) loadGoogleCals();
  }, [settings.google_connected, loadGoogleCals]);

  const disconnect = async () => {
    if (!confirm('Disconnect Google Calendar? Conflict calendar settings will also be removed.')) return;
    setDisconnecting(true);
    await fetch('/api/calendar/google/disconnect', { method: 'POST' });
    setDisconnecting(false);
    setGoogleCals([]);
    setConflictCals([]);
    loadSettings();
  };

  const saveLinkedCal = async () => {
    setSaving(true);
    await fetch('/api/calendar/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_linked_calendar_id: linkedCalId }),
    });
    setSaving(false);
  };

  const addConflictCal = async (cal: GoogleCal) => {
    const already = conflictCals.some((c) => c.google_calendar_id === cal.id);
    if (already) return;
    await fetch('/api/calendar/conflict-calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        google_calendar_id: cal.id,
        calendar_name: cal.name,
        account_email: settings.google_account_email,
      }),
    });
    loadConflictCals();
  };

  const removeConflictCal = async (id: string) => {
    await fetch(`/api/calendar/conflict-calendars?id=${id}`, { method: 'DELETE' });
    loadConflictCals();
  };

  if (loading) return <LoadingCard />;

  return (
    <div className="max-w-2xl space-y-6">
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 size={16} />
          Google Calendar connected successfully!
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <XCircle size={16} />
          {errorMsg === 'google_denied' ? 'Google Calendar connection was denied.' : 'Failed to connect Google Calendar. Please try again.'}
        </div>
      )}

      {/* Google Calendar */}
      <Card title="Connected Calendars" description="Connect your Google Calendar for two-way sync to prevent double bookings.">
        {settings.google_connected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
                  <GoogleCalIcon />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Google Calendar</p>
                  <p className="text-xs text-gray-500">{settings.google_account_email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                  <Check size={12} /> Connected
                </span>
                <button
                  onClick={disconnect}
                  disabled={disconnecting}
                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            </div>

            {/* Linked (write-to) calendar */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Linked Calendar <span className="text-gray-400 font-normal">(new events are written here)</span>
              </label>
              {loadingCals ? (
                <div className="text-sm text-gray-400">Loading calendars…</div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={linkedCalId}
                    onChange={(e) => setLinkedCalId(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="">None</option>
                    {googleCals.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.primary ? ' (Primary)' : ''}</option>
                    ))}
                  </select>
                  <button
                    onClick={saveLinkedCal}
                    disabled={saving}
                    className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:opacity-85 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
              <GoogleCalIcon size={24} />
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Connect Google Calendar for two-way sync to prevent double bookings and conflicts.
            </p>
            <a
              href="/api/calendar/google/connect"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:opacity-85"
            >
              <Plus size={14} /> Connect Google Calendar
            </a>
          </div>
        )}
      </Card>

      {/* Conflict Calendars */}
      {settings.google_connected && (
        <Card
          title="Conflict Calendars"
          description="Check the calendars below to prevent double bookings. Events on checked calendars will block your available time slots."
        >
          {loadingCals ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading your Google Calendars…
            </div>
          ) : googleCals.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400">No Google Calendars found.</p>
              <button onClick={loadGoogleCals} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1 mx-auto">
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {googleCals.map((cal) => {
                const conflictRow = conflictCals.find((c) => c.google_calendar_id === cal.id);
                const isChecked = !!conflictRow;
                return (
                  <label key={cal.id} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => isChecked ? removeConflictCal(conflictRow!.id) : addConflictCal(cal)}
                      className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <GoogleCalIcon size={16} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{cal.name}{cal.primary ? ' (Primary)' : ''}</p>
                        <p className="text-xs text-gray-400">{settings.google_account_email}</p>
                      </div>
                    </div>
                    {isChecked && (
                      <span className="text-xs text-green-600 font-medium shrink-0 flex items-center gap-1">
                        <Check size={11} /> Blocking
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Availability Tab ──────────────────────────────────────────────────────────

function AvailabilityTab() {
  const [avail, setAvail] = useState<AvailRow[]>([]);
  const [overrides, setOverrides] = useState<DateOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [newOverride, setNewOverride] = useState({ date: '', is_available: false, start_time: '09:00', end_time: '17:00', label: '' });

  const defaultAvail = (): AvailRow[] =>
    Array.from({ length: 7 }, (_, i) => ({
      id: `default-${i}`,
      venue_id: '',
      day_of_week: i,
      is_available: i >= 1 && i <= 5,
      start_time: '09:00:00',
      end_time: '17:00:00',
    }));

  const loadData = useCallback(() => {
    Promise.all([
      fetch('/api/calendar/availability', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/calendar/date-overrides').then((r) => r.json()),
    ]).then(([a, o]) => {
      const rows: AvailRow[] = Array.isArray(a) ? a : [];
      // If we got fewer than 7 rows, fill missing days with defaults
      if (rows.length < 7) {
        const existing = new Set(rows.map((r) => r.day_of_week));
        const missing = Array.from({ length: 7 }, (_, i) => i).filter((i) => !existing.has(i));
        missing.forEach((i) => rows.push({
          id: `default-${i}`,
          venue_id: '',
          day_of_week: i,
          is_available: i >= 1 && i <= 5,
          start_time: '09:00:00',
          end_time: '17:00:00',
        }));
        rows.sort((a, b) => a.day_of_week - b.day_of_week);
      }
      setAvail(rows);
      setOverrides(Array.isArray(o) ? o : []);
      setLoading(false);
    }).catch(() => {
      setAvail(defaultAvail());
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const updateRow = (day: number, field: keyof AvailRow, value: unknown) => {
    setAvail((rows) => rows.map((r) => r.day_of_week === day ? { ...r, [field]: value } : r));
  };

  const saveAvail = async () => {
    setSaving(true);
    await fetch('/api/calendar/availability', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(avail),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addOverride = async () => {
    if (!newOverride.date) return;
    await fetch('/api/calendar/date-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        override_date: newOverride.date,
        is_available: newOverride.is_available,
        start_time: newOverride.is_available ? newOverride.start_time : null,
        end_time: newOverride.is_available ? newOverride.end_time : null,
        label: newOverride.label || null,
      }),
    });
    setShowAddOverride(false);
    setNewOverride({ date: '', is_available: false, start_time: '09:00', end_time: '17:00', label: '' });
    loadData();
  };

  const deleteOverride = async (id: string) => {
    await fetch(`/api/calendar/date-overrides?id=${id}`, { method: 'DELETE' });
    loadData();
  };

  if (loading) return <LoadingCard />;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Weekly schedule */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Weekly Working Hours</h3>
            <p className="text-xs text-gray-500 mt-0.5">Set working days and hours to determine when availability appears on calendars.</p>
          </div>
          <SaveButton saving={saving} saved={saved} onClick={saveAvail} />
        </div>

        <div className="divide-y divide-gray-100">
          {avail.map((row) => (
            <div key={row.day_of_week} className="flex items-center gap-4 px-6 py-3">
              <div className="w-16">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.is_available}
                    onChange={(e) => updateRow(row.day_of_week, 'is_available', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                  />
                  <span className={`text-sm font-medium ${row.is_available ? 'text-gray-900' : 'text-gray-400'}`}>
                    {DAYS[row.day_of_week]}
                  </span>
                </label>
              </div>

              {row.is_available ? (
                <div className="flex items-center gap-2 flex-1">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Start Time</label>
                    <input
                      type="time"
                      value={row.start_time.slice(0, 5)}
                      onChange={(e) => updateRow(row.day_of_week, 'start_time', e.target.value + ':00')}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                  <span className="text-gray-400 text-sm mt-5">–</span>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">End Time</label>
                    <input
                      type="time"
                      value={row.end_time.slice(0, 5)}
                      onChange={(e) => updateRow(row.day_of_week, 'end_time', e.target.value + ':00')}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                </div>
              ) : (
                <span className="text-sm text-gray-400 flex-1">Unavailable</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Date-specific overrides */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Date Specific Hours</h3>
            <p className="text-xs text-gray-500 mt-0.5">Override weekly hours by marking availability/unavailability for specific dates.</p>
          </div>
          <button
            onClick={() => setShowAddOverride(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus size={14} /> Add Date Specific Hours
          </button>
        </div>

        {overrides.length === 0 && !showAddOverride && (
          <div className="py-10 text-center">
            <CalendarDays size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No date-specific overrides yet.</p>
          </div>
        )}

        {overrides.length > 0 && (
          <div className="divide-y divide-gray-100">
            {overrides.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-6 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {new Date(o.override_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                    {o.label && <span className="ml-2 text-xs text-gray-500">— {o.label}</span>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {o.is_available
                      ? `Available: ${o.start_time ? formatTime(o.start_time) : '—'} – ${o.end_time ? formatTime(o.end_time) : '—'}`
                      : 'Unavailable (blocked)'}
                  </p>
                </div>
                <button onClick={() => deleteOverride(o.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showAddOverride && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-900 mb-3">Add Date Override</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date</label>
                <input
                  type="date"
                  value={newOverride.date}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setNewOverride((n) => ({ ...n, date: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Label (optional)</label>
                <input
                  type="text"
                  value={newOverride.label}
                  onChange={(e) => setNewOverride((n) => ({ ...n, label: e.target.value }))}
                  placeholder="e.g. Holiday"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newOverride.is_available}
                  onChange={(e) => setNewOverride((n) => ({ ...n, is_available: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-700">Available on this date (custom hours)</span>
              </label>
            </div>
            {newOverride.is_available && (
              <div className="flex items-center gap-3 mb-3">
                <input
                  type="time"
                  value={newOverride.start_time}
                  onChange={(e) => setNewOverride((n) => ({ ...n, start_time: e.target.value }))}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none"
                />
                <span className="text-gray-400">–</span>
                <input
                  type="time"
                  value={newOverride.end_time}
                  onChange={(e) => setNewOverride((n) => ({ ...n, end_time: e.target.value }))}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={addOverride}
                disabled={!newOverride.date}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:opacity-85 disabled:opacity-50"
              >
                Save Override
              </button>
              <button
                onClick={() => setShowAddOverride(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Booking Rules Tab ─────────────────────────────────────────────────────────

function BookingRulesTab() {
  const [settings, setSettings] = useState<Partial<CalendarSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/calendar/settings').then((r) => r.json()).then((d) => { setSettings(d); setLoading(false); });
  }, []);

  const save = async () => {
    setSaving(true);
    await fetch('/api/calendar/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <LoadingCard />;

  return (
    <div className="max-w-2xl space-y-6">
      <Card title="Booking Rules" description="Control how and when appointments can be booked.">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Meeting Duration"
            tooltip="How long each appointment is."
            value={settings.meeting_duration_min ?? 60}
            onChange={(v) => setSettings((s) => ({ ...s, meeting_duration_min: v }))}
            options={DURATION_OPTIONS.map((v) => ({ value: v, label: timeLabel(v) }))}
          />
          <SelectField
            label="Meeting Interval"
            tooltip="Time between available slot start times."
            value={settings.meeting_interval_min ?? 60}
            onChange={(v) => setSettings((s) => ({ ...s, meeting_interval_min: v }))}
            options={INTERVAL_OPTIONS.map((v) => ({ value: v, label: timeLabel(v) }))}
          />
          <SelectField
            label="Minimum Scheduling Notice"
            tooltip="How far in advance an appointment must be booked."
            value={settings.min_scheduling_notice_hrs ?? 24}
            onChange={(v) => setSettings((s) => ({ ...s, min_scheduling_notice_hrs: v }))}
            options={NOTICE_OPTIONS.map((v) => ({ value: v, label: v === 0 ? 'None' : v < 24 ? `${v}h` : `${v / 24}d` }))}
          />
          <SelectField
            label="Date Range"
            tooltip="How far ahead appointments can be booked."
            value={settings.date_range_days ?? 60}
            onChange={(v) => setSettings((s) => ({ ...s, date_range_days: v }))}
            options={RANGE_OPTIONS.map((v) => ({ value: v, label: v < 30 ? `${v} days` : `${v / 30} mo` }))}
          />
          <SelectField
            label="Pre-buffer Time"
            tooltip="Blocked time before each appointment."
            value={settings.pre_buffer_min ?? 0}
            onChange={(v) => setSettings((s) => ({ ...s, pre_buffer_min: v }))}
            options={BUFFER_OPTIONS.map((v) => ({ value: v, label: timeLabel(v) }))}
          />
          <SelectField
            label="Post-buffer Time"
            tooltip="Blocked time after each appointment."
            value={settings.post_buffer_min ?? 0}
            onChange={(v) => setSettings((s) => ({ ...s, post_buffer_min: v }))}
            options={BUFFER_OPTIONS.map((v) => ({ value: v, label: timeLabel(v) }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              Max Bookings per Day
              <InfoTip text="Maximum appointments that can be scheduled on a single day." />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSettings((s) => ({ ...s, max_bookings_per_day: Math.max(1, (s.max_bookings_per_day ?? 4) - 1) }))}
                className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
              >−</button>
              <span className="w-8 text-center text-sm font-medium">{settings.max_bookings_per_day ?? 4}</span>
              <button
                onClick={() => setSettings((s) => ({ ...s, max_bookings_per_day: (s.max_bookings_per_day ?? 4) + 1 }))}
                className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
              >+</button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              Max Bookings per Slot
              <InfoTip text="Maximum bookings allowed per time slot." />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSettings((s) => ({ ...s, max_bookings_per_slot: Math.max(1, (s.max_bookings_per_slot ?? 1) - 1) }))}
                className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
              >−</button>
              <span className="w-8 text-center text-sm font-medium">{settings.max_bookings_per_slot ?? 1}</span>
              <button
                onClick={() => setSettings((s) => ({ ...s, max_bookings_per_slot: (s.max_bookings_per_slot ?? 1) + 1 }))}
                className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50"
              >+</button>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <SaveButton saving={saving} saved={saved} onClick={save} />
      </div>
    </div>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────

function NotificationsTab() {
  const [notifs, setNotifs] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/calendar/notifications')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setNotifs(d); setLoading(false); });
  }, []);

  const updateNotif = (type: string, channel: string, field: keyof NotifRow, value: unknown) => {
    setNotifs((rows) => rows.map((r) =>
      r.notification_type === type && r.channel === channel ? { ...r, [field]: value } : r
    ));
  };

  const save = async () => {
    setSaving(true);
    await fetch('/api/calendar/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifs),
    });
    setSaving(false);
    setSaved(true);
    setEditingKey(null);
    setTimeout(() => setSaved(false), 2000);
  };

  const getNotif = (type: string, channel: string) =>
    notifs.find((n) => n.notification_type === type && n.channel === channel);

  if (loading) return <LoadingCard />;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-600">
          Configure how you send booking notifications via email, SMS, and in-app alerts.
        </p>
        <SaveButton saving={saving} saved={saved} onClick={save} />
      </div>

      {NOTIF_TYPES.map((nt) => {
        const channels = CHANNELS.filter((ch) => getNotif(nt.type, ch) !== undefined);
        const activeChannels = channels.filter((ch) => getNotif(nt.type, ch)?.enabled);

        return (
          <div key={nt.type} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <Bell size={16} className="text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{nt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{nt.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {CHANNELS.map((ch) => {
                  const n = getNotif(nt.type, ch);
                  if (!n) return null;
                  return (
                    <span
                      key={ch}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        n.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {ch === 'in_app' ? 'In-app' : ch.toUpperCase()}
                    </span>
                  );
                })}
                <button
                  onClick={() => setEditingKey(editingKey === nt.type ? null : nt.type)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                >
                  <Edit3 size={14} />
                </button>
              </div>
            </div>

            {editingKey === nt.type && (
              <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-4">
                {CHANNELS.map((ch) => {
                  const n = getNotif(nt.type, ch);
                  if (!n) return null;
                  return (
                    <div key={ch} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-900 capitalize">
                          {ch === 'in_app' ? 'In-App' : ch.toUpperCase()}
                        </p>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Toggle
                            checked={n.enabled}
                            onChange={(v) => updateNotif(nt.type, ch, 'enabled', v)}
                          />
                          <span className="text-xs text-gray-500">{n.enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                      </div>

                      {n.enabled && (
                        <div className="space-y-2 pl-2 border-l-2 border-gray-200">
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-1">Who should receive this?</p>
                            <div className="flex flex-wrap gap-3">
                              {(['notify_contact', 'notify_assigned', 'notify_guests'] as const).map((f) => (
                                <label key={f} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={n[f]}
                                    onChange={(e) => updateNotif(nt.type, ch, f, e.target.checked)}
                                    className="w-3.5 h-3.5 rounded"
                                  />
                                  {f === 'notify_contact' ? 'Contact' : f === 'notify_assigned' ? 'Assigned User' : 'Guests'}
                                </label>
                              ))}
                            </div>
                          </div>

                          {ch === 'email' && (
                            <div>
                              <label className="text-xs text-gray-600 block mb-1">Subject</label>
                              <input
                                type="text"
                                value={n.subject ?? ''}
                                onChange={(e) => updateNotif(nt.type, ch, 'subject', e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900"
                                placeholder="Email subject…"
                              />
                            </div>
                          )}

                          <div>
                            <label className="text-xs text-gray-600 block mb-1">
                              {ch === 'email' ? 'Email Body' : ch === 'sms' ? 'SMS Message' : 'In-App Message'}
                            </label>
                            <textarea
                              value={n.body ?? ''}
                              onChange={(e) => updateNotif(nt.type, ch, 'body', e.target.value)}
                              rows={3}
                              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 resize-none"
                              placeholder="Use {{contact.name}}, {{appointment.start_time}}, {{venue.name}}…"
                            />
                            <p className="text-xs text-gray-400 mt-1">
                              Variables: <code className="bg-gray-100 px-1 rounded">{'{{contact.name}}'}</code>{' '}
                              <code className="bg-gray-100 px-1 rounded">{'{{appointment.start_time}}'}</code>{' '}
                              <code className="bg-gray-100 px-1 rounded">{'{{venue.name}}'}</code>{' '}
                              <code className="bg-gray-100 px-1 rounded">{'{{appointment.timezone}}'}</code>
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Shared Sub-components ─────────────────────────────────────────────────────

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 mb-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-0.5">{title}</h3>
      {description && <p className="text-xs text-gray-500 mb-4">{description}</p>}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function SelectField({
  label, tooltip, value, onChange, options,
}: {
  label: string;
  tooltip?: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
        {label}
        {tooltip && <InfoTip text={tooltip} />}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative cursor-help">
      <Info size={12} className="text-gray-400" />
      <span className="absolute left-full ml-1 top-1/2 -translate-y-1/2 w-48 rounded-lg bg-gray-900 text-white text-xs p-2 opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-lg">
        {text}
      </span>
    </span>
  );
}

function SaveButton({ saving, saved, onClick }: { saving: boolean; saved: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        saved
          ? 'bg-green-600 text-white'
          : 'bg-gray-900 text-white hover:opacity-85'
      } disabled:opacity-50`}
    >
      {saving ? (
        <><Loader2 size={14} className="animate-spin" /> Saving…</>
      ) : saved ? (
        <><Check size={14} /> Saved</>
      ) : (
        <><Save size={14} /> Save Changes</>
      )}
    </button>
  );
}

function LoadingCard() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={24} className="animate-spin text-gray-400" />
    </div>
  );
}

function GoogleCalIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#4285F4" />
      <path d="M7 12h10M12 7v10" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
