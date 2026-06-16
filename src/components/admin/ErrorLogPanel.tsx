'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, Search, AlertTriangle, AlertOctagon, Info,
  X, ExternalLink, CheckCircle2, Eye, Ban, Radio, Copy, ClipboardCheck, Wand2,
} from 'lucide-react';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type ErrorLoggedEvent } from '@/lib/realtime/channels';

const BRAND = '#1b1b1b';

type Level = 'info' | 'warning' | 'error' | 'critical';
type Status = 'new' | 'investigating' | 'resolved' | 'ignored';

interface ErrorRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  level: Level;
  source: string;
  category: string | null;
  message: string;
  stack: string | null;
  venue_id: string | null;
  user_email: string | null;
  route: string | null;
  method: string | null;
  http_status: number | null;
  context: Record<string, unknown> | null;
  fingerprint: string | null;
  occurrence_count: number;
  status: Status;
  resolved_by: string | null;
  resolved_at: string | null;
  notes: string | null;
}

interface Stats {
  total: number; critical: number; error: number; warning: number; info: number;
  unresolved: number; occurrences: number;
}

const LEVEL_STYLES: Record<Level, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  critical: { bg: 'bg-red-100',    text: 'text-red-700',    icon: <AlertOctagon size={12} />,  label: 'Critical' },
  error:    { bg: 'bg-orange-100', text: 'text-orange-700', icon: <AlertTriangle size={12} />, label: 'Error' },
  warning:  { bg: 'bg-amber-100',  text: 'text-amber-700',  icon: <AlertTriangle size={12} />, label: 'Warning' },
  info:     { bg: 'bg-blue-100',   text: 'text-blue-700',   icon: <Info size={12} />,          label: 'Info' },
};

const STATUS_STYLES: Record<Status, string> = {
  new:           'bg-red-50 text-red-600 border-red-200',
  investigating: 'bg-amber-50 text-amber-700 border-amber-200',
  resolved:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  ignored:       'bg-gray-100 text-gray-500 border-gray-200',
};

const SOURCES = ['api', 'client', 'sms', 'email', 'payment', 'webhook', 'ai', 'cron', 'other'];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Keep only the most useful stack frames (app code), drop framework noise,
 *  cap the length — keeps the fix prompt small + high-signal. */
function trimStack(stack: string | null): string {
  if (!stack) return '';
  const lines = stack.split('\n').map(l => l.trim());
  const kept = lines.filter(l =>
    !/node_modules|webpack-internal|next\/dist|node:internal/.test(l),
  );
  return (kept.length ? kept : lines).slice(0, 12).join('\n');
}

/** Plain-English, high-school-level explanation of an error: what happened,
 *  who/what it affects, and the outcome once fixed. Deterministic (no AI). */
function explainError(r: ErrorRow): { what: string; impact: string; outcome: string } {
  const route = r.route || 'a part of the app';
  const s = r.http_status ?? 0;
  const statusPhrase =
    s >= 500 ? 'the server hit a bug and crashed while handling it'
    : s === 404 ? 'the thing it asked for could not be found'
    : (s === 401 || s === 403) ? 'it was blocked by a login or permission problem'
    : s === 429 ? 'it was rate-limited (too many requests too fast)'
    : s >= 400 ? 'the information it sent was invalid or rejected'
    : 'it did not complete successfully';

  switch (r.source) {
    case 'sms':
      return {
        what: 'The system tried to send a text message and it failed.',
        impact: 'The lead or customer did not get their text (for example a follow-up or a guide link), so from their side it looks like nothing happened.',
        outcome: 'Once fixed, the text will go out and the person will receive their message.',
      };
    case 'email':
      return {
        what: 'The system tried to send an email and it failed.',
        impact: 'The recipient never got the email (for example a pricing guide, receipt, or notification).',
        outcome: 'Once fixed, the email will be delivered to the recipient.',
      };
    case 'payment':
      return {
        what: 'A billing or payment action with the card processor (LunarPay) failed.',
        impact: 'A charge, subscription update, or payout may not have gone through — this can affect money and billing for this account.',
        outcome: 'Once fixed, payments and billing updates will process correctly.',
      };
    case 'webhook':
      return {
        what: 'An automatic update sent from an outside service could not be processed.',
        impact: 'Something that is supposed to update on its own (like a payment status or calendar event) may now be out of date.',
        outcome: 'Once fixed, these automatic updates will apply correctly without anyone doing it by hand.',
      };
    case 'ai':
      return {
        what: 'The AI assistant ran into a problem while doing its job.',
        impact: 'An AI action — like an automatic follow-up message to a lead — may not have happened.',
        outcome: 'Once fixed, the AI will carry out its task as scheduled.',
      };
    case 'cron':
      return {
        what: 'A scheduled background job (a task that runs automatically on a timer) failed.',
        impact: 'Automatic work like follow-ups, reminders, or data syncs may have been skipped for that run.',
        outcome: 'Once fixed, the scheduled job will run reliably on time.',
      };
    case 'client':
      if (r.category === 'api_fetch' || r.category === 'api_network') {
        return {
          what: `A page in the app asked the server for data from ${route}, and ${statusPhrase}.`,
          impact: 'The person using that page did not get what they expected — they may have seen an error, a blank area, or a button that looked like it "did nothing."',
          outcome: `Once fixed, ${route} will respond correctly and the page will load or save the way it should.`,
        };
      }
      return {
        what: 'Something in the web page itself crashed while someone was using it in their browser.',
        impact: 'The page may have frozen, gone blank, or a feature stopped responding for that user.',
        outcome: 'Once fixed, the page will run smoothly without crashing.',
      };
    case 'api':
      return {
        what: `A request to ${route} failed — ${statusPhrase}.`,
        impact: 'Whatever feature relies on that request did not work for the person who triggered it.',
        outcome: `Once fixed, ${route} will work and the feature will behave normally.`,
      };
    default:
      return {
        what: 'The app ran into an unexpected problem.',
        impact: 'A feature may not have worked as expected for whoever ran into it.',
        outcome: 'Once fixed, this part of the app will work normally again.',
      };
  }
}

