'use client';

/**
 * AiConciergeMonitorTab — live view of every AI Concierge conversation.
 *
 * Each lead card shows state, attempt count, next send, last AI message,
 * and last bride reply. Expanding a card reveals full-context details plus
 * action buttons:
 *   - Force Send Now   → immediately runs the send pipeline (bypass timing/quiet hours)
 *   - Preview Message  → generate a draft SMS via DeepSeek without sending
 *   - Pause / Resume   → toggle ai_state between ai_active ↔ paused
 *   - Mark Handoff     → flag for human follow-up
 *   - Snooze +1/+2/+3d → push next scheduled send forward
 *   - Tags             → add/remove marketing tags (AI on/off, custom labels)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Search, ChevronDown, ChevronUp,
  MessageSquare, Clock, CalendarClock, Sparkles,
  AlertTriangle, XCircle, Pause, Play, PhoneOff,
  CheckCircle2, Radio, Eye, Zap, Tag, X as XIcon,
  RotateCcw, Hand, Moon, ExternalLink,
} from 'lucide-react';
import type { MonitorLead, MonitorPayload } from '@/app/api/admin/ai-concierge/monitor/route';

// ── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs  = Math.abs(diff);
  const future = diff < 0;
  const mins  = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days  = Math.round(abs / 86400000);
  const label =
    mins < 1    ? 'just now' :
    mins < 60   ? `${mins}m`  :
    hours < 24  ? `${hours}h` :
    days < 7    ? `${days}d`  :
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return future ? `in ${label}` : `${label} ago`;
}

function absTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function formatAngle(a: string): string {
  return a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── config ────────────────────────────────────────────────────────────────────

type StateKey = 'ai_active' | 'paused' | 'handoff' | 'exhausted' | 'opted_out';

const STATE_CFG: Record<StateKey, { label: string; color: string; bg: string; icon: React.FC<{ size?: number; className?: string }> }> = {
  ai_active:  { label: 'Active',    color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: Sparkles      },
  paused:     { label: 'Paused',    color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     icon: Pause         },
  handoff:    { label: 'Handoff',   color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   icon: AlertTriangle },
  exhausted:  { label: 'Exhausted', color: 'text-gray-500',    bg: 'bg-gray-50 border-gray-200',       icon: XCircle       },
  opted_out:  { label: 'Opted out', color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         icon: PhoneOff      },
};

const OUTCOME_CFG: Record<string, { dot: string; label: string }> = {
  sent:               { dot: 'bg-emerald-500', label: 'Sent'         },
  transient_error:    { dot: 'bg-amber-500',   label: 'Retrying'     },
  auth_error:         { dot: 'bg-red-500',     label: 'Auth error'   },
  permanent_error:    { dot: 'bg-red-500',     label: 'Failed'       },
  llm_error:          { dot: 'bg-orange-500',  label: 'LLM error'    },
  invalid_phone:      { dot: 'bg-red-500',     label: 'Bad phone'    },
  dnd:                { dot: 'bg-gray-400',    label: 'DND'          },
  expired:            { dot: 'bg-gray-400',    label: 'Expired'      },
  reschedule_quiet_hours: { dot: 'bg-blue-400', label: 'Quiet hours' },
  manual_re_enable:   { dot: 'bg-purple-400',  label: 'Re-enabled'   },
};

// ── tag type ──────────────────────────────────────────────────────────────────

interface TagRow {
  id:         string;
  name:       string;
  icon:       string | null;
  color:      string | null;
  is_system:  boolean | null;
  system_key: string | null;
  category:   string | null;
}

// ── main component ────────────────────────────────────────────────────────────

export default function AiConciergeMonitorTab() {
  const [data, setData]       = useState<MonitorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/ai-concierge/monitor', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as MonitorPayload;
      setData(d);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => void load(true), 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  // When an action mutates state, refresh the list after a brief delay
  const scheduleRefresh = useCallback(() => {
    setTimeout(() => void load(true), 1500);
  }, [load]);

  const filtered = (data?.leads ?? []).filter(l => {
    if (stateFilter !== 'all' && stateFilter !== 'expiring' && l.ai_state !== stateFilter) return false;
    if (stateFilter === 'expiring') {
      const d = daysLeft(l.ai_expires_at);
      if (l.ai_state !== 'ai_active' || d === null || d > 7) return false;
    }
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (l.first_name  ?? '').toLowerCase().includes(s) ||
      (l.last_name   ?? '').toLowerCase().includes(s) ||
      (l.email       ?? '').toLowerCase().includes(s) ||
      (l.venue_name  ?? '').toLowerCase().includes(s)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <RefreshCw size={20} className="animate-spin mr-2" />
        <span className="text-sm">Loading active leads…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        <AlertTriangle size={15} />
        <span>{error}</span>
        <button onClick={() => void load()} className="ml-auto text-xs underline">Retry</button>
      </div>
    );
  }

  const s = data?.summary;

  return (
    <div className="space-y-4">

      {/* Summary strip */}
      {s && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {([
            { key: 'ai_active',  label: 'Active',     val: s.ai_active,   color: 'text-emerald-600' },
            { key: 'paused',     label: 'Paused',     val: s.paused,      color: 'text-amber-600'   },
            { key: 'handoff',    label: 'Handoff',    val: s.handoff,     color: 'text-orange-600'  },
            { key: 'exhausted',  label: 'Exhausted',  val: s.exhausted,   color: 'text-gray-500'    },
            { key: 'opted_out',  label: 'Opted out',  val: s.opted_out,   color: 'text-red-600'     },
            { key: 'expiring',   label: '≤7d expiry', val: s.expiringIn7d,color: 'text-rose-600'    },
          ] as const).map(({ key, label, val, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStateFilter(prev => prev === key ? 'all' : key)}
              className={`rounded-xl border p-3 text-left transition-all ${
                stateFilter === key
                  ? 'border-gray-900 bg-gray-900 text-white shadow'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`text-2xl font-bold tabular-nums ${stateFilter === key ? 'text-white' : color}`}>
                {val}
              </div>
              <div className={`text-xs mt-0.5 ${stateFilter === key ? 'text-gray-300' : 'text-gray-500'}`}>
                {label}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, or venue…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
          {lastRefreshed && (
            <>
              <Radio size={10} className="text-emerald-500 animate-pulse" />
              <span>Updated {lastRefreshed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
            </>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 shrink-0"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <p className="text-xs text-gray-500">
        {filtered.length} of {data?.leads.length ?? 0} leads
        {stateFilter !== 'all' && ` — ${STATE_CFG[stateFilter as StateKey]?.label ?? stateFilter}`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 py-16 text-center">
          <Sparkles size={28} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No active AI conversations</p>
          <p className="mt-1 text-xs text-gray-400">
            {search ? 'Try a different search' : "AI Concierge isn't running on any leads right now"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(lead => (
            <LeadCard
              key={lead.lead_id}
              lead={lead}
              expanded={expandedId === lead.lead_id}
              onToggle={() => setExpandedId(prev => prev === lead.lead_id ? null : lead.lead_id)}
              onMutated={scheduleRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── LeadCard ──────────────────────────────────────────────────────────────────

function LeadCard({ lead, expanded, onToggle, onMutated }: {
  lead: MonitorLead;
  expanded: boolean;
  onToggle: () => void;
  onMutated: () => void;
}) {
  const st   = STATE_CFG[lead.ai_state as StateKey] ?? { label: lead.ai_state, color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200', icon: CheckCircle2 };
  const Icon = st.icon;
  const out  = lead.last_run_outcome ? (OUTCOME_CFG[lead.last_run_outcome] ?? { dot: 'bg-gray-400', label: lead.last_run_outcome }) : null;
  const days = daysLeft(lead.ai_expires_at);
  const expiryWarning = days !== null && days <= 7 && lead.ai_state === 'ai_active';
  const brideName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown';

  return (
    <div className={`rounded-2xl border bg-white transition-shadow ${expanded ? 'shadow-md' : 'shadow-sm hover:shadow'}`}>
      {/* Collapsed row */}
      <button type="button" onClick={onToggle} className="w-full text-left px-5 py-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${st.bg} ${st.color}`}>
            <Icon size={10} />
            {st.label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">{brideName}</span>
              {lead.venue_name && (
                <span className="text-xs text-gray-400 truncate">@ {lead.venue_name}{lead.persona_name ? ` · ${lead.persona_name}` : ''}</span>
              )}
            </div>
            {lead.last_sent_text && (
              <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">
                <span className="font-medium text-gray-700">AI:</span> {lead.last_sent_text}
              </p>
            )}
            {lead.last_reply_body && (
              <p className="mt-0.5 text-xs text-emerald-700 line-clamp-1">
                <span className="font-medium">Replied:</span> {lead.last_reply_body}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right space-y-1 hidden sm:block">
            <div className="text-xs text-gray-500 flex items-center justify-end gap-1">
              <MessageSquare size={11} />
              {lead.ai_attempt_count} sent
            </div>
            {lead.ai_state === 'ai_active' && lead.ai_next_send_at && (
              <div className="text-xs text-blue-600 flex items-center justify-end gap-1">
                <CalendarClock size={11} />
                {relTime(lead.ai_next_send_at)}
              </div>
            )}
            {expiryWarning && (
              <div className="text-xs text-rose-600 font-medium flex items-center justify-end gap-1">
                <Clock size={11} />
                {days}d left
              </div>
            )}
            {out && (
              <div className="flex items-center justify-end gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${out.dot}`} />
                <span className="text-xs text-gray-400">{out.label}</span>
              </div>
            )}
          </div>
          <span className="ml-1 shrink-0 text-gray-400 mt-0.5">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-5">

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 text-xs">
            <Stat label="Attempts" value={String(lead.ai_attempt_count)} />
            <Stat label="Next send" value={lead.ai_state === 'ai_active' ? absTime(lead.ai_next_send_at) : '—'} />
            <Stat label="Activated" value={relTime(lead.ai_first_activated_at)} />
            <Stat
              label="Expires"
              value={days !== null ? (days > 0 ? `${days}d left` : 'expired') : '—'}
              valueClass={expiryWarning ? 'text-rose-600 font-semibold' : undefined}
            />
            <Stat label="Last sent" value={relTime(lead.last_sent_at)} />
            <Stat label="Last reply" value={lead.last_reply_at ? relTime(lead.last_reply_at) : 'No reply yet'} />
            <Stat label="Last outcome" value={out?.label ?? '—'} />
            <Stat label="Email" value={lead.email ?? '—'} />
          </div>

          {/* Messages */}
          {lead.last_sent_text && (
            <MessageBubble label="Last AI message" text={lead.last_sent_text} time={lead.last_sent_at} variant="outbound" />
          )}
          {lead.last_reply_body && (
            <MessageBubble label="Last bride reply" text={lead.last_reply_body} time={lead.last_reply_at} variant="inbound" />
          )}

          {/* Run error */}
          {lead.last_run_error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{lead.last_run_error}</span>
            </div>
          )}

          {/* Angles */}
          {lead.ai_angles_used.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Angles used</p>
              <div className="flex flex-wrap gap-1.5">
                {lead.ai_angles_used.map(a => (
                  <span key={a} className="rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-xs text-purple-700 font-medium">
                    {formatAngle(a)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Action bar ─────────────────────────────────────────────── */}
          <ActionBar lead={lead} onMutated={onMutated} />

          {/* ── Tag manager ────────────────────────────────────────────── */}
          <TagManager leadId={lead.lead_id} venueId={lead.venue_id} />

          {/* Deep-link actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
            <a
              href={`/admin?tab=ai-concierge&runs_lead=${lead.lead_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Eye size={12} />
              Full run history
            </a>
            <a
              href={`/admin?tab=ai-concierge&transitions_lead=${lead.lead_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <MessageSquare size={12} />
              State history
            </a>
            <a
              href={`/admin/venues?vid=${lead.venue_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
            >
              <ExternalLink size={12} />
              Venue page
            </a>
            {lead.thread_id && (
              <a
                href={`/admin?tab=support&thread=${lead.thread_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <MessageSquare size={12} />
                Chat thread
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ActionBar ─────────────────────────────────────────────────────────────────

function ActionBar({ lead, onMutated }: { lead: MonitorLead; onMutated: () => void }) {
  const [forceSending, setForceSending]   = useState(false);
  const [forceResult, setForceResult]     = useState<string | null>(null);
  const [forceError, setForceError]       = useState<string | null>(null);
  const [previewing, setPreviewing]       = useState(false);
  const [previewText, setPreviewText]     = useState<string | null>(null);
  const [previewAngle, setPreviewAngle]   = useState<string | null>(null);
  const [previewError, setPreviewError]   = useState<string | null>(null);
  const [stateLoading, setStateLoading]   = useState(false);
  const [stateMsg, setStateMsg]           = useState<string | null>(null);
  const [snoozeLoading, setSnoozeLoading] = useState(false);
  const [snoozeMsg, setSnoozeMsg]         = useState<string | null>(null);

  const canSend   = lead.ai_state === 'ai_active';
  const canResume = lead.ai_state === 'paused';
  const canPause  = lead.ai_state === 'ai_active';
  const canHandoff = lead.ai_state === 'ai_active' || lead.ai_state === 'paused';
  const canSnooze = lead.ai_state === 'ai_active';

  async function handleForceSend() {
    if (!canSend) return;
    setForceSending(true);
    setForceResult(null);
    setForceError(null);
    try {
      const r = await fetch(`/api/admin/ai-concierge/leads/${lead.lead_id}/force-send`, { method: 'POST' });
      const d = await r.json() as { ok: boolean; message?: string; result?: { sent: number } };
      if (d.ok) {
        setForceResult(d.message ?? 'Sent!');
        onMutated();
      } else {
        setForceError(d.message ?? 'Failed');
      }
    } catch {
      setForceError('Network error');
    } finally {
      setForceSending(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewText(null);
    setPreviewAngle(null);
    setPreviewError(null);
    try {
      const r = await fetch(`/api/admin/ai-concierge/leads/${lead.lead_id}/preview`, { method: 'POST' });
      const d = await r.json() as { ok?: boolean; draftSms?: string; angle?: string; error?: string };
      if (d.ok && d.draftSms) {
        setPreviewText(d.draftSms);
        setPreviewAngle(d.angle ?? null);
      } else {
        setPreviewError(d.error ?? 'Preview failed');
      }
    } catch {
      setPreviewError('Network error');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleStateChange(newState: 'paused' | 'ai_active' | 'handoff') {
    setStateLoading(true);
    setStateMsg(null);
    try {
      const r = await fetch(`/api/admin/ai-concierge/leads/${lead.lead_id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });
      const d = await r.json() as { ok: boolean; fromState?: string; toState?: string };
      if (d.ok) {
        setStateMsg(`State changed to ${newState}`);
        onMutated();
      }
    } catch { /* silent */ }
    finally { setStateLoading(false); }
  }

  async function handleSnooze(days: 1 | 2 | 3) {
    setSnoozeLoading(true);
    setSnoozeMsg(null);
    try {
      const r = await fetch(`/api/admin/ai-concierge/leads/${lead.lead_id}/snooze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      const d = await r.json() as { ok: boolean; message?: string };
      if (d.ok) {
        setSnoozeMsg(d.message ?? `Snoozed +${days}d`);
        onMutated();
      }
    } catch { /* silent */ }
    finally { setSnoozeLoading(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</p>

      <div className="flex flex-wrap gap-2">

        {/* Force send */}
        {canSend && (
          <button
            onClick={() => void handleForceSend()}
            disabled={forceSending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-60 transition-colors"
          >
            {forceSending
              ? <><RefreshCw size={12} className="animate-spin" /> Sending…</>
              : <><Zap size={12} /> Send Now</>}
          </button>
        )}

        {/* Preview */}
        <button
          onClick={() => void handlePreview()}
          disabled={previewing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          {previewing
            ? <><RefreshCw size={12} className="animate-spin" /> Generating…</>
            : <><Eye size={12} /> Preview Draft</>}
        </button>

        {/* Pause / Resume */}
        {canPause && (
          <button
            onClick={() => void handleStateChange('paused')}
            disabled={stateLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60 transition-colors"
          >
            <Pause size={12} /> Pause AI
          </button>
        )}
        {canResume && (
          <button
            onClick={() => void handleStateChange('ai_active')}
            disabled={stateLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-colors"
          >
            <Play size={12} /> Resume AI
          </button>
        )}

        {/* Handoff */}
        {canHandoff && (
          <button
            onClick={() => void handleStateChange('handoff')}
            disabled={stateLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-60 transition-colors"
          >
            <Hand size={12} /> Mark Handoff
          </button>
        )}

        {/* Snooze */}
        {canSnooze && (
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white overflow-hidden">
            <span className="px-2 py-2 text-xs text-gray-500 flex items-center gap-1">
              <Moon size={11} /> Snooze
            </span>
            {([1, 2, 3] as const).map(d => (
              <button
                key={d}
                onClick={() => void handleSnooze(d)}
                disabled={snoozeLoading}
                className="px-2 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 border-l border-gray-200 disabled:opacity-60 transition-colors"
              >
                +{d}d
              </button>
            ))}
          </div>
        )}

        {/* Resume from handoff/exhausted */}
        {(lead.ai_state === 'handoff' || lead.ai_state === 'exhausted') && (
          <button
            onClick={() => void handleStateChange('ai_active')}
            disabled={stateLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-colors"
          >
            <RotateCcw size={12} /> Re-activate AI
          </button>
        )}
      </div>

      {/* Action feedback */}
      {forceResult && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 size={12} className="shrink-0" />
          {forceResult}
        </div>
      )}
      {forceError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertTriangle size={12} className="shrink-0" />
          {forceError}
        </div>
      )}
      {stateMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <CheckCircle2 size={12} className="shrink-0" />
          {stateMsg}
        </div>
      )}
      {snoozeMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Moon size={12} className="shrink-0" />
          {snoozeMsg}
        </div>
      )}

      {/* Message preview */}
      {previewError && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {previewError}
        </div>
      )}
      {previewText && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Draft preview {previewAngle ? `· ${formatAngle(previewAngle)}` : ''}
            </p>
            <button onClick={() => setPreviewText(null)} className="text-gray-400 hover:text-gray-600">
              <XIcon size={12} />
            </button>
          </div>
          <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 leading-relaxed">
            {previewText}
          </div>
          <p className="mt-1 text-xs text-gray-400">This is a live DeepSeek preview — not sent. Hit "Send Now" to actually send.</p>
        </div>
      )}
    </div>
  );
}

// ── TagManager ────────────────────────────────────────────────────────────────

function TagManager({ leadId, venueId }: { leadId: string; venueId: string }) {
  const [assigned, setAssigned]   = useState<TagRow[]>([]);
  const [available, setAvailable] = useState<TagRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [adding, setAdding]       = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [search, setSearch]       = useState('');

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/ai-concierge/leads/${leadId}/tags`);
      const d = await r.json() as { assigned?: TagRow[]; available?: TagRow[] };
      setAssigned(d.assigned ?? []);
      setAvailable(d.available ?? []);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { void loadTags(); }, [loadTags]);

  async function addTag(tagId: string) {
    setAdding(true);
    await fetch(`/api/admin/ai-concierge/leads/${leadId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId }),
    });
    setAdding(false);
    setShowAdd(false);
    setSearch('');
    void loadTags();
  }

  async function removeTag(tagId: string) {
    await fetch(`/api/admin/ai-concierge/leads/${leadId}/tags/${tagId}`, { method: 'DELETE' });
    void loadTags();
  }

  const filteredAvailable = available.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );

  void venueId; // used in the API route via leadId lookup

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
          <Tag size={10} /> Tags
        </p>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
        >
          {showAdd ? 'Cancel' : '+ Add tag'}
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Loading tags…</p>
      ) : (
        <>
          {/* Current tags */}
          <div className="flex flex-wrap gap-1.5 min-h-6">
            {assigned.length === 0 && !showAdd && (
              <p className="text-xs text-gray-400 italic">No tags</p>
            )}
            {assigned.map(t => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                style={{
                  borderColor: t.color ? `${t.color}40` : '#e5e7eb',
                  backgroundColor: t.color ? `${t.color}15` : '#f9fafb',
                  color: t.color ?? '#374151',
                }}
              >
                {t.icon && <span>{t.icon}</span>}
                {t.name}
                <button
                  onClick={() => void removeTag(t.id)}
                  className="ml-0.5 opacity-60 hover:opacity-100"
                  title="Remove tag"
                >
                  <XIcon size={9} />
                </button>
              </span>
            ))}
          </div>

          {/* Add dropdown */}
          {showAdd && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <input
                  type="text"
                  placeholder="Search tags…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full text-xs rounded-md border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  autoFocus
                />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {filteredAvailable.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    {search ? 'No matching tags' : 'All tags already applied'}
                  </p>
                ) : (
                  filteredAvailable.map(t => (
                    <button
                      key={t.id}
                      onClick={() => void addTag(t.id)}
                      disabled={adding}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 text-left disabled:opacity-60"
                    >
                      {t.icon && <span>{t.icon}</span>}
                      <span className="font-medium">{t.name}</span>
                      {t.is_system && <span className="ml-auto text-gray-400 text-[10px]">system</span>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-gray-400 uppercase tracking-wide mb-0.5" style={{ fontSize: 10 }}>{label}</p>
      <p className={`font-medium text-gray-900 text-xs ${valueClass ?? ''}`}>{value}</p>
    </div>
  );
}

function MessageBubble({ label, text, time, variant }: {
  label: string; text: string; time: string | null;
  variant: 'inbound' | 'outbound';
}) {
  const cls = variant === 'inbound'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
    : 'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</p>
      <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${cls}`}>{text}</div>
      {time && <p className="mt-1 text-xs text-gray-400">{absTime(time)}</p>}
    </div>
  );
}
