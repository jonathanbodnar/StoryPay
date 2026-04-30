'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Clock, Globe, Link2, CalendarDays, Bell, Settings2,
  ChevronRight, CheckCircle2, XCircle, RefreshCw, Plus,
  Trash2, Edit3, Info, Check, X, AlertTriangle, Loader2, Save, Layers,
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
  /** channel is now one of: email_owner | email_contact | sms_owner | sms_contact */
  channel: string;
  enabled: boolean;
  notify_contact: boolean;
  notify_assigned: boolean;
  notify_guests: boolean;
  subject?: string | null;
  body?: string | null;
  offset_minutes?: number | null;
  /** Per-channel reminder offsets — only meaningful for notification_type = 'reminder' */
  reminder_offsets?: { d: number; h: number; m: number }[] | null;
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
  { type: 'booked_confirmed', label: 'Appointment Booked (Confirmed)', desc: 'Sent when an appointment is successfully confirmed.' },
  { type: 'cancellation',     label: 'Cancellation',                   desc: 'Sent when an appointment is cancelled.' },
  { type: 'reschedule',       label: 'Reschedule',                     desc: 'Sent when an appointment is rescheduled.' },
  { type: 'reminder',         label: 'Reminder',                       desc: 'Sent before the appointment as a reminder.' },
  { type: 'follow_up',        label: 'Follow-Up',                      desc: 'Sent after the appointment is completed.' },
];

/** Ordered list of per-recipient template channels */
const NOTIF_CHANNELS: { key: string; label: string; medium: 'email' | 'sms'; recipient: 'owner' | 'contact' }[] = [
  { key: 'email_owner',   label: 'Email → Venue Owner', medium: 'email', recipient: 'owner' },
  { key: 'email_contact', label: 'Email → Contact',     medium: 'email', recipient: 'contact' },
  { key: 'sms_owner',     label: 'SMS → Venue Owner',   medium: 'sms',   recipient: 'owner' },
  { key: 'sms_contact',   label: 'SMS → Contact',       medium: 'sms',   recipient: 'contact' },
];

const MERGE_TAGS = [
  // Contact
  { tag: '{{contact.first_name}}',        desc: "Contact's first name" },
  { tag: '{{contact.last_name}}',         desc: "Contact's last name" },
  { tag: '{{contact.name}}',              desc: "Contact's full name" },
  { tag: '{{contact.email}}',             desc: "Contact's email" },
  { tag: '{{contact.phone}}',             desc: "Contact's phone" },
  // Appointment
  { tag: '{{appointment.title}}',         desc: 'Appointment title' },
  { tag: '{{appointment.date}}',          desc: 'Date only (e.g. Monday, May 5, 2026)' },
  { tag: '{{appointment.time}}',          desc: 'Time only (e.g. 2:00 PM)' },
  { tag: '{{appointment.start_time}}',    desc: 'Full start date & time' },
  { tag: '{{appointment.end_time}}',      desc: 'Full end date & time' },
  { tag: '{{appointment.duration}}',      desc: 'Duration (e.g. 1 hour)' },
  { tag: '{{appointment.timezone}}',      desc: 'Timezone abbreviation' },
  { tag: '{{appointment.meeting_location}}', desc: 'Meeting link or address' },
  { tag: '{{appointment.calendar_name}}', desc: 'Calendar name (e.g. Tour Calendar)' },
  // Venue
  { tag: '{{venue.name}}',                desc: 'Venue / business name' },
  { tag: '{{venue.owner_name}}',          desc: "Owner's full name" },
  { tag: '{{venue.owner_first_name}}',    desc: "Owner's first name" },
  { tag: '{{venue.email}}',               desc: "Venue's contact email" },
  { tag: '{{venue.phone}}',               desc: "Venue's phone number" },
  { tag: '{{venue.address}}',             desc: 'Full venue address' },
  { tag: '{{venue.city}}',               desc: 'Venue city' },
  { tag: '{{venue.state}}',              desc: 'Venue state' },
  { tag: '{{venue.website}}',             desc: 'Venue website URL' },
  // System
  { tag: '{{system.date}}',               desc: "Today's date at send time" },
  { tag: '{{system.year}}',               desc: 'Current year' },
];

