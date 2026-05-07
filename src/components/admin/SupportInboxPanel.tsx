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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  Inbox, LifeBuoy, Search, RefreshCw, Send, MessageSquare,
  Mail, MessageCircle, Building2, Loader2, AlertCircle, CheckCircle2,
  StickyNote, ShieldCheck, AlertTriangle, CircleDot, CircleSlash,
  UserPlus, Flag, X, Radio, Sparkles, FileText, Maximize2, Minimize2,
} from 'lucide-react';
import { useBroadcastChannel, useBroadcastChannels } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type BrideMessageEvent, type TicketMessageEvent, type TicketStatusEvent } from '@/lib/realtime/channels';
import { CannedReplyPicker } from '@/components/support/CannedReplyPicker';
import { SupportContextSidebar } from '@/components/admin/SupportContextSidebar';
import { SlaDot, SlaPill } from '@/components/support/SlaIndicator';
import { SupportMentionPicker } from '@/components/support/SupportMentionPicker';

const BRAND = '#1b1b1b';

type SupportSubTab = 'bride-replies' | 'venue-direct' | 'tickets';

interface VenueDirectInboxRow {
  threadId:             string;
  venueId:              string | null;
  venueName:            string;
  contactId:            string | null;
  contactName:          string;
  latestBody:           string;
  latestAuthor:         string;
  latestAt:             string;
  latestFromVenue:      boolean;
  lastConciergeSentAt:  string | null;
  readReceipts:         Array<{ label: string; readAt: string }>;
}

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
  id:                          string;
  thread_id:                   string;
  visibility:                  'internal' | 'external';
  channel:                     'sms' | 'email';
  body:                        string;
  sender_kind:                 'owner' | 'team' | 'contact' | 'system' | 'ai' | 'concierge';
  venue_team_member_id:        string | null;
  contact_from_name:           string | null;
  contact_from_email:          string | null;
  external_email_sent:         boolean | null;
  send_error:                  string | null;
  sent_by_support_user_id:     string | null;
  sent_on_behalf_of_venue:     boolean | null;
  support_internal_note:       string | null;
  support_only?:               boolean | null;
  audience?:                   'external' | 'support_only' | 'venue_direct' | null;
  mentioned_support_user_ids?: string[] | null;
  created_at:                  string;
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
  /** Other conversation_threads for the same bride (different channels). */
  siblings: Array<{
    id: string;
    subject: string;
    last_message_at: string;
    external_reply_channel: string | null;
  }>;
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
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  // Restore state from URL (e.g. after returning from impersonation,
  // or after a hard refresh — preserves which thread was open).
  const initialTab = ((): SupportSubTab => {
    const t = searchParams.get('tab');
    if (t === 'tickets')      return 'tickets';
    if (t === 'venue-direct') return 'venue-direct';
    return 'bride-replies';
  })();
  const initialThread = searchParams.get('thread') || null;

  const [subTab, setSubTab] = useState<SupportSubTab>(initialTab);

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
    // Pre-fetch open ticket count so the Venue support tab dot is visible
    // immediately, even before the user clicks to that tab.
    fetch('/api/admin/support/tickets?status=open,pending&limit=200', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { tickets?: TicketListRow[] } | null) => {
        if (d?.tickets) setTicketOpenCount(d.tickets.filter(t => t.status !== 'closed').length);
      })
      .catch(() => {});
  }, [loadMe, loadTeamMembers]);

  // Persist actAsId for super-admin sessions across reloads. Real support
  // agent sessions have a fixed identity (their own member id), so we skip.
  useEffect(() => {
    if (!me) return;
    if (!me.superAdmin) return; // agent identity is fixed; only super admin can switch
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('support_act_as_id') : '';
    if (stored && teamMembers.some(m => m.id === stored && m.active)) {
      setActAsId(stored);
    } else if (!actAsId && me.member?.id) {
      // Default to the synthetic Super Admin row so a fresh super admin can
      // act immediately without picking from a dropdown.
      setActAsId(me.member.id);
    }
  }, [me, teamMembers, actAsId]);

  function chooseActAs(id: string) {
    setActAsId(id);
    try { window.localStorage.setItem('support_act_as_id', id); } catch { /* ignore */ }
  }

  // ── Focus mode ─────────────────────────────────────────────────────────────
  const [focusMode, setFocusMode] = useState(false);
  const [ticketOpenCount, setTicketOpenCount] = useState(0);
  const [venueDirectUnreadCount, setVenueDirectUnreadCount] = useState(0);

  // ── Bride inbox state ──────────────────────────────────────────────────────
  const [threads, setThreads] = useState<BrideInboxRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThread);
  const [brideStatusFilter, setBrideStatusFilter] = useState<'open' | 'all' | 'closed'>('open');
  // Tracks only needs-reply threads for the tab badge, regardless of which filter is active.
  const [needsReplyCount, setNeedsReplyCount] = useState(0);

  // Group threads by contact (venue_id + venue_customer_id) so a bride with
  // both an SMS and an email thread appears as ONE row in the list. The most-
  // recently active thread for the group is the "primary" (used for loading
  // the detail — which already merges all sibling messages).
  const groupedThreads = useMemo(() => {
    const groups = new Map<string, BrideInboxRow[]>();
    for (const t of threads) {
      const key = `${t.venue_id}:${t.venue_customer_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return Array.from(groups.values()).map(group => {
      group.sort((a, b) =>
        new Date(b.last_inbound_created_at).getTime() - new Date(a.last_inbound_created_at).getTime()
      );
      return { primary: group[0], channels: group.length };
    });
  }, [threads]);

  const fetchInbox = useCallback(async (opts: { append?: boolean; cursor?: string | null } = {}) => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (committedSearch) params.set('search', committedSearch);
      if (opts.cursor) params.set('cursor', opts.cursor);
      params.set('filter', brideStatusFilter);
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
  }, [committedSearch, activeThreadId, brideStatusFilter]);

  useEffect(() => {
    if (subTab === 'bride-replies') fetchInbox();
  }, [subTab, fetchInbox]);

  // Keep the "needs reply" badge accurate regardless of which filter is active.
  useEffect(() => {
    if (brideStatusFilter === 'open') {
      setNeedsReplyCount(groupedThreads.length);
    }
  }, [brideStatusFilter, groupedThreads]);

  // Background fetch of venue_direct unread count so the tab badge reflects
  // reality even when the user is on a different sub-tab. Cheap query.
  useEffect(() => {
    let cancelled = false;
    const fetchCount = () => {
      void fetch('/api/admin/support/inbox-count', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then((d: { venueReplies?: number } | null) => {
          if (cancelled) return;
          if (d && typeof d.venueReplies === 'number') setVenueDirectUnreadCount(d.venueReplies);
        })
        .catch(() => {});
    };
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // When viewing a non-open filter, fetch a live open count in the background
  // so the badge reflects reality (e.g. a new bride message arrives while
  // the team is browsing the Replied list).
  useEffect(() => {
    if (brideStatusFilter === 'open' || subTab !== 'bride-replies') return;
    const ctrl = new AbortController();
    fetch('/api/admin/support/bride-inbox?filter=open&limit=200', { cache: 'no-store', signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then((d: { threads?: BrideInboxRow[] } | null) => {
        if (!d?.threads) return;
        const groups = new Set(d.threads.map(t => `${t.venue_id}:${t.venue_customer_id}`));
        setNeedsReplyCount(groups.size);
      })
      .catch(() => {});
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brideStatusFilter, subTab]);

  // Sync active thread + tab to the URL so a hard refresh (or a return from
  // impersonation) lands you back on the same thread you were viewing — and
  // so the bride-context sidebar refetches the correct row instead of
  // silently jumping to the first thread in the list.
  useEffect(() => {
    if (!pathname) return;
    const next = new URLSearchParams(searchParams.toString());
    if (subTab === 'tickets')           next.set('tab', 'tickets');
    else if (subTab === 'venue-direct') next.set('tab', 'venue-direct');
    else                                next.delete('tab');
    if (activeThreadId) next.set('thread', activeThreadId);
    else next.delete('thread');
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    const current = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    if (target !== current) {
      router.replace(target, { scroll: false });
    }
    // We intentionally exclude searchParams from deps so we only push when
    // our own state (subTab/activeThreadId) changes — searchParams is read
    // synchronously above to compute the next URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, subTab, pathname, router]);

  function submitSearch() {
    setCommittedSearch(search.trim());
    setActiveThreadId(null);
    setThreads([]);
    setNextCursor(null);
  }

  // ── Active thread state ────────────────────────────────────────────────────
  const THREAD_READS_KEY = 'support_inbox_thread_reads';
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const unreadDividerRef = useRef<HTMLDivElement | null>(null);
  // When opening a thread from the Venue Direct inbox, this asks loadDetail
  // to scroll to the most recent venue-side venue_direct reply instead of
  // the bottom — like iMessage opening to the unread message.
  const pendingScrollTargetRef = useRef<'venue-direct-latest' | null>(null);
  // ISO of when the support agent last read this thread (set just before loading)
  const [threadLastReadAt, setThreadLastReadAt] = useState<string | null>(null);
  // Read-state mirror in React state so badge re-renders when threads are opened
  const [readStates, setReadStates] = useState<Record<string, { readAt: string; msgCount: number }>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('support_inbox_thread_reads') : null;
      if (!raw) return {};
      const map = JSON.parse(raw) as Record<string, { readAt: string; msgCount: number } | string>;
      const out: Record<string, { readAt: string; msgCount: number }> = {};
      for (const [k, v] of Object.entries(map)) {
        out[k] = typeof v === 'string' ? { readAt: v, msgCount: 0 } : v;
      }
      return out;
    } catch { return {}; }
  });

  type ReadRecord = { readAt: string; msgCount: number };
  function getThreadReadRecord(threadId: string): ReadRecord | null {
    try {
      const map = JSON.parse(localStorage.getItem(THREAD_READS_KEY) || '{}') as Record<string, ReadRecord | string>;
      const v = map[threadId];
      if (!v) return null;
      // Backwards-compat: old entries were plain ISO strings
      if (typeof v === 'string') return { readAt: v, msgCount: 0 };
      return v;
    } catch { return null; }
  }
  function getThreadLastRead(threadId: string): string | null {
    return getThreadReadRecord(threadId)?.readAt ?? null;
  }
  function markThreadRead(threadId: string, msgCount = 0) {
    try {
      const map = JSON.parse(localStorage.getItem(THREAD_READS_KEY) || '{}') as Record<string, ReadRecord | string>;
      const rec = { readAt: new Date().toISOString(), msgCount };
      map[threadId] = rec;
      localStorage.setItem(THREAD_READS_KEY, JSON.stringify(map));
      setReadStates(prev => ({ ...prev, [threadId]: rec }));
    } catch { /* ignore */ }
  }
  /** Returns unread count for a thread in the list (0 = fully read). */
  function getUnreadCount(threadId: string, currentMsgCount: number, lastMessageAt: string): number {
    const rec = getThreadReadRecord(threadId);
    if (!rec) return currentMsgCount > 0 ? 1 : 0; // never opened
    if (lastMessageAt <= rec.readAt) return 0;
    const diff = currentMsgCount - rec.msgCount;
    return diff > 0 ? diff : 1; // at least 1 if newer
  }

  const loadDetail = useCallback(async (threadId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    // Capture last-read before updating so we can show the unread divider
    const lastRead = getThreadLastRead(threadId);
    setThreadLastReadAt(lastRead);
    try {
      const r = await fetch(`/api/admin/support/bride-thread/${threadId}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as ThreadDetail;
      // Mark read with accurate message count so the unread badge computes correctly
      markThreadRead(threadId, d.messages.filter(m => !m.support_only && m.audience !== 'venue_direct').length);
      setDetail(d);

      // If the user just clicked a row in the Venue Direct inbox, jump to the
      // newest venue-side venue_direct reply (iMessage-style "scroll to last
      // unread"). Falls back to the unread divider, then to bottom.
      const scrollIntent = pendingScrollTargetRef.current;
      pendingScrollTargetRef.current = null;
      requestAnimationFrame(() => {
        if (scrollIntent === 'venue-direct-latest') {
          const venueLatest = [...d.messages]
            .reverse()
            .find(m => m.audience === 'venue_direct' && m.sender_kind !== 'concierge');
          if (venueLatest) {
            const el = document.querySelector<HTMLElement>(`[data-msg-id="${venueLatest.id}"]`);
            if (el) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' });
              el.classList.add('ring-2', 'ring-violet-400', 'rounded-xl');
              setTimeout(() => {
                el.classList.remove('ring-2', 'ring-violet-400', 'rounded-xl');
              }, 2000);
              return;
            }
          }
        }
        if (unreadDividerRef.current) {
          unreadDividerRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else {
          messagesEndRef.current?.scrollIntoView({ block: 'end' });
        }
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

  // ── Realtime: bride inbox ─────────────────────────────────────────────────
  // A throttled refresh that respects in-flight loads. We refresh the whole
  // inbox list on any inbound bride message — server-side filtering is much
  // simpler than reconstructing the "needs attention" computation in the
  // browser (latest-external-is-contact + venue/customer joins).
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedInboxRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (subTab === 'bride-replies') fetchInbox();
    }, 400);
  }, [subTab, fetchInbox]);

  const [liveBride, setLiveBride] = useState(false);

  useBroadcastChannel(
    subTab === 'bride-replies' ? supportChannels.brideInbox() : null,
    ['message'],
    useCallback((_evt, payload) => {
      const evt = payload as BrideMessageEvent;
      if (!evt) return;
      // Pulse the "live" indicator briefly
      setLiveBride(true);
      setTimeout(() => setLiveBride(false), 1500);

      // Support-only internal notes don't change the bride's "needs attention"
      // status — never bump or drop the inbox row for those.
      if (evt.supportOnly) return;

      if (evt.inbound) {
        // Bride replied — bump existing row to top with new preview, or fetch
        // a fresh list to pull in a brand-new thread.
        setThreads(prev => {
          const idx = prev.findIndex(t => t.thread_id === evt.threadId);
          if (idx === -1) {
            debouncedInboxRefresh();
            return prev;
          }
          const updated: BrideInboxRow = {
            ...prev[idx],
            last_message_preview:    evt.body.slice(0, 200),
            last_message_at:         evt.createdAt,
            last_inbound_body:       evt.body,
            last_inbound_channel:    evt.channel,
            last_inbound_created_at: evt.createdAt,
            message_count:           prev[idx].message_count + 1,
          };
          const rest = prev.filter((_, i) => i !== idx);
          return [updated, ...rest];
        });
      } else {
        // Outbound (any sender) — thread is now answered, drop from list
        setThreads(prev => prev.filter(t => t.thread_id !== evt.threadId));
      }
    }, [debouncedInboxRefresh]),
  );

  // Active thread realtime — append new messages immediately. Subscribes to
  // the active thread AND every sibling thread so cross-channel messages
  // (e.g. an email reply while the agent is viewing the SMS thread) appear
  // live in the merged conversation.
  const liveThreadChannels = useMemo(() => {
    if (!activeThreadId || subTab !== 'bride-replies' || !detail) {
      return [] as string[];
    }
    const ids = [activeThreadId, ...detail.siblings.map(s => s.id)];
    return Array.from(new Set(ids)).map(id => supportChannels.brideThread(id));
  }, [activeThreadId, subTab, detail]);

  useBroadcastChannels(
    liveThreadChannels,
    ['message'],
    useCallback((_evt, payload) => {
      const evt = payload as BrideMessageEvent;
      if (!evt) return;
      setDetail(prev => {
        if (!prev) return prev;
        // Accept events from the active thread or any of its siblings
        const validThreadIds = new Set([prev.thread.id, ...prev.siblings.map(s => s.id)]);
        if (!validThreadIds.has(evt.threadId)) return prev;
        if (prev.messages.some(m => m.id === evt.messageId)) return prev;
        const isNote = evt.supportOnly === true;
        const isFromActiveThread = evt.threadId === prev.thread.id;
        const newMsg: ThreadMessage = {
          id:                          evt.messageId,
          thread_id:                   evt.threadId,
          visibility:                  isNote ? 'internal' : 'external',
          channel:                     evt.channel,
          body:                        evt.body,
          // Narrow to the union; concierge/ai/contact/owner/team/system all valid
          sender_kind:                 evt.senderKind as ThreadMessage['sender_kind'],
          venue_team_member_id:        null,
          contact_from_name:           null,
          contact_from_email:          null,
          external_email_sent:         null,
          send_error:                  null,
          sent_by_support_user_id:     evt.supportAgentId,
          sent_on_behalf_of_venue:     evt.sentByVenueSupport,
          support_internal_note:       null,
          support_only:                isNote,
          mentioned_support_user_ids:  evt.mentionedSupportUserIds || [],
          created_at:                  evt.createdAt,
        };
        return {
          ...prev,
          // Update active-thread summary only when the message is for the
          // active thread AND it isn't a support-only note (notes never
          // affect last_message_preview — see migration 110).
          thread: (isFromActiveThread && !isNote) ? {
            ...prev.thread,
            last_message_at:      evt.createdAt,
            last_message_preview: evt.body.slice(0, 200),
          } : prev.thread,
          // For sibling-thread messages, also bump that sibling's last_message_at
          // so the channel-bridge banner updates timestamps live.
          siblings: !isFromActiveThread && !isNote
            ? prev.siblings.map(s =>
                s.id === evt.threadId
                  ? { ...s, last_message_at: evt.createdAt }
                  : s,
              )
            : prev.siblings,
          messages: [...prev.messages, newMsg],
        };
      });
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ block: 'end' });
      });
      // Mark actively-viewed thread as read whenever a new message arrives in it
      if (evt.threadId === activeThreadId && activeThreadId) {
        markThreadRead(activeThreadId);
        setThreadLastReadAt(new Date().toISOString());
      }
    }, [activeThreadId]),
  );

  // ── Reply box ──────────────────────────────────────────────────────────────
  // Composer has two modes:
  //   'reply'        — outbound message to the bride (existing flow)
  //   'note'         — internal "support-team-only" note with @-mentions
  //   'venue_direct' — message to venue staff (concierge ↔ venue, hidden from bride)
  const [composerMode, setComposerMode] = useState<'reply' | 'note' | 'venue_direct'>('reply');
  const [replyBody, setReplyBody] = useState('');
  const [replyChannel, setReplyChannel] = useState<'auto' | 'sms' | 'email'>('auto');
  const [internalNote, setInternalNote] = useState('');
  const [showInternalNote, setShowInternalNote] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [noteMentionIds, setNoteMentionIds] = useState<string[]>([]);
  const [venueDirectBody, setVenueDirectBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftIntent, setDraftIntent] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showIntent, setShowIntent] = useState(false);

  useEffect(() => {
    setComposerMode('reply');
    setReplyBody('');
    setReplyChannel('auto');
    setInternalNote('');
    setShowInternalNote(false);
    setNoteBody('');
    setNoteMentionIds([]);
    setVenueDirectBody('');
    setSendStatus(null);
    setDrafting(false);
    setDraftIntent('');
    setDraftError(null);
    setShowIntent(false);
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

  const draftReply = useCallback(async () => {
    if (!detail || drafting) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const r = await fetch('/api/admin/support/draft-bride-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: detail.thread.id,
          channel:  effectiveChannel,
          intent:   draftIntent.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Draft failed (${r.status})`);
      setReplyBody(d.text || '');
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setDrafting(false);
    }
  }, [detail, drafting, effectiveChannel, draftIntent]);

  const canSend = useMemo(() => {
    if (!detail || sending) return false;
    if (composerMode === 'note') {
      if (!noteBody.trim()) return false;
    } else if (composerMode === 'venue_direct') {
      if (!venueDirectBody.trim()) return false;
    } else {
      if (!replyBody.trim()) return false;
    }
    if (me?.member?.id) return true;
    return Boolean(actAsId);
  }, [detail, replyBody, noteBody, venueDirectBody, sending, me, actAsId, composerMode]);

  async function send() {
    if (!detail || !canSend) return;
    if (composerMode === 'note') return saveNote();
    if (composerMode === 'venue_direct') return sendVenueDirect();
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
          // Super admin: explicitly send the selected identity (synthetic
          // Super Admin or a teammate they're acting-as). Agent sessions
          // omit so the server falls through to agent.sub.
          supportUserId: me?.superAdmin ? (actAsId || me?.member?.id) : undefined,
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

  /** POST a support-only internal note. The realtime broadcast will append it
   *  to this view automatically; we just need to clear the composer. */
  async function saveNote() {
    if (!detail) return;
    setSending(true);
    setSendStatus(null);
    try {
      const r = await fetch('/api/admin/support/bride-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId:                detail.thread.id,
          body:                    noteBody.trim(),
          mentionedSupportUserIds: noteMentionIds,
          supportUserId:           me?.superAdmin ? (actAsId || me?.member?.id) : undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Save failed (${r.status})`);
      setSendStatus({
        ok: true,
        msg: noteMentionIds.length > 0
          ? `Note saved — ${noteMentionIds.length} teammate${noteMentionIds.length === 1 ? '' : 's'} notified`
          : 'Note saved',
      });
      setNoteBody('');
      setNoteMentionIds([]);
      // Refresh detail so the note shows up immediately even if realtime
      // hasn't propagated yet.
      await loadDetail(detail.thread.id);
    } catch (e) {
      setSendStatus({ ok: false, msg: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSending(false);
    }
  }

  /** POST a "Venue Direct" message — visible to the venue's team but hidden
   *  from the bride. Used to ask the venue questions about a bride contact
   *  without ever logging into their subaccount. */
  async function sendVenueDirect() {
    if (!detail) return;
    setSending(true);
    setSendStatus(null);
    try {
      const r = await fetch('/api/admin/support/venue-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId:      detail.thread.id,
          body:          venueDirectBody.trim(),
          supportUserId: me?.superAdmin ? (actAsId || me?.member?.id) : undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Send failed (${r.status})`);
      const n = typeof d.recipientsNotified === 'number' ? d.recipientsNotified : 0;
      setSendStatus({
        ok: true,
        msg: n > 0
          ? `Sent to ${n} venue ${n === 1 ? 'teammate' : 'teammates'}`
          : 'Sent — no active venue teammates yet, billing email used as fallback',
      });
      setVenueDirectBody('');
      await loadDetail(detail.thread.id);
    } catch (e) {
      setSendStatus({ ok: false, msg: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setSending(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const inboxContent = (
    <div className={`flex flex-col gap-3 min-w-0 max-w-full ${focusMode ? 'flex-1 min-h-0' : 'lg:h-[calc(100vh-80px)]'}`}>
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="font-heading text-xl text-gray-900">Support inbox</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Bride replies + venue support tickets, in one place.
            </p>
          </div>
          <LiveBadge active={liveBride} />
        </div>
        <div className="flex items-center gap-2">
          <IdentityPicker
            me={me}
            teamMembers={teamMembers}
            actAsId={actAsId}
            onChange={chooseActAs}
          />
          <button
            type="button"
            onClick={() => setFocusMode(v => !v)}
            title={focusMode ? 'Exit focus mode' : 'Focus mode'}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors shrink-0"
          >
            {focusMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {focusMode ? 'Exit' : 'Focus'}
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="shrink-0 flex items-center gap-1 border-b border-gray-200">
        <SubTabButton
          active={subTab === 'bride-replies'}
          onClick={() => setSubTab('bride-replies')}
          icon={<Inbox size={14} />}
          label="Bride replies"
          count={needsReplyCount}
        />
        <SubTabButton
          active={subTab === 'venue-direct'}
          onClick={() => setSubTab('venue-direct')}
          icon={<Building2 size={14} />}
          label="Venue Direct"
          count={venueDirectUnreadCount}
        />
        <SubTabButton
          active={subTab === 'tickets'}
          onClick={() => setSubTab('tickets')}
          icon={<LifeBuoy size={14} />}
          label="Venue support"
          dot={ticketOpenCount}
        />
      </div>

      {subTab === 'tickets' && (
        <div className="flex-1 min-h-0">
          <TicketsView
            me={me}
            teamMembers={teamMembers}
            actAsId={actAsId}
            onOpenCount={setTicketOpenCount}
          />
        </div>
      )}

      {subTab === 'venue-direct' && (
        <div className="flex-1 min-h-0">
          <VenueDirectInboxView
            onUnreadCount={setVenueDirectUnreadCount}
            onOpenThread={(threadId) => {
              pendingScrollTargetRef.current = 'venue-direct-latest';
              setActiveThreadId(threadId);
              setSubTab('bride-replies');
            }}
          />
        </div>
      )}

      {subTab === 'bride-replies' && (
        <div className="flex-1 min-h-[500px] lg:min-h-0 grid grid-cols-1 lg:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_290px] gap-4 min-w-0 overflow-hidden">
          {/* Thread list */}
          <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 overflow-hidden">
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
                  {(['open', 'all', 'closed'] as const).map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setBrideStatusFilter(opt);
                        setActiveThreadId(null);
                        setThreads([]);
                        setNextCursor(null);
                      }}
                      className={`px-2.5 py-1 font-medium transition-colors ${brideStatusFilter === opt ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {opt === 'open' ? 'Needs Reply' : opt === 'all' ? 'All' : 'Replied'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => fetchInbox()}
                  className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              <p className="text-[11px] text-gray-500">
                {brideStatusFilter === 'open'
                  ? `${groupedThreads.length} contact${groupedThreads.length === 1 ? '' : 's'} need${groupedThreads.length === 1 ? 's' : ''} reply`
                  : `${groupedThreads.length} conversation${groupedThreads.length === 1 ? '' : 's'}`}
              </p>
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
              {!listLoading && !listError && groupedThreads.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-gray-400">
                  <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-400" />
                  {brideStatusFilter === 'open'
                    ? 'No unanswered replies.'
                    : brideStatusFilter === 'closed'
                    ? 'No replied conversations.'
                    : 'No conversations yet.'}
                </div>
              )}
              {groupedThreads.map(({ primary: t, channels }) => {
                const unread = getUnreadCount(t.thread_id, t.message_count, t.last_message_at);
                const isActive = activeThreadId === t.thread_id;
                return (
                  <button
                    key={t.thread_id}
                    type="button"
                    onClick={() => setActiveThreadId(t.thread_id)}
                    className={`w-full text-left px-3 py-3 border-b border-gray-100 last:border-b-0 transition-colors ${
                      isActive
                        ? 'bg-gray-50 border-l-2 border-l-gray-900'
                        : unread > 0
                        ? 'bg-blue-50/50 border-l-2 border-l-blue-500 hover:bg-blue-50/70'
                        : 'hover:bg-gray-50/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <SlaDot iso={t.last_inbound_created_at} className="mt-1.5" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${unread > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'}`}>
                            {fullName(t.contact_first_name, t.contact_last_name, t.contact_email || 'Unknown bride')}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Building2 size={11} className="text-gray-400 shrink-0" />
                            <span className="text-[11px] text-gray-500 truncate">{t.venue_name}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0 gap-1">
                        <span className="text-[10px] text-gray-400">{relativeTime(t.last_inbound_created_at)}</span>
                        <div className="flex items-center gap-1">
                          {unread > 0 && (
                            <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white min-w-[18px] h-[18px] px-1 text-[10px] font-bold leading-none">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                          {channels > 1 && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-500 px-1.5 py-0.5 text-[9px] font-semibold">
                              {channels} ch
                            </span>
                          )}
                          <ChannelChip channel={t.last_inbound_channel} />
                        </div>
                      </div>
                    </div>
                    <p className={`text-xs line-clamp-2 mt-1 ${unread > 0 ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                      {t.last_inbound_body || t.last_message_preview}
                    </p>
                  </button>
                );
              })}
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
          <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 overflow-hidden">
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
                composerMode={composerMode}
                onComposerModeChange={setComposerMode}
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
                noteBody={noteBody}
                onNoteBodyChange={setNoteBody}
                noteMentionIds={noteMentionIds}
                onNoteMentionIdsChange={setNoteMentionIds}
                venueDirectBody={venueDirectBody}
                onVenueDirectBodyChange={setVenueDirectBody}
                teamMembers={teamMembers}
                selfId={(me?.superAdmin ? actAsId : null) || me?.member?.id || null}
                onSwitchActiveThread={setActiveThreadId}
                canSend={canSend}
                sending={sending}
                onSend={send}
                sendStatus={sendStatus}
                actAsName={
                  // For super admin, prefer the explicitly-selected teammate
                  // (actAsId) over the synthetic Super Admin row, so the
                  // composer reflects who the message is being attributed to.
                  (me?.superAdmin && actAsId
                    ? teamMembers.find(m => m.id === actAsId)?.name
                    : null
                  ) ||
                  me?.member?.name ||
                  teamMembers.find(m => m.id === actAsId)?.name ||
                  null
                }
                onDismiss={async () => {
                  if (detail) {
                    const tid = detail.thread.id;
                    // Mark bride thread closed (clears the Bride replies badge)
                    void fetch(`/api/admin/support/bride-thread/${tid}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'closed' }),
                    }).catch(() => {});
                    // Mark Venue Direct thread as acknowledged so the "Awaiting reply"
                    // badge clears too — even if no reply was sent to the venue.
                    void fetch('/api/admin/support/venue-direct-inbox/acknowledge', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ threadId: tid }),
                    }).catch(() => {});
                    // Drop from the open list immediately
                    setThreads(prev => prev.filter(t => t.thread_id !== tid));
                    // Tell VenueDirectInboxView to remove the row instantly
                    window.dispatchEvent(
                      new CustomEvent('storypay:vd-acknowledge', { detail: { threadId: tid } }),
                    );
                  }
                  setActiveThreadId(null);
                }}
                noActorWarning={!me?.member?.id && !actAsId}
                messagesEndRef={messagesEndRef}
                unreadDividerRef={unreadDividerRef}
                threadLastReadAt={threadLastReadAt}
                drafting={drafting}
                onDraft={draftReply}
                draftError={draftError}
                draftIntent={draftIntent}
                onDraftIntentChange={setDraftIntent}
                showIntent={showIntent}
                onToggleIntent={() => setShowIntent(v => !v)}
              />
            )}
          </div>

          {/* Context sidebar — hidden on smaller screens, visible from xl up */}
          <SupportContextSidebar threadId={activeThreadId} />
        </div>
      )}
    </div>
  );

  if (focusMode && typeof document !== 'undefined') {
    return createPortal(
      <>
        {/* Dark blurred backdrop */}
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
          onClick={() => setFocusMode(false)}
        />
        {/* Focus panel — 16px inset gives floating feel; px/pt add inner breathing room */}
        <div className="fixed inset-4 z-[70] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 px-6 pt-5 pb-4 overflow-hidden flex flex-col">
            {inboxContent}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  return inboxContent;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function LiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
        active
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-gray-200 bg-gray-50 text-gray-500'
      }`}
      title={active ? 'New message just arrived' : 'Live updates active'}
    >
      <Radio size={10} className={active ? 'animate-pulse text-emerald-600' : ''} />
      Live
    </span>
  );
}

function SubTabButton({
  active, onClick, icon, label, count, dot,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  dot?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-gray-900 text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}
    >
      {icon}
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-semibold tabular-nums">
          {count}
        </span>
      )}
      {typeof dot === 'number' && dot > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold tabular-nums">
          {dot > 99 ? '99+' : dot}
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

  // Super admin (or any logged-in support agent) always has a member id
  // resolved by /api/admin/support/me — for super admins this is the
  // synthetic Super Admin row, auto-bootstrapped on first /me call.
  if (me.member?.id) {
    // Super admin gets a "switch identity" affordance when other team
    // members exist, so they can attribute replies to a real teammate
    // instead of the synthetic Super Admin row.
    if (me.superAdmin && teamMembers.filter(m => m.active && m.id !== me.member!.id).length > 0) {
      const selectedId = actAsId || me.member.id;
      return (
        <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
          <ShieldCheck size={14} className="text-emerald-600" />
          Acting as
          <select
            value={selectedId}
            onChange={e => onChange(e.target.value)}
            className="bg-transparent outline-none font-semibold text-gray-900 cursor-pointer"
          >
            <option value={me.member.id}>{me.member.name} (super admin)</option>
            {teamMembers.filter(m => m.active && m.id !== me.member!.id).map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
        <ShieldCheck size={14} className="text-emerald-600" />
        <span>
          Acting as <span className="font-semibold text-gray-900">{me.member.name}</span>
          <span className="ml-1 text-gray-400">
            ({me.superAdmin ? 'super admin' : me.member.role})
          </span>
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
  composerMode, onComposerModeChange,
  replyBody, onReplyBodyChange,
  replyChannel, onReplyChannelChange,
  effectiveChannel, lastInboundChannel,
  internalNote, onInternalNoteChange,
  showInternalNote, onToggleInternalNote,
  noteBody, onNoteBodyChange,
  noteMentionIds, onNoteMentionIdsChange,
  venueDirectBody, onVenueDirectBodyChange,
  teamMembers, selfId,
  onSwitchActiveThread,
  onDismiss,
  canSend, sending, onSend, sendStatus,
  actAsName, noActorWarning,
  messagesEndRef, unreadDividerRef, threadLastReadAt,
  drafting, onDraft, draftError,
  draftIntent, onDraftIntentChange,
  showIntent, onToggleIntent,
}: {
  detail: ThreadDetail;
  onDismiss: () => void | Promise<void>;
  composerMode: 'reply' | 'note' | 'venue_direct';
  onComposerModeChange: (m: 'reply' | 'note' | 'venue_direct') => void;
  replyBody: string; onReplyBodyChange: (v: string) => void;
  replyChannel: 'auto' | 'sms' | 'email';
  onReplyChannelChange: (v: 'auto' | 'sms' | 'email') => void;
  effectiveChannel: 'sms' | 'email';
  lastInboundChannel: 'sms' | 'email';
  internalNote: string; onInternalNoteChange: (v: string) => void;
  showInternalNote: boolean; onToggleInternalNote: () => void;
  noteBody: string; onNoteBodyChange: (v: string) => void;
  noteMentionIds: string[]; onNoteMentionIdsChange: (ids: string[]) => void;
  venueDirectBody: string; onVenueDirectBodyChange: (v: string) => void;
  teamMembers: SupportTeamMember[];
  selfId: string | null;
  onSwitchActiveThread: (threadId: string) => void;
  canSend: boolean; sending: boolean;
  onSend: () => void;
  sendStatus: { ok: boolean; msg: string } | null;
  actAsName: string | null;
  noActorWarning: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  unreadDividerRef: React.RefObject<HTMLDivElement | null>;
  threadLastReadAt: string | null;
  drafting: boolean;
  onDraft: () => void;
  draftError: string | null;
  draftIntent: string;
  onDraftIntentChange: (v: string) => void;
  showIntent: boolean;
  onToggleIntent: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const contactName = fullName(
    detail.customer?.first_name ?? null,
    detail.customer?.last_name ?? null,
    detail.customer?.customer_email || 'Unknown bride',
  );
  const isNoteMode = composerMode === 'note';
  const isVenueDirectMode = composerMode === 'venue_direct';

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
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <SlaPill iso={detail.thread.last_message_at} />
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              title="Close thread"
            >
              <X size={11} /> Close
            </button>
          </div>
          {detail.lead?.status && (
            <span className="inline-block rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {detail.lead.status}
            </span>
          )}
        </div>
      </div>

      {/* Cross-channel merge banner — only when the bride has talked across
          more than one thread/channel for this venue. Lets agents pivot the
          reply target by clicking the alternate channel chip. */}
      {detail.siblings.length > 0 && (
        <CrossChannelBanner
          activeChannel={effectiveChannel}
          activeThreadId={detail.thread.id}
          siblings={detail.siblings}
          onSwitchActive={onSwitchActiveThread}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50/30 px-4 py-4 space-y-3">
        {detail.messages.length === 0 && (
          <p className="text-center text-xs text-gray-400 py-8">No messages yet.</p>
        )}
        {detail.messages.map((m, idx) => {
          // iMessage-style unread divider: show before the first message after lastReadAt
          const isFirstUnread = threadLastReadAt !== null
            && m.created_at > threadLastReadAt
            && (idx === 0 || detail.messages[idx - 1].created_at <= threadLastReadAt);
          return (
            <div key={m.id} data-msg-id={m.id}>
              {isFirstUnread && (
                <div
                  ref={unreadDividerRef}
                  className="flex items-center gap-2 py-2 select-none"
                >
                  <div className="flex-1 h-px bg-blue-300" />
                  <span className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide whitespace-nowrap">
                    New messages
                  </span>
                  <div className="flex-1 h-px bg-blue-300" />
                </div>
              )}
              <MessageBubble
                msg={m}
                supportName={
                  m.sent_by_support_user_id
                    ? detail.supportUsers[m.sent_by_support_user_id]?.name || 'Support'
                    : null
                }
                supportUsers={detail.supportUsers}
              />
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className={`border-t bg-white p-3 space-y-2 ${
        isNoteMode
          ? 'border-amber-200 bg-amber-50/40'
          : isVenueDirectMode
            ? 'border-violet-200 bg-violet-50/30'
            : 'border-gray-200'
      }`}>
        {/* Mode tabs */}
        <div className="flex items-center gap-1 -mt-1">
          <ComposerTabButton
            active={composerMode === 'reply'}
            onClick={() => onComposerModeChange('reply')}
            icon={<Send size={11} />}
            label="Reply"
            tone="reply"
          />
          <ComposerTabButton
            active={isNoteMode}
            onClick={() => onComposerModeChange('note')}
            icon={<StickyNote size={11} />}
            label="Internal note"
            tone="note"
          />
          <ComposerTabButton
            active={isVenueDirectMode}
            onClick={() => onComposerModeChange('venue_direct')}
            icon={<Building2 size={11} />}
            label="Venue Direct"
            tone="venue_direct"
          />
          {isNoteMode && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              <ShieldCheck size={10} /> Support team only
            </span>
          )}
          {isVenueDirectMode && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              <Building2 size={10} /> Venue staff only · bride hidden
            </span>
          )}
        </div>

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

        {composerMode === 'reply' && (
          <>
            <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
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
              <span className="text-gray-400">→ as <span className="font-semibold text-gray-700">{effectiveChannel.toUpperCase()}</span></span>
              <button
                type="button"
                onClick={onToggleIntent}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  showIntent ? 'bg-violet-100 text-violet-800' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <Sparkles size={11} /> {showIntent ? 'Hide intent' : 'Steer AI'}
              </button>
              <button
                type="button"
                onClick={onToggleInternalNote}
                className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  showInternalNote ? 'bg-amber-100 text-amber-800' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <StickyNote size={11} /> Pin note to message
              </button>
            </div>

            {showIntent && (
              <input
                type="text"
                value={draftIntent}
                onChange={e => onDraftIntentChange(e.target.value)}
                placeholder="Optional: tell the AI what to say (e.g. 'offer a Tuesday tour')"
                className="w-full text-xs border border-violet-200 bg-violet-50/40 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
              />
            )}

            {showInternalNote && (
              <textarea
                value={internalNote}
                onChange={e => onInternalNoteChange(e.target.value)}
                placeholder="Pin a small note to this reply (only support sees it)"
                rows={2}
                className="w-full text-sm border border-amber-200 bg-amber-50/40 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300"
              />
            )}

            {draftError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle size={12} /> {draftError}
              </div>
            )}

            <div className="relative">
              <textarea
                value={replyBody}
                onChange={e => onReplyBodyChange(e.target.value)}
                placeholder={`Reply on behalf of ${detail.venue?.name || 'the venue'}… or click Suggest for an AI draft.`}
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 pr-44 outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300"
              />
              <div className="absolute top-2 right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPickerOpen(v => !v)}
                  title="Insert a saved reply"
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    pickerOpen
                      ? 'border-violet-300 bg-violet-100 text-violet-800'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <FileText size={11} /> Saved
                </button>
                <button
                  type="button"
                  onClick={onDraft}
                  disabled={drafting}
                  title="Generate a reply with AI using venue voice + bride context"
                  className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-white hover:bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 disabled:opacity-50"
                >
                  {drafting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {drafting ? 'Drafting…' : 'Suggest'}
                </button>
                <CannedReplyPicker
                  open={pickerOpen}
                  onClose={() => setPickerOpen(false)}
                  listEndpoint="/api/admin/support/canned-replies?scope=admin"
                  renderEndpoint={(id) => `/api/admin/support/canned-replies/${id}/render`}
                  threadId={detail.thread.id}
                  agentName={actAsName ?? undefined}
                  channel={effectiveChannel}
                  onInsert={(b) => onReplyBodyChange(b)}
                />
              </div>
            </div>
          </>
        )}

        {isNoteMode && (
          <>
            <SupportMentionPicker
              members={teamMembers}
              selectedIds={noteMentionIds}
              onChange={onNoteMentionIdsChange}
              selfId={selfId}
              disabled={sending}
            />
            <textarea
              value={noteBody}
              onChange={e => onNoteBodyChange(e.target.value)}
              placeholder="Leave context for whoever picks this up next. The bride and venue never see this."
              rows={3}
              className="w-full text-sm border border-amber-200 bg-amber-50/60 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300"
            />
            <p className="text-[10px] text-amber-800/80">
              {noteMentionIds.length === 0
                ? 'Tip: @-mention a teammate to email them this note.'
                : `${noteMentionIds.length} teammate${noteMentionIds.length === 1 ? '' : 's'} will be emailed when you save.`}
            </p>
          </>
        )}

        {isVenueDirectMode && (
          <>
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2 text-[11px] text-violet-900 leading-relaxed">
              <div className="font-semibold mb-0.5 inline-flex items-center gap-1">
                <Building2 size={11} /> Messaging the venue team about{' '}
                <span className="font-semibold">{contactName}</span>
              </div>
              All active teammates on the venue&apos;s team page (and the account owner) get an email
              with a link to reply in their dashboard. The bride never sees this.
            </div>
            <textarea
              value={venueDirectBody}
              onChange={e => onVenueDirectBodyChange(e.target.value)}
              placeholder={`Ask the venue team about ${contactName}… e.g. "We booked a tour Saturday 2pm — anything we should mention?"`}
              rows={4}
              className="w-full text-sm border border-violet-200 bg-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
            />
          </>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-500">
            {isNoteMode
              ? (actAsName
                  ? <>Saving as <span className="font-semibold text-gray-700">{actAsName}</span></>
                  : 'Pick an identity to save.')
              : isVenueDirectMode
                ? (actAsName
                    ? <>Sending as <span className="font-semibold text-gray-700">{actAsName}</span> · StoryVenue Support</>
                    : 'Pick an identity to send.')
                : (actAsName
                    ? <>Sending as <span className="font-semibold text-gray-700">{actAsName}</span> on behalf of <span className="font-semibold text-gray-700">{detail.venue?.name || 'venue'}</span></>
                    : 'Pick an identity to send.')}
          </p>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: isNoteMode ? '#b45309' : isVenueDirectMode ? '#7c3aed' : BRAND }}
          >
            {sending
              ? <Loader2 size={12} className="animate-spin" />
              : (isNoteMode ? <StickyNote size={12} /> : isVenueDirectMode ? <Building2 size={12} /> : <Send size={12} />)}
            {sending
              ? (isNoteMode ? 'Saving…' : isVenueDirectMode ? 'Sending…' : 'Sending…')
              : (isNoteMode
                  ? 'Save note'
                  : isVenueDirectMode
                    ? `Send to venue team`
                    : `Send ${effectiveChannel.toUpperCase()}`)}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Banner shown above a merged thread view when the bride has multiple
 * conversation_threads (one per channel) for the same venue. Agents can
 * click an alternate channel to switch the *reply target* — the merged
 * message stream stays the same.
 */
function CrossChannelBanner({
  activeChannel,
  activeThreadId,
  siblings,
  onSwitchActive,
}: {
  activeChannel: 'sms' | 'email';
  activeThreadId: string;
  siblings: ThreadDetail['siblings'];
  onSwitchActive: (threadId: string) => void;
}) {
  // Group active + siblings together for the chip row
  const all = [
    { id: activeThreadId, label: activeChannel.toUpperCase(), channel: activeChannel as 'sms' | 'email', isActive: true },
    ...siblings.map(s => {
      const ch = (s.external_reply_channel === 'sms' || s.external_reply_channel === 'email')
        ? s.external_reply_channel
        : 'email';
      return { id: s.id, label: ch.toUpperCase(), channel: ch as 'sms' | 'email', isActive: false };
    }),
  ];

  return (
    <div className="border-b border-gray-200 bg-blue-50/40 px-4 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
        Merged from {all.length} channel{all.length === 1 ? '' : 's'}
      </span>
      <span className="text-[10px] text-blue-700/80">— Reply targets:</span>
      <div className="flex items-center gap-1 flex-wrap">
        {all.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => { if (!t.isActive) onSwitchActive(t.id); }}
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
              t.isActive
                ? 'border-blue-500 bg-blue-100 text-blue-900'
                : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-50'
            }`}
            title={t.isActive ? 'Replies go to this thread' : 'Switch reply target to this channel'}
          >
            {t.channel === 'sms' ? <MessageCircle size={10} /> : <Mail size={10} />}
            {t.label}{t.isActive ? ' · active' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

function ComposerTabButton({
  active, onClick, icon, label, tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: 'reply' | 'note' | 'venue_direct';
}) {
  const activeCls = tone === 'reply'
    ? 'border-gray-900 text-gray-900 bg-white'
    : tone === 'note'
      ? 'border-amber-500 text-amber-800 bg-white'
      : 'border-violet-500 text-violet-800 bg-white';
  const idleCls = 'border-transparent text-gray-500 hover:text-gray-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border-b-2 px-2.5 py-1 text-[11px] font-semibold transition-colors ${active ? activeCls : idleCls}`}
    >
      {icon} {label}
    </button>
  );
}

