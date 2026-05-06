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
import {
  Loader2, AlertCircle, User, Building2, Mail, Phone, ShieldCheck, ShieldAlert,
  Sparkles, CircleDot, AlertTriangle, Calendar, Clock, Tag,
  Activity, Inbox, BellOff, RefreshCw, ExternalLink, ChevronDown, X, Plus, CheckCircle2,
} from 'lucide-react';
import { SlaPill } from '@/components/support/SlaIndicator';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type StageChangedEvent } from '@/lib/realtime/channels';

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
    ai_concierge_enabled: boolean;
    ai_persona:         string | null;
    open_tickets_count: number;
    concierge_notify_emails: string[];
  } | null;
  recent_activity: Array<{ action: string; at: string; details: unknown }>;
  lead_id: string | null;
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

  // Live stage updates from the venue side — update inline without a full refetch
  useBroadcastChannel(
    threadId ? supportChannels.brideThread(threadId) : null,
    ['stage_changed'],
    useCallback((_evt, payload) => {
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
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Context</h3>
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
                disabled={!data.lead_id || actionPending}
                onSelect={(stageId, stageName) =>
                  runAction(
                    { action: 'set_stage', stageId },
                    undefined,
                    `Stage → ${stageName}`,
                  )
                }
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

            {/* Tags */}
            <TagsRow
              allTags={data.tags}
              appliedTagIds={data.applied_tag_ids}
              disabled={!data.lead_id || actionPending}
              onAdd={(tagId, tagName) =>
                runAction(
                  { action: 'add_tag', tagId },
                  undefined,
                  `Tagged · ${tagName}`,
                )
              }
              onRemove={(tagId) =>
                runAction(
                  { action: 'remove_tag', tagId },
                  undefined,
                  'Tag removed',
                )
              }
            />

            {/* AI quick-actions */}
            {data.ai && (
              <AiActionRow
                ai={data.ai}
                disabled={!data.lead_id || actionPending}
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
 * Renders applied tag chips with "x" buttons + a "+ Add tag" affordance that
 * opens a dropdown of available tags.
 */
function TagsRow({
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
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, ContextResponse['tags'][number]>();
    for (const t of allTags) m.set(t.id, t);
    return m;
  }, [allTags]);

  const remaining = useMemo(() => {
    const set = new Set(appliedTagIds);
    return allTags.filter(t => !set.has(t.id));
  }, [allTags, appliedTagIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return remaining;
    return remaining.filter(t => t.name.toLowerCase().includes(q));
  }, [remaining, query]);

  if (allTags.length === 0 && appliedTagIds.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5" ref={wrapRef}>
      {appliedTagIds.map(id => {
        const t = byId.get(id);
        if (!t) return null;
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full border bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-800"
            style={{ borderColor: t.color || '#e5e7eb' }}
            title={t.name}
          >
            <span aria-hidden="true">{t.icon}</span> {t.name}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(id)}
              className="-mr-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-50"
              aria-label={`Remove tag ${t.name}`}
            >
              <X size={9} />
            </button>
          </span>
        );
      })}
      <div className="relative">
        <button
          type="button"
          disabled={disabled || remaining.length === 0}
          onClick={() => setOpen(v => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-50"
          title={remaining.length === 0 ? 'No more tags to add' : 'Add tag'}
        >
          <Plus size={9} /> Tag
        </button>
        {open && (
          <div className="absolute z-20 mt-1 left-0 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search tags…"
                className="w-full text-[11px] px-2 py-1 outline-none"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-[10px] text-gray-400">
                  {remaining.length === 0 ? 'All tags applied.' : 'No matches.'}
                </p>
              )}
              {filtered.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setOpen(false); setQuery(''); onAdd(t.id, t.name); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-gray-50"
                >
                  <span aria-hidden="true">{t.icon}</span>
                  <span className="font-medium text-gray-800">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AiActionRow({
  ai,
  disabled,
  onPause,
  onReEnable,
}: {
  ai: NonNullable<ContextResponse['ai']>;
  disabled: boolean;
  onPause:    () => void;
  onReEnable: () => void;
}) {
  const canPause = ai.state === 'ai_active';
  const canReEnable = ['paused', 'handoff', 'opted_out', 'exhausted'].includes(ai.state);
  if (!canPause && !canReEnable) return null;

  return (
    <div className="flex items-center gap-1 pt-0.5">
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
          title="Reset state to dormant; activation cron picks up after 24h cooldown"
        >
          <Sparkles size={9} /> Re-enable AI
        </button>
      )}
    </div>
  );
}