/**
 * Build a compact, token-optimized prompt the super admin can paste straight
 * back into the coding chat. Deterministic (no LLM call → free + instant).
 * Only includes high-signal fields; omits empty ones to save tokens.
 */
function buildFixPrompt(r: ErrorRow, venueName?: string): string {
  const lines: string[] = [];
  const seen = r.occurrence_count > 1 ? ` (seen ${r.occurrence_count}x)` : '';
  lines.push(`Fix this StoryPay ${r.source} error${seen}.`);
  lines.push('');
  lines.push(`Error: ${r.message}`);
  if (r.route)  lines.push(`Where: ${r.method ? r.method + ' ' : ''}${r.route}${r.http_status ? ` [HTTP ${r.http_status}]` : ''}`);
  if (r.category) lines.push(`Area: ${r.source}/${r.category}`);
  if (r.venue_id) lines.push(`Venue: ${venueName || r.venue_id}`);

  const stack = trimStack(r.stack);
  if (stack) { lines.push('Stack:'); lines.push(stack); }

  if (r.context && Object.keys(r.context).length) {
    let ctx = '';
    try { ctx = JSON.stringify(r.context); } catch { /* ignore */ }
    if (ctx && ctx !== '{}') lines.push(`Context: ${ctx.slice(0, 600)}`);
  }

  lines.push('');
  lines.push('Find the root cause in the repo and fix it with minimal changes. Explain the bug in 1-2 sentences, then make the fix.');
  return lines.join('\n');
}