function MessageBubble({
  msg,
  supportName,
  supportUsers,
}: {
  msg: ThreadMessage;
  supportName: string | null;
  supportUsers: Record<string, { id: string; name: string; email: string }>;
}) {
  const isInbound = msg.sender_kind === 'contact';
  const isInternal = msg.visibility === 'internal';
  const isAi = msg.sender_kind === 'ai';
  const isConcierge = msg.sender_kind === 'concierge' || msg.sent_on_behalf_of_venue;
  const isSupportNote = msg.support_only === true;
  const isVenueDirect = msg.audience === 'venue_direct';

  // Venue Direct messages render full-width with a distinctive violet style
  // so they're clearly separate from bride conversation bubbles. They're a
  // private side-channel between the concierge and the venue's team.
  if (isVenueDirect) {
    return (
      <div className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2 text-[10px] text-violet-800 mb-1">
          <Building2 size={11} />
          <span className="font-semibold uppercase tracking-wide">Venue Direct</span>
          <span className="rounded-full bg-violet-100 border border-violet-300 px-1.5 py-0.5 text-[9px] font-semibold">
            Concierge ↔ Venue · bride hidden
          </span>
          {supportName && <span className="text-violet-700">— {supportName}</span>}
          <span className="ml-auto text-violet-600">{relativeTime(msg.created_at)}</span>
        </div>
        <p className="text-sm text-violet-900 whitespace-pre-wrap break-words">{msg.body}</p>
      </div>
    );
  }

  // Support-only notes always render full-width with sticky-note styling so
  // they read as "scratchpad for the team" rather than a conversation bubble.
  if (isSupportNote) {
    const mentionedNames = (msg.mentioned_support_user_ids ?? [])
      .map(id => supportUsers[id]?.name)
      .filter(Boolean) as string[];
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2 text-[10px] text-amber-800 mb-1">
          <StickyNote size={11} />
          <span className="font-semibold uppercase tracking-wide">Internal note</span>
          <span className="rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[9px] font-semibold">
            Support team only
          </span>
          {supportName && <span className="text-amber-700">— {supportName}</span>}
          <span className="ml-auto text-amber-600">{relativeTime(msg.created_at)}</span>
        </div>
        <p className="text-sm text-amber-900 whitespace-pre-wrap break-words">{msg.body}</p>
        {mentionedNames.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
            <span className="text-amber-700">Notified:</span>
            {mentionedNames.map(n => (
              <span key={n} className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900 px-1.5 py-0.5 font-semibold">
                @{n}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const bubbleSide = isInbound ? 'justify-start' : 'justify-end';

  let label = 'Venue';
  if (isInbound) label = msg.contact_from_name || 'Bride';
  else if (msg.sender_kind === 'system') label = 'System';
  else if (isAi) label = 'AI Concierge';
  else if (isConcierge) label = supportName ? `Support — ${supportName}` : 'Support';
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
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">
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
        <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${bubbleClass}`}>
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

// ─── Venue support tickets ──────────────────────────────────────────────────

interface TicketListRow {
  id:                       string;
  venue_id:                 string;
  venue_name:               string;
  subject:                  string;
  status:                   'open' | 'pending' | 'closed';
  priority:                 'low' | 'normal' | 'high';
  assigned_support_user_id: string | null;
  assigned_support_name:    string | null;
  last_message_at:          string;
  last_message_preview:     string | null;
  opener_label:             string;
  opener_email:             string | null;
  message_count:            number;
  created_at:               string;
}

interface TicketDetail {
  ticket: {
    id: string; venue_id: string; subject: string;
    status: 'open' | 'pending' | 'closed';
    priority: 'low' | 'normal' | 'high';
    assigned_support_user_id: string | null;
    last_message_at: string;
    last_message_preview: string | null;
    opened_by_profile_id: string | null;
    opened_by_member_id: string | null;
    created_at: string;
  };
  venue: { id: string; name: string; notification_email: string | null; contact_email: string | null; phone: string | null } | null;
  opener: { kind: 'owner' | 'team_member' | 'unknown'; label: string; email: string | null };
  messages: {
    id: string; sender_type: 'venue' | 'support';
    sender_profile_id: string | null;
    sender_member_id: string | null;
    sender_support_user_id: string | null;
    body: string;
    attachments: unknown;
    created_at: string;
  }[];
  senders: {
    profiles: Record<string, { id: string; full_name: string | null }>;
    members:  Record<string, { id: string; first_name: string | null; last_name: string | null; email: string | null }>;
    support:  Record<string, { id: string; name: string; email: string }>;
  };
}

function StatusPill({ status }: { status: 'open' | 'pending' | 'closed' }) {
  const map = {
    open:    { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CircleDot size={10} /> },
    pending: { cls: 'bg-amber-50 text-amber-700 border-amber-200',       icon: <CircleDot size={10} /> },
    closed:  { cls: 'bg-gray-100 text-gray-600 border-gray-200',         icon: <CircleSlash size={10} /> },
  } as const;
  const { cls, icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {icon} {status}
    </span>
  );
}

function PriorityPill({ priority }: { priority: 'low' | 'normal' | 'high' }) {
  if (priority === 'high') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 text-red-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        <AlertTriangle size={10} /> High
      </span>
    );
  }
  if (priority === 'low') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 text-gray-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        <Flag size={10} /> Low
      </span>
    );
  }
  return null;
}

function VenueDirectInboxView({
  onUnreadCount,
  onOpenThread,
}: {
  onUnreadCount: (n: number) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [rows, setRows] = useState<VenueDirectInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'awaiting' | 'all'>('awaiting');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/admin/support/venue-direct-inbox', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      const list = (d.threads ?? []) as VenueDirectInboxRow[];
      setRows(list);
      onUnreadCount(typeof d.unreadCount === 'number' ? d.unreadCount : list.filter(r => r.latestFromVenue).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [onUnreadCount]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // When the Close button on a bride reply thread fires, it dispatches
  // 'storypay:vd-acknowledge' so we can instantly clear the "Awaiting reply"
  // badge for that thread without waiting for the next 30s poll.
  useEffect(() => {
    const handler = (e: Event) => {
      const { threadId } = (e as CustomEvent<{ threadId: string }>).detail ?? {};
      if (!threadId) return;
      setRows(prev =>
        prev.map(r => r.threadId === threadId ? { ...r, latestFromVenue: false } : r),
      );
    };
    window.addEventListener('storypay:vd-acknowledge', handler);
    return () => window.removeEventListener('storypay:vd-acknowledge', handler);
  }, []);

  const visible = useMemo(
    () => filter === 'awaiting' ? rows.filter(r => r.latestFromVenue) : rows,
    [rows, filter],
  );
  const awaitingCount = useMemo(() => rows.filter(r => r.latestFromVenue).length, [rows]);
  // Keep the parent badge in sync with our optimistic row updates
  useEffect(() => { onUnreadCount(awaitingCount); }, [awaitingCount, onUnreadCount]);

  function relativeTime(iso: string): string {
    try {
      const d = new Date(iso);
      const diff = Date.now() - d.getTime();
      const min = Math.floor(diff / 60000);
      if (min < 1)  return 'just now';
      if (min < 60) return `${min}m ago`;
      const hrs = Math.floor(min / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 7) return `${days}d ago`;
      return d.toLocaleDateString();
    } catch { return iso; }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 mt-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-heading text-base text-gray-900 inline-flex items-center gap-2">
            <Building2 size={16} className="text-violet-700" />
            Venue Direct
            {awaitingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                {awaitingCount}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Private venue↔concierge threads about specific brides. Venue replies needing response show up here first.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter('awaiting')}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
              filter === 'awaiting' ? 'bg-violet-700 text-white border-violet-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            Awaiting reply ({awaitingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
              filter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            All ({rows.length})
          </button>
          <button
            type="button"
            onClick={load}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-gray-500 hover:bg-gray-50"
            title="Refresh"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-6 justify-center">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-10 px-4 border border-dashed border-gray-200 rounded-xl">
          <Building2 size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm font-semibold text-gray-700">
            {filter === 'awaiting' ? 'No venues waiting for a reply' : 'No Venue Direct activity yet'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {filter === 'awaiting'
              ? 'When a venue replies to a Venue Direct message, it shows up here so the team can respond fast.'
              : 'Send a Venue Direct from any bride thread to start a conversation with the venue team.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
          {visible.map(row => (
            <button
              key={row.threadId}
              type="button"
              onClick={() => onOpenThread(row.threadId)}
              className="w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50"
            >
              <div className={`mt-0.5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${
                row.latestFromVenue
                  ? 'bg-violet-100 text-violet-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {(row.contactName.match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm truncate ${row.latestFromVenue ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
                    {row.contactName}
                  </p>
                  <span className="text-[11px] text-gray-400">·</span>
                  <p className="text-[11px] text-gray-500 truncate">{row.venueName}</p>
                  {row.latestFromVenue && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                      Awaiting reply
                    </span>
                  )}
                  <span className={`text-[10px] text-gray-400 ${row.latestFromVenue ? '' : 'ml-auto'}`}>
                    {relativeTime(row.latestAt)}
                  </span>
                </div>
                <p className="text-[11px] text-violet-700 font-medium mt-0.5">
                  {row.latestAuthor}
                  {row.latestFromVenue && row.lastConciergeSentAt && (
                    <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 px-1.5 py-0.5 text-[9px] font-semibold">
                      asked {relativeTime(row.lastConciergeSentAt)}
                    </span>
                  )}
                </p>
                <p className={`text-xs truncate mt-0.5 ${row.latestFromVenue ? 'text-gray-800' : 'text-gray-500'}`}>
                  {row.latestFromVenue ? '' : 'You: '}{row.latestBody}
                </p>
                {!row.latestFromVenue && row.readReceipts.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                    Seen by {row.readReceipts.map(r => r.label).join(', ')}
                    {' · '}{relativeTime(row.readReceipts[0].readAt)}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketsView({
  me, teamMembers, actAsId, onOpenCount,
}: {
  me: SupportMe | null;
  teamMembers: SupportTeamMember[];
  actAsId: string;
  onOpenCount?: (n: number) => void;
}) {
  const [tickets, setTickets] = useState<TicketListRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | 'closed'>('open');
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const fetchTickets = useCallback(async (opts: { append?: boolean; cursor?: string | null } = {}) => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter === 'open')   params.set('status', 'open,pending');
      if (statusFilter === 'closed') params.set('status', 'closed');
      if (statusFilter === 'all')    params.set('status', 'all');
      if (committedSearch) params.set('search', committedSearch);
      if (opts.cursor) params.set('cursor', opts.cursor);
      params.set('limit', '50');

      const r = await fetch(`/api/admin/support/tickets?${params.toString()}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as { tickets: TicketListRow[]; nextCursor: string | null };
      const merged = opts.append ? [...tickets, ...d.tickets] : d.tickets;
      setTickets(merged);
      setNextCursor(d.nextCursor);
      if (!opts.append && d.tickets.length > 0 && !activeTicketId) {
        setActiveTicketId(d.tickets[0].id);
      }
      // Count open+pending across all loaded tickets for the tab dot indicator.
      // When viewing the open filter this equals merged.length; when viewing
      // other filters we do a quick separate count via a lightweight fetch.
      if (statusFilter === 'open') {
        onOpenCount?.(merged.filter(t => t.status !== 'closed').length);
      } else {
        // Fire-and-forget lightweight open count
        fetch('/api/admin/support/tickets?status=open,pending&limit=1', { cache: 'no-store' })
          .then(res => res.ok ? res.json() : null)
          .then((data: { tickets?: TicketListRow[] } | null) => {
            if (data?.tickets) onOpenCount?.(data.tickets.length);
          })
          .catch(() => {});
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load tickets');
    } finally {
      setListLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, committedSearch, activeTicketId]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  function submitSearch() {
    setCommittedSearch(search.trim());
    setTickets([]);
    setActiveTicketId(null);
    setNextCursor(null);
  }

  // Active ticket detail
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const r = await fetch(`/api/admin/support/tickets/${id}`, { cache: 'no-store' });
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
  }, []);

  useEffect(() => {
    if (activeTicketId) loadDetail(activeTicketId);
    else setDetail(null);
  }, [activeTicketId, loadDetail]);

  // ── Realtime: tickets list ────────────────────────────────────────────────
  const ticketsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedTicketsRefresh = useCallback(() => {
    if (ticketsRefreshTimerRef.current) clearTimeout(ticketsRefreshTimerRef.current);
    ticketsRefreshTimerRef.current = setTimeout(() => fetchTickets(), 400);
  }, [fetchTickets]);

  const [liveTickets, setLiveTickets] = useState(false);
  const pulseLive = useCallback(() => {
    setLiveTickets(true);
    setTimeout(() => setLiveTickets(false), 1500);
  }, []);

  useBroadcastChannel(
    supportChannels.tickets(),
    ['message', 'status'],
    useCallback((evt, payload) => {
      if (evt === 'message') {
        const m = payload as TicketMessageEvent;
        if (!m) return;
        pulseLive();
        // Bump existing row to top with new preview, or refetch for a brand-new ticket
        setTickets(prev => {
          const idx = prev.findIndex(t => t.id === m.ticketId);
          if (idx === -1) {
            debouncedTicketsRefresh();
            return prev;
          }
          const updated: TicketListRow = {
            ...prev[idx],
            status:               m.status,
            last_message_at:      m.createdAt,
            last_message_preview: m.body.slice(0, 200),
          };
          const rest = prev.filter((_, i) => i !== idx);
          return [updated, ...rest];
        });
      } else if (evt === 'status') {
        const s = payload as TicketStatusEvent;
        if (!s) return;
        pulseLive();
        setTickets(prev => prev.map(t => t.id === s.ticketId ? {
          ...t,
          status:                  s.status,
          priority:                s.priority,
          assigned_support_user_id: s.assignedSupportUserId,
        } : t));
      }
    }, [pulseLive, debouncedTicketsRefresh]),
  );

  // Active ticket realtime — append new messages instantly
  useBroadcastChannel(
    activeTicketId ? supportChannels.ticket(activeTicketId) : null,
    ['message', 'status'],
    useCallback((evt, payload) => {
      if (evt === 'message') {
        const m = payload as TicketMessageEvent;
        if (!m) return;
        setDetail(prev => {
          if (!prev || prev.ticket.id !== m.ticketId) return prev;
          if (prev.messages.some(x => x.id === m.messageId)) return prev;
          const newMsg: TicketDetail['messages'][number] = {
            id:                     m.messageId,
            sender_type:            m.senderType,
            sender_profile_id:      null,
            sender_member_id:       null,
            sender_support_user_id: null,
            body:                   m.body,
            attachments:            [],
            created_at:             m.createdAt,
          };
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
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    setReplyBody('');
    setSendStatus(null);
  }, [activeTicketId]);

  const supportUserId = me?.member?.id || actAsId;
  const canSend = Boolean(detail && replyBody.trim() && supportUserId && !sending && detail.ticket.status !== 'closed');

  async function send() {
    if (!detail || !canSend) return;
    setSending(true);
    setSendStatus(null);
    try {
      const r = await fetch(`/api/admin/support/tickets/${detail.ticket.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body:          replyBody.trim(),
          supportUserId: me?.superAdmin ? supportUserId : undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Send failed (${r.status})`);
      setSendStatus({ ok: true, msg: 'Reply sent' });
      setReplyBody('');
      await loadDetail(detail.ticket.id);
      // Refresh list so status pill / preview updates
      fetchTickets();
    } catch (e) {
      setSendStatus({ ok: false, msg: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setSending(false);
    }
  }

  async function updateStatus(updates: { status?: 'open' | 'pending' | 'closed'; priority?: 'low' | 'normal' | 'high'; assigned_support_user_id?: string | null }) {
    if (!detail) return;
    try {
      const r = await fetch(`/api/admin/support/tickets/${detail.ticket.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Update failed');
      await loadDetail(detail.ticket.id);
      fetchTickets();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed');
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 h-full min-h-[500px] lg:min-h-0 min-w-0 overflow-hidden">
      {/* Ticket list */}
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 overflow-hidden">
        <div className="p-3 border-b border-gray-200 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitSearch(); }}
              placeholder="Search subject, venue..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300 outline-none"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px]">
              {(['open', 'all', 'closed'] as const).map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => { setStatusFilter(opt); setActiveTicketId(null); setTickets([]); setNextCursor(null); }}
                  className={`px-2.5 py-1 font-medium transition-colors ${statusFilter === opt ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  {opt === 'open' ? 'Open + Pending' : opt === 'all' ? 'All' : 'Closed'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fetchTickets()}
              className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
            >
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-500">{tickets.length} ticket{tickets.length === 1 ? '' : 's'}</p>
            <LiveBadge active={liveTickets} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {listLoading && tickets.length === 0 && (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}
          {listError && (
            <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle size={12} className="inline mr-1" /> {listError}
            </div>
          )}
          {!listLoading && !listError && tickets.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-gray-400">
              <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-400" />
              No tickets {statusFilter === 'open' ? 'open' : 'matching'}.
            </div>
          )}
          {tickets.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTicketId(t.id)}
              className={`w-full text-left px-3 py-3 border-b border-gray-100 last:border-b-0 transition-colors ${
                activeTicketId === t.id ? 'bg-gray-50' : 'hover:bg-gray-50/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  {t.status !== 'closed' && <SlaDot iso={t.last_message_at} className="mt-1.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{t.subject}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Building2 size={11} className="text-gray-400 shrink-0" />
                      <span className="text-[11px] text-gray-500 truncate">{t.venue_name}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end shrink-0 gap-1">
                  <span className="text-[10px] text-gray-400">{relativeTime(t.last_message_at)}</span>
                  <div className="flex items-center gap-1">
                    <PriorityPill priority={t.priority} />
                    <StatusPill status={t.status} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                {t.last_message_preview || '(no messages)'}
              </p>
              <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-400">
                <span>From {t.opener_label}</span>
                <span>
                  {t.assigned_support_name
                    ? `Assigned to ${t.assigned_support_name}`
                    : 'Unassigned'}
                </span>
              </div>
            </button>
          ))}
          {nextCursor && (
            <div className="p-3">
              <button
                type="button"
                onClick={() => fetchTickets({ append: true, cursor: nextCursor })}
                disabled={listLoading}
                className="w-full text-xs font-medium text-gray-600 hover:text-gray-900 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                {listLoading ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Ticket detail */}
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 overflow-hidden">
        {!activeTicketId && (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm py-16">
            <LifeBuoy size={28} className="mb-2" />
            Select a ticket to view the conversation.
          </div>
        )}
        {activeTicketId && detailLoading && !detail && (
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
          <>
            <div className="border-b border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900 truncate">{detail.ticket.subject}</p>
                    <StatusPill status={detail.ticket.status} />
                    <PriorityPill priority={detail.ticket.priority} />
                    {detail.ticket.status !== 'closed' && <SlaPill iso={detail.ticket.last_message_at} size="sm" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500">
                    {detail.venue && (
                      <span className="inline-flex items-center gap-1">
                        <Building2 size={11} className="text-gray-400" /> {detail.venue.name}
                      </span>
                    )}
                    <span>From: <span className="text-gray-700 font-medium">{detail.opener.label}</span></span>
                    {detail.opener.email && <span className="text-gray-400">{detail.opener.email}</span>}
                    {detail.venue?.notification_email && <span>Notif: {detail.venue.notification_email}</span>}
                  </div>
                </div>
              </div>

              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px]">
                <select
                  value={detail.ticket.priority}
                  onChange={e => updateStatus({ priority: e.target.value as 'low' | 'normal' | 'high' })}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] cursor-pointer"
                >
                  <option value="low">Low priority</option>
                  <option value="normal">Normal priority</option>
                  <option value="high">High priority</option>
                </select>
                <select
                  value={detail.ticket.assigned_support_user_id || ''}
                  onChange={e => updateStatus({ assigned_support_user_id: e.target.value || null })}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {teamMembers.filter(m => m.active).map(m => (
                    <option key={m.id} value={m.id}>Assign → {m.name}</option>
                  ))}
                </select>
                {supportUserId && detail.ticket.assigned_support_user_id !== supportUserId && (
                  <button
                    type="button"
                    onClick={() => updateStatus({ assigned_support_user_id: supportUserId })}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <UserPlus size={11} /> Claim
                  </button>
                )}
                <span className="ml-auto" />
                {detail.ticket.status !== 'closed' ? (
                  <button
                    type="button"
                    onClick={() => updateStatus({ status: 'closed' })}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <X size={11} /> Close ticket
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateStatus({ status: 'open' })}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <CircleDot size={11} /> Reopen
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto bg-gray-50/30 px-4 py-4 space-y-3">
              {detail.messages.length === 0 && (
                <p className="text-center text-xs text-gray-400 py-8">No messages.</p>
              )}
              {detail.messages.map(m => {
                const isVenue = m.sender_type === 'venue';
                let label = 'Support';
                if (isVenue) {
                  if (m.sender_profile_id) {
                    label = detail.senders.profiles[m.sender_profile_id]?.full_name || 'Venue owner';
                  } else if (m.sender_member_id) {
                    const mem = detail.senders.members[m.sender_member_id];
                    label = mem ? ([mem.first_name, mem.last_name].filter(Boolean).join(' ').trim() || mem.email || 'Team member') : 'Team member';
                  }
                } else if (m.sender_support_user_id) {
                  label = detail.senders.support[m.sender_support_user_id]?.name || 'Support';
                }

                return (
                  <div key={m.id} className={`flex ${isVenue ? 'justify-start' : 'justify-end'}`}>
                    <div className="max-w-[75%] space-y-1">
                      <div className="flex items-center gap-2 text-[10px] text-gray-500">
                        <span className="font-semibold">{label}</span>
                        <span className="text-gray-400">{relativeTime(m.created_at)}</span>
                      </div>
                      <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        isVenue
                          ? 'bg-white border border-gray-200 text-gray-900'
                          : 'bg-gray-900 text-white'
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
              {detail.ticket.status === 'closed' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  This ticket is closed. Reopen it to send a reply.
                </div>
              )}
              {!supportUserId && (
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
              <textarea
                value={replyBody}
                onChange={e => setReplyBody(e.target.value)}
                placeholder={detail.ticket.status === 'closed' ? 'Ticket is closed' : 'Reply to this ticket…'}
                rows={3}
                disabled={detail.ticket.status === 'closed'}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300 disabled:bg-gray-50 disabled:cursor-not-allowed"
              />
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: BRAND }}
                >
                  {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {sending ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SupportInboxPanel;
