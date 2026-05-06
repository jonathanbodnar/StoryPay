'use client';

/**
 * SupportPanel — venue-side support UX rendered inside the Ask AI widget.
 *
 * Three views:
 *   1. List   — venue's recent support tickets (open + closed sections)
 *   2. New    — compact form to open a new ticket (subject + body + priority)
 *   3. Detail — message history + venue reply box (or read-only when closed)
 *
 * Mounted at fixed widget width (~360px), so all UI is dense and stack-friendly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, ArrowLeft, RefreshCw, Send, Loader2, AlertCircle,
  CheckCircle2, AlertTriangle, ShieldCheck, X,
} from 'lucide-react';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type TicketMessageEvent, type TicketStatusEvent } from '@/lib/realtime/channels';
import { SlaDot, SlaPill } from '@/components/support/SlaIndicator';

const BRAND = '#1b1b1b';

type Priority = 'low' | 'normal' | 'high';
type TicketStatus = 'open' | 'pending' | 'closed';

interface TicketListRow {
  id:                       string;
  subject:                  string;
  status:                   TicketStatus;
  priority:                 Priority;
  last_message_at:          string;
  last_message_preview:     string | null;
  last_sender_type:         'venue' | 'support';
  created_at:               string;
  assigned_support_user_id: string | null;
}

const READS_KEY = 'support_ticket_reads';
export function getReads(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(READS_KEY) || '{}'); } catch { return {}; }
}
export function markRead(ticketId: string) {
  try {
    const reads = getReads();
    reads[ticketId] = new Date().toISOString();
    localStorage.setItem(READS_KEY, JSON.stringify(reads));
  } catch { /* ignore */ }
}
export interface UnreadableTicket { id: string; last_message_at: string; last_sender_type: 'venue' | 'support' }
export function countUnreadFromList(tickets: UnreadableTicket[]): number {
  const reads = getReads();
  return tickets.filter(t => {
    if (t.last_sender_type !== 'support') return false;
    const lastRead = reads[t.id];
    if (!lastRead) return true;
    return t.last_message_at > lastRead;
  }).length;
}
function countUnread(tickets: TicketListRow[]): number {
  return countUnreadFromList(tickets);
}

interface TicketMessage {
  id:                     string;
  sender_type:            'venue' | 'support';
  sender_profile_id:      string | null;
  sender_member_id:       string | null;
  sender_support_user_id: string | null;
  body:                   string;
  attachments:            unknown;
  created_at:             string;
}

interface TicketDetail {
  ticket: TicketListRow;
  messages: TicketMessage[];
  senders: {
    support: Record<string, string>;
    members: Record<string, string>;
  };
}

