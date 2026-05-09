'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles, Loader2, Check, AlertTriangle, ShieldCheck,
  ShieldAlert, MessageSquare, BadgeCheck, ExternalLink,
  TrendingUp, Send, Inbox, UserCheck, UserX, Activity,
  Pause as PauseIcon, AlertOctagon, Gauge, Bot, RefreshCw,
  Search, Pause, Play, Clock, ChevronDown, ChevronUp,
  CheckCircle2, Eye, AlarmClock,
} from 'lucide-react';

// ── Shared types ───────────────────────────────────────────────────────────

interface Eligibility {
  addonPurchased: boolean;
  a2pVerified:    boolean;
  eligible:       boolean;
  blockers:       string[];
}

interface AiConciergeSettings {
  enabled:                boolean;
  personaName:            string;
  conciergeNotifyEmails:  string[];
  eligibility:            Eligibility;
  ownerNotificationEmail: string | null;
  ghlConnected:           boolean;
  enabledAt:              string | null;
  resourcesReady:         boolean;
}

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
  ai_angles_used:        string[];
  last_inbound_at:       string | null;
  last_sent_at:          string | null;
  last_sent_text:        string | null;
  last_reply_at:         string | null;
  last_reply_body:       string | null;
  last_run_outcome:      string | null;
  last_run_at:           string | null;
  last_run_error:        string | null;
  tags:                  Array<{ id: string; name: string; color: string | null }>;
}

interface MonitorSummary {
  ai_active:    number;
  paused:       number;
  handoff:      number;
  exhausted:    number;
  opted_out:    number;
  expiringIn7d: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
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

// ── Main page ──────────────────────────────────────────────────────────────

type Tab = 'overview' | 'leads';

export default function AiConciergeSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // ── Settings state ─────────────────────────────────────────────────────
  const [data, setData]         = useState<AiConciergeSettings | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [toggleSaving, setToggleSaving] = useState(false);