export default function ErrorLogPanel() {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [venueNames, setVenueNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('open'); // open = new+investigating
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [days, setDays] = useState<number>(7);
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  const [activeId, setActiveId] = useState<string | null>(null);
  const [livePulse, setLivePulse] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRows = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams();
      if (statusFilter === 'open') {
        // default backend behavior (new+investigating) → omit
      } else {
        p.set('status', statusFilter);
      }
      if (levelFilter) p.set('level', levelFilter);
      if (sourceFilter) p.set('source', sourceFilter);
      if (committedSearch) p.set('q', committedSearch);
      p.set('days', String(days));
      const r = await fetch(`/api/admin/errors?${p.toString()}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setRows(d.rows ?? []);
      setStats(d.stats ?? null);
      setVenueNames(d.venueNames ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, levelFilter, sourceFilter, committedSearch, days]);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  // Realtime: new error → pulse + debounced refresh.
  useBroadcastChannel(
    supportChannels.adminErrors(),
    ['error'],
    useCallback((_evt, payload) => {
      const e = payload as ErrorLoggedEvent | null;
      if (!e) return;
      setLivePulse(true);
      setTimeout(() => setLivePulse(false), 1200);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void fetchRows(), 800);
    }, [fetchRows]),
  );

  const active = useMemo(() => rows.find(r => r.id === activeId) ?? null, [rows, activeId]);

  async function updateStatus(ids: string[], status: Status, notes?: string) {
    try {
      const r = await fetch('/api/admin/errors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status, notes }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Update failed'); }
      await fetchRows();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed');
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl text-gray-900">Error Log</h2>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-colors ${livePulse ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
              <Radio size={10} className={livePulse ? 'animate-pulse' : ''} /> Live
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Every failure across the platform and all sub-accounts, in real time.</p>
        </div>
        <button
          onClick={() => { setLoading(true); void fetchRows(); }}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stat counters */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <StatCard label="Unresolved" value={stats.unresolved} tone="red" />
          <StatCard label="Critical" value={stats.critical} tone="red" />
          <StatCard label="Errors" value={stats.error} tone="orange" />
          <StatCard label="Warnings" value={stats.warning} tone="amber" />
          <StatCard label="Distinct" value={stats.total} tone="gray" />
          <StatCard label="Occurrences" value={stats.occurrences} tone="gray" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setCommittedSearch(search.trim()); }}
            placeholder="Search message, category, route…"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </div>
        <Select value={statusFilter} onChange={setStatusFilter} options={[
          { v: 'open', l: 'Open (unresolved)' }, { v: 'new', l: 'New' },
          { v: 'investigating', l: 'Investigating' }, { v: 'resolved', l: 'Resolved' },
          { v: 'ignored', l: 'Ignored' }, { v: 'all', l: 'All statuses' },
        ]} />
        <Select value={levelFilter} onChange={setLevelFilter} options={[
          { v: '', l: 'All levels' }, { v: 'critical', l: 'Critical' },
          { v: 'error', l: 'Error' }, { v: 'warning', l: 'Warning' }, { v: 'info', l: 'Info' },
        ]} />
        <Select value={sourceFilter} onChange={setSourceFilter} options={[
          { v: '', l: 'All sources' }, ...SOURCES.map(s => ({ v: s, l: s })),
        ]} />
        <Select value={String(days)} onChange={(v) => setDays(Number(v))} options={[
          { v: '1', l: 'Last 24h' }, { v: '7', l: 'Last 7 days' },
          { v: '30', l: 'Last 30 days' }, { v: '0', l: 'All time' },
        ]} />
      </div>

      {/* List */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400"><Loader2 size={20} className="animate-spin mx-auto" /></div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-red-500">{error}</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-400" />
            <p className="text-sm">No errors match these filters. 🎉</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rows.map((r) => {
              const ls = LEVEL_STYLES[r.level];
              return (
                <button
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3"
                >
                  <span className={`shrink-0 mt-0.5 inline-flex items-center gap-1 ${ls.bg} ${ls.text} text-[10px] font-bold uppercase px-2 py-0.5 rounded-full`}>
                    {ls.icon} {ls.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.message}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 flex-wrap">
                      <span className="font-medium text-gray-600">{r.source}{r.category ? ` · ${r.category}` : ''}</span>
                      {r.route && <span className="font-mono">{r.method ? `${r.method} ` : ''}{r.route}</span>}
                      {r.venue_id && <span>· {venueNames[r.venue_id] || 'Venue'}</span>}
                      {r.http_status && <span>· {r.http_status}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {r.occurrence_count > 1 && (
                      <span className="text-[10px] font-bold bg-gray-900 text-white px-1.5 py-0.5 rounded-full">×{r.occurrence_count}</span>
                    )}
                    <span className="text-[11px] text-gray-400">{relativeTime(r.last_seen_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {active && (
        <ErrorDetailDrawer
          row={active}
          venueName={active.venue_id ? venueNames[active.venue_id] : undefined}
          onClose={() => setActiveId(null)}
          onStatus={(s, notes) => updateStatus([active.id], s, notes)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'red' | 'orange' | 'amber' | 'gray' }) {
  const toneCls = {
    red: 'text-red-600', orange: 'text-orange-600', amber: 'text-amber-600', gray: 'text-gray-900',
  }[tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <p className={`text-xl font-bold ${toneCls}`}>{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-200"
    >
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function ErrorDetailDrawer({ row, venueName, onClose, onStatus }: {
  row: ErrorRow;
  venueName?: string;
  onClose: () => void;
  onStatus: (status: Status, notes?: string) => void;
}) {
  const [notes, setNotes] = useState(row.notes ?? '');
  const [copied, setCopied] = useState(false);
  const ls = LEVEL_STYLES[row.level];
  const appBase = 'https://app.storyvenue.com';

  const copyFixPrompt = async () => {
    const prompt = buildFixPrompt(row, venueName);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement('textarea');
      ta.value = prompt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 ${ls.bg} ${ls.text} text-[11px] font-bold uppercase px-2 py-0.5 rounded-full`}>
            {ls.icon} {ls.label}
          </span>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[row.status]}`}>{row.status}</span>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X size={18} /></button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-base font-semibold text-gray-900">{row.message}</p>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 flex-wrap">
              <span className="font-medium text-gray-600">{row.source}{row.category ? ` · ${row.category}` : ''}</span>
              {row.occurrence_count > 1 && <span className="font-bold text-gray-900">· seen ×{row.occurrence_count}</span>}
              <span>· first {relativeTime(row.created_at)}</span>
              <span>· last {relativeTime(row.last_seen_at)}</span>
            </div>
          </div>

          {/* Plain-English explanation */}
          {(() => {
            const ex = explainError(row);
            return (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">In plain English</p>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">What happened</p>
                  <p className="text-sm text-gray-800">{ex.what}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Who / what it affects</p>
                  <p className="text-sm text-gray-800">{ex.impact}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Outcome once fixed</p>
                  <p className="text-sm text-gray-800">{ex.outcome}</p>
                </div>
              </div>
            );
          })()}

          {/* Copy fix prompt — paste straight into the coding chat */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Wand2 size={16} className="text-indigo-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-indigo-900">Copy fix prompt</p>
                  <p className="text-[11px] text-indigo-700/80">Token-optimized — paste it into the dev chat to get this fixed.</p>
                </div>
              </div>
              <button
                onClick={copyFixPrompt}
                className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
              >
                {copied ? <><ClipboardCheck size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {row.route && <Meta label="Route" value={`${row.method ? row.method + ' ' : ''}${row.route}`} mono />}
            {row.http_status != null && <Meta label="HTTP status" value={String(row.http_status)} />}
            {row.user_email && <Meta label="User" value={row.user_email} />}
            {row.venue_id && (
              <div>
                <p className="text-gray-400 uppercase text-[10px] font-semibold tracking-wide">Sub-account</p>
                <a href={`${appBase}/admin/venues`} target="_blank" rel="noreferrer" className="text-gray-900 font-medium inline-flex items-center gap-1 hover:underline">
                  {venueName || row.venue_id} <ExternalLink size={11} />
                </a>
              </div>
            )}
          </div>

          {row.stack && (
            <div>
              <p className="text-gray-400 uppercase text-[10px] font-semibold tracking-wide mb-1">Stack trace</p>
              <pre className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-[11px] leading-relaxed overflow-auto whitespace-pre-wrap text-gray-700 max-h-64">{row.stack}</pre>
            </div>
          )}

          {row.context && Object.keys(row.context).length > 0 && (
            <div>
              <p className="text-gray-400 uppercase text-[10px] font-semibold tracking-wide mb-1">Context (PII redacted)</p>
              <pre className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-[11px] leading-relaxed overflow-auto whitespace-pre-wrap text-gray-700 max-h-64">{JSON.stringify(row.context, null, 2)}</pre>
            </div>
          )}

          {/* Triage */}
          <div>
            <p className="text-gray-400 uppercase text-[10px] font-semibold tracking-wide mb-1.5">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add triage notes…"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => onStatus('investigating', notes)} className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 px-3 py-2 text-sm font-medium hover:bg-amber-100">
              <Eye size={14} /> Investigating
            </button>
            <button onClick={() => onStatus('resolved', notes)} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white hover:opacity-90" style={{ backgroundColor: BRAND }}>
              <CheckCircle2 size={14} /> Resolve
            </button>
            <button onClick={() => onStatus('ignored', notes)} className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white text-gray-600 px-3 py-2 text-sm font-medium hover:bg-gray-50">
              <Ban size={14} /> Ignore
            </button>
            {row.status !== 'new' && (
              <button onClick={() => onStatus('new', notes)} className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white text-gray-600 px-3 py-2 text-sm font-medium hover:bg-gray-50">
                Reopen
              </button>
            )}
          </div>

          {row.resolved_by && row.resolved_at && (
            <p className="text-[11px] text-gray-400">Resolved by {row.resolved_by} · {relativeTime(row.resolved_at)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-gray-400 uppercase text-[10px] font-semibold tracking-wide">{label}</p>
      <p className={`text-gray-900 font-medium break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</p>
    </div>
  );
}
