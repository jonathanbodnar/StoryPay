'use client';

/**
 * Super-admin AI Concierge panel.
 *
 * Renders three things:
 *   1. The global kill-switch (front and center; toggling it short-circuits
 *      both crons within ~30 seconds)
 *   2. Pulse stats (sent / failed / opted-out in the last 24h)
 *   3. Three tabbed views:
 *        - Live runs   (most recent ai_runs across all venues)
 *        - Transitions (most recent ai_state_transitions)
 *        - Venues      (per-venue overview + per-venue actions)
 *
 * All data is live-fetched from /api/admin/ai-concierge/*. The kill switch
 * has a 30-second server-side cache, so the cron-side effect lags slightly;
 * we surface that in the UI so operators don't get confused.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Loader2, AlertTriangle, RotateCw, Power, Search,
  CheckCircle2, XCircle, Pause, Play, Shield, ShieldOff,
  ExternalLink, BadgeCheck, Activity, MessageSquare, Filter,
  Workflow, FileCode2,
} from 'lucide-react';
import AiConciergeHandoffRulesEditor from './AiConciergeHandoffRulesEditor';
import AiConciergeConfigEditor from './AiConciergeConfigEditor';

const BRAND = '#1b1b1b';

// ── API types ─────────────────────────────────────────────────────────────

interface KillSwitch {
  killSwitchEnabled: boolean;
  killSwitchReason:  string | null;
  killSwitchSetBy:   string | null;
  killSwitchSetAt:   string | null;
  updatedAt:         string;
}

interface RunRow {
  id:                  string;
  lead_id:             string;
  venue_id:            string;
  ai_config_version:   number | null;
  attempt_number:      number | null;
  angle_used:          string | null;
  sms_provider:        string | null;
  provider_message_id: string | null;
  outcome:             string;
  error_detail:        string | null;
  final_sent_text:     string | null;
  created_at:          string;
  venue_name:          string | null;
  lead_first_name:     string | null;
  lead_last_name:      string | null;
  lead_email:          string | null;
}

interface RunsPayload {
  rows:       RunRow[];
  nextCursor: string | null;
  summary:    { sentLast24h: number; failedLast24h: number; optedOutLast24h: number };
}

interface TransitionRow {
  id:           string;
  lead_id:      string;
  venue_id:     string;
  from_state:   string | null;
  to_state:     string;
  reason:       string | null;
  triggered_by: string | null;
  metadata:     Record<string, unknown> | null;
  created_at:   string;
  venue_name:   string | null;
  lead_first_name: string | null;
  lead_last_name:  string | null;
  lead_email:      string | null;
}

interface VenueRow {
  id:                          string;
  name:                        string | null;
  email:                       string | null;
  ai_concierge_enabled:        boolean | null;
  a2p_verified:                boolean | null;
  directory_addon_concierge:   boolean | null;
  ai_assistant_persona_name:   string | null;
  ai_concierge_enabled_at:     string | null;
  sms_provider:                string | null;
  ghl_location_id:             string | null;
  created_at:                  string | null;
  ghlConnected:                boolean;
  isEligible:                  boolean;
  leadCounts: {
    ai_active:  number;
    paused:     number;
    handoff:    number;
    opted_out:  number;
    exhausted:  number;
    dormant:    number;
    total:      number;
  };
}

interface VenuesPayload {
  venues: VenueRow[];
  totals: {
    totalVenues:        number;
    addonHolders:       number;
    aiEnabled:          number;
    a2pVerified:        number;
    eligibleNotEnabled: number;
  };
}

type TabKey = 'runs' | 'transitions' | 'venues' | 'handoff-rules' | 'prompt-config';

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return '—'; }
}
function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const now = Date.now();
  const t   = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.max(0, now - t);
  if (diff < 60_000)         return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function leadDisplay(r: { lead_first_name: string | null; lead_last_name: string | null; lead_email: string | null }) {
  const name = [r.lead_first_name, r.lead_last_name].filter(Boolean).join(' ').trim();
  return name || r.lead_email || '—';
}

// Outcome badge (used in runs table)
function OutcomePill({ outcome }: { outcome: string }) {
  const map: Record<string, { bg: string; fg: string; label?: string }> = {
    sent:                    { bg: 'bg-emerald-50', fg: 'text-emerald-700' },
    invalid_phone:           { bg: 'bg-rose-50',    fg: 'text-rose-700'    },
    dnd:                     { bg: 'bg-rose-50',    fg: 'text-rose-700'    },
    permanent_error:         { bg: 'bg-rose-50',    fg: 'text-rose-700'    },
    transient_error:         { bg: 'bg-amber-50',   fg: 'text-amber-700'   },
    auth_error:              { bg: 'bg-amber-50',   fg: 'text-amber-700'   },
    expired:                 { bg: 'bg-orange-50',  fg: 'text-orange-700'  },
    manual_re_enable:        { bg: 'bg-blue-50',    fg: 'text-blue-700'    },
    llm_error:               { bg: 'bg-purple-50',  fg: 'text-purple-700'  },
    reschedule_quiet_hours:  { bg: 'bg-gray-100',   fg: 'text-gray-700', label: 'rescheduled' },
  };
  const spec = map[outcome] ?? { bg: 'bg-gray-100', fg: 'text-gray-700' };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${spec.bg} ${spec.fg}`}>
      {spec.label ?? outcome}
    </span>
  );
}

function StatePill({ state }: { state: string | null }) {
  if (!state) return <span className="text-gray-400">—</span>;
  const map: Record<string, { bg: string; fg: string }> = {
    dormant:   { bg: 'bg-gray-50',     fg: 'text-gray-600'    },
    ai_active: { bg: 'bg-emerald-50',  fg: 'text-emerald-700' },
    paused:    { bg: 'bg-amber-50',    fg: 'text-amber-700'   },
    handoff:   { bg: 'bg-rose-50',     fg: 'text-rose-700'    },
    opted_out: { bg: 'bg-gray-100',    fg: 'text-gray-700'    },
    exhausted: { bg: 'bg-orange-50',   fg: 'text-orange-700'  },
  };
  const spec = map[state] ?? { bg: 'bg-gray-100', fg: 'text-gray-700' };
  return (
    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${spec.bg} ${spec.fg}`}>
      {state}
    </span>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────

export function AiConciergeAdminPanel() {
  const [tab, setTab] = useState<TabKey>('runs');
  const [killSwitch, setKillSwitch] = useState<KillSwitch | null>(null);
  const [killSwitchSaving, setKillSwitchSaving] = useState(false);
  const [killSwitchReason, setKillSwitchReason] = useState('');
  const [error, setError] = useState('');
  const [bootError, setBootError] = useState(''); // schema-missing, etc.

  const loadKillSwitch = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/ai-concierge/kill-switch', { cache: 'no-store' });
      const j = await res.json().catch(() => ({})) as KillSwitch & { error?: string; schemaMissing?: boolean };
      if (!res.ok) {
        if (j.schemaMissing) {
          setBootError('AI runtime settings table is missing. Run /api/admin/run-migration-099 then reload.');
          return;
        }
        setError(j.error ?? 'Failed to load kill switch');
        return;
      }
      setKillSwitch(j);
      setKillSwitchReason(j.killSwitchReason ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load kill switch');
    }
  }, []);

  useEffect(() => { void loadKillSwitch(); }, [loadKillSwitch]);

  const toggleKillSwitch = useCallback(async (next: boolean) => {
    if (!killSwitch || killSwitchSaving) return;
    setKillSwitchSaving(true); setError('');
    try {
      const res = await fetch('/api/admin/ai-concierge/kill-switch', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled: next, reason: next ? killSwitchReason || null : null }),
      });
      const j = await res.json().catch(() => ({})) as KillSwitch & { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Failed to update kill switch');
        return;
      }
      setKillSwitch(j);
      setKillSwitchReason(j.killSwitchReason ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update kill switch');
    } finally {
      setKillSwitchSaving(false);
    }
  }, [killSwitch, killSwitchSaving, killSwitchReason]);

  if (bootError) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="font-heading text-base text-amber-950">Schema not initialized</p>
            <p className="mt-1 text-sm text-amber-900/90">{bootError}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={18} style={{ color: BRAND }} />
          <h1 className="font-heading text-2xl text-gray-900">AI Concierge</h1>
        </div>
        <p className="text-sm text-gray-500">
          Live runs monitor, global kill-switch, and per-venue overrides for the AI concierge.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <KillSwitchCard
        killSwitch={killSwitch}
        saving={killSwitchSaving}
        reason={killSwitchReason}
        onChangeReason={setKillSwitchReason}
        onToggle={toggleKillSwitch}
        onRefresh={() => void loadKillSwitch()}
      />

      <PulseSummary />

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {([
          { key: 'runs',           label: 'Live runs',         icon: Activity     },
          { key: 'transitions',    label: 'State transitions', icon: MessageSquare },
          { key: 'venues',         label: 'Venues',            icon: BadgeCheck   },
          { key: 'handoff-rules',  label: 'Handoff rules',     icon: Workflow     },
          { key: 'prompt-config',  label: 'Prompt config',     icon: FileCode2    },
        ] as const).map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'runs'          && <RunsTable />}
      {tab === 'transitions'   && <TransitionsTable />}
      {tab === 'venues'        && <VenuesTable />}
      {tab === 'handoff-rules' && <AiConciergeHandoffRulesEditor />}
      {tab === 'prompt-config' && <AiConciergeConfigEditor />}
    </div>
  );
}

// ── Sub-component: kill switch card ───────────────────────────────────────

function KillSwitchCard({
  killSwitch, saving, reason, onChangeReason, onToggle, onRefresh,
}: {
  killSwitch:    KillSwitch | null;
  saving:        boolean;
  reason:        string;
  onChangeReason:(v: string) => void;
  onToggle:      (next: boolean) => void;
  onRefresh:     () => void;
}) {
  if (!killSwitch) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">Loading kill switch…</span>
        </div>
      </div>
    );
  }

  const on = killSwitch.killSwitchEnabled;

  return (
    <div className={`rounded-2xl border p-5 ${on ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {on
            ? <ShieldOff size={22} className="mt-0.5 shrink-0 text-rose-700" />
            : <Shield    size={22} className="mt-0.5 shrink-0 text-emerald-700" />}
          <div>
            <h2 className="font-heading text-lg text-gray-900">Global kill switch</h2>
            <p className="mt-0.5 text-sm text-gray-600">
              {on
                ? 'AI Concierge crons are halted across all venues. Existing leads keep their state; nothing sends until released.'
                : 'AI Concierge crons run normally. Toggle to halt all activation + sending across every venue.'}
            </p>
            {on && (
              <ul className="mt-2 space-y-0.5 text-xs text-rose-900/80">
                <li>Engaged {fmtRelative(killSwitch.killSwitchSetAt)} by {killSwitch.killSwitchSetBy ?? '—'}.</li>
                {killSwitch.killSwitchReason && <li>Reason: <em>{killSwitch.killSwitchReason}</em></li>}
                <li>Crons read with a 30-second cache — releasing the switch can take up to ~30s to propagate.</li>
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => onToggle(!on)}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              on ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-rose-700 hover:bg-rose-800'
            }`}
          >
            {saving
              ? <Loader2 size={14} className="animate-spin" />
              : on ? <Play size={14} /> : <Power size={14} />}
            {on ? 'Release kill switch' : 'Engage kill switch'}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <RotateCw size={12} />
          </button>
        </div>
      </div>

      {!on && (
        <div className="mt-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Reason (optional, recorded with the switch)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => onChangeReason(e.target.value)}
            placeholder="e.g. DeepSeek outage / spend cap reached / runaway"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

// ── Sub-component: pulse summary ──────────────────────────────────────────

function PulseSummary() {
  const [data, setData] = useState<RunsPayload['summary'] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/admin/ai-concierge/runs?limit=1', { cache: 'no-store' });
        const j   = await res.json() as RunsPayload;
        if (alive && res.ok) setData(j.summary);
      } catch { /* swallow — summary is best-effort */ }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <PulseCard label="Sent (24h)"      value={data?.sentLast24h     ?? '—'} icon={<MessageSquare size={14} className="text-emerald-600" />} tone="emerald" />
      <PulseCard label="Failed (24h)"    value={data?.failedLast24h   ?? '—'} icon={<XCircle       size={14} className="text-rose-600"    />} tone="rose"    />
      <PulseCard label="Opted out (24h)" value={data?.optedOutLast24h ?? '—'} icon={<ShieldOff     size={14} className="text-gray-600"   />} tone="gray"    />
    </div>
  );
}
function PulseCard({ label, value, icon, tone }: { label: string; value: number | string; icon: React.ReactNode; tone: 'emerald' | 'rose' | 'gray' }) {
  const toneRing = tone === 'emerald' ? 'border-emerald-100' : tone === 'rose' ? 'border-rose-100' : 'border-gray-100';
  return (
    <div className={`rounded-2xl border ${toneRing} bg-white p-4`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {icon}{label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// ── Sub-component: live runs table ────────────────────────────────────────

function RunsTable() {
  const [rows, setRows]         = useState<RunRow[]>([]);
  const [cursor, setCursor]     = useState<string | null>(null);
  const [hasMore, setHasMore]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [outcome, setOutcome]   = useState<string>('');
  const [venueFilter, setVenueFilter] = useState('');
  const [error, setError]       = useState('');

  const load = useCallback(async (mode: 'reset' | 'page') => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '50');
      if (outcome)              qs.set('outcome', outcome);
      if (venueFilter.trim())   qs.set('venueId', venueFilter.trim());
      if (mode === 'page' && cursor) qs.set('cursor', cursor);
      const res = await fetch(`/api/admin/ai-concierge/runs?${qs.toString()}`, { cache: 'no-store' });
      const j   = await res.json().catch(() => ({})) as RunsPayload & { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Failed to load runs');
        return;
      }
      setRows(mode === 'reset' ? j.rows : [...rows, ...j.rows]);
      setCursor(j.nextCursor);
      setHasMore(!!j.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }, [outcome, venueFilter, cursor, rows]);

  // Reset whenever filters change
  useEffect(() => { void load('reset'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [outcome, venueFilter]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <Filter size={12} /> Filters:
        </span>
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="">All outcomes</option>
          <option value="sent">Sent</option>
          <option value="invalid_phone">Invalid phone</option>
          <option value="dnd">DND</option>
          <option value="permanent_error">Permanent error</option>
          <option value="transient_error">Transient error</option>
          <option value="auth_error">Auth error</option>
          <option value="expired">Expired</option>
          <option value="llm_error">LLM error</option>
          <option value="manual_re_enable">Manual re-enable</option>
          <option value="reschedule_quiet_hours">Rescheduled (quiet hours)</option>
        </select>
        <input
          value={venueFilter}
          onChange={(e) => setVenueFilter(e.target.value)}
          placeholder="Venue ID"
          className="w-40 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
        />
        <button
          type="button"
          onClick={() => { setRows([]); setCursor(null); void load('reset'); }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Venue</th>
              <th className="px-4 py-2.5">Lead</th>
              <th className="px-4 py-2.5">Attempt</th>
              <th className="px-4 py-2.5">Angle</th>
              <th className="px-4 py-2.5">Outcome</th>
              <th className="px-4 py-2.5">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No runs match the current filters.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50/60">
                <td className="px-4 py-2.5 align-top text-xs text-gray-600 whitespace-nowrap">
                  <div>{fmtRelative(r.created_at)}</div>
                  <div className="text-[10px] text-gray-400">{fmtDateTime(r.created_at)}</div>
                </td>
                <td className="px-4 py-2.5 align-top text-gray-900">{r.venue_name ?? r.venue_id.slice(0, 8)}</td>
                <td className="px-4 py-2.5 align-top">
                  <div className="text-gray-900">{leadDisplay(r)}</div>
                  {r.lead_email && <div className="text-[11px] text-gray-400">{r.lead_email}</div>}
                </td>
                <td className="px-4 py-2.5 align-top text-xs text-gray-700">{r.attempt_number ?? '—'}</td>
                <td className="px-4 py-2.5 align-top text-xs text-gray-700">{r.angle_used ?? '—'}</td>
                <td className="px-4 py-2.5 align-top"><OutcomePill outcome={r.outcome} /></td>
                <td className="px-4 py-2.5 align-top text-xs text-gray-600 max-w-md">
                  {r.error_detail
                    ? <span className="text-rose-600">{r.error_detail}</span>
                    : (r.final_sent_text
                        ? <span className="line-clamp-2 italic text-gray-700">{r.final_sent_text}</span>
                        : <span className="text-gray-400">—</span>)}
                </td>
              </tr>
            ))}
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center"><Loader2 size={16} className="inline animate-spin text-gray-400" /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void load('page')}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: state transitions table ────────────────────────────────

function TransitionsTable() {
  const [rows, setRows]       = useState<TransitionRow[]>([]);
  const [cursor, setCursor]   = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reason, setReason]   = useState('');
  const [error, setError]     = useState('');

  const load = useCallback(async (mode: 'reset' | 'page') => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '50');
      if (reason) qs.set('reason', reason);
      if (mode === 'page' && cursor) qs.set('cursor', cursor);
      const res = await fetch(`/api/admin/ai-concierge/transitions?${qs.toString()}`, { cache: 'no-store' });
      const j   = await res.json().catch(() => ({})) as { rows: TransitionRow[]; nextCursor: string | null; error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Failed to load transitions');
        return;
      }
      setRows(mode === 'reset' ? j.rows : [...rows, ...j.rows]);
      setCursor(j.nextCursor);
      setHasMore(!!j.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transitions');
    } finally {
      setLoading(false);
    }
  }, [reason, cursor, rows]);

  useEffect(() => { void load('reset'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [reason]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <Filter size={12} /> Reason:
        </span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="">All</option>
          <option value="first_activation">First activation</option>
          <option value="manually_re_enabled">Manually re-enabled</option>
          <option value="manually_paused">Manually paused</option>
          <option value="inbound_reply">Inbound reply</option>
          <option value="inbound_negative_intent">Negative intent</option>
          <option value="inbound_handoff_keyword">Handoff (keyword)</option>
          <option value="inbound_pricing_keyword">Pricing (keyword)</option>
          <option value="inbound_tcpa_opt_out">TCPA opt-out</option>
          <option value="expired_60_days">60-day expired</option>
          <option value="venue_disabled_ai">Venue disabled AI</option>
          <option value="admin_force_reset">Admin force reset</option>
        </select>
        <button
          type="button"
          onClick={() => { setRows([]); setCursor(null); void load('reset'); }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Venue</th>
              <th className="px-4 py-2.5">Lead</th>
              <th className="px-4 py-2.5">From → To</th>
              <th className="px-4 py-2.5">Reason</th>
              <th className="px-4 py-2.5">Triggered by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">No transitions match the current filters.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50/60">
                <td className="px-4 py-2.5 align-top text-xs text-gray-600 whitespace-nowrap">
                  <div>{fmtRelative(r.created_at)}</div>
                  <div className="text-[10px] text-gray-400">{fmtDateTime(r.created_at)}</div>
                </td>
                <td className="px-4 py-2.5 align-top text-gray-900">{r.venue_name ?? r.venue_id.slice(0, 8)}</td>
                <td className="px-4 py-2.5 align-top">
                  <div className="text-gray-900">{leadDisplay(r)}</div>
                  {r.lead_email && <div className="text-[11px] text-gray-400">{r.lead_email}</div>}
                </td>
                <td className="px-4 py-2.5 align-top">
                  <div className="flex items-center gap-1.5 text-xs">
                    <StatePill state={r.from_state} />
                    <span className="text-gray-400">→</span>
                    <StatePill state={r.to_state} />
                  </div>
                </td>
                <td className="px-4 py-2.5 align-top text-xs text-gray-700">{r.reason ?? '—'}</td>
                <td className="px-4 py-2.5 align-top text-xs text-gray-500">{r.triggered_by ?? '—'}</td>
              </tr>
            ))}
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center"><Loader2 size={16} className="inline animate-spin text-gray-400" /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void load('page')}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-component: venues table ───────────────────────────────────────────

function VenuesTable() {
  const [data, setData]       = useState<VenuesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [error, setError]     = useState('');
  const [busyVenue, setBusyVenue] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      const res = await fetch(`/api/admin/ai-concierge/venues${qs.toString() ? `?${qs.toString()}` : ''}`, { cache: 'no-store' });
      const j   = await res.json().catch(() => ({})) as VenuesPayload & { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Failed to load venues');
        return;
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load venues');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  const patchVenue = useCallback(async (venueId: string, patch: Record<string, unknown>) => {
    setBusyVenue(venueId); setError('');
    try {
      const res = await fetch(`/api/admin/ai-concierge/venues/${venueId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; venue?: VenueRow; missing?: string[]; ok?: boolean; paused?: number };
      if (!res.ok) {
        const reason = (j.missing && j.missing.length > 0) ? `${j.error} (${j.missing.join(', ')})` : (j.error ?? 'Update failed');
        setError(reason);
        return;
      }
      // Optimistically merge or reload
      if (j.venue && data) {
        setData({
          ...data,
          venues: data.venues.map((v) => v.id === venueId ? { ...v, ...j.venue! } : v),
        });
      } else {
        await load();
      }
      if (j.paused !== undefined) {
        // Refresh to update lead counts after a pause-all action
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyVenue('');
    }
  }, [data, load]);

  const totals = data?.totals;

  const filtered = useMemo(() => data?.venues ?? [], [data]);

  return (
    <div>
      {/* Totals row */}
      {totals && (
        <div className="grid gap-3 sm:grid-cols-5 mb-4">
          <SmallStat label="Total venues"      value={totals.totalVenues} />
          <SmallStat label="Concierge addon"   value={totals.addonHolders} />
          <SmallStat label="A2P verified"      value={totals.a2pVerified} />
          <SmallStat label="AI enabled"        value={totals.aiEnabled} highlight />
          <SmallStat label="Eligible, not on"  value={totals.eligibleNotEnabled} />
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by venue name or email"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-4 py-2.5">Venue</th>
              <th className="px-4 py-2.5">Addon</th>
              <th className="px-4 py-2.5">A2P</th>
              <th className="px-4 py-2.5">GHL</th>
              <th className="px-4 py-2.5">AI on?</th>
              <th className="px-4 py-2.5">Active leads</th>
              <th className="px-4 py-2.5">Other states</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">No venues match.</td></tr>
            )}
            {filtered.map((v) => {
              const busy = busyVenue === v.id;
              return (
                <tr key={v.id} className="hover:bg-gray-50/60 align-top">
                  <td className="px-4 py-3">
                    <div className="text-gray-900 font-medium">{v.name ?? '—'}</div>
                    <div className="text-[11px] text-gray-400">{v.email ?? '—'}</div>
                    <div className="mt-0.5 text-[10px] text-gray-300">{v.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    {v.directory_addon_concierge
                      ? <CheckCircle2 size={14} className="text-emerald-600" />
                      : <XCircle      size={14} className="text-gray-300"   />}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void patchVenue(v.id, { a2p_verified: !v.a2p_verified })}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                        v.a2p_verified
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {v.a2p_verified ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                      {v.a2p_verified ? 'verified' : 'not verified'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {v.ghlConnected
                      ? <CheckCircle2 size={14} className="text-emerald-600" />
                      : <XCircle      size={14} className="text-gray-300"   />}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busy || (!v.isEligible && !v.ai_concierge_enabled)}
                      onClick={() => void patchVenue(v.id, { ai_concierge_enabled: !v.ai_concierge_enabled })}
                      title={!v.isEligible && !v.ai_concierge_enabled ? 'Venue is not eligible (addon + A2P + GHL required)' : ''}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                        v.ai_concierge_enabled
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : v.isEligible
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            : 'bg-gray-50 text-gray-400'
                      }`}
                    >
                      {v.ai_concierge_enabled ? <Sparkles size={11} /> : <Pause size={11} />}
                      {v.ai_concierge_enabled ? 'on' : 'off'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-emerald-700">{v.leadCounts.ai_active}</span>
                    <span className="text-[10px] text-gray-400"> / {v.leadCounts.total}</span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-gray-600">
                    <div className="flex flex-wrap gap-1.5">
                      {v.leadCounts.paused    > 0 && <Mini label="paused"    value={v.leadCounts.paused}    tone="amber" />}
                      {v.leadCounts.handoff   > 0 && <Mini label="handoff"   value={v.leadCounts.handoff}   tone="rose" />}
                      {v.leadCounts.opted_out > 0 && <Mini label="opt-out"   value={v.leadCounts.opted_out} tone="gray" />}
                      {v.leadCounts.exhausted > 0 && <Mini label="exhausted" value={v.leadCounts.exhausted} tone="orange" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busy || v.leadCounts.ai_active === 0}
                      onClick={() => {
                        if (!confirm(`Pause ALL ${v.leadCounts.ai_active} active AI leads at "${v.name}"?`)) return;
                        void patchVenue(v.id, { action: 'pause_all_leads' });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-30"
                    >
                      <Pause size={11} />
                      Pause all
                    </button>
                    {v.id && (
                      <a
                        href={`/admin/venues?vid=${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center"><Loader2 size={16} className="inline animate-spin text-gray-400" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SmallStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-white p-3 ${highlight ? 'border-emerald-200' : 'border-gray-200'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${highlight ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'rose' | 'gray' | 'orange' }) {
  const map = {
    amber:  'bg-amber-50 text-amber-700',
    rose:   'bg-rose-50 text-rose-700',
    gray:   'bg-gray-100 text-gray-700',
    orange: 'bg-orange-50 text-orange-700',
  } as const;
  return <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] ${map[tone]}`}>{label}: {value}</span>;
}

export default AiConciergeAdminPanel;
