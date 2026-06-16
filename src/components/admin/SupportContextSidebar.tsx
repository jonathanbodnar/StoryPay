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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2, AlertCircle, User, Building2, Mail, Phone, ShieldCheck, ShieldAlert,
  Sparkles, CircleDot, AlertTriangle, Calendar, Clock, Tag, Tags,
  Activity, Inbox, BellOff, RefreshCw, ExternalLink, ChevronDown, CheckCircle2,
  StickyNote, CalendarPlus, Plus, Trash2, X,
} from 'lucide-react';
import { SlaPill } from '@/components/support/SlaIndicator';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type StageChangedEvent, type TagsChangedEvent } from '@/lib/realtime/channels';
import EventEditorModal from '@/components/calendar/EventEditorModal';

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
  thread: { id: string; last_message_at: string | null; created_at: string | null };
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
    ghl_connected:      boolean;
    ai_concierge_enabled: boolean;
    ai_persona:         string | null;
    open_tickets_count: number;
    concierge_notify_emails: string[];
  } | null;
  recent_activity: Array<{ action: string; at: string; details: unknown }>;
  lead_id: string | null;
  venue_customer_id: string | null;
  pipelines: Array<{
    id:         string;
    name:       string;
    is_default: boolean;
    stages: Array<{ id: string; name: string; color: string | null; kind: string; position: number }>;
  }>;
  tags: Array<{ id: string; name: string; icon: string; color: string | null }>;
  applied_tag_ids: string[];
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

function ImpersonateButton({
  venueId,
  venueName,
  returnThreadId,
}: {
  venueId: string;
  venueName: string;
  returnThreadId: string | null;
}) {
  const [loading, setLoading] = useState(false);

  async function enter() {
    setLoading(true);
    // Build return URL so admin lands back in the exact bride thread after exit
    const returnUrl = returnThreadId
      ? `/admin/support?tab=bride-replies&thread=${returnThreadId}`
      : '/admin/support';
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, returnUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      window.location.href = data.redirect || '/dashboard';
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not enter venue');
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void enter()}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-900 bg-gray-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-gray-800 transition-colors disabled:opacity-50 w-full justify-center"
    >
      {loading
        ? <Loader2 size={11} className="animate-spin" />
        : <ExternalLink size={11} />
      }
      {loading ? 'Entering…' : `Open venue dashboard`}
    </button>
  );
}

