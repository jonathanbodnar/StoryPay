'use client';

/**
 * Super-admin Support Inbox panel.
 *
 * Two streams in one workspace:
 *   1. Bride replies — every conversation thread (across all venues) where
 *      the latest external message is from the bride and nobody has answered.
 *      Replies are sent on behalf of the venue (recorded with sender_kind
 *      'concierge' + the support agent's id).
 *   2. Venue owner support tickets — separate threads opened by venues for
 *      help. (Wired in step 5; tab is a placeholder for now.)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Inbox, LifeBuoy, Search, RefreshCw, Send, MessageSquare,
  Mail, MessageCircle, Building2, Loader2, AlertCircle, CheckCircle2,
  StickyNote, ShieldCheck,
} from 'lucide-react';

const BRAND = '#1b1b1b';

type SupportSubTab = 'bride-replies' | 'tickets';

interface BrideInboxRow {
  thread_id:               string;
  venue_id:                string;
  venue_name:              string;
  venue_customer_id:       string;
  contact_first_name:      string | null;
  contact_last_name:       string | null;
  contact_email:           string | null;
  contact_phone:           string | null;
  subject:                 string;
  last_message_at:         string;
  last_message_preview:    string | null;
  last_inbound_channel:    'sms' | 'email';
  last_inbound_body:       string;
  last_inbound_created_at: string;
  message_count:           number;
}

interface ThreadMessage {
  id:                       string;
  thread_id:                string;
  visibility:               'internal' | 'external';
  channel:                  'sms' | 'email';
  body:                     string;
  sender_kind:              'owner' | 'team' | 'contact' | 'system' | 'ai' | 'concierge';
  venue_team_member_id:     string | null;
  contact_from_name:        string | null;
  contact_from_email:       string | null;
  external_email_sent:      boolean | null;
  send_error:               string | null;
  sent_by_support_user_id:  string | null;
  sent_on_behalf_of_venue:  boolean | null;
  support_internal_note:    string | null;
  created_at:               string;
}

interface ThreadDetail {
  thread: {
    id: string; venue_id: string; venue_customer_id: string;
    subject: string; last_message_at: string;
    last_message_preview: string | null;
    external_reply_channel: string | null;
  };
  venue: { id: string; name: string; notification_email: string | null; timezone: string | null } | null;
  customer: {
    id: string; customer_email: string | null;
    first_name: string | null; last_name: string | null; phone: string | null;
  } | null;
  lead: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; status: string | null } | null;
  messages: ThreadMessage[];
  supportUsers: Record<string, { id: string; name: string; email: string }>;
}

interface SupportMe {
  authed: boolean;
  superAdmin: boolean;
  member: { id: string; email: string; name: string; role: 'support_agent' | 'support_admin' } | null;
}

interface SupportTeamMember {
  id: string;
  email: string;
  name: string;
  role: 'support_agent' | 'support_admin';
  active: boolean;
}

function relativeTime(iso: string): string {
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

function fullName(first: string | null, last: string | null, fallback = 'Unknown'): string {
  return [first, last].filter(Boolean).join(' ').trim() || fallback;
}

export function SupportInboxPanel() {
  const [subTab, setSubTab] = useState<SupportSubTab>('bride-replies');

  // ── Identity ───────────────────────────────────────────────────────────────
  const [me, setMe] = useState<SupportMe | null>(null);
  const [teamMembers, setTeamMembers] = useState<SupportTeamMember[]>([]);
  const [actAsId, setActAsId] = useState<string>('');

  const loadMe = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/support/me', { cache: 'no-store' });
      if (r.ok) {
        const d = (await r.json()) as SupportMe;
        setMe(d);
        if (d.member?.id) setActAsId(d.member.id);
      }
    } catch { /* ignore */ }
  }, []);

  const loadTeamMembers = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/support-team-members', { cache: 'no-store' });
      if (r.ok) {
        const d = (await r.json()) as { members: SupportTeamMember[] };
        setTeamMembers(d.members || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadMe();
    loadTeamMembers();
  }, [loadMe, loadTeamMembers]);

  // Persist actAsId for super-admin sessions across reloads
  useEffect(() => {
    if (!me) return;
    if (me.member?.id) return; // agent identity is fixed
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('support_act_as_id') : '';
    if (stored && teamMembers.some(m => m.id === stored && m.active)) {
      setActAsId(stored);
    } else if (!actAsId && teamMembers.length > 0) {
      const firstActive = teamMembers.find(m => m.active);
      if (firstActive) setActAsId(firstActive.id);
    }
  }, [me, teamMembers, actAsId]);

  function chooseActAs(id: string) {
    setActAsId(id);
    try { window.localStorage.setItem('support_act_as_id', id); } catch { /* ignore */ }
  }

  // ── Bride inbox state ──────────────────────────────────────────────────────
  const [threads, setThreads] = useState<BrideInboxRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const fetchInbox = useCallback(async (opts: { append?: boolean; cursor?: string | null } = {}) => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (committedSearch) params.set('search', committedSearch);
      if (opts.cursor) params.set('cursor', opts.cursor);
      params.set('limit', '50');
      const r = await fetch(`/api/admin/support/bride-inbox?${params.toString()}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as { threads: BrideInboxRow[]; nextCursor: string | null };
      setNextCursor(d.nextCursor);
      setThreads(prev => (opts.append ? [...prev, ...d.threads] : d.threads));
      if (!opts.append && d.threads.length > 0 && !activeThreadId) {
        setActiveThreadId(d.threads[0].thread_id);
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load inbox');
    } finally {
      setListLoading(false);
    }
  }, [committedSearch, activeThreadId]);

  useEffect(() => {
    if (subTab === 'bride-replies') fetchInbox();
  }, [subTab, fetchInbox]);

  function submitSearch() {
    setCommittedSearch(search.trim());
    setActiveThreadId(null);
    setThreads([]);
    setNextCursor(null);
  }

  // ── Active thread state ────────────────────────────────────────────────────
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadDetail = useCallback(async (threadId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const r = await fetch(`/api/admin/support/bride-thread/${threadId}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as ThreadDetail;
      setDetail(d);
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end' });
      });
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load thread');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeThreadId) loadDetail(activeThreadId);
    else setDetail(null);
  }, [activeThreadId, loadDetail]);

  // ── Reply box ──────────────────────────────────────────────────────────────
  const [replyBody, setReplyBody] = useState('');
  const [replyChannel, setReplyChannel] = useState<'auto' | 'sms' | 'email'>('auto');
  const [internalNote, setInternalNote] = useState('');
  const [showInternalNote, setShowInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setReplyBody('');
    setReplyChannel('auto');
    setInternalNote('');
    setShowInternalNote(false);
    setSendStatus(null);
  }, [activeThreadId]);

  const lastInboundChannel = useMemo<'sms' | 'email'>(() => {
    if (!detail) return 'sms';
    for (let i = detail.messages.length - 1; i >= 0; i--) {
      const m = detail.messages[i];
      if (m.sender_kind === 'contact' && m.visibility === 'external') return m.channel;
    }
    const ext = detail.thread.external_reply_channel;
    if (ext === 'sms' || ext === 'email') return ext;
    return 'sms';
  }, [detail]);

  const effectiveChannel: 'sms' | 'email' = replyChannel === 'auto' ? lastInboundChannel : replyChannel;

  const canSend = useMemo(() => {
    if (!detail || !replyBody.trim() || sending) return false;
    if (me?.member?.id) return true;
    return Boolean(actAsId);
  }, [detail, replyBody, sending, me, actAsId]);

  async function send() {
    if (!detail || !canSend) return;
    setSending(true);
    setSendStatus(null);
    try {
      const r = await fetch('/api/admin/support/bride-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId:      detail.thread.id,
          body:          replyBody.trim(),
          channel:       replyChannel === 'auto' ? undefined : replyChannel,
          internalNote:  internalNote.trim() || undefined,
          supportUserId: me?.member?.id ? undefined : actAsId,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Send failed (${r.status})`);
      setSendStatus({ ok: true, msg: `Sent via ${d.channel}` });
      setReplyBody('');
      setInternalNote('');
      setShowInternalNote(false);
      await loadDetail(detail.thread.id);
      // Remove this thread from the inbox (it's no longer "needs attention")
      setThreads(prev => prev.filter(t => t.thread_id !== detail.thread.id));
      // Pick a neighbour as the new active thread
      setThreads(prev => {
        if (prev.length === 0) setActiveThreadId(null);
        return prev;
      });
    } catch (e) {
      setSendStatus({ ok: false, msg: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setSending(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl text-gray-900">Support inbox</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Bride replies + venue support tickets, in one place.
          </p>
        </div>
        <IdentityPicker
          me={me}
          teamMembers={teamMembers}
          actAsId={actAsId}
          onChange={chooseActAs}
        />
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <SubTabButton
          active={subTab === 'bride-replies'}
          onClick={() => setSubTab('bride-replies')}
          icon={<Inbox size={14} />}
          label="Bride replies"
          count={threads.length}
        />
        <SubTabButton
          active={subTab === 'tickets'}
          onClick={() => setSubTab('tickets')}
          icon={<LifeBuoy size={14} />}
          label="Venue support"
        />
      </div>

      {subTab === 'tickets' && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
          <LifeBuoy className="mx-auto mb-3 text-gray-400" size={28} />
          <p className="text-sm font-medium text-gray-700">Venue support tickets coming soon</p>
          <p className="text-xs text-gray-500 mt-1">
            This tab is wired up in the next step — it will list help requests opened by venue owners.
          </p>
        </div>
      )}

      {subTab === 'bride-replies' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 min-h-[600px]">
          {/* Thread list */}
          <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0">
            <div className="p-3 border-b border-gray-200 space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }}
                  placeholder="Search venue, contact, message..."
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300 outline-none"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{threads.length} thread{threads.length === 1 ? '' : 's'} need attention</span>
                <button
                  type="button"
                  onClick={() => fetchInbox()}
                  className="flex items-center gap-1 hover:text-gray-800"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {listLoading && threads.length === 0 && (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              )}
              {listError && (
                <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={12} className="inline mr-1" /> {listError}
                </div>
              )}
              {!listLoading && !listError && threads.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-gray-400">
                  <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-400" />
                  Inbox zero. No bride replies waiting.
                </div>
              )}
              {threads.map(t => (
                <button
                  key={t.thread_id}
                  type="button"
                  onClick={() => setActiveThreadId(t.thread_id)}
                  className={`w-full text-left px-3 py-3 border-b border-gray-100 last:border-b-0 transition-colors ${
                    activeThreadId === t.thread_id ? 'bg-gray-50' : 'hover:bg-gray-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {fullName(t.contact_first_name, t.contact_last_name, t.contact_email || 'Unknown bride')}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Building2 size={11} className="text-gray-400 shrink-0" />
                        <span className="text-[11px] text-gray-500 truncate">{t.venue_name}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-1">
                      <span className="text-[10px] text-gray-400">{relativeTime(t.last_inbound_created_at)}</span>
                      <ChannelChip channel={t.last_inbound_channel} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                    {t.last_inbound_body || t.last_message_preview}
                  </p>
                </button>
              ))}
              {nextCursor && (
                <div className="p-3">
                  <button
                    type="button"
                    onClick={() => fetchInbox({ append: true, cursor: nextCursor })}
                    disabled={listLoading}
                    className="w-full text-xs font-medium text-gray-600 hover:text-gray-900 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {listLoading ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Thread detail */}
          <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0">
            {!activeThreadId && (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm py-16">
                <MessageSquare size={28} className="mb-2" />
                Select a conversation to start replying.
              </div>
            )}
            {activeThreadId && detailLoading && !detail && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            )}
            {detailError && (
              <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle size={12} className="inline mr-1" /> {detailError}
              </div>
            )}
            {detail && (
              <ThreadDetailView
                detail={detail}
                replyBody={replyBody}
                onReplyBodyChange={setReplyBody}
                replyChannel={replyChannel}
                onReplyChannelChange={setReplyChannel}
                effectiveChannel={effectiveChannel}
                lastInboundChannel={lastInboundChannel}
                internalNote={internalNote}
                onInternalNoteChange={setInternalNote}
                showInternalNote={showInternalNote}
                onToggleInternalNote={() => setShowInternalNote(v => !v)}
                canSend={canSend}
                sending={sending}
                onSend={send}
                sendStatus={sendStatus}
                actAsName={
                  me?.member?.name ||
                  teamMembers.find(m => m.id === actAsId)?.name ||
                  null
                }
                noActorWarning={!me?.member?.id && !actAsId}
                messagesEndRef={messagesEndRef}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SubTabButton({
  active, onClick, icon, label, count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-gray-900 text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}
    >
      {icon}
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-gray-900 text-white text-[10px] font-semibold tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function ChannelChip({ channel }: { channel: 'sms' | 'email' }) {
  if (channel === 'sms') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase">
        <MessageCircle size={9} /> SMS
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase">
      <Mail size={9} /> Email
    </span>
  );
}

function IdentityPicker({
  me, teamMembers, actAsId, onChange,
}: {
  me: SupportMe | null;
  teamMembers: SupportTeamMember[];
  actAsId: string;
  onChange: (id: string) => void;
}) {
  if (!me) return null;
  if (me.member?.id) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
        <ShieldCheck size={14} className="text-emerald-600" />
        <span>
          Acting as <span className="font-semibold text-gray-900">{me.member.name}</span>
          <span className="ml-1 text-gray-400">({me.member.role})</span>
        </span>
      </div>
    );
  }

  if (teamMembers.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <AlertCircle size={14} />
        <span>No support team members yet — add one to send replies.</span>
      </div>
    );
  }

  return (
    <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
      <ShieldCheck size={14} className="text-gray-500" />
      Reply as
      <select
        value={actAsId}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent outline-none font-semibold text-gray-900 cursor-pointer"
      >
        {!actAsId && <option value="">Select identity…</option>}
        {teamMembers.filter(m => m.active).map(m => (
          <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
        ))}
      </select>
    </label>
  );
}

function ThreadDetailView({
  detail,
  replyBody, onReplyBodyChange,
  replyChannel, onReplyChannelChange,
  effectiveChannel, lastInboundChannel,
  internalNote, onInternalNoteChange,
  showInternalNote, onToggleInternalNote,
  canSend, sending, onSend, sendStatus,
  actAsName, noActorWarning,
  messagesEndRef,
}: {
  detail: ThreadDetail;
  replyBody: string; onReplyBodyChange: (v: string) => void;
  replyChannel: 'auto' | 'sms' | 'email';
  onReplyChannelChange: (v: 'auto' | 'sms' | 'email') => void;
  effectiveChannel: 'sms' | 'email';
  lastInboundChannel: 'sms' | 'email';
  internalNote: string; onInternalNoteChange: (v: string) => void;
  showInternalNote: boolean; onToggleInternalNote: () => void;
  canSend: boolean; sending: boolean;
  onSend: () => void;
  sendStatus: { ok: boolean; msg: string } | null;
  actAsName: string | null;
  noActorWarning: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const contactName = fullName(
    detail.customer?.first_name ?? null,
    detail.customer?.last_name ?? null,
    detail.customer?.customer_email || 'Unknown bride',
  );

  return (
    <>
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{contactName}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-gray-500">
            {detail.venue && (
              <span className="inline-flex items-center gap-1">
                <Building2 size={11} className="text-gray-400" /> {detail.venue.name}
              </span>
            )}
            {detail.customer?.customer_email && <span>{detail.customer.customer_email}</span>}
            {detail.customer?.phone && <span>{detail.customer.phone}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          {detail.lead?.status && (
            <span className="inline-block rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {detail.lead.status}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50/30 px-4 py-4 space-y-3">
        {detail.messages.length === 0 && (
          <p className="text-center text-xs text-gray-400 py-8">No messages yet.</p>
        )}
        {detail.messages.map(m => (
          <MessageBubble
            key={m.id}
            msg={m}
            supportName={
              m.sent_by_support_user_id
                ? detail.supportUsers[m.sent_by_support_user_id]?.name || 'Support'
                : null
            }
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box */}
      <div className="border-t border-gray-200 bg-white p-3 space-y-2">
        {noActorWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
            <AlertCircle size={12} /> Pick a support identity above before sending.
          </div>
        )}
        {sendStatus && (
          <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${
            sendStatus.ok
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}>
            {sendStatus.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {sendStatus.msg}
          </div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span>Reply via</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['auto', 'sms', 'email'] as const).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => onReplyChannelChange(opt)}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  replyChannel === opt ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt === 'auto' ? `Auto (${lastInboundChannel.toUpperCase()})` : opt.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="text-gray-400">→ will send as <span className="font-semibold text-gray-700">{effectiveChannel.toUpperCase()}</span></span>
          <button
            type="button"
            onClick={onToggleInternalNote}
            className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              showInternalNote ? 'bg-amber-100 text-amber-800' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            <StickyNote size={11} /> Internal note
          </button>
        </div>

        {showInternalNote && (
          <textarea
            value={internalNote}
            onChange={e => onInternalNoteChange(e.target.value)}
            placeholder="Internal note (only visible to your team — saved on the message row)"
            rows={2}
            className="w-full text-sm border border-amber-200 bg-amber-50/40 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300"
          />
        )}

        <textarea
          value={replyBody}
          onChange={e => onReplyBodyChange(e.target.value)}
          placeholder={`Reply on behalf of ${detail.venue?.name || 'the venue'}…`}
          rows={3}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300"
        />

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-500">
            {actAsName
              ? <>Sending as <span className="font-semibold text-gray-700">{actAsName}</span> on behalf of <span className="font-semibold text-gray-700">{detail.venue?.name || 'venue'}</span></>
              : 'Pick an identity to send.'}
          </p>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: BRAND }}
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {sending ? 'Sending…' : `Send ${effectiveChannel.toUpperCase()}`}
          </button>
        </div>
      </div>
    </>
  );
}

function MessageBubble({
  msg,
  supportName,
}: {
  msg: ThreadMessage;
  supportName: string | null;
}) {
  const isInbound = msg.sender_kind === 'contact';
  const isInternal = msg.visibility === 'internal';
  const isAi = msg.sender_kind === 'ai';
  const isConcierge = msg.sender_kind === 'concierge' || msg.sent_on_behalf_of_venue;

  const bubbleSide = isInbound ? 'justify-start' : 'justify-end';

  let label = 'Venue';
  if (isInbound) label = msg.contact_from_name || 'Bride';
  else if (msg.sender_kind === 'system') label = 'System';
  else if (isAi) label = 'AI Concierge';
  else if (isConcierge) label = `StoryVenue Support${supportName ? ` — ${supportName}` : ''}`;
  else if (msg.sender_kind === 'team') label = 'Team member';
  else if (msg.sender_kind === 'owner') label = 'Owner';

  const bubbleClass = (() => {
    if (isInternal) return 'bg-amber-50 border border-amber-200 text-amber-900';
    if (isInbound) return 'bg-white border border-gray-200 text-gray-900';
    if (isAi) return 'bg-purple-50 border border-purple-200 text-purple-900';
    if (isConcierge) return 'bg-emerald-50 border border-emerald-300 text-emerald-900';
    return 'bg-gray-900 text-white';
  })();

  return (
    <div className={`flex ${bubbleSide}`}>
      <div className="max-w-[75%] space-y-1">
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span className="font-semibold">{label}</span>
          {isConcierge && (
            <span className="rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase">
              Sent by Support
            </span>
          )}
          <ChannelChip channel={msg.channel} />
          {isInternal && (
            <span className="rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase">
              Internal
            </span>
          )}
          <span className="text-gray-400">{relativeTime(msg.created_at)}</span>
        </div>
        <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${bubbleClass}`}>
          {msg.body}
        </div>
        {msg.support_internal_note && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-800">
            <StickyNote size={10} className="inline mr-1" />
            <span className="font-semibold">Note:</span> {msg.support_internal_note}
          </div>
        )}
        {msg.send_error && (
          <p className="text-[10px] text-red-600">⚠ {msg.send_error}</p>
        )}
      </div>
    </div>
  );
}

export default SupportInboxPanel;