  async function load() {
    setError('');
    try {
      const res = await fetch('/api/dashboard/settings/ai-concierge', { cache: 'no-store' });
      if (!res.ok) { setError('Unable to load AI Concierge settings.'); return; }
      setData(await res.json() as AiConciergeSettings);
    } catch {
      setError('Unable to load AI Concierge settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch('/api/dashboard/settings/ai-concierge', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Save failed');
    return json as AiConciergeSettings;
  }

  async function toggleEnabled(next: boolean) {
    if (!data) return;
    setToggleSaving(true); setError('');
    try { setData(await patch({ enabled: next })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to toggle.'); }
    finally { setToggleSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-500 mb-4">{error || 'Unable to load AI Concierge settings.'}</p>
        <button
          onClick={() => { setLoading(true); void load(); }}
          className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Sparkles size={22} className="text-purple-500" /> AI Concierge
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          A personal AI assistant that follows up with quiet leads via SMS until they reply or 60 days pass.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {([
          { id: 'overview', label: 'Overview', icon: Sparkles },
          { id: 'leads',    label: 'Active Leads', icon: Bot,
            badge: data.eligibility.addonPurchased ? undefined : undefined },
        ] as { id: Tab; label: string; icon: React.ElementType; badge?: number }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === id
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
              <MessageSquare size={18} className="text-gray-400" />
              <h2 className="font-heading text-base font-semibold text-gray-900">How AI Concierge works</h2>
            </div>
            <div className="px-6 py-5 space-y-3 text-sm text-gray-600">
              <Step n={1} title="14-day silence triggers activation"
                body="When a lead doesn't reply to your automated email sequence for 14 days, AI Concierge activates and starts following up via SMS." />
              <Step n={2} title="Random 1–3 day cadence for up to 60 days"
                body="The AI sends short, varied SMS messages on a randomized cadence — never spammy, always casual. Each message picks a fresh angle so it never feels repetitive." />
              <Step n={3} title="Reply = AI stops"
                body="The moment the bride replies, the AI pauses and you (or your team) take over. We tag the contact and notify you immediately by email." />
              <Step n={4} title="Quiet hours respected"
                body="AI never sends outside 9am–8pm in your venue's local timezone. Late replies get queued for the next morning." />
              <Step n={5} title="60-day hard cap"
                body="If a bride still hasn't replied after 60 days of follow-up, the AI moves her to your &quot;Not Interested&quot; pipeline and never messages her again automatically." />
            </div>
          </section>

          <AiConciergeMetricsCard />

          <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
              <ShieldCheck size={18} className="text-gray-400" />
              <h2 className="font-heading text-base font-semibold text-gray-900">Eligibility</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <EligibilityRow label="Venue Concierge add-on" ok={data.eligibility.addonPurchased}
                okLabel="Active on this account"
                failLabel="Not active — upgrade your plan or add the Venue Concierge add-on"
                actionUrl={!data.eligibility.addonPurchased ? '/dashboard/directory-billing' : undefined}
                actionLabel="View plans" />
              <EligibilityRow label="A2P 10DLC compliance" ok={data.eligibility.a2pVerified}
                okLabel="Verified by StoryVenue"
                failLabel="Not yet verified — required by carriers before any AI SMS can be sent"
                info="A2P verification is handled by our team after your venue completes its messaging registration. Reach out to support if this has been pending more than 5 business days." />
              <EligibilityRow label="SMS messaging connected" ok={data.ghlConnected}
                okLabel="Connected — AI will send through your messaging account"
                failLabel="Not connected — AI has nowhere to send SMS through. Connect on the General settings page."
                actionUrl={!data.ghlConnected ? '/dashboard/settings' : undefined}
                actionLabel="Connect now" />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
              <BadgeCheck size={18} className="text-gray-400" />
              <h2 className="font-heading text-base font-semibold text-gray-900">Status</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">AI Concierge is</p>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      data.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {data.enabled ? 'On' : 'Off'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    {data.enabled
                      ? "New leads who go quiet for 14 days will start receiving AI follow-up SMS during 9am–8pm in your venue's timezone."
                      : 'AI follow-up is paused. Existing active leads will not receive any new messages.'}
                  </p>
                  {data.enabledAt && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      First enabled {new Date(data.enabledAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {toggleSaving && <Loader2 size={14} className="animate-spin text-gray-400" />}
                  <Toggle checked={data.enabled} disabled={toggleSaving} onChange={(v) => void toggleEnabled(v)} />
                </div>
              </div>

              {data.enabled && data.resourcesReady && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 flex items-start gap-2">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                  <span>Pipeline stages and tags are ready. New activations will appear under your <strong>Followup</strong> stage with the <strong>AI Active</strong> tag.</span>
                </div>
              )}
              {data.enabled && !data.resourcesReady && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
                  <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
                  <span>Setting up your AI pipeline stages and tags — this finishes within a minute.</span>
                </div>
              )}
            </div>
          </section>

          {error && (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3 flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>
      )}

      {/* Active Leads tab */}
      {activeTab === 'leads' && <ActiveLeadsPanel />}
    </div>
  );
}

// ── Active Leads monitor panel ─────────────────────────────────────────────

function ActiveLeadsPanel() {
  const [leads, setLeads]     = useState<MonitorLead[]>([]);
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [updatedAt, setUpdatedAt]     = useState<Date | null>(null);
  const [error, setError]     = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search)      params.set('search', search);
      if (stateFilter) params.set('state',  stateFilter);
      const res  = await fetch(`/api/listing/ai-concierge?${params}`, { cache: 'no-store' });
      const data = await res.json() as { leads?: MonitorLead[]; summary?: MonitorSummary; error?: string };
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

  const refresh = useCallback(() => void load(true), [load]);

  const statCards = summary ? [
    { key: 'ai_active', label: 'Active',    value: summary.ai_active, color: 'text-emerald-600' },
    { key: 'paused',    label: 'Paused',    value: summary.paused,    color: 'text-amber-600'   },
    { key: 'handoff',   label: 'Handoff',   value: summary.handoff,   color: 'text-blue-600'    },
    { key: 'exhausted', label: 'Exhausted', value: summary.exhausted, color: 'text-gray-500'    },
    { key: 'opted_out', label: 'Opted out', value: summary.opted_out, color: 'text-red-500'     },
  ] : [];

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      {summary && (
        <div className="grid grid-cols-5 gap-3">
          {statCards.map(s => (
            <button
              key={s.key}
              onClick={() => setStateFilter(prev => prev === s.key ? '' : s.key)}
              className={`rounded-xl border px-3 py-2.5 text-center transition-colors ${
                stateFilter === s.key
                  ? 'border-gray-400 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className={`text-xl font-bold ${stateFilter === s.key ? 'text-white' : s.color}`}>{s.value}</p>
              <p className={`text-[11px] mt-0.5 ${stateFilter === s.key ? 'text-white/70' : 'text-gray-500'}`}>{s.label}</p>
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

      {/* Search + refresh */}
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
        <div className="flex items-center gap-2 shrink-0">
          {updatedAt && (
            <span className="text-xs text-gray-400 hidden sm:block">
              Updated {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => void load(true)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
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
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border border-gray-200 bg-white">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 mb-3">
            <Bot size={20} className="text-gray-400" />
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
              onRefresh={refresh}
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
        <p>AI Concierge automatically follows up with leads via SMS when activated through your Booking System sequence. It never replies on its own. When a lead replies, your team gets notified to respond personally.</p>
        <p>Use <strong>Pause</strong> to stop AI outreach for a specific lead, and <strong>Resume</strong> to continue. Your StoryVenue concierge team can also manage this from their side.</p>
      </div>
    </div>
  );
}

// ── Lead row ───────────────────────────────────────────────────────────────

function LeadRow({
  lead,
  onRefresh,
}: {
  lead:      MonitorLead;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded]     = useState(false);
  const [busy, setBusy]             = useState<string | null>(null); // action key
  const [toast, setToast]           = useState('');
  const [preview, setPreview]       = useState<{ text: string; angle: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const state    = STATE_STYLES[lead.ai_state] ?? { label: lead.ai_state, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  const name     = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Unknown';
  const isActive = lead.ai_state === 'ai_active';
  const isPaused = lead.ai_state === 'paused';

  // Days until expiry
  const expiresIn = lead.ai_expires_at
    ? Math.max(0, Math.ceil((new Date(lead.ai_expires_at).getTime() - Date.now()) / 86_400_000))
    : null;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function doAction(action: string, body?: Record<string, unknown>) {
    setBusy(action);
    try {
      let url = `/api/listing/ai-concierge/leads/${lead.lead_id}`;
      let method = 'PATCH';

      if (action === 'send_now') { url += '/force-send'; method = 'POST'; }
      else if (action === 'snooze') { url += '/snooze'; }
      else { url += '/state'; body = { action }; }

      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body ?? {}),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) { showToast(data.error ?? 'Action failed'); return; }
      showToast(data.message ?? 'Done');
      onRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function doPreview() {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res  = await fetch(`/api/listing/ai-concierge/leads/${lead.lead_id}/preview`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; draftSms?: string; angle?: string; error?: string };
      if (!res.ok || !data.ok) { showToast(data.error ?? 'Preview failed'); return; }
      setPreview({ text: data.draftSms ?? '', angle: data.angle ?? '' });
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
          {lead.email && <p className="text-xs text-gray-400 truncate">{lead.email}</p>}
        </div>

        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${state.cls}`}>
          {state.label}
        </span>
        <span className="shrink-0 text-xs text-gray-400 hidden sm:block">{lead.ai_attempt_count} sent</span>
        {isActive && (
          <span className="shrink-0 text-xs text-gray-500 hidden md:block">
            <Clock size={11} className="inline mr-0.5" />{futureRelative(lead.ai_next_send_at)}
          </span>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href={`/dashboard/leads?search=${encodeURIComponent(lead.email ?? lead.first_name ?? '')}`}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50"
            title="View in leads"
          >
            <ExternalLink size={12} />
          </Link>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4 space-y-4">

          {/* Toast */}
          {toast && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {toast}
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Attempts"  value={String(lead.ai_attempt_count)} />
            <Stat label="Next send" value={isActive ? futureRelative(lead.ai_next_send_at) : '—'} />
            <Stat label="Activated" value={relativeTime(lead.ai_first_activated_at)} />
            <Stat label="Expires"   value={expiresIn !== null ? `${expiresIn}d left` : '—'} />
            <Stat label="Last sent"    value={relativeTime(lead.last_sent_at)} />
            <Stat label="Last reply"   value={lead.last_reply_at ? relativeTime(lead.last_reply_at) : 'No reply yet'} />
            <Stat label="Last outcome" value={lead.last_run_outcome ?? '—'}
              tone={lead.last_run_outcome === 'sent' ? 'green' : lead.last_run_outcome === 'error' ? 'red' : 'gray'} />
            <Stat label="Email"     value={lead.email ?? '—'} />
          </div>

          {/* Last AI message */}
          {lead.last_sent_text && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Last AI message</p>
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                {lead.last_sent_text}
              </div>
              {lead.last_sent_at && <p className="mt-1 text-[10px] text-gray-400">{new Date(lead.last_sent_at).toLocaleString()}</p>}
            </div>
          )}

          {/* Last reply */}
          {lead.last_reply_body && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Last reply from lead</p>
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                {lead.last_reply_body}
              </div>
            </div>
          )}

          {/* Error */}
          {lead.last_run_error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {lead.last_run_error}
            </div>
          )}

          {/* Angles used */}
          {lead.ai_angles_used?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Angles used</p>
              <div className="flex flex-wrap gap-1.5">
                {lead.ai_angles_used.map(a => (
                  <span key={a} className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] text-purple-700">
                    {a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {lead.tags.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {lead.tags.map(t => (
                  <span key={t.id}
                    style={t.color ? { backgroundColor: `${t.color}18`, borderColor: `${t.color}50`, color: t.color } : undefined}
                    className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Preview draft */}
          {preview && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Preview draft <span className="normal-case font-normal text-purple-600">— angle: {preview.angle}</span>
              </p>
              <div className="bg-white border-2 border-dashed border-purple-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                {preview.text}
              </div>
              <p className="mt-1 text-[10px] text-gray-400">This is a draft — it has not been sent.</p>
            </div>
          )}

          {/* Actions */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Actions</p>
            <div className="flex flex-wrap gap-2">

              {/* Send Now */}
              {isActive && (
                <button
                  onClick={() => void doAction('send_now')}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {busy === 'send_now' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  Send Now
                </button>
              )}

              {/* Preview Draft */}
              <button
                onClick={() => void doPreview()}
                disabled={previewLoading || !!busy}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {previewLoading ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
                Preview Draft
              </button>

              {/* Pause / Resume */}
              {isActive && (
                <button
                  onClick={() => void doAction('pause')}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  {busy === 'pause' ? <Loader2 size={11} className="animate-spin" /> : <Pause size={11} />}
                  Pause AI
                </button>
              )}
              {isPaused && (
                <button
                  onClick={() => void doAction('resume')}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {busy === 'resume' ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  Resume AI
                </button>
              )}

              {/* Mark Handoff */}
              {(isActive || isPaused) && (
                <button
                  onClick={() => void doAction('handoff')}
                  disabled={!!busy}
                  className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                >
                  {busy === 'handoff' ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} />}
                  Mark Handoff
                </button>
              )}

              {/* Snooze */}
              {(isActive || isPaused) && (
                <>
                  <span className="flex items-center text-xs text-gray-400 gap-1"><AlarmClock size={11} /> Snooze:</span>
                  {[1, 2, 3].map(d => (
                    <button key={d}
                      onClick={() => void doAction('snooze', { days: d })}
                      disabled={!!busy}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {busy === `snooze_${d}` ? <Loader2 size={10} className="animate-spin inline" /> : null}
                      +{d}d
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' | 'gray' }) {
  const colorCls = tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-500' : 'text-gray-800';
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{label}</p>
      <p className={`text-xs font-medium ${colorCls}`}>{value}</p>
    </div>
  );
}

// ── Small components ───────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-emerald-500' : 'bg-gray-200'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full border border-gray-200 bg-white shadow transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
}

function EligibilityRow({ label, ok, okLabel, failLabel, info, actionUrl, actionLabel }: {
  label: string; ok: boolean; okLabel: string; failLabel: string;
  info?: string; actionUrl?: string; actionLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          ok ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
        }`}>
          {ok ? <Check size={13} /> : <ShieldAlert size={13} />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="mt-0.5 text-xs text-gray-500">{ok ? okLabel : failLabel}</p>
          {!ok && info && <p className="mt-1 text-[11px] text-gray-400">{info}</p>}
        </div>
      </div>
      {!ok && actionUrl && (
        <a href={actionUrl}
          className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          {actionLabel || 'Open'} <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-purple-50 text-xs font-semibold text-purple-600">{n}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500" dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </div>
  );
}

// ── Metrics card ───────────────────────────────────────────────────────────

interface MetricsPayload {
  windowDays: number; windowStartIso: string; messagesSent: number;
  leadsReplied: number; replyRate: number; handedOff: number; optedOut: number;
  exhausted: number; activated: number; activeNow: number; pausedNow: number;
  handoffNow: number; sentToday: number; effectiveDailyCap: number;
  enabled: boolean; a2pVerified: boolean; addonActive: boolean;
}

const WINDOW_OPTIONS = [
  { days: 7, label: '7d' }, { days: 30, label: '30d' }, { days: 90, label: '90d' },
] as const;

function AiConciergeMetricsCard() {
  const [data, setData]       = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<number>(30);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/ai-concierge/metrics?days=${days}`, { cache: 'no-store' });
      if (!res.ok) { setData(null); return; }
      setData(await res.json() as MetricsPayload);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(windowDays); }, [load, windowDays]);

  if (!loading && data && !data.addonActive) return null;

  const sentTodayPct  = data && data.effectiveDailyCap > 0 ? Math.min(100, Math.round((data.sentToday / data.effectiveDailyCap) * 100)) : 0;
  const sentTodayTone = sentTodayPct >= 100 ? 'text-rose-600' : sentTodayPct >= 80 ? 'text-amber-600' : 'text-gray-700';
  const replyRatePct  = data ? Math.round(data.replyRate * 100) : 0;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <TrendingUp size={18} className="text-gray-400" />
          <h2 className="font-heading text-base font-semibold text-gray-900">Performance</h2>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-gray-100 p-0.5">
          {WINDOW_OPTIONS.map(({ days, label }) => (
            <button key={days} type="button" onClick={() => setWindowDays(days)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                windowDays === days ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-5">
        {loading && !data && <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 size={18} className="animate-spin" /></div>}
        {!loading && !data && <p className="py-6 text-center text-sm text-gray-400">Couldn&apos;t load metrics right now.</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricTile icon={<Send size={14} />} label="Messages sent" value={data.messagesSent.toLocaleString()} hint={`${data.activated.toLocaleString()} activations`} tone="default" />
              <MetricTile icon={<Inbox size={14} />} label="Leads who replied" value={data.leadsReplied.toLocaleString()} hint={data.replyRate > 0 ? `${replyRatePct}% reply rate` : 'No replies yet'} tone={data.leadsReplied > 0 ? 'emerald' : 'default'} />
              <MetricTile icon={<UserCheck size={14} />} label="Handed to humans" value={data.handedOff.toLocaleString()} hint={data.handoffNow > 0 ? `${data.handoffNow} waiting` : '—'} tone={data.handoffNow > 0 ? 'amber' : 'default'} />
              <MetricTile icon={<UserX size={14} />} label="Opted out" value={data.optedOut.toLocaleString()} hint={data.exhausted > 0 ? `+ ${data.exhausted} exhausted` : '—'} tone="default" />
            </div>
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MicroTile icon={<Activity size={12} />} label="Active now" value={data.activeNow} tone="emerald" />
              <MicroTile icon={<PauseIcon size={12} />} label="Paused" value={data.pausedNow} tone="amber" />
              <MicroTile icon={<AlertOctagon size={12} />} label="Awaiting human" value={data.handoffNow} tone={data.handoffNow > 0 ? 'rose' : 'default'} />
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <Gauge size={12} /> Today&apos;s sends
                </div>
                <p className={`mt-0.5 text-base font-semibold ${sentTodayTone}`}>
                  {data.sentToday}<span className="text-xs text-gray-400"> / {data.effectiveDailyCap}</span>
                </p>
              </div>
            </div>
            {!data.enabled && data.addonActive && (
              <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                AI Concierge is currently <strong>off</strong>. Existing metrics still show but no new follow-ups will go out until you toggle it on below.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const TONE_MAP = {
  default: 'border-gray-200 bg-white text-gray-900',
  emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-900',
  amber:   'border-amber-100 bg-amber-50/60 text-amber-900',
  rose:    'border-rose-100 bg-rose-50/60 text-rose-900',
} as const;
type Tone = keyof typeof TONE_MAP;

function MetricTile({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone: Tone }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${TONE_MAP[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">{icon} {label}</div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] opacity-60">{hint}</p>}
    </div>
  );
}

function MicroTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: Tone }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${TONE_MAP[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">{icon} {label}</div>
      <p className="mt-0.5 text-base font-semibold">{value}</p>
    </div>
  );
}
