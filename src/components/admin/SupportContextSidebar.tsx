'use client';

/**
 * SupportContextSidebar — right-rail context for the active bride thread in
 * the admin support inbox.
 *
 * One fetch to /api/admin/support/bride-context/[threadId] feeds the whole
 * panel. The component is intentionally information-dense: agents should be
 * able to answer the bride without flipping tabs to look up venue plan,
 * pipeline stage, AI state, recent activity, etc.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, User, Building2, Mail, Phone, ShieldCheck, ShieldAlert,
  Sparkles, CircleDot, AlertTriangle, Calendar, Clock, Tag,
  Activity, Inbox, BellOff, RefreshCw, ExternalLink,
} from 'lucide-react';

interface ContextResponse {
  bride: {
    first_name:    string | null;
    last_name:     string | null;
    email:         string | null;
    phone:         string | null;
    sms_dnd:       boolean;
    conversation_dnd_all: boolean;
    submitted_at:  string | null;
    lead_source:   string | null;
    lead_status:   string | null;
    message_count: number;
  };
  pipeline: { id: string; name: string; color: string | null; pipeline_id: string; pipeline_name: string } | null;
  ai: {
    state:              string;
    first_activated_at: string | null;
    expires_at:         string | null;
    next_send_at:       string | null;
    attempt_count:      number;
    re_enable_count:    number;
    last_inbound_at:    string | null;
    last_outbound_at:   string | null;
  } | null;
  ai_handoff: { at: string; reason: string | null; trigger: string | null } | null;
  venue: {
    id:                 string;
    name:               string;
    notification_email: string | null;
    timezone:           string | null;
    created_at:         string | null;
    plan:               { id: string; name: string; price_cents: number; is_legacy: boolean } | null;
    addons:             { concierge: boolean; verified: boolean; sponsored: boolean };
    a2p:                { verified: boolean; brand_status: string | null; campaign_status: string | null };
    ai_concierge_enabled: boolean;
    ai_persona:         string | null;
    open_tickets_count: number;
    concierge_notify_emails: string[];
  } | null;
  recent_activity: Array<{ action: string; at: string; details: unknown }>;
  lead_id: string | null;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return '';
  const diff = Date.now() - d;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return null;
  return Math.floor((Date.now() - d) / 86_400_000);
}

function dollars(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return cents % 100 === 0
    ? `$${(cents / 100).toFixed(0)}`
    : `$${(cents / 100).toFixed(2)}`;
}

function humanizeAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function AiStatePill({ state }: { state: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    dormant:   { label: 'Dormant',     cls: 'bg-gray-100 text-gray-700 border-gray-200' },
    ai_active: { label: 'AI active',   cls: 'bg-violet-100 text-violet-800 border-violet-200' },
    paused:    { label: 'Paused',      cls: 'bg-blue-100 text-blue-800 border-blue-200' },
    handoff:   { label: 'Handoff',     cls: 'bg-amber-100 text-amber-800 border-amber-200' },
    opted_out: { label: 'Opted out',   cls: 'bg-red-100 text-red-700 border-red-200' },
    exhausted: { label: 'Exhausted',   cls: 'bg-gray-200 text-gray-600 border-gray-300' },
  };
  const c = cfg[state] || cfg.dormant;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.cls}`}>
      <Sparkles size={9} /> {c.label}
    </span>
  );
}

export function SupportContextSidebar({ threadId }: { threadId: string | null }) {
  const [data, setData] = useState<ContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/support/bride-context/${threadId}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      setData((await r.json()) as ContextResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load context');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    setData(null);
    if (threadId) void load();
  }, [threadId, load]);

  if (!threadId) {
    return (
      <div className="hidden xl:flex w-72 shrink-0 rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-400 items-center justify-center">
        Select a conversation to see context.
      </div>
    );
  }

  return (
    <aside className="hidden xl:flex w-72 shrink-0 rounded-2xl border border-gray-200 bg-white flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-gray-50/60">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Context</h3>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-800"
          title="Refresh"
        >
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}

      {error && (
        <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={11} className="inline mr-1" /> {error}
        </div>
      )}

      {data && (
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {/* AI handoff banner */}
          {data.ai_handoff && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 mb-1">
                <AlertTriangle size={11} /> AI handoff
              </div>
              <p className="text-[11px] text-amber-900">
                AI escalated {relativeTime(data.ai_handoff.at)}
                {data.ai_handoff.trigger ? <> on keyword <code className="bg-amber-100 px-1 rounded">{data.ai_handoff.trigger}</code></> : null}
                {data.ai_handoff.reason ? <>: {data.ai_handoff.reason}</> : null}
              </p>
            </div>
          )}

          {/* Bride */}
          <section className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <User size={11} /> Bride
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-900">
                {[data.bride.first_name, data.bride.last_name].filter(Boolean).join(' ') || data.bride.email || 'Unknown'}
              </p>
              {data.bride.email && (
                <p className="flex items-center gap-1.5 text-[11px] text-gray-600 truncate">
                  <Mail size={10} className="text-gray-400 shrink-0" />
                  <a href={`mailto:${data.bride.email}`} className="hover:underline truncate">{data.bride.email}</a>
                </p>
              )}
              {data.bride.phone && (
                <p className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <Phone size={10} className="text-gray-400 shrink-0" />
                  <a href={`tel:${data.bride.phone}`} className="hover:underline">{data.bride.phone}</a>
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 flex-wrap pt-1">
              {data.pipeline && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    borderColor: data.pipeline.color || '#e5e7eb',
                    backgroundColor: (data.pipeline.color || '#f3f4f6') + '20',
                    color: data.pipeline.color || '#374151',
                  }}
                  title={data.pipeline.pipeline_name ? `Pipeline: ${data.pipeline.pipeline_name}` : ''}
                >
                  <CircleDot size={9} /> {data.pipeline.name}
                </span>
              )}
              {data.bride.lead_status && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
                  {data.bride.lead_status}
                </span>
              )}
              {data.ai && <AiStatePill state={data.ai.state} />}
            </div>

            {data.bride.lead_source && (
              <p className="text-[10px] text-gray-500">
                <span className="text-gray-400">Source:</span> <span className="font-medium text-gray-700">{data.bride.lead_source}</span>
              </p>
            )}
            <p className="flex items-center gap-1 text-[10px] text-gray-500">
              <Calendar size={9} /> Submitted {data.bride.submitted_at ? relativeTime(data.bride.submitted_at) : 'unknown'}
              {(() => {
                const d = daysSince(data.bride.submitted_at);
                if (d === null || d < 1) return null;
                return <span className="ml-1 text-gray-400">({d}d ago)</span>;
              })()}
            </p>
            <p className="flex items-center gap-1 text-[10px] text-gray-500">
              <Inbox size={9} /> {data.bride.message_count} message{data.bride.message_count === 1 ? '' : 's'} in thread
            </p>

            {(data.bride.sms_dnd || data.bride.conversation_dnd_all) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800 flex items-center gap-1">
                <BellOff size={10} /> {data.bride.sms_dnd ? 'SMS opted out' : 'All channels suppressed'}
              </div>
            )}
          </section>

          {/* AI detail (only when active or recently was) */}
          {data.ai && data.ai.state !== 'dormant' && (
            <section className="px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <Sparkles size={11} /> AI Concierge
              </div>
              {data.ai.first_activated_at && (
                <p className="text-[10px] text-gray-600">
                  <span className="text-gray-400">First activated:</span> {relativeTime(data.ai.first_activated_at)}
                </p>
              )}
              {data.ai.next_send_at && (data.ai.state === 'ai_active' || data.ai.state === 'dormant') && (
                <p className="flex items-center gap-1 text-[10px] text-gray-600">
                  <Clock size={9} /> Next send {relativeTime(data.ai.next_send_at)}
                </p>
              )}
              {data.ai.expires_at && (
                <p className="text-[10px] text-gray-600">
                  <span className="text-gray-400">60-day cap:</span> {relativeTime(data.ai.expires_at)}
                </p>
              )}
              <p className="text-[10px] text-gray-600">
                <span className="text-gray-400">Sent:</span> {data.ai.attempt_count} · <span className="text-gray-400">Re-enables:</span> {data.ai.re_enable_count}
              </p>
            </section>
          )}

          {/* Venue */}
          {data.venue && (
            <section className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <Building2 size={11} /> Venue
              </div>
              <p className="text-sm font-semibold text-gray-900">{data.venue.name}</p>
              {data.venue.notification_email && (
                <p className="flex items-center gap-1.5 text-[11px] text-gray-600 truncate">
                  <Mail size={10} className="text-gray-400 shrink-0" />
                  <a href={`mailto:${data.venue.notification_email}`} className="hover:underline truncate">{data.venue.notification_email}</a>
                </p>
              )}

              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                {data.venue.plan && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 text-blue-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    {data.venue.plan.name} · {dollars(data.venue.plan.price_cents)}/mo
                    {data.venue.plan.is_legacy && <span className="ml-0.5 text-blue-600">·legacy</span>}
                  </span>
                )}
                {data.venue.a2p.verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" title="A2P verified">
                    <ShieldCheck size={9} /> A2P
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 text-gray-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" title="A2P not verified">
                    <ShieldAlert size={9} /> No A2P
                  </span>
                )}
                {data.venue.ai_concierge_enabled && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 text-violet-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    <Sparkles size={9} /> AI on
                  </span>
                )}
              </div>

              {/* Addons */}
              <div className="flex items-center gap-1 flex-wrap">
                {data.venue.addons.concierge && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                    <Tag size={9} /> Concierge
                  </span>
                )}
                {data.venue.addons.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                    <Tag size={9} /> Verified
                  </span>
                )}
                {data.venue.addons.sponsored && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                    <Tag size={9} /> Sponsored
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1 pt-1 text-[10px] text-gray-500">
                <p>
                  <span className="text-gray-400">Open tickets:</span><br />
                  <span className="font-semibold text-gray-700">{data.venue.open_tickets_count}</span>
                </p>
                <p>
                  <span className="text-gray-400">Joined:</span><br />
                  <span className="font-semibold text-gray-700">{data.venue.created_at ? relativeTime(data.venue.created_at) : '—'}</span>
                </p>
              </div>

              <div className="pt-1">
                <a
                  href={`/admin/venues?venue=${data.venue.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-700 hover:text-gray-900"
                >
                  Open venue page <ExternalLink size={9} />
                </a>
              </div>
            </section>
          )}

          {/* Recent activity */}
          {data.recent_activity.length > 0 && (
            <section className="px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">
                <Activity size={11} /> Recent activity
              </div>
              <ul className="space-y-1.5">
                {data.recent_activity.map((a, i) => (
                  <li key={i} className="text-[10px] text-gray-600 flex items-start gap-1.5">
                    <CircleDot size={8} className="text-gray-300 mt-1 shrink-0" />
                    <span className="flex-1">
                      <span className="font-medium text-gray-800">{humanizeAction(a.action)}</span>
                      <span className="text-gray-400"> — {relativeTime(a.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
