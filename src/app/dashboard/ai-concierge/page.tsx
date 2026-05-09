'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bot, RefreshCw, Search, Pause, Play, ExternalLink,
  MessageSquare, AlertTriangle, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

interface MonitorLead {
  lead_id:               string;
  first_name:            string | null;
  last_name:             string | null;
  email:                 string | null;
  phone:                 string | null;
  ai_state:              string;
  ai_attempt_count:      number;
  ai_next_send_at:       string | null;
  ai_expires_at:         string | null;
  ai_first_activated_at: string | null;
  last_inbound_at:       string | null;
  last_sent_at:          string | null;
  last_sent_text:        string | null;
  last_reply_at:         string | null;
  last_reply_body:       string | null;
  last_run_outcome:      string | null;
  last_run_at:           string | null;
  last_run_error:        string | null;
}

interface Summary {
  ai_active:    number;
  paused:       number;
  handoff:      number;
  exhausted:    number;
  opted_out:    number;
  expiringIn7d: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function futureRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const m = Math.floor(diff / 60_000);
  if (m < 60)  return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

const STATE_STYLES: Record<string, { label: string; cls: string }> = {
  ai_active: { label: 'Active',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  paused:    { label: 'Paused',    cls: 'bg-amber-50  text-amber-700  border-amber-200'  },
  handoff:   { label: 'Handoff',   cls: 'bg-blue-50   text-blue-700   border-blue-200'   },
  exhausted: { label: 'Exhausted', cls: 'bg-gray-100  text-gray-500   border-gray-200'   },
  opted_out: { label: 'Opted out', cls: 'bg-red-50    text-red-600    border-red-200'    },
};

// ── Lead row ──────────────────────────────────────────────────────────────

function LeadRow({
  lead,
  onToggle,
  toggling,
}: {
  lead:     MonitorLead;
  onToggle: (lead: MonitorLead) => void;
  toggling: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const state = STATE_STYLES[lead.ai_state] ?? { label: lead.ai_state, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  const name  = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown';
  const canToggle = lead.ai_state === 'ai_active' || lead.ai_state === 'paused';

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50/60 transition-colors">
        {/* Name + email */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
          {lead.email && <p className="text-xs text-gray-400 truncate">{lead.email}</p>}
        </div>

        {/* State badge */}
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${state.cls}`}>
          {state.label}
        </span>

        {/* Attempt count */}
        <span className="shrink-0 text-xs text-gray-400 hidden sm:block">
          {lead.ai_attempt_count} sent
        </span>

        {/* Next send */}
        {lead.ai_state === 'ai_active' && (
          <span className="shrink-0 text-xs text-gray-500 hidden md:block">
            <Clock size={11} className="inline mr-0.5" />
            {futureRelative(lead.ai_next_send_at)}
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {canToggle && (
            <button
              onClick={() => onToggle(lead)}
              disabled={toggling}
              title={lead.ai_state === 'ai_active' ? 'Pause AI' : 'Resume AI'}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors disabled:opacity-50 ${
                lead.ai_state === 'ai_active'
                  ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {toggling
                ? <Loader2 size={11} className="animate-spin" />
                : lead.ai_state === 'ai_active'
                  ? <><Pause size={11} /> Pause</>
                  : <><Play size={11} /> Resume</>
              }
            </button>
          )}

          <Link
            href={`/dashboard/leads?search=${encodeURIComponent(lead.email ?? lead.first_name ?? '')}`}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            title="View contact"
          >
            <ExternalLink size={11} />
          </Link>

          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 space-y-3 text-xs text-gray-600">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <p className="font-medium text-gray-400 mb-0.5">Started</p>
              <p>{relativeTime(lead.ai_first_activated_at)}</p>
            </div>
            <div>
              <p className="font-medium text-gray-400 mb-0.5">Last reply from lead</p>
              <p>{relativeTime(lead.last_reply_at)}</p>
            </div>
            <div>
              <p className="font-medium text-gray-400 mb-0.5">Next send</p>
              <p>{lead.ai_state === 'ai_active' ? futureRelative(lead.ai_next_send_at) : '—'}</p>
            </div>
            <div>
              <p className="font-medium text-gray-400 mb-0.5">Last run</p>
              <p className={`font-medium ${
                lead.last_run_outcome === 'sent'    ? 'text-emerald-600' :
                lead.last_run_outcome === 'skipped' ? 'text-gray-500' :
                lead.last_run_outcome === 'error'   ? 'text-red-500' : ''
              }`}>
                {lead.last_run_outcome ?? '—'} {lead.last_run_at ? `· ${relativeTime(lead.last_run_at)}` : ''}
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-400 mb-0.5">Attempts</p>
              <p>{lead.ai_attempt_count}</p>
            </div>
          </div>

          {lead.last_run_error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <AlertTriangle size={12} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-red-700 text-xs">{lead.last_run_error}</p>
            </div>
          )}

          {lead.last_sent_text && (
            <div>
              <p className="font-medium text-gray-400 mb-1">Last AI message sent</p>
              <p className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 leading-relaxed">
                {lead.last_sent_text}
              </p>
            </div>
          )}

          {lead.last_reply_body && (
            <div>
              <p className="font-medium text-gray-400 mb-1">Last reply from lead</p>
              <p className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 leading-relaxed">
                {lead.last_reply_body}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function VenueAiConciergePage() {
  const [leads, setLeads]     = useState<MonitorLead[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [updatedAt, setUpdatedAt]     = useState<Date | null>(null);
  const [toggling, setToggling]       = useState<string | null>(null);
  const [error, setError]     = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search)      params.set('search', search);
      if (stateFilter) params.set('state',  stateFilter);
      const res  = await fetch(`/api/listing/ai-concierge?${params}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setLeads(data.leads ?? []);
      setSummary(data.summary ?? null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [search, stateFilter]);

  useEffect(() => { void load(); }, [load]);

  async function toggleState(lead: MonitorLead) {
    setToggling(lead.lead_id);
    const action = lead.ai_state === 'ai_active' ? 'pause' : 'resume';
    try {
      const res = await fetch(`/api/listing/ai-concierge/leads/${lead.lead_id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Failed to update');
        return;
      }
      // Optimistic update
      setLeads(prev => prev.map(l =>
        l.lead_id === lead.lead_id
          ? { ...l, ai_state: action === 'pause' ? 'paused' : 'ai_active' }
          : l
      ));
    } finally {
      setToggling(null);
    }
  }

  const statCards = summary ? [
    { label: 'Active',    value: summary.ai_active, color: 'text-emerald-600' },
    { label: 'Paused',    value: summary.paused,    color: 'text-amber-600'   },
    { label: 'Handoff',   value: summary.handoff,   color: 'text-blue-600'    },
    { label: 'Exhausted', value: summary.exhausted, color: 'text-gray-500'    },
    { label: 'Opted out', value: summary.opted_out, color: 'text-red-500'     },
  ] : [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900">
            <Bot size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">AI Concierge</h1>
            <p className="text-xs text-gray-500">Live monitor for your active leads</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-xs text-gray-400">
              Updated {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => void load(true)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {summary && (
        <div className="grid grid-cols-5 gap-3">
          {statCards.map(s => (
            <button
              key={s.label}
              onClick={() => setStateFilter(prev =>
                prev === s.label.toLowerCase().replace(' ', '_')
                  ? ''
                  : s.label.toLowerCase().replace(' ', '_')
              )}
              className={`rounded-xl border px-3 py-2.5 text-center transition-colors ${
                stateFilter === s.label.toLowerCase().replace(' ', '_')
                  ? 'border-gray-400 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className={`text-xl font-bold ${stateFilter === s.label.toLowerCase().replace(' ', '_') ? 'text-white' : s.color}`}>
                {s.value}
              </p>
              <p className={`text-[11px] mt-0.5 ${stateFilter === s.label.toLowerCase().replace(' ', '_') ? 'text-white/70' : 'text-gray-500'}`}>
                {s.label}
              </p>
            </button>
          ))}
        </div>
      )}

      {summary && summary.expiringIn7d > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={14} className="shrink-0" />
          {summary.expiringIn7d} lead{summary.expiringIn7d > 1 ? 's' : ''} will exhaust AI follow-up within 7 days.
        </div>
      )}

      {/* Search + filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-gray-400"
          />
        </div>
        {stateFilter && (
          <button
            onClick={() => setStateFilter('')}
            className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Lead list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 mb-3">
            <MessageSquare size={20} className="text-gray-400" />
          </div>
          <p className="text-sm font-semibold text-gray-700">No active AI conversations</p>
          <p className="text-xs text-gray-400 mt-1">
            {stateFilter || search
              ? 'No leads match your filter.'
              : 'When AI Concierge activates on a lead, it will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">{leads.length} lead{leads.length !== 1 ? 's' : ''}</p>
          {leads.map(lead => (
            <LeadRow
              key={lead.lead_id}
              lead={lead}
              onToggle={toggleState}
              toggling={toggling === lead.lead_id}
            />
          ))}
        </div>
      )}

      {/* Info footer */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 space-y-1">
        <div className="flex items-center gap-1.5 font-medium text-gray-700">
          <CheckCircle2 size={12} className="text-emerald-500" />
          How this works
        </div>
        <p>AI Concierge automatically follows up with leads via SMS when activated through your Booking System sequence. It never replies on its own — it only sends scheduled outreach. When a lead replies, a notification is sent to your team to respond personally.</p>
        <p>You can <strong>pause</strong> AI on any lead to stop outreach temporarily, and <strong>resume</strong> to continue. The concierge team can also manage this from their admin panel.</p>
      </div>
    </div>
  );
}