type View = 'list' | 'new' | 'detail';

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusPill({ status }: { status: TicketStatus }) {
  const cfg = {
    open:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    closed:  'bg-gray-100 text-gray-500 border-gray-200',
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cfg[status]}`}>
      {status}
    </span>
  );
}

function PriorityChip({ priority }: { priority: Priority }) {
  if (priority === 'high') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 text-red-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
        <AlertTriangle size={9} /> High
      </span>
    );
  }
  return null;
}

export function SupportPanel({ onClose, onUnreadCount }: { onClose?: () => void; onUnreadCount?: (n: number) => void }) {
  const [view, setView] = useState<View>('list');
  const [activeId, setActiveId] = useState<string | null>(null);

  // List
  const [tickets, setTickets] = useState<TicketListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const r = await fetch('/api/dashboard/support-tickets', { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as { tickets: TicketListRow[]; venueId?: string };
      const list = d.tickets || [];
      setTickets(list);
      if (d.venueId) setVenueId(d.venueId);
      onUnreadCount?.(countUnread(list));
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load tickets');
    } finally {
      setListLoading(false);
    }
  }, [onUnreadCount]);

  useEffect(() => {
    if (view === 'list') loadList();
  }, [view, loadList]);

  // Detail
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    // Mark as read immediately when venue opens the ticket
    markRead(id);
    setTickets(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, last_sender_type: 'venue' as const } : t);
      onUnreadCount?.(countUnread(updated));
      return updated;
    });
    try {
      const r = await fetch(`/api/dashboard/support-tickets/${id}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as TicketDetail;
      setDetail(d);
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end' });
      });
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load ticket');
    } finally {
      setDetailLoading(false);
    }
  }, [onUnreadCount]);

  useEffect(() => {
    if (view === 'detail' && activeId) loadDetail(activeId);
  }, [view, activeId, loadDetail]);

  // ── Realtime: ticket list (venue scope) ──────────────────────────────────
  useBroadcastChannel(
    venueId ? supportChannels.venueTickets(venueId) : null,
    ['message', 'status'],
    useCallback((evt, payload) => {
      if (evt === 'message') {
        const m = payload as TicketMessageEvent;
        if (!m) return;
        setTickets(prev => {
          const idx = prev.findIndex(t => t.id === m.ticketId);
          if (idx === -1) {
            // Brand-new ticket (or one we hadn't loaded yet) — refetch.
            // Skip refetch if we just opened it from the new-ticket form, since
            // POST already returned and we navigated to detail.
            void loadList();
            return prev;
          }
          const updated: TicketListRow = {
            ...prev[idx],
            status:               m.status,
            last_message_at:      m.createdAt,
            last_message_preview: m.body.slice(0, 200),
            last_sender_type:     m.senderType === 'support' ? 'support' : 'venue',
          };
          const next = [updated, ...prev.filter((_, i) => i !== idx)];
          onUnreadCount?.(countUnread(next));
          return next;
        });
      } else if (evt === 'status') {
        const s = payload as TicketStatusEvent;
        if (!s) return;
        setTickets(prev => prev.map(t => t.id === s.ticketId ? {
          ...t,
          status:                  s.status,
          priority:                s.priority,
          assigned_support_user_id: s.assignedSupportUserId,
        } : t));
      }
    }, [loadList]),
  );

  // ── Realtime: active ticket detail ───────────────────────────────────────
  // Subscribe whenever venueId + activeId are set (even if temporarily on list view)
  // so the detail updates live without needing to remount the subscription.
  useBroadcastChannel(
    venueId && activeId ? supportChannels.venueTicket(venueId, activeId) : null,
    ['message', 'status'],
    useCallback((evt, payload) => {
      if (evt === 'message') {
        const m = payload as TicketMessageEvent;
        if (!m) return;
        setDetail(prev => {
          if (!prev || prev.ticket.id !== m.ticketId) return prev;
          if (prev.messages.some(x => x.id === m.messageId)) return prev;
          const newMsg: TicketMessage = {
            id:                     m.messageId,
            sender_type:            m.senderType,
            sender_profile_id:      null,
            sender_member_id:       null,
            sender_support_user_id: null,
            body:                   m.body,
            attachments:            [],
            created_at:             m.createdAt,
          };
          // Venue is actively viewing — mark as read immediately
          if (m.senderType === 'support') markRead(m.ticketId);
          return {
            ...prev,
            ticket: { ...prev.ticket, status: m.status, last_message_at: m.createdAt, last_message_preview: m.body.slice(0, 200) },
            messages: [...prev.messages, newMsg],
          };
        });
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ block: 'end' });
        });
      } else if (evt === 'status') {
        const s = payload as TicketStatusEvent;
        if (!s) return;
        setDetail(prev => prev && prev.ticket.id === s.ticketId
          ? { ...prev, ticket: { ...prev.ticket, status: s.status, priority: s.priority, assigned_support_user_id: s.assignedSupportUserId } }
          : prev,
        );
      }
    }, []),
  );

  // Reply
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  useEffect(() => {
    setReplyBody('');
    setReplyError(null);
  }, [activeId]);

  async function sendReply() {
    if (!detail || !replyBody.trim() || replying) return;
    setReplying(true);
    setReplyError(null);
    try {
      const r = await fetch(`/api/dashboard/support-tickets/${detail.ticket.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Send failed');
      setReplyBody('');
      await loadDetail(detail.ticket.id);
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setReplying(false);
    }
  }

  // Create ticket
  const [newSubject, setNewSubject]   = useState('');
  const [newBody, setNewBody]         = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('normal');
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function createTicket() {
    if (!newBody.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch('/api/dashboard/support-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject:  newSubject.trim() || 'Support request',
          body:     newBody.trim(),
          priority: newPriority,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed to open ticket');
      setNewSubject('');
      setNewBody('');
      setNewPriority('normal');
      // Open the new ticket in detail view
      const id = (d.ticket as { id: string } | undefined)?.id;
      if (id) {
        setActiveId(id);
        setView('detail');
      } else {
        setView('list');
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to open ticket');
    } finally {
      setCreating(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Subheader */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
        {view === 'list' ? (
          <>
            <p className="text-xs font-semibold text-gray-700">Your support tickets</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={loadList}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={13} />
              </button>
              <button
                type="button"
                onClick={() => setView('new')}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: BRAND }}
              >
                <Plus size={12} /> New
              </button>
            </div>
          </>
        ) : view === 'new' ? (
          <>
            <button
              type="button"
              onClick={() => setView('list')}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={12} /> Back
            </button>
            <p className="text-xs font-semibold text-gray-700">New support ticket</p>
            <span className="w-12" />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setView('list'); setActiveId(null); setDetail(null); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={12} /> Back
            </button>
            {detail && <StatusPill status={detail.ticket.status} />}
            {!detail && <span className="w-12" />}
          </>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-y-auto bg-gray-50/40 min-h-0">
        {view === 'list' && (
          <>
            {listLoading && tickets.length === 0 && (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            {listError && (
              <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle size={11} className="inline mr-1" /> {listError}
              </div>
            )}
            {!listLoading && !listError && tickets.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-gray-500">
                <ShieldCheck size={22} className="mx-auto mb-2 text-emerald-400" />
                <p className="font-medium text-gray-700 mb-1">No tickets yet</p>
                <p className="leading-relaxed">
                  Open a ticket and our support team will reply by email and here in this widget.
                </p>
                <button
                  type="button"
                  onClick={() => setView('new')}
                  className="mt-4 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: BRAND }}
                >
                  <Plus size={12} /> Open your first ticket
                </button>
              </div>
            )}
            {tickets.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setActiveId(t.id); setView('detail'); }}
                className="w-full text-left px-3 py-3 border-b border-gray-100 last:border-b-0 bg-white hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-start gap-1.5 flex-1 min-w-0">
                    {t.status !== 'closed' && <SlaDot iso={t.last_message_at} className="mt-1.5" />}
                    <p className="text-sm font-medium text-gray-900 truncate">{t.subject}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <PriorityChip priority={t.priority} />
                    <StatusPill status={t.status} />
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 line-clamp-2">{t.last_message_preview || '(no messages yet)'}</p>
                <p className="text-[10px] text-gray-400 mt-1">{relTime(t.last_message_at)}</p>
              </button>
            ))}
          </>
        )}

        {view === 'new' && (
          <div className="p-4 space-y-3">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Tell us what&apos;s going on and our support team will get back to you. You&apos;ll see replies right here.
            </p>

            {createError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-1.5">
                <AlertCircle size={12} /> {createError}
              </div>
            )}

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 block">Subject</label>
              <input
                value={newSubject}
                onChange={e => setNewSubject(e.target.value)}
                placeholder="Briefly, what's this about?"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300"
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 block">Priority</label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
                {(['low', 'normal', 'high'] as const).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setNewPriority(p)}
                    className={`flex-1 px-2 py-1.5 font-medium transition-colors capitalize ${
                      newPriority === p
                        ? p === 'high' ? 'bg-red-600 text-white'
                          : p === 'low' ? 'bg-gray-500 text-white'
                          : 'bg-gray-900 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 block">Message</label>
              <textarea
                value={newBody}
                onChange={e => setNewBody(e.target.value)}
                placeholder="Describe what you need help with…"
                rows={5}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300 resize-y"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setView('list')}
                className="flex-1 rounded-lg border border-gray-200 bg-white py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createTicket}
                disabled={!newBody.trim() || creating}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND }}
              >
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {creating ? 'Sending…' : 'Send ticket'}
              </button>
            </div>
          </div>
        )}

        {view === 'detail' && (
          <div className="flex flex-col h-full min-h-0">
            {detailLoading && !detail && (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={18} className="animate-spin text-gray-400" />
              </div>
            )}
            {detailError && (
              <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle size={11} className="inline mr-1" /> {detailError}
              </div>
            )}
            {detail && (
              <>
                <div className="bg-white px-4 py-3 border-b border-gray-200">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 flex-1">{detail.ticket.subject}</p>
                    <PriorityChip priority={detail.ticket.priority} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <p className="text-[10px] text-gray-400">Opened {relTime(detail.ticket.created_at)}</p>
                    {detail.ticket.status !== 'closed' && (
                      <SlaPill iso={detail.ticket.last_message_at} size="sm" />
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                  {detail.messages.length === 0 && (
                    <p className="text-center text-xs text-gray-400 py-8">No messages.</p>
                  )}
                  {detail.messages.map(m => {
                    const isVenue = m.sender_type === 'venue';
                    const label = (() => {
                      if (isVenue) {
                        if (m.sender_member_id) return detail.senders.members[m.sender_member_id] || 'Team member';
                        return 'You';
                      }
                      if (m.sender_support_user_id) return detail.senders.support[m.sender_support_user_id] || 'StoryVenue Support';
                      return 'StoryVenue Support';
                    })();
                    return (
                      <div key={m.id} className={`flex ${isVenue ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[85%] space-y-1">
                          <div className="flex items-center gap-1.5 text-[9px] text-gray-500">
                            <span className="font-semibold">{label}</span>
                            <span className="text-gray-400">{relTime(m.created_at)}</span>
                          </div>
                          <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                            isVenue
                              ? 'bg-gray-900 text-white rounded-tr-sm'
                              : 'bg-white border border-gray-200 text-gray-900 rounded-tl-sm'
                          }`}>
                            {m.body}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply box */}
                <div className="border-t border-gray-200 bg-white p-3 space-y-2">
                  {detail.ticket.status === 'closed' ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 flex items-center gap-2">
                      <CheckCircle2 size={12} />
                      <span>This ticket was closed. Open a new one if you need more help.</span>
                    </div>
                  ) : (
                    <>
                      {replyError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-1.5">
                          <AlertCircle size={11} /> {replyError}
                        </div>
                      )}
                      <div className="flex items-end gap-2">
                        <textarea
                          value={replyBody}
                          onChange={e => setReplyBody(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }}
                          placeholder="Reply to support…"
                          rows={2}
                          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300 resize-none"
                        />
                        <button
                          type="button"
                          onClick={sendReply}
                          disabled={!replyBody.trim() || replying}
                          className="flex h-9 w-9 items-center justify-center rounded-full text-white disabled:opacity-40"
                          style={{ backgroundColor: BRAND }}
                          title="Send reply"
                        >
                          {replying ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Optional close hint when used standalone */}
      {onClose && view === 'list' && tickets.length > 0 && (
        <div className="border-t border-gray-200 bg-white px-3 py-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
          >
            <X size={11} /> Close
          </button>
        </div>
      )}
    </div>
  );
}

export default SupportPanel;
