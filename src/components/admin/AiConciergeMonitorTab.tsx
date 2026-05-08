'use client';

/**
 * AiConciergeMonitorTab — live view of every bride the AI Concierge is
 * currently working.  Shows state, attempt count, next scheduled send,
 * days-until-expiry, last sent message, and last bride reply in one screen
 * so the concierge team is never flying blind.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Search, ChevronDown, ChevronUp,
  MessageSquare, Clock, CalendarClock, Sparkles,
  AlertTriangle, XCircle, Pause, PhoneOff,
  CheckCircle2, Radio, Eye,
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

// ── state config ──────────────────────────────────────────────────────────────

type StateKey = 'ai_active' | 'paused' | 'handoff' | 'exhausted' | 'opted_out';

const STATE_CFG: Record<StateKey, { label: string; color: string; bg: string; icon: React.FC<{ size?: number; className?: string }> }> = {
  ai_active:  { label: 'Active',    color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: Sparkles  },
  paused:     { label: 'Paused',    color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     icon: Pause     },
  handoff:    { label: 'Handoff',   color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   icon: AlertTriangle },
  exhausted:  { label: 'Exhausted', color: 'text-gray-500',    bg: 'bg-gray-50 border-gray-200',       icon: XCircle   },
  opted_out:  { label: 'Opted out', color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         icon: PhoneOff  },
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
  manual_re_enable:   { dot: 'bg-purple-400',  label: 'Re-enabled'  },
};

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
    // Auto-refresh every 60 seconds
    intervalRef.current = setInterval(() => void load(true), 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const filtered = (data?.leads ?? []).filter(l => {
    if (stateFilter !== 'all' && l.ai_state !== stateFilter) return false;
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
            { key: 'ai_active',  label: 'Active',    val: s.ai_active,  color: 'text-emerald-600' },
            { key: 'paused',     label: 'Paused',    val: s.paused,     color: 'text-amber-600'   },
            { key: 'handoff',    label: 'Handoff',   val: s.handoff,    color: 'text-orange-600'  },
            { key: 'exhausted',  label: 'Exhausted', val: s.exhausted,  color: 'text-gray-500'    },
            { key: 'opted_out',  label: 'Opted out', val: s.opted_out,  color: 'text-red-600'     },
            { key: 'expiring',   label: '≤7d expiry',val: s.expiringIn7d, color: 'text-rose-600'  },
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
        <div className="flex items-center gap-1 text-xs text-gray-400">
          {lastRefreshed && (
            <>
              <Radio size={10} className="text-emerald-500 animate-pulse" />
              <span>Updated {lastRefreshed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
            </>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Lead count */}
      <p className="text-xs text-gray-500">
        {filtered.length} of {data?.leads.length ?? 0} leads
        {stateFilter !== 'all' && ` — filtered to "${STATE_CFG[stateFilter as StateKey]?.label ?? stateFilter}"`}
      </p>

      {/* Lead list */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 py-16 text-center">
          <Sparkles size={28} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No active AI conversations</p>
          <p className="mt-1 text-xs text-gray-400">
            {search ? 'Try a different search' : 'AI Concierge isn\'t running on any leads right now'}
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── LeadCard ──────────────────────────────────────────────────────────────────

function LeadCard({ lead, expanded, onToggle }: {
  lead: MonitorLead;
  expanded: boolean;
  onToggle: () => void;
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
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-5 py-4"
      >
        <div className="flex items-start gap-3 min-w-0">

          {/* State pill */}
          <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${st.bg} ${st.color}`}>
            <Icon size={10} />
            {st.label}
          </span>

          {/* Name + venue */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">{brideName}</span>
              {lead.venue_name && (
                <span className="text-xs text-gray-400 truncate">@ {lead.venue_name}{lead.persona_name ? ` · ${lead.persona_name}` : ''}</span>
              )}
            </div>
            {/* Last sent preview */}
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

          {/* Meta column */}
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

          {/* Expand chevron */}
          <span className="ml-1 shrink-0 text-gray-400 mt-0.5">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 text-xs">
            <Stat label="Attempts" value={String(lead.ai_attempt_count)} />
            <Stat label="Next send" value={lead.ai_state === 'ai_active' ? absTime(lead.ai_next_send_at) : '—'} />
            <Stat label="Activated" value={relTime(lead.ai_first_activated_at)} />
            <Stat
              label="Expires"
              value={days !== null ? `${days > 0 ? `${days}d left` : 'expired'}` : '—'}
              valueClass={expiryWarning ? 'text-rose-600 font-semibold' : undefined}
            />
            <Stat label="Last sent" value={relTime(lead.last_sent_at)} />
            <Stat label="Last reply" value={lead.last_reply_at ? relTime(lead.last_reply_at) : 'No reply yet'} />
            <Stat label="Last outcome" value={out?.label ?? '—'} />
            <Stat label="Email" value={lead.email ?? '—'} />
          </div>

          {/* Last sent message */}
          {lead.last_sent_text && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Last AI message</p>
              <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-800 leading-relaxed">
                {lead.last_sent_text}
              </div>
              {lead.last_sent_at && (
                <p className="mt-1 text-xs text-gray-400">{absTime(lead.last_sent_at)}</p>
              )}
            </div>
          )}

          {/* Last bride reply */}
          {lead.last_reply_body && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Last bride reply</p>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900 leading-relaxed">
                {lead.last_reply_body}
              </div>
              {lead.last_reply_at && (
                <p className="mt-1 text-xs text-gray-400">{absTime(lead.last_reply_at)}</p>
              )}
            </div>
          )}

          {/* Run error */}
          {lead.last_run_error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{lead.last_run_error}</span>
            </div>
          )}

          {/* Angles used */}
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

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <a
              href={`/admin?tab=ai-concierge&runs_lead=${lead.lead_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Eye size={12} />
              View runs for this lead
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
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-gray-400 uppercase tracking-wide mb-0.5" style={{ fontSize: 10 }}>{label}</p>
      <p className={`font-medium text-gray-900 ${valueClass ?? ''}`}>{value}</p>
    </div>
  );
}