// ── Default templates per scenario × channel ─────────────────────────────────
const NOTIF_DEFAULTS: Record<string, Record<string, { subject?: string; body: string }>> = {
  booked_confirmed: {
    email_owner: {
      subject: 'New Booking: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

A new appointment has been confirmed.

Contact: {{contact.name}} ({{contact.email}})
Phone: {{contact.phone}}
Title: {{appointment.title}}
Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

— {{venue.name}}`,
    },
    email_contact: {
      subject: 'Confirmed! Your {{appointment.title}} on {{appointment.start_time}} ({{appointment.timezone}})',
      body: `Hi {{contact.name}},

Your appointment has been confirmed. Here are the details of your upcoming appointment:

Appointment Title: {{appointment.title}}
Date and Time: {{appointment.start_time}} ({{appointment.timezone}})
Meeting Link / Location: {{appointment.meeting_location}}

We look forward to connecting with you!

{{venue.name}}`,
    },
    sms_owner: {
      body: `New booking: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).`,
    },
    sms_contact: {
      body: `Hi {{contact.name}}, your appointment "{{appointment.title}}" is confirmed for {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}`,
    },
  },
  cancellation: {
    email_owner: {
      subject: 'Cancelled: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

The following appointment has been cancelled:

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
Date: {{appointment.start_time}} ({{appointment.timezone}})

— {{venue.name}}`,
    },
    email_contact: {
      subject: 'Your Appointment Has Been Cancelled',
      body: `Hi {{contact.name}},

Your appointment "{{appointment.title}}" scheduled for {{appointment.start_time}} ({{appointment.timezone}}) has been cancelled.

If you have any questions or would like to reschedule, please don't hesitate to reach out.

{{venue.name}}`,
    },
    sms_owner: {
      body: `Cancelled: {{appointment.title}} with {{contact.name}} (was {{appointment.start_time}}).`,
    },
    sms_contact: {
      body: `Hi {{contact.name}}, your appointment "{{appointment.title}}" on {{appointment.start_time}} has been cancelled. Contact us to reschedule.`,
    },
  },
  reschedule: {
    email_owner: {
      subject: 'Rescheduled: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

An appointment has been rescheduled:

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
New Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

— {{venue.name}}`,
    },
    email_contact: {
      subject: 'Your Appointment Has Been Rescheduled',
      body: `Hi {{contact.name}},

Your appointment "{{appointment.title}}" has been rescheduled to:

Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

{{venue.name}}`,
    },
    sms_owner: {
      body: `Rescheduled: {{appointment.title}} with {{contact.name}} → {{appointment.start_time}} ({{appointment.timezone}}).`,
    },
    sms_contact: {
      body: `Hi {{contact.name}}, your appointment "{{appointment.title}}" has been rescheduled to {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}`,
    },
  },
  reminder: {
    email_owner: {
      subject: 'Upcoming Appointment: {{appointment.title}} with {{contact.name}}',
      body: `Hi,

Reminder: you have an upcoming appointment.

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
Date & Time: {{appointment.start_time}} ({{appointment.timezone}})
Location: {{appointment.meeting_location}}

— {{venue.name}}`,
    },
    email_contact: {
      subject: 'Reminder: Your Appointment — {{appointment.title}}',
      body: `Hi {{contact.name}},

This is a reminder for your upcoming appointment:

Appointment Title: {{appointment.title}}
Date and Time: {{appointment.start_time}} ({{appointment.timezone}})
Meeting Link / Location: {{appointment.meeting_location}}

We look forward to speaking with you!

{{venue.name}}`,
    },
    sms_owner: {
      body: `Reminder: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}} ({{appointment.timezone}}).`,
    },
    sms_contact: {
      body: `Hi {{contact.name}}, reminder: "{{appointment.title}}" is on {{appointment.start_time}} ({{appointment.timezone}}). Location: {{appointment.meeting_location}}`,
    },
  },
  follow_up: {
    email_owner: {
      subject: 'Follow-Up: {{appointment.title}} with {{contact.name}} completed',
      body: `Hi,

The following appointment has been completed:

Contact: {{contact.name}} ({{contact.email}})
Title: {{appointment.title}}
Date: {{appointment.start_time}} ({{appointment.timezone}})

— {{venue.name}}`,
    },
    email_contact: {
      subject: 'Thank You — {{appointment.title}}',
      body: `Hi {{contact.name}},