export function SupportContextSidebar({ threadId }: { threadId: string | null }) {
  const [data, setData] = useState<ContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [actionPending, setActionPending] = useState(false);

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
    setActionStatus(null);
    if (threadId) void load();
  }, [threadId, load]);

  // Live stage + tag updates from the venue side — update inline without a full refetch
  useBroadcastChannel(
    threadId ? supportChannels.brideThread(threadId) : null,
    ['stage_changed', 'tags_changed'],
    useCallback((evt, payload) => {
      if (evt === 'stage_changed') {
        const s = payload as StageChangedEvent;
        if (!s) return;
        setData(prev => prev ? {
          ...prev,
          pipeline: {
            id:            s.stageId,
            name:          s.stageName,
            color:         s.stageColor,
            pipeline_id:   s.pipelineId,
            pipeline_name: prev.pipeline?.pipeline_name ?? '',
          },
        } : prev);
      } else if (evt === 'tags_changed') {
        const t = payload as TagsChangedEvent;
        if (!t) return;
        setData(prev => prev ? { ...prev, applied_tag_ids: t.appliedTagIds } : prev);
      }
    }, []),
  );

  /** Optimistic action runner. On success, refetches context to lock in
   *  server state; on error, surfaces the message + reverts. */
  const runAction = useCallback(async (
    body: Record<string, unknown>,
    optimistic?: () => void,
    successMsg?: string,
  ) => {
    if (!threadId) return;
    setActionPending(true);
    setActionStatus(null);
    optimistic?.();
    try {
      const r = await fetch(`/api/admin/support/bride-thread/${threadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({} as { error?: string; blockers?: string[] }));
      if (!r.ok) {
        const blockers = (d as { blockers?: string[] }).blockers;
        throw new Error(((d as { error?: string }).error || 'Action failed') + (blockers?.length ? ` — ${blockers[0]}` : ''));
      }
      setActionStatus({ ok: true, msg: successMsg || 'Saved' });
      // Re-pull authoritative state
      await load();
    } catch (e) {
      setActionStatus({ ok: false, msg: e instanceof Error ? e.message : 'Action failed' });
      // Refetch to revert any optimistic UI
      await load();
    } finally {
      setActionPending(false);
    }
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
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Contact Profile</h3>
          {data?.thread?.last_message_at && (
            <SlaPill iso={data.thread.last_message_at} size="sm" />
          )}
        </div>
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
              <StagePickerChip
                pipelines={data.pipelines}
                currentStageId={data.pipeline?.id ?? null}
                currentStageName={data.pipeline?.name ?? null}
                currentStageColor={data.pipeline?.color ?? null}
                disabled={actionPending}
                onSelect={(stageId, stageName) => {
                  // Find the matching pipeline + stage so we can optimistically render
                  let pipelineId = '';
                  let stageColor: string | null = null;
                  for (const p of data.pipelines) {
                    const s = p.stages.find(st => st.id === stageId);
                    if (s) { pipelineId = p.id; stageColor = s.color; break; }
                  }
                  runAction(
                    { action: 'set_stage', stageId },
                    () => {
                      setData(prev => prev ? {
                        ...prev,
                        pipeline: {
                          id:           stageId,
                          name:         stageName,
                          color:        stageColor,
                          pipeline_id:  pipelineId,
                          pipeline_name: prev.pipeline?.pipeline_name ?? '',
                        },
                      } : prev);
                    },
                    `Stage updated to ${stageName}`,
                  );
                }}
              />
              {data.bride.lead_status && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
                  {data.bride.lead_status}
                </span>
              )}
              {data.ai && <AiStatePill state={data.ai.state} />}
            </div>

            {actionStatus && (
              <div className={`rounded-md px-2 py-1 text-[10px] flex items-center gap-1 ${
                actionStatus.ok
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border border-red-200 bg-red-50 text-red-700'
              }`}>
                {actionStatus.ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                {actionStatus.msg}
              </div>
            )}

            {/* Action icons — tags / notes / calendar. The applied tags
                themselves live inside the tag modal so the contact card stays
                tight; the icon's badge count tells you how many are on. */}
            <div className="flex items-center gap-1 flex-wrap">
              <TagsModal
                allTags={data.tags}
                appliedTagIds={data.applied_tag_ids}
                disabled={actionPending}
                onAdd={(tagId, tagName) =>
                  runAction(
                    { action: 'add_tag', tagId },
                    () => {
                      setData(prev => prev ? {
                        ...prev,
                        applied_tag_ids: [...new Set([...prev.applied_tag_ids, tagId])],
                      } : prev);
                    },
                    `Tagged · ${tagName}`,
                  )
                }
                onRemove={(tagId) =>
                  runAction(
                    { action: 'remove_tag', tagId },
                    () => {
                      setData(prev => prev ? {
                        ...prev,
                        applied_tag_ids: prev.applied_tag_ids.filter(id => id !== tagId),
                      } : prev);
                    },
                    'Tag removed',
                  )
                }
              />
              {data.venue && data.venue_customer_id && (
                <NotesButton venueId={data.venue.id} customerId={data.venue_customer_id} />
              )}
              {data.venue && data.venue_customer_id && (
                <CalendarButton
                  venueId={data.venue.id}
                  customerId={data.venue_customer_id}
                  contactName={[data.bride.first_name, data.bride.last_name].filter(Boolean).join(' ') || data.bride.email || 'Contact'}
                  contactEmail={data.bride.email}
                  venueTimezone={data.venue.timezone}
                />
              )}
            </div>

            {/* Inline applied tags — visible at a glance so agents can see
                which tags are active without opening the modal. The modal
                button above is still the way to add/remove them. */}
            {data.applied_tag_ids.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {data.tags
                  .filter(t => data.applied_tag_ids.includes(t.id))
                  .map(t => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        borderColor: t.color ? `${t.color}60` : '#e5e7eb',
                        backgroundColor: t.color ? `${t.color}15` : '#f9fafb',
                        color: t.color ?? '#374151',
                      }}
                    >
                      {t.icon && <span className="text-[10px] leading-none">{t.icon}</span>}
                      {t.name}
                    </span>
                  ))
                }
              </div>
            )}

            {/* AI quick-actions */}
            {data.ai && (
              <AiActionRow
                ai={data.ai}
                disabled={!data.lead_id || actionPending}
                onActivate={() =>
                  runAction({ action: 'activate_ai' }, undefined, 'AI activated — first message in ~1 min')
                }
                onPause={() =>
                  runAction({ action: 'pause_ai' }, undefined, 'AI paused')
                }
                onReEnable={() =>
                  runAction({ action: 're_enable_ai' }, undefined, 'AI re-enabled (24h cooldown)')
                }
              />
            )}

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
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" title={`A2P verified${data.venue.a2p.campaign_status ? ` · campaign: ${data.venue.a2p.campaign_status}` : ''}`}>
                    <ShieldCheck size={9} /> A2P ✓
                  </span>
                ) : data.venue.ghl_connected ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 text-teal-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" title="GHL connected — SMS active">
                    <ShieldCheck size={9} /> SMS Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 text-gray-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" title="No GHL connection or A2P registration">
                    <ShieldAlert size={9} /> No SMS
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

              <div className="pt-1 flex flex-col gap-1.5">
                <ImpersonateButton venueId={data.venue.id} venueName={data.venue.name} returnThreadId={threadId} />
                <a
                  href={`/admin/venues?venue=${data.venue.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-gray-700"
                >
                  View in admin <ExternalLink size={9} />
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

// ─── Inline pickers ─────────────────────────────────────────────────────────

/**
 * Stage chip that opens a dropdown of all stages across all pipelines for the
 * venue. Click a stage to move the lead.
 */
function StagePickerChip({
  pipelines,
  currentStageId,
  currentStageName,
  currentStageColor,
  disabled,
  onSelect,
}: {
  pipelines: ContextResponse['pipelines'];
  currentStageId:    string | null;
  currentStageName:  string | null;
  currentStageColor: string | null;
  disabled: boolean;
  onSelect: (stageId: string, stageName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (pipelines.length === 0) {
    // No pipeline configured — show a static badge if we have one, otherwise nothing
    if (!currentStageName) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
        <CircleDot size={9} /> {currentStageName}
      </span>
    );
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          borderColor: currentStageColor || '#e5e7eb',
          backgroundColor: (currentStageColor || '#f3f4f6') + '20',
          color: currentStageColor || '#374151',
        }}
        title={currentStageId ? 'Click to move stage' : 'Set stage'}
      >
        <CircleDot size={9} /> {currentStageName || 'Set stage'} <ChevronDown size={9} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {pipelines.map(p => (
            <div key={p.id}>
              <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400 border-b border-gray-50">
                {p.name}{p.is_default ? ' · default' : ''}
              </p>
              {p.stages.length === 0 && (
                <p className="px-3 py-2 text-[10px] text-gray-400">No stages</p>
              )}
              {p.stages.map(s => {
                const isCurrent = s.id === currentStageId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setOpen(false); onSelect(s.id, s.name); }}
                    disabled={isCurrent}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-gray-50 disabled:cursor-default ${isCurrent ? 'bg-gray-50' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: s.color || '#9ca3af' }}
                      />
                      <span className={`font-medium ${isCurrent ? 'text-gray-900' : 'text-gray-700'}`}>{s.name}</span>
                    </span>
                    {isCurrent && <span className="text-[9px] text-emerald-600 font-semibold">CURRENT</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tag icon button + anchored popover — matches the venue-side LeadTagPopover
 * pixel-for-pixel. Active tags are filled `#1b1b1b` (brand-900) with white
 * text; inactive tags are an outlined pill with gray text.
 *
 * Rendered via createPortal so it's never clipped by overflow:hidden parents.
 */
function TagsModal({
  allTags,
  appliedTagIds,
  disabled,
  onAdd,
  onRemove,
}: {
  allTags: ContextResponse['tags'];
  appliedTagIds: string[];
  disabled: boolean;
  onAdd:    (tagId: string, tagName: string) => void;
  onRemove: (tagId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const n = appliedTagIds.length;

  const appliedSet = useMemo(() => new Set(appliedTagIds), [appliedTagIds]);

  // Close on outside click (matching LeadTagPopover behaviour)
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node;
      const portalEl = document.getElementById('admin-tag-popover-portal');
      if (btnRef.current?.contains(target)) return;
      if (portalEl?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top:   rect.bottom + window.scrollY + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(v => !v);
  };

  const popup = open && pos ? createPortal(
    <div
      id="admin-tag-popover-portal"
      style={{ position: 'absolute', top: pos.top, right: pos.right, zIndex: 9999 }}
      className="w-64 rounded-xl border border-gray-200 bg-white shadow-xl p-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Tags</p>
        {n > 0 && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-gray-600">
            {n}
          </span>
        )}
      </div>
      {allTags.length === 0 ? (
        <p className="text-[10px] text-gray-400">No tags yet.</p>
      ) : (
        // Sort applied tags first so the active set is the first thing the
        // agent sees when they open the modal.
        (() => {
          const sorted = [...allTags].sort((a, b) => {
            const aa = appliedSet.has(a.id) ? 0 : 1;
            const bb = appliedSet.has(b.id) ? 0 : 1;
            if (aa !== bb) return aa - bb;
            return a.name.localeCompare(b.name);
          });
          return (
            <div className="flex flex-wrap gap-1 max-h-[60vh] overflow-y-auto">
              {sorted.map(t => {
                const active = appliedSet.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={disabled}
                    title={t.name}
                    onClick={() => active ? onRemove(t.id) : onAdd(t.id, t.name)}
                    className={`inline-flex max-w-[140px] items-center justify-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      active
                        ? 'border-brand-900 bg-brand-900 text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-brand-900/30 hover:bg-brand-900/5 hover:text-brand-900'
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                  </button>
                );
              })}
            </div>
          );
        })()
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        title={n > 0 ? `${n} tag${n === 1 ? '' : 's'} — manage` : 'Add tags'}
        className="relative inline-flex items-center justify-center rounded-lg p-1 text-gray-400 hover:bg-orange-50 hover:text-orange-500 transition-colors"
      >
        <Tags size={14} />
        {n > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-400 text-[9px] font-bold text-white leading-none">
            {n > 9 ? '9+' : n}
          </span>
        )}
      </button>
      {popup}
    </>
  );
}

function AiActionRow({
  ai,
  disabled,
  onActivate,
  onPause,
  onReEnable,
}: {
  ai: NonNullable<ContextResponse['ai']>;
  disabled:   boolean;
  onActivate: () => void;
  onPause:    () => void;
  onReEnable: () => void;
}) {
  const canActivate  = ai.state === 'dormant';
  const canPause     = ai.state === 'ai_active';
  const canReEnable  = ['paused', 'handoff', 'opted_out', 'exhausted'].includes(ai.state);
  if (!canActivate && !canPause && !canReEnable) return null;

  return (
    <div className="flex items-center gap-1 pt-0.5 flex-wrap">
      {canActivate && (
        <button
          type="button"
          disabled={disabled}
          onClick={onActivate}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 disabled:opacity-50"
          title="Manually start AI follow-up now (sends first message in ~1 min)"
        >
          <Sparkles size={9} /> Activate AI
        </button>
      )}
      {canPause && (
        <button
          type="button"
          disabled={disabled}
          onClick={onPause}
          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800 disabled:opacity-50"
        >
          <Sparkles size={9} /> Pause AI
        </button>
      )}
      {canReEnable && (
        <button
          type="button"
          disabled={disabled}
          onClick={onReEnable}
          className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 hover:bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 disabled:opacity-50"
          title="Reset state to dormant; cron picks up after 24h cooldown"
        >
          <Sparkles size={9} /> Re-enable AI
        </button>
      )}
    </div>
  );
}

// ─── Notes ──────────────────────────────────────────────────────────────────
//
// Notes are written to `customer_notes` on the venue's subaccount, scoped by
// (venue_id, customer_id). The venue's contact-profile page reads from the
// same table, so a note added here shows up there automatically — no copies,
// no syncing job, just one row in one table.

interface ContactNote {
  id:           string;
  content:      string;
  author_name:  string | null;
  created_at:   string;
}

function NotesButton({ venueId, customerId }: { venueId: string; customerId: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Lazy-load count only — full list is fetched when the modal opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/admin/support/contact/${venueId}/${customerId}/notes`, { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json() as { notes: ContactNote[] };
        if (cancelled) return;
        setNotes(d.notes ?? []);
        setCount((d.notes ?? []).length);
        setLoaded(true);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [venueId, customerId]);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/support/contact/${venueId}/${customerId}/notes`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json() as { notes: ContactNote[] };
      setNotes(d.notes ?? []);
      setCount((d.notes ?? []).length);
      setLoaded(true);
    } catch { /* ignore */ }
  }, [venueId, customerId]);

  const n = count ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={n > 0 ? `${n} note${n === 1 ? '' : 's'} — view & add` : 'Add a note'}
        className="relative inline-flex items-center justify-center rounded-lg p-1 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
      >
        <StickyNote size={14} />
        {n > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white leading-none">
            {n > 9 ? '9+' : n}
          </span>
        )}
      </button>
      {open && (
        <NotesModal
          venueId={venueId}
          customerId={customerId}
          initialNotes={loaded ? notes : null}
          onClose={() => setOpen(false)}
          onChanged={reload}
        />
      )}
    </>
  );
}

function NotesModal({
  venueId,
  customerId,
  initialNotes,
  onClose,
  onChanged,
}: {
  venueId:      string;
  customerId:   string;
  initialNotes: ContactNote[] | null;
  onClose:      () => void;
  onChanged:    () => void;
}) {
  const [notes, setNotes] = useState<ContactNote[]>(initialNotes ?? []);
  const [loading, setLoading] = useState(initialNotes === null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/support/contact/${venueId}/${customerId}/notes`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({} as { error?: string; notes?: ContactNote[] }));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setNotes(d.notes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [venueId, customerId]);

  useEffect(() => {
    if (initialNotes === null) void fetchNotes();
  }, [fetchNotes, initialNotes]);

  const addNote = useCallback(async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/support/contact/${venueId}/${customerId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const d = await r.json().catch(() => ({} as { error?: string; note?: ContactNote }));
      if (!r.ok || !d.note) throw new Error(d.error || `Failed (${r.status})`);
      setNotes(prev => [d.note as ContactNote, ...prev]);
      setDraft('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }, [draft, venueId, customerId, onChanged]);

  const removeNote = useCallback(async (noteId: string) => {
    if (!confirm('Delete this note? It will also disappear from the venue\'s contact profile.')) return;
    try {
      const r = await fetch(`/api/admin/support/contact/${venueId}/${customerId}/notes?noteId=${encodeURIComponent(noteId)}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      setNotes(prev => prev.filter(n => n.id !== noteId));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete note');
    }
  }, [venueId, customerId, onChanged]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[80vh] flex flex-col rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <StickyNote size={16} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-900">Contact notes</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/40">
          <p className="text-[11px] text-amber-900">
            Notes are shared with the venue&apos;s contact profile — anything saved here also appears in their subaccount.
          </p>
        </div>

        <div className="px-4 py-3 border-b border-gray-100">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a note about this contact…"
            rows={3}
            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            disabled={saving}
          />
          <div className="mt-2 flex items-center justify-between">
            {error ? (
              <span className="text-[10px] text-red-600">{error}</span>
            ) : <span />}
            <button
              type="button"
              onClick={addNote}
              disabled={saving || !draft.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              {saving ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-6 text-gray-400">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}
          {!loading && notes.length === 0 && (
            <p className="py-6 text-center text-xs text-gray-400">No notes yet — add the first one above.</p>
          )}
          {notes.map(note => (
            <div key={note.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
              <p className="text-xs text-gray-800 whitespace-pre-wrap break-words">{note.content}</p>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-400">
                <span>
                  {note.author_name ? `${note.author_name} · ` : ''}{relativeTime(note.created_at)}
                </span>
                <button
                  type="button"
                  onClick={() => removeNote(note.id)}
                  className="rounded p-0.5 hover:bg-red-50 hover:text-red-600"
                  title="Delete note"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Calendar ───────────────────────────────────────────────────────────────
//
// Booking is delegated to the shared <EventEditorModal> in act-as-venue mode
// (see CalendarButton below). The thin admin endpoint
// /api/admin/support/contact/[venueId]/[customerId]/calendar is still used
// to fetch upcoming events for the badge count — the modal itself talks
// directly to the venue's /api/calendar through the X-Acting-As-Venue header.

interface ContactEvent {
  id:               string;
  title:            string;
  start_at:         string;
  end_at:           string;
  all_day:          boolean;
  status:           string;
  notes:            string | null;
  calendar_id:      string | null;
  google_html_link: string | null;
  customer_email:   string | null;
}


/**
 * CalendarButton — booking entry point for super-admin support agents.
 *
 * The button itself shows an upcoming-event count badge (powered by the
 * thin /api/admin/support/contact/.../calendar endpoint) and, when clicked,
 * opens the venue's own EventEditorModal in act-as-venue mode. We reuse the
 * full venue modal — same form, same availability slots, same Google
 * Calendar push — so a support agent never has to log in as the venue to
 * book on their behalf.
 */
function CalendarButton({
  venueId,
  customerId,
  contactName,
  contactEmail,
  venueTimezone,
}: {
  venueId:        string;
  customerId:     string;
  contactName:    string;
  contactEmail:   string | null;
  venueTimezone?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/support/contact/${venueId}/${customerId}/calendar`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json() as { events: ContactEvent[] };
      const now = Date.now();
      const upcoming = (d.events ?? []).filter(e => new Date(e.start_at).getTime() >= now).length;
      setCount(upcoming);
    } catch { /* ignore */ }
  }, [venueId, customerId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch(`/api/admin/support/contact/${venueId}/${customerId}/calendar`, { cache: 'no-store' }).catch(() => null);
      if (!r || !r.ok || cancelled) return;
      const d = await r.json().catch(() => null) as { events?: ContactEvent[] } | null;
      if (cancelled || !d) return;
      const now = Date.now();
      const upcoming = (d.events ?? []).filter(e => new Date(e.start_at).getTime() >= now).length;
      setCount(upcoming);
    })();
    return () => { cancelled = true; };
  }, [venueId, customerId]);

  const n = count ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={n > 0 ? `${n} upcoming event${n === 1 ? '' : 's'} — view & book` : 'View calendar / book event'}
        className="relative inline-flex items-center justify-center rounded-lg p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
      >
        <CalendarPlus size={14} />
        {n > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white leading-none">
            {n > 9 ? '9+' : n}
          </span>
        )}
      </button>
      <EventEditorModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          // Refresh the upcoming-event count and close. The modal itself wrote
          // the event into the venue's calendar via the act-as-venue header,
          // so there's nothing else for us to do here.
          void refreshCount();
          setOpen(false);
        }}
        actingAsVenueId={venueId}
        venueTimezone={venueTimezone ?? undefined}
        prefill={{
          customerEmail: contactEmail ?? undefined,
          customerName: contactName,
          title: contactName ? `Appointment — ${contactName}` : undefined,
        }}
      />
    </>
  );
}