Thank you for your appointment "{{appointment.title}}" on {{appointment.start_time}}.

We hope it was valuable! Please don't hesitate to reach out if you have any questions or would like to book another appointment.

{{venue.name}}`,
    },
    sms_owner: {
      body: `Completed: {{appointment.title}} with {{contact.name}} on {{appointment.start_time}}.`,
    },
    sms_contact: {
      body: `Hi {{contact.name}}, thanks for your appointment "{{appointment.title}}"! Feel free to reach out with any questions. — {{venue.name}}`,
    },
  },
};

/** Default per-channel reminder offsets (used when no DB value is saved yet) */
const DEFAULT_CHANNEL_OFFSETS: Record<string, { d: number; h: number; m: number }[]> = {
  email_owner:   [{ d: 1, h: 0, m: 0 }, { d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
  email_contact: [{ d: 1, h: 0, m: 0 }, { d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
  sms_owner:     [{ d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
  sms_contact:   [{ d: 0, h: 1, m: 0 }, { d: 0, h: 0, m: 10 }],
};

// Default follow-up offset: 30 minutes after the event ends
const DEFAULT_FOLLOWUP_OFFSETS: { d: number; h: number; m: number }[] = [{ d: 0, h: 0, m: 30 }];

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
    { id: 'calendars', label: 'Calendars', icon: Layers },
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
      {activeTab === 'calendars' && <CalendarsTab />}
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

// ── Calendars Tab ─────────────────────────────────────────────────────────────

interface VenueCalendar {
  id: string;
  name: string;
  color: string;
  description: string | null;
  is_default: boolean;
  sort_order: number;
}

const CALENDAR_COLORS = [
  '#1b1b1b', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

function CalendarsTab() {
  const [calendars, setCalendars] = useState<VenueCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');

  // New calendar form
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#1b1b1b');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Edit form
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editDesc, setEditDesc] = useState('');

  useEffect(() => {
    fetch('/api/venue-calendars')
      .then((r) => r.json())
      .then((d) => { setCalendars(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const startEdit = (cal: VenueCalendar) => {
    setEditId(cal.id);
    setEditName(cal.name);
    setEditColor(cal.color);
    setEditDesc(cal.description ?? '');
  };

  const saveEdit = async (id: string) => {
    setSaving(id);
    setError('');
    const res = await fetch(`/api/venue-calendars/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, color: editColor, description: editDesc }),
    });
    const data = await res.json() as VenueCalendar & { error?: string };
    if (data.error) { setError(data.error); } else {
      setCalendars((prev) => prev.map((c) => c.id === id ? data : c));
      setEditId(null);
    }
    setSaving(null);
  };

  const setDefault = async (id: string) => {
    setSaving(id);
    await fetch(`/api/venue-calendars/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_default: true }),
    });
    setCalendars((prev) => prev.map((c) => ({ ...c, is_default: c.id === id })));
    setSaving(null);
  };

  const deleteCalendar = async (id: string) => {
    if (!window.confirm('Delete this calendar? Events will be moved to the default calendar.')) return;
    setDeleting(id);
    setError('');
    const res = await fetch(`/api/venue-calendars/${id}`, { method: 'DELETE' });
    const data = await res.json() as { success?: boolean; error?: string };
    if (data.error) { setError(data.error); } else {
      setCalendars((prev) => prev.filter((c) => c.id !== id));
    }
    setDeleting(null);
  };

  const createCalendar = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    const res = await fetch('/api/venue-calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor, description: newDesc.trim() || null }),
    });
    const data = await res.json() as VenueCalendar & { error?: string };
    if (data.error) { setError(data.error); } else {
      setCalendars((prev) => [...prev, data]);
      setNewName(''); setNewColor('#1b1b1b'); setNewDesc('');
      setShowCreate(false);
    }
    setCreating(false);
  };

  if (loading) return <LoadingCard />;

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-gray-500">
        Create multiple calendars (e.g. "Tour Calendar", "Phone Calls") to organize events and give each its own notification templates. All calendars appear on one unified view.
      </p>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Calendar list */}
      <div className="space-y-2">
        {calendars.map((cal) => (
          <div key={cal.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {editId === cal.id ? (
              /* Edit mode */
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-800"
                    placeholder="Calendar name"
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {CALENDAR_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditColor(c)}
                        className={`w-6 h-6 rounded-full transition-all ${editColor === c ? 'ring-2 ring-offset-1 ring-gray-800 scale-110' : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-800"
                  placeholder="Description (optional)"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditId(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button
                    onClick={() => saveEdit(cal.id)}
                    disabled={saving === cal.id || !editName.trim()}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ backgroundColor: '#1b1b1b' }}
                  >
                    {saving === cal.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              /* Display mode */
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: cal.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{cal.name}</p>
                    {cal.is_default && (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                        Default
                      </span>
                    )}
                  </div>
                  {cal.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{cal.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!cal.is_default && (
                    <button
                      onClick={() => setDefault(cal.id)}
                      disabled={saving === cal.id}
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(cal)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Edit3 size={13} />
                  </button>
                  {calendars.length > 1 && (
                    <button
                      onClick={() => deleteCalendar(cal.id)}
                      disabled={deleting === cal.id}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deleting === cal.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create new calendar — hidden when at the 3-calendar limit */}
      {calendars.length >= 3 ? (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <strong>Maximum 3 calendars reached.</strong> Delete an existing calendar to create a new one.
        </div>
      ) : showCreate ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-700">New Calendar</p>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-800"
              placeholder="Calendar name (e.g. Tour Calendar)"
              autoFocus
            />
            <div className="flex gap-1.5 flex-wrap">
              {CALENDAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded-full transition-all ${newColor === c ? 'ring-2 ring-offset-1 ring-gray-800 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-800"
            placeholder="Description (optional)"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowCreate(false); setNewName(''); setNewColor('#1b1b1b'); setNewDesc(''); }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
            <button
              onClick={createCalendar}
              disabled={creating || !newName.trim()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Create Calendar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors w-full"
        >
          <Plus size={14} /> Add calendar <span className="ml-auto text-[11px] text-gray-400">{calendars.length}/3</span>
        </button>
      )}

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        <strong>How it works:</strong> All calendars share one calendar view and are color-coded. Each calendar can have its own notification templates — go to the <strong>Notifications</strong> tab and select a calendar from the dropdown to configure its templates. Maximum 3 calendars per venue.
      </div>
    </div>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────

// ── Reminder offset helpers ───────────────────────────────────────────────────

type OffsetUnit = 'minutes' | 'hours' | 'days';
interface OffsetRow { value: number; unit: OffsetUnit }

function dhmToOffsetRow(o: { d: number; h: number; m: number }): OffsetRow {
  if (o.d > 0) return { value: o.d, unit: 'days' };
  if (o.h > 0) return { value: o.h, unit: 'hours' };
  return { value: o.m || 0, unit: 'minutes' };
}

function offsetRowToDhm(r: OffsetRow): { d: number; h: number; m: number } {
  if (r.unit === 'days')  return { d: r.value, h: 0, m: 0 };
  if (r.unit === 'hours') return { d: 0, h: r.value, m: 0 };
  return { d: 0, h: 0, m: r.value };
}

// ─────────────────────────────────────────────────────────────────────────────

function NotificationsTab() {
  const [notifs, setNotifs] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());
  const [showTags, setShowTags] = useState(false);
  // key = "type:channel"
  const [testState, setTestState] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({});
  const [testError, setTestError] = useState<Record<string, string>>({});
  // key = "type:channel", value = recipient email or phone digits
  const [testRecipients, setTestRecipients] = useState<Record<string, string>>({});

  // Per-calendar template support
  const [calendars, setCalendars] = useState<VenueCalendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null);

  // Build a full default row for a given type+channel if none exists in DB
  const makeDefault = (type: string, channel: string): NotifRow => {
    const def = NOTIF_DEFAULTS[type]?.[channel];
    let offsets: { d: number; h: number; m: number }[] | null = null;
    if (type === 'reminder') offsets = DEFAULT_CHANNEL_OFFSETS[channel] ?? null;
    if (type === 'follow_up') offsets = DEFAULT_FOLLOWUP_OFFSETS;
    return {
      notification_type: type,
      channel,
      enabled: false,
      notify_contact: channel.includes('contact'),
      notify_assigned: false,
      notify_guests: false,
      subject: def?.subject ?? null,
      body: def?.body ?? '',
      reminder_offsets: offsets,
    };
  };

  // Merge DB rows over defaults so every type×channel is always represented
  const buildFull = (dbRows: NotifRow[]): NotifRow[] => {
    const result: NotifRow[] = [];
    for (const nt of NOTIF_TYPES) {
      for (const ch of NOTIF_CHANNELS) {
        const existing = dbRows.find(
          (r) => r.notification_type === nt.type && r.channel === ch.key,
        );
        // Backfill reminder_offsets if DB row is missing them
        if (existing && existing.notification_type === 'reminder' && !existing.reminder_offsets) {
          existing.reminder_offsets = DEFAULT_CHANNEL_OFFSETS[ch.key] ?? null;
        }
        if (existing && existing.notification_type === 'follow_up' && !existing.reminder_offsets) {
          existing.reminder_offsets = DEFAULT_FOLLOWUP_OFFSETS;
        }
        result.push(existing ?? makeDefault(nt.type, ch.key));
      }
    }
    return result;
  };

  // Load calendars list once on mount
  useEffect(() => {
    fetch('/api/venue-calendars')
      .then((r) => r.json())
      .then((d) => setCalendars(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Load notification templates whenever the selected calendar changes
  useEffect(() => {
    setLoading(true);
    const url = selectedCalendarId
      ? `/api/calendar/notifications?calendar_id=${selectedCalendarId}`
      : '/api/calendar/notifications';
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setNotifs(buildFull(Array.isArray(data) ? (data as NotifRow[]) : []));
        setExpandedType(null);
        setOpenChannels(new Set());
        setLoading(false);
      })
      .catch(() => {
        setNotifs(buildFull([]));
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCalendarId]);

  const updateRow = (type: string, channel: string, field: keyof NotifRow, value: unknown) =>
    setNotifs((rows) =>
      rows.map((r) =>
        r.notification_type === type && r.channel === channel ? { ...r, [field]: value } : r,
      ),
    );

  const getRow = (type: string, channel: string) =>
    notifs.find((r) => r.notification_type === type && r.channel === channel);

  const resetToDefault = (type: string, channel: string) => {
    const def = NOTIF_DEFAULTS[type]?.[channel];
    if (!def) return;
    setNotifs((rows) =>
      rows.map((r) =>
        r.notification_type === type && r.channel === channel
          ? { ...r, subject: def.subject ?? null, body: def.body }
          : r,
      ),
    );
  };

  // ── Per-channel reminder offset helpers ──────────────────────────────────────

  const getChannelOffsets = (type: string, channel: string): OffsetRow[] => {
    const row = getRow(type, channel);
    const fallback = type === 'follow_up'
      ? DEFAULT_FOLLOWUP_OFFSETS
      : (DEFAULT_CHANNEL_OFFSETS[channel] ?? [{ d: 0, h: 1, m: 0 }]);
    const raw = row?.reminder_offsets ?? fallback;
    return raw.map(dhmToOffsetRow);
  };

  const updateChannelOffset = (type: string, channel: string, idx: number, patch: Partial<OffsetRow>) => {
    const offsets = getChannelOffsets(type, channel);
    const updated = offsets.map((o, i) => i === idx ? { ...o, ...patch } : o);
    updateRow(type, channel, 'reminder_offsets', updated.map(offsetRowToDhm));
  };

  const addChannelOffset = (type: string, channel: string) => {
    const offsets = getChannelOffsets(type, channel);
    if (offsets.length >= 3) return;
    updateRow(type, channel, 'reminder_offsets', [...offsets, { value: 1, unit: 'hours' as OffsetUnit }].map(offsetRowToDhm));
  };

  const removeChannelOffset = (type: string, channel: string, idx: number) => {
    const offsets = getChannelOffsets(type, channel);
    updateRow(type, channel, 'reminder_offsets', offsets.filter((_, i) => i !== idx).map(offsetRowToDhm));
  };

  // ── Channel expand/collapse ───────────────────────────────────────────────────

  const toggleChannel = (key: string) =>
    setOpenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const handleToggleEnabled = (type: string, chKey: string, v: boolean) => {
    updateRow(type, chKey, 'enabled', v);
    // Auto-open the editor when enabling
    if (v) setOpenChannels((prev) => new Set([...prev, `${type}:${chKey}`]));
  };

  // ── Send test ─────────────────────────────────────────────────────────────────

  const sendTest = async (type: string, channel: string) => {
    const row = getRow(type, channel);
    if (!row?.body) return;
    const key = `${type}:${channel}`;
    const isSms = channel.startsWith('sms_');
    const rawRecipient = (testRecipients[key] ?? '').trim();
    // For SMS, strip non-digits and prepend +1
    const testTo = isSms
      ? `+1${rawRecipient.replace(/\D/g, '')}`
      : rawRecipient;
    if (!testTo || (isSms && testTo === '+1')) return; // nothing typed yet
    setTestState((s) => ({ ...s, [key]: 'sending' }));
    setTestError((s) => ({ ...s, [key]: '' }));
    try {
      const res = await fetch('/api/calendar/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, subject: row.subject, body: row.body, testTo }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (json.ok) {
        setTestState((s) => ({ ...s, [key]: 'sent' }));
        setTimeout(() => setTestState((s) => ({ ...s, [key]: 'idle' })), 3000);
      } else {
        setTestState((s) => ({ ...s, [key]: 'error' }));
        setTestError((s) => ({ ...s, [key]: json.error ?? 'Unknown error' }));
      }
    } catch {
      setTestState((s) => ({ ...s, [key]: 'error' }));
      setTestError((s) => ({ ...s, [key]: 'Network error — please try again' }));
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────────

  const save = async () => {
    setSaving(true);
    try {
      // Tag each row with the currently selected calendar_id (null = venue-wide default)
      const payload = notifs.map((r) => ({ ...r, calendar_id: selectedCalendarId ?? null }));
      await fetch('/api/calendar/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSaved(true);
      setExpandedType(null);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingCard />;

  const selectedCalendar = calendars.find((c) => c.id === selectedCalendarId) ?? null;

  return (
    <div className="max-w-3xl space-y-3">
      {/* Calendar picker — only shown when venue has multiple calendars */}
      {calendars.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3">
          <Layers size={14} className="text-gray-400 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-700 mb-1">Editing templates for</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCalendarId(null)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedCalendarId === null
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                All Calendars (Default)
              </button>
              {calendars.map((cal) => (
                <button
                  key={cal.id}
                  onClick={() => setSelectedCalendarId(cal.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedCalendarId === cal.id
                      ? 'text-white'
                      : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                  style={selectedCalendarId === cal.id ? { backgroundColor: cal.color } : {}}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selectedCalendarId === cal.id ? 'white' : cal.color }} />
                  {cal.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedCalendar && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          Editing templates for <strong>{selectedCalendar.name}</strong>. These override the "All Calendars" defaults for events in this calendar. Leave a channel template body empty to inherit the default.
        </div>
      )}

      <p className="text-sm text-gray-500 mb-2">
        Configure email and SMS templates per scenario. Each channel has independent settings and, for reminders, its own send schedule.
      </p>

      {/* Merge tags reference */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTags((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2 text-xs text-gray-600 font-medium">
            <Info size={13} className="text-gray-400" />
            Available merge tags
          </span>
          <ChevronRight size={13} className={`text-gray-400 transition-transform ${showTags ? 'rotate-90' : ''}`} />
        </button>
        {showTags && (
          <div className="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-gray-100">
            {MERGE_TAGS.map(({ tag, desc }) => (
              <div key={tag} className="flex items-center gap-2 py-0.5">
                <code className="shrink-0 bg-gray-50 border border-gray-200 text-[11px] font-mono px-1.5 py-0.5 rounded text-gray-800">{tag}</code>
                <span className="text-[11px] text-gray-400">{desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notification scenario accordions */}
      {NOTIF_TYPES.map((nt) => {
        const isOpen = expandedType === nt.type;
        const activeCount = NOTIF_CHANNELS.filter((ch) => getRow(nt.type, ch.key)?.enabled).length;

        return (
          <div key={nt.type} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {/* Scenario header */}
            <button
              type="button"
              onClick={() => setExpandedType(isOpen ? null : nt.type)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
            >
              <div>
                <p className="text-sm font-semibold text-gray-900">{nt.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{nt.desc}</p>
              </div>
              <div className="flex items-center gap-2.5 ml-4 shrink-0">
                {activeCount > 0 && (
                  <span className="text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                    {activeCount} active
                  </span>
                )}
                <ChevronRight size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              </div>
            </button>

            {/* Channel rows */}
            {isOpen && (
              <div className="border-t border-gray-100 divide-y divide-gray-100">
                {NOTIF_CHANNELS.map((ch) => {
                  const row = getRow(nt.type, ch.key);
                  if (!row) return null;
                  const def = NOTIF_DEFAULTS[nt.type]?.[ch.key];
                  const isEmail = ch.medium === 'email';
                  const smsLen = !isEmail ? (row.body ?? '').length : 0;
                  const chStateKey = `${nt.type}:${ch.key}`;
                  const isChOpen = openChannels.has(chStateKey);
                  const isReminder = nt.type === 'reminder';
                  const isFollowUp = nt.type === 'follow_up';
                  const channelOffsets = (isReminder || isFollowUp) ? getChannelOffsets(nt.type, ch.key) : [];

                  return (
                    <div key={ch.key} className="bg-white">
                      {/* Channel header — click chevron area to expand editor */}
                      <div
                        className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleChannel(chStateKey)}
                      >
                        <div className="flex items-center gap-2.5">
                          <ChevronRight
                            size={13}
                            className={`text-gray-400 transition-transform shrink-0 ${isChOpen ? 'rotate-90' : ''}`}
                          />
                          <span className="text-xs font-medium text-gray-700">{ch.label}</span>
                          {row.enabled && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </div>
                        {/* Toggle: stop propagation so clicking it doesn't toggle accordion */}
                        <label
                          className="flex items-center gap-2 cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Toggle
                            checked={row.enabled}
                            onChange={(v) => handleToggleEnabled(nt.type, ch.key, v)}
                          />
                          <span className={`text-xs font-medium ${row.enabled ? 'text-gray-700' : 'text-gray-400'}`}>
                            {row.enabled ? 'On' : 'Off'}
                          </span>
                        </label>
                      </div>

                      {/* Editor panel — open when chevron clicked (independent of toggle) */}
                      {isChOpen && (
                        <div className="px-5 pb-5 bg-gray-50 border-t border-gray-100 space-y-4">

                          {/* ── Timing (reminder = before event, follow_up = after event) ── */}
                          {(isReminder || isFollowUp) && (
                            <div className="pt-4">
                              <p className="text-xs font-semibold text-gray-700 mb-2">
                                {isFollowUp ? `Send follow-up — ${ch.label}` : `When to send — ${ch.label}`}
                              </p>
                              <div className="space-y-2">
                                {channelOffsets.map((offset, idx) => (
                                  <div key={idx} className="flex items-center gap-2.5">
                                    <input
                                      type="number"
                                      min={1}
                                      max={365}
                                      value={offset.value}
                                      onChange={(e) =>
                                        updateChannelOffset(nt.type, ch.key, idx, {
                                          value: Math.max(1, parseInt(e.target.value) || 1),
                                        })
                                      }
                                      className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-gray-800"
                                    />
                                    <select
                                      value={offset.unit}
                                      onChange={(e) =>
                                        updateChannelOffset(nt.type, ch.key, idx, {
                                          unit: e.target.value as OffsetUnit,
                                        })
                                      }
                                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-gray-800"
                                    >
                                      <option value="minutes">Minutes</option>
                                      <option value="hours">Hours</option>
                                      <option value="days">Days</option>
                                    </select>
                                    <span className="text-sm text-gray-500 flex-1">
                                      {isFollowUp ? 'after event ends' : 'before'}
                                    </span>
                                    {channelOffsets.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => removeChannelOffset(nt.type, ch.key, idx)}
                                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {channelOffsets.length < 3 && (
                                <button
                                  type="button"
                                  onClick={() => addChannelOffset(nt.type, ch.key)}
                                  className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                                >
                                  <Plus size={12} /> Add time
                                </button>
                              )}
                              <p className="mt-2 text-[11px] text-gray-400">
                                {isFollowUp
                                  ? 'Up to 3 follow-up times per channel, each counted after the event ends.'
                                  : 'Up to 3 send times per channel.'}
                              </p>
                            </div>
                          )}

                          {/* Subject (email only) */}
                          {isEmail && (
                            <div className={(isReminder || isFollowUp) ? '' : 'pt-4'}>
                              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                Subject <span className="text-red-400">*</span>
                              </label>
                              <input
                                type="text"
                                value={row.subject ?? ''}
                                onChange={(e) => updateRow(nt.type, ch.key, 'subject', e.target.value)}
                                placeholder={def?.subject ?? 'Email subject line…'}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-800"
                              />
                            </div>
                          )}

                          {/* Message body */}
                          <div className={isEmail || isReminder || isFollowUp ? '' : 'pt-4'}>
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="text-xs font-medium text-gray-600">
                                {isEmail ? 'Email body' : 'SMS message'}
                              </label>
                              {!isEmail && (
                                <span className={`text-[11px] font-medium ${smsLen > 160 ? 'text-red-500' : 'text-gray-400'}`}>
                                  {smsLen} / 160 chars
                                </span>
                              )}
                            </div>
                            <textarea
                              value={row.body ?? ''}
                              onChange={(e) => updateRow(nt.type, ch.key, 'body', e.target.value)}
                              rows={isEmail ? 9 : 4}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-gray-800 resize-y font-mono"
                              placeholder={def?.body ?? 'Enter message…'}
                            />
                          </div>

                          {/* Bottom action row: test recipient + send + reset */}
                          {(() => {
                            const tKey = `${nt.type}:${ch.key}`;
                            const ts = testState[tKey] ?? 'idle';
                            const isSms = ch.medium === 'sms';
                            const recipientVal = testRecipients[tKey] ?? '';
                            const hasRecipient = isSms
                              ? recipientVal.replace(/\D/g, '').length >= 10
                              : recipientVal.includes('@');
                            return (
                              <div className="pt-2 space-y-2">
                                {/* Recipient input row */}
                                <div className="flex items-center gap-2">
                                  {isSms ? (
                                    <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden focus-within:ring-1 focus-within:ring-gray-800 bg-white flex-1">
                                      <span className="px-2.5 py-2 text-sm text-gray-500 bg-gray-50 border-r border-gray-300 select-none font-mono">+1</span>
                                      <input
                                        type="tel"
                                        value={recipientVal}
                                        onChange={(e) => {
                                          // Only allow digits, spaces, dashes, parens
                                          const clean = e.target.value.replace(/[^\d\s\-()]/g, '');
                                          setTestRecipients((p) => ({ ...p, [tKey]: clean }));
                                        }}
                                        placeholder="555 555 5555"
                                        className="flex-1 px-2.5 py-2 text-sm focus:outline-none bg-white"
                                      />
                                    </div>
                                  ) : (
                                    <input
                                      type="email"
                                      value={recipientVal}
                                      onChange={(e) =>
                                        setTestRecipients((p) => ({ ...p, [tKey]: e.target.value }))
                                      }
                                      placeholder="test@example.com"
                                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-800 bg-white"
                                    />
                                  )}
                                  <button
                                    type="button"
                                    disabled={ts === 'sending' || !row.body || !hasRecipient}
                                    onClick={() => sendTest(nt.type, ch.key)}
                                    className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all disabled:opacity-40 ${
                                      ts === 'sent'
                                        ? 'border-green-300 bg-green-50 text-green-700'
                                        : ts === 'error'
                                        ? 'border-red-300 bg-red-50 text-red-600'
                                        : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-800'
                                    }`}
                                  >
                                    {ts === 'sending' ? (
                                      <><Loader2 size={12} className="animate-spin" /> Sending…</>
                                    ) : ts === 'sent' ? (
                                      <><Check size={12} /> Sent!</>
                                    ) : ts === 'error' ? (
                                      <><X size={12} /> Failed</>
                                    ) : (
                                      <>Send test {isSms ? 'SMS' : 'email'}</>
                                    )}
                                  </button>
                                </div>

                                {/* Error message */}
                                {ts === 'error' && testError[tKey] && (
                                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 leading-snug">
                                    {testError[tKey]}
                                  </p>
                                )}

                                {/* Reset to default */}
                                {def && (
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => resetToDefault(nt.type, ch.key)}
                                      className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
                                    >
                                      Reset to default
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
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

      <div className="flex justify-end pt-2">
        <SaveButton saving={saving} saved={saved} onClick={save} />
      </div>
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
