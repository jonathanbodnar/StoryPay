'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageCircle,
  MessageSquare,
  Minus,
  Plus,
  Search,
  Send,
  User,
  Users,
  Lock,
  Mail,
  ChevronRight,
  X,
  Star,
  Pin,
  Info,
  Phone,
  Smile,
  Paperclip,
  Zap,
} from 'lucide-react';
import { classNames } from '@/lib/utils';
import { EmojiPickerPopover } from '@/components/EmojiPickerPopover';

interface ThreadRow {
  thread_id: string;
  subject: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_visibility: string | null;
  unread_count: number;
  contact_first_name: string;
  contact_last_name: string;
  contact_email: string;
  contact_phone?: string | null;
  external_reply_channel?: string;
  venue_customer_id: string;
  has_starred?: boolean;
  has_pinned?: boolean;
}

interface ThreadDetail {
  id: string;
  subject: string;
  last_message_at: string;
  venue_customer_id: string;
  external_reply_channel?: string;
  contact_stage?: { name: string; color: string | null } | null;
  venue_customers: {
    id: string;
    first_name: string;
    last_name: string;
    customer_email: string;
    phone: string | null;
    sms_dnd?: boolean;
    conversation_dnd_all?: boolean;
    conversation_dnd_email?: boolean;
    conversation_dnd_calls?: boolean;
    conversation_dnd_inbound_sms?: boolean;
  } | null;
}

interface Msg {
  id: string;
  visibility: 'internal' | 'external';
  channel: string;
  body: string;
  sender_kind: string;
  created_at: string;
  external_email_sent?: boolean | null;
  send_error?: string | null;
  mentioned_member_ids?: string[];
  author_label?: string;
  email_subject?: string | null;
  is_starred?: boolean;
  is_pinned?: boolean;
  email_cc?: string | null;
  email_bcc?: string | null;
  contact_from_name?: string | null;
  contact_from_email?: string | null;
  trigger_link?: { short_code: string; name: string | null } | null;
  trigger_link_id?: string | null;
}

interface TriggerLinkOpt {
  id: string;
  name: string;
  short_code: string;
}

interface TeamMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}

type ComposerTab = 'team' | 'email' | 'sms';
type ThreadListFilter = 'all' | 'unread' | 'starred' | 'pinned';

export default function ConversationsPage() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [threadListFilter, setThreadListFilter] = useState<ThreadListFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [composerTab, setComposerTab] = useState<ComposerTab>('sms');
  // Collapsed by default — the composer starts as a single-line input and
  // blooms into the full editor on focus or as soon as the user types.
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [expandedEmailIds, setExpandedEmailIds] = useState<Set<string>>(new Set());
  const [emailSubject, setEmailSubject] = useState('');
  const [body, setBody] = useState('');
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<{ id: string; first_name: string; last_name: string; customer_email: string }[]>([]);
  const [creatingThread, setCreatingThread] = useState(false);
  const [newConversationError, setNewConversationError] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailBcc, setEmailBcc] = useState('');
  const [triggerLinkOptions, setTriggerLinkOptions] = useState<TriggerLinkOpt[]>([]);
  const [selectedTriggerLinkId, setSelectedTriggerLinkId] = useState<string>('');
  const [triggerModalOpen, setTriggerModalOpen] = useState(false);
  const [triggerSearch, setTriggerSearch] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [fileAttaching, setFileAttaching] = useState(false);
  const [dndSaving, setDndSaving] = useState(false);
  const [listActionError, setListActionError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerFileRef = useRef<HTMLInputElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const deepLinkConsumed = useRef(false);

  const loadThreads = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (threadListFilter === 'unread') params.set('unread', '1');
      if (threadListFilter === 'starred') params.set('starred', '1');
      if (threadListFilter === 'pinned') params.set('pinned', '1');
      const q = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/conversations/threads${q}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setThreads(Array.isArray(data) ? data : []);
        setListActionError('');
      }
    } finally {
      setLoadingList(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('storypay:conversations-unread'));
      }
    }
  }, [threadListFilter]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (deepLinkConsumed.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get('customer')?.trim();
    const customerFromEmail = params.get('customerFromEmail')?.trim();
    const uuidOk =
      !!customerId && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(customerId);
    if (!uuidOk && !customerFromEmail) return;

    deepLinkConsumed.current = true;

    const composeRaw = params.get('compose')?.trim().toLowerCase();
    const composeTab: ComposerTab | null =
      composeRaw === 'email' || composeRaw === 'sms' ? composeRaw : null;

    void (async () => {
      try {
        let threadId: string | undefined;

        if (uuidOk && customerId) {
          const res = await fetch('/api/conversations/threads');
          if (!res.ok) return;
          const list = (await res.json()) as ThreadRow[];
          const existing = Array.isArray(list)
            ? list.find((t) => t.venue_customer_id === customerId)
            : undefined;
          threadId = existing?.thread_id;
          if (!threadId) {
            const cre = await fetch('/api/conversations/threads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ venue_customer_id: customerId, subject: 'Conversation' }),
            });
            if (!cre.ok) return;
            const data = (await cre.json()) as { id?: string };
            threadId = data.id;
          }
        } else if (customerFromEmail) {
          const r = await fetch(
            `/api/conversations/open-or-create?email=${encodeURIComponent(customerFromEmail)}`,
          );
          if (!r.ok) return;
          const data = (await r.json()) as { thread_id?: string };
          threadId = data.thread_id;
        }

        if (!threadId) return;
        setSelectedId(threadId);
        if (composeTab) setComposerTab(composeTab);
        setMobileShowThread(true);
        await loadThreads();
        window.history.replaceState({}, '', '/dashboard/conversations');
      } catch {
        /* ignore */
      }
    })();
  }, [loadThreads]);

  useEffect(() => {
    if (loadingList || threads.length !== 1 || selectedId) return;
    setSelectedId(threads[0].thread_id);
    setMobileShowThread(true);
  }, [loadingList, threads, selectedId]);

  useEffect(() => {
    fetch('/api/team')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setTeam(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/marketing/trigger-links')
      .then((r) => r.json())
      .then((d: { links?: TriggerLinkOpt[] }) => {
        if (Array.isArray(d?.links)) setTriggerLinkOptions(d.links);
      })
      .catch(() => {});
  }, []);

  const reloadMessages = useCallback(async (id: string) => {
    setLoadingThread(true);
    setSendError('');
    try {
      const [tRes, mRes] = await Promise.all([
        fetch(`/api/conversations/threads/${id}`, { cache: 'no-store' }),
        fetch(`/api/conversations/threads/${id}/messages`, { cache: 'no-store' }),
      ]);
      if (tRes.ok) {
        const raw = (await tRes.json()) as ThreadDetail & {
          venue_customers?: ThreadDetail['venue_customers'] | unknown[];
          contact_stage?: ThreadDetail['contact_stage'];
        };
        const vc = raw.venue_customers;
        const venue_customers = Array.isArray(vc) ? (vc[0] as ThreadDetail['venue_customers']) ?? null : vc ?? null;
        setThreadDetail({
          ...raw,
          venue_customers,
          contact_stage: raw.contact_stage ?? null,
        });
      } else {
        const err = await tRes.json().catch(() => ({}));
        setThreadDetail(null);
        setSendError(typeof err?.error === 'string' ? err.error : 'Could not load conversation');
      }
      if (mRes.ok) setMessages(await mRes.json());
      else setMessages([]);
      if (tRes.ok) {
        await fetch(`/api/conversations/threads/${id}/read`, { method: 'POST' });
        await loadThreads();
      }
    } finally {
      setLoadingThread(false);
    }
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedId) {
      setThreadDetail(null);
      setMessages([]);
      return;
    }
    void reloadMessages(selectedId);
  }, [selectedId, reloadMessages]);

  useEffect(() => {
    if (!selectedId) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedId]);

  // Background poll — silently fetch new messages every 5 s without triggering
  // the slow GHL sync (nosync=1). Keeps the thread live for back-and-forth SMS.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(async () => {
      // Skip if the tab is hidden to save resources.
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await fetch(
          `/api/conversations/threads/${selectedId}/messages?nosync=1`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const fresh = await res.json();
        // Only update state if the message count changed to avoid unnecessary re-renders.
        setMessages(prev => {
          if (!Array.isArray(fresh)) return prev;
          if (fresh.length !== prev.length) return fresh;
          // Also check if the latest message id changed (e.g. a new message arrived
          // with the same count as a deleted one — extremely unlikely but safe).
          const lastFresh = fresh[fresh.length - 1]?.id;
          const lastPrev  = prev[prev.length - 1]?.id;
          return lastFresh !== lastPrev ? fresh : prev;
        });
      } catch { /* network hiccup — ignore, next tick will retry */ }
    }, 5_000);
    return () => clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    if (!composerExpanded) return;
    const node = composerTextareaRef.current;
    if (!node) return;
    node.focus();
    const len = node.value.length;
    try {
      node.setSelectionRange(len, len);
    } catch {
      // Some browsers throw for number/email inputs; safe to ignore.
    }
  }, [composerExpanded]);

  useEffect(() => {
    setComposerTab('sms');
    setEmailSubject('');
    setBody('');
    setMentionedIds([]);
    setSendError('');
    setEmailCc('');
    setEmailBcc('');
    setSelectedTriggerLinkId('');
    setComposerExpanded(false);
    setComposerMenuOpen(false);
    setExpandedEmailIds(new Set());
  }, [selectedId]);

  const contactLabel = useMemo(() => {
    if (threadDetail?.venue_customers) {
      const v = threadDetail.venue_customers;
      return [v.first_name, v.last_name].filter(Boolean).join(' ') || v.customer_email || 'Contact';
    }
    const row = threads.find((t) => t.thread_id === selectedId);
    if (row) {
      return [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' ') || row.contact_email || 'Contact';
    }
    return 'Contact';
  }, [threadDetail, threads, selectedId]);

  const contactProfileHref = threadDetail?.venue_customer_id
    ? `/dashboard/contacts/${threadDetail.venue_customer_id}`
    : null;

  const selectedTriggerMeta = useMemo(
    () => triggerLinkOptions.find((t) => t.id === selectedTriggerLinkId),
    [triggerLinkOptions, selectedTriggerLinkId],
  );

  const filteredTriggerLinks = useMemo(() => {
    const q = triggerSearch.trim().toLowerCase();
    if (!q) return triggerLinkOptions;
    return triggerLinkOptions.filter(
      (tl) =>
        tl.name.toLowerCase().includes(q) || tl.short_code.toLowerCase().includes(q),
    );
  }, [triggerLinkOptions, triggerSearch]);

  const triggerPreviewBase = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const raw = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '');
    try {
      return new URL(raw).hostname;
    } catch {
      return window.location.hostname;
    }
  }, []);

  async function handleComposerAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedId) return;
    setFileAttaching(true);
    setSendError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/conversations/threads/${selectedId}/sms-attachment`, {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string; filename?: string };
      if (!res.ok) {
        setSendError(data.error || 'Could not attach file');
        return;
      }
      if (data.url && data.filename) {
        const line = `${data.filename}: ${data.url}`;
        setBody((prev) => (prev.trim() ? `${prev.trim()}\n\n${line}` : line));
      }
    } finally {
      setFileAttaching(false);
    }
  }

  const threadsFiltered = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    const base = !q
      ? threads
      : threads.filter((t) => {
          const name = [t.contact_first_name, t.contact_last_name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          const em = (t.contact_email || '').toLowerCase();
          const ph = (t.contact_phone || '').toLowerCase();
          return name.includes(q) || em.includes(q) || ph.includes(q);
        });
    return [...base].sort((a, b) => {
      const ap = a.has_pinned ? 1 : 0;
      const bp = b.has_pinned ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });
  }, [threads, threadSearch]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    if (composerTab !== 'team' && mentionedIds.length > 0) return;

    const canSendExternal = body.trim() || !!selectedTriggerLinkId;
    if (composerTab === 'team' && !body.trim()) return;
    if (composerTab !== 'team' && !canSendExternal) return;

    setSending(true);
    setSendError('');
    try {
      const visibility = composerTab === 'team' ? 'internal' : 'external';
      const payload: Record<string, unknown> = {
        visibility,
        body: body.trim(),
        mentioned_member_ids: composerTab === 'team' ? mentionedIds : [],
      };
      if (composerTab === 'email') {
        payload.external_channel = 'email';
        payload.email_subject = emailSubject.trim();
        if (emailCc.trim()) payload.email_cc = emailCc.trim();
        if (emailBcc.trim()) payload.email_bcc = emailBcc.trim();
        if (selectedTriggerLinkId) payload.trigger_link_id = selectedTriggerLinkId;
      }
      if (composerTab === 'sms') {
        payload.external_channel = 'sms';
        if (selectedTriggerLinkId) payload.trigger_link_id = selectedTriggerLinkId;
      }

      const res = await fetch(`/api/conversations/threads/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(data.error || 'Failed to send');
        return;
      }
      setBody('');
      setEmailSubject('');
      setMentionedIds([]);
      setEmailCc('');
      setEmailBcc('');
      setSelectedTriggerLinkId('');
      setComposerExpanded(false);
      await reloadMessages(selectedId);
      await loadThreads();
    } finally {
      setSending(false);
    }
  }

  function toggleMention(id: string) {
    setMentionedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function patchContactDnd(updates: Record<string, boolean>) {
    const cid = threadDetail?.venue_customers?.id;
    if (!cid) return;
    setDndSaving(true);
    try {
      const res = await fetch(`/api/venue-customers/${cid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return;
      if (selectedId) await reloadMessages(selectedId);
      await loadThreads();
    } finally {
      setDndSaving(false);
    }
  }

  async function toggleThreadStarPin(
    threadId: string,
    field: 'is_starred' | 'is_pinned',
    e: React.MouseEvent,
  ) {
    e.stopPropagation();
    e.preventDefault();
    setListActionError('');
    const res = await fetch(`/api/conversations/threads/${threadId}/toggle-star-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field }),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
    if (!res.ok) {
      const msg = [data.error, data.hint].filter(Boolean).join(' — ') || `Request failed (${res.status})`;
      setListActionError(msg);
      console.error('[conversations] star/pin toggle:', msg);
      return;
    }
    await loadThreads();
    if (selectedId === threadId) await reloadMessages(threadId);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (!showNew || !contactSearch.trim()) {
        setContactResults([]);
        return;
      }
      fetch(`/api/conversations/contact-search?search=${encodeURIComponent(contactSearch.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d)) setContactResults(d.slice(0, 20));
        })
        .catch(() => setContactResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [contactSearch, showNew]);

  async function createThreadForContact(venueCustomerId: string) {
    setCreatingThread(true);
    setNewConversationError('');
    try {
      const res = await fetch('/api/conversations/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_customer_id: venueCustomerId, subject: 'Conversation' }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || 'Could not start conversation';
        setNewConversationError(msg);
        setSendError(msg);
        return;
      }
      setShowNew(false);
      setContactSearch('');
      setSelectedId(data.id);
      setMobileShowThread(true);
      await loadThreads();
    } finally {
      setCreatingThread(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col gap-0 sm:h-[calc(100vh-6rem)]">
      <div className="mb-4 flex flex-shrink-0 flex-wrap items-start justify-between gap-3 px-1">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Conversations</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowNew(true);
            setNewConversationError('');
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
        >
          <Plus size={18} />
          New conversation
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {/* Thread list */}
        <aside
          className={classNames(
            'flex w-full flex-shrink-0 flex-col border-gray-200 bg-gray-50/80 md:w-[min(100%,300px)] md:border-r',
            mobileShowThread ? 'hidden md:flex' : 'flex',
          )}
        >
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 p-3">
            {listActionError ? (
              <p className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {listActionError}
              </p>
            ) : null}
            {(
              [
                { id: 'all' as const, label: 'All' },
                { id: 'unread' as const, label: 'Unread' },
                { id: 'starred' as const, label: 'Starred' },
                { id: 'pinned' as const, label: 'Pinned' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setThreadListFilter(tab.id)}
                className={classNames(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  threadListFilter === tab.id
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 border border-gray-200',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex-shrink-0 border-b border-gray-200 p-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={threadSearch}
                onChange={(e) => setThreadSearch(e.target.value)}
                placeholder="Search by name, email, or phone…"
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400"
                style={{ fontSize: 16 }}
              />
            </div>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="flex justify-center py-12 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : threads.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">
                {threadListFilter === 'starred'
                  ? 'No starred conversations. Star a thread from the list using the star icon.'
                  : threadListFilter === 'pinned'
                    ? 'No pinned conversations. Pin a thread from the list using the pin icon.'
                    : threadListFilter === 'unread'
                      ? 'No unread conversations.'
                      : 'No conversations yet. Start one with a contact.'}
              </p>
            ) : threadsFiltered.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">
                No threads match your search.
              </p>
            ) : (
              threadsFiltered.map((t) => {
                const name =
                  [t.contact_first_name, t.contact_last_name].filter(Boolean).join(' ') ||
                  t.contact_email ||
                  'Contact';
                const unreadN = Number(t.unread_count ?? 0);
                const unread = unreadN > 0;
                return (
                  <div
                    key={t.thread_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedId(t.thread_id);
                      setMobileShowThread(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(t.thread_id);
                        setMobileShowThread(true);
                      }
                    }}
                    className={classNames(
                      'flex w-full cursor-pointer flex-col gap-0.5 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-white',
                      selectedId === t.thread_id ? 'bg-white border-l-[3px] border-l-neutral-900' : '',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={classNames('min-w-0 truncate text-sm font-semibold', unread ? 'text-gray-900' : 'text-gray-700')}>
                        {name}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          title={t.has_starred ? 'Remove star' : 'Star thread'}
                          onClick={(e) => void toggleThreadStarPin(t.thread_id, 'is_starred', e)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-amber-600"
                        >
                          <Star
                            size={15}
                            className={t.has_starred ? 'fill-amber-400 text-amber-500' : ''}
                          />
                        </button>
                        <button
                          type="button"
                          title={t.has_pinned ? 'Unpin' : 'Pin thread'}
                          onClick={(e) => void toggleThreadStarPin(t.thread_id, 'is_pinned', e)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-sky-700"
                        >
                          <Pin size={15} className={t.has_pinned ? 'text-sky-600' : ''} />
                        </button>
                        {unread ? (
                          <span className="flex items-center gap-1 pl-0.5">
                            {unreadN > 1 ? (
                              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                                {unreadN > 99 ? '99+' : unreadN}
                              </span>
                            ) : (
                              <span className="h-2 w-2 rounded-full bg-red-500" />
                            )}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className="truncate text-xs text-gray-500">
                      {t.last_message_preview || t.subject || 'No messages'}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
                      {t.external_reply_channel === 'sms' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0 text-violet-900">
                          <MessageSquare size={10} /> SMS
                        </span>
                      )}
                      {t.last_message_visibility === 'internal' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0 text-amber-800">
                          <Lock size={10} /> Team
                        </span>
                      )}
                      {t.last_message_visibility === 'external' && t.external_reply_channel !== 'sms' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0 text-sky-800">
                          <Mail size={10} /> Email
                        </span>
                      )}
                      {t.last_message_visibility === 'external' && t.external_reply_channel === 'sms' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-sky-100/80 px-1.5 py-0 text-sky-900">
                          Client
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Thread pane */}
        <section
          className={classNames(
            'flex min-h-0 min-w-0 flex-1 flex-col bg-white',
            !mobileShowThread ? 'hidden md:flex' : 'flex',
          )}
        >
          {selectedId && threadDetail ? (
            <>
              <header className="flex flex-shrink-0 items-center gap-3 border-b border-gray-100 px-3 py-3 sm:px-5">
                <button
                  type="button"
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 md:hidden"
                  aria-label="Back to list"
                  onClick={() => setMobileShowThread(false)}
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-gray-900">{contactLabel}</p>
                  <p className="truncate text-xs text-gray-500">
                    {threadDetail.external_reply_channel === 'sms' ? (
                      <>
                        <span className="inline-flex items-center gap-0.5 font-medium text-violet-800">
                          <MessageSquare size={12} /> SMS
                        </span>
                        {threadDetail.venue_customers?.phone ?
                          <> · {threadDetail.venue_customers.phone}</>
                        : null}
                      </>
                    ) : (
                      threadDetail.venue_customers?.customer_email
                    )}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                  {threadDetail.contact_stage?.name ? (
                    <span
                      className="inline-flex max-w-[140px] truncate rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-800 sm:max-w-[200px]"
                      style={
                        threadDetail.contact_stage.color
                          ? {
                              borderColor: threadDetail.contact_stage.color,
                              backgroundColor: `${threadDetail.contact_stage.color}18`,
                            }
                          : undefined
                      }
                      title={threadDetail.contact_stage.name}
                    >
                      {threadDetail.contact_stage.name}
                    </span>
                  ) : null}
                  {contactProfileHref ? (
                    <Link
                      href={contactProfileHref}
                      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <User size={14} />
                      Profile
                      <ChevronRight size={14} className="text-gray-400" />
                    </Link>
                  ) : null}
                </div>
              </header>

              {threadDetail.venue_customers ? (
                <div className="flex-shrink-0 border-b border-gray-100 bg-white px-3 py-3 sm:px-5">
                  <div className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Do not disturb
                    </p>
                    <p className="mb-3 text-xs text-gray-500">
                      Blocks outbound messages from this inbox. If a lead texts STOP, SMS DND is turned on
                      automatically (and inbound SMS preference below).
                    </p>
                    <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 border-b border-gray-200 pb-4 text-sm font-medium text-gray-800">
                      <span>DND all channels</span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={!!threadDetail.venue_customers.conversation_dnd_all}
                        disabled={dndSaving}
                        onChange={(e) => {
                          if (e.target.checked) {
                            void patchContactDnd({
                              conversation_dnd_all: true,
                              conversation_dnd_email: true,
                              sms_dnd: true,
                              conversation_dnd_inbound_sms: true,
                            });
                          } else {
                            void patchContactDnd({ conversation_dnd_all: false });
                          }
                        }}
                      />
                    </label>
                    <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      or
                    </p>
                    <div className="flex flex-col gap-3 text-sm font-medium text-gray-800">
                      <label className="flex cursor-pointer items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <Mail size={16} className="shrink-0 text-gray-500" /> Email
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={!!threadDetail.venue_customers.conversation_dnd_email}
                          disabled={dndSaving}
                          onChange={(e) => void patchContactDnd({ conversation_dnd_email: e.target.checked })}
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <MessageCircle size={16} className="shrink-0 text-gray-500" /> Text messages
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={!!threadDetail.venue_customers.sms_dnd}
                          disabled={dndSaving}
                          onChange={(e) => void patchContactDnd({ sms_dnd: e.target.checked })}
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <Phone size={16} className="shrink-0 text-gray-500" /> Calls &amp; voicemail
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={!!threadDetail.venue_customers.conversation_dnd_calls}
                          disabled={dndSaving}
                          onChange={(e) => void patchContactDnd({ conversation_dnd_calls: e.target.checked })}
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-between gap-3">
                        <span className="flex flex-1 items-center gap-2">
                          <span className="shrink-0 text-gray-500" aria-hidden>
                            ↙
                          </span>
                          <span>Inbound calls &amp; SMS</span>
                          <span
                            className="inline-flex text-gray-400"
                            title="Preference for inbound handling. Opt-out keywords also set SMS DND."
                          >
                            <Info size={14} />
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-gray-300"
                          checked={!!threadDetail.venue_customers.conversation_dnd_inbound_sms}
                          disabled={dndSaving}
                          onChange={(e) =>
                            void patchContactDnd({ conversation_dnd_inbound_sms: e.target.checked })
                          }
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              <div
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {loadingThread ? (
                  <div className="flex justify-center py-16 text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-12 text-center text-sm text-gray-500">No messages yet. Say hello below.</p>
                ) : (
                  <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
                    {messages.map((m) => {
                      const isInternal = m.visibility === 'internal';
                      const fromContact = m.sender_kind === 'contact';
                      const fromUs = m.sender_kind === 'owner' || m.sender_kind === 'team';
                      const alignRight = fromUs && !fromContact;
                      const isEmail = !isInternal && m.channel === 'email';
                      const emailExpanded = expandedEmailIds.has(m.id);
                      const toggleEmail = () => {
                        setExpandedEmailIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        });
                      };
                      const host =
                        typeof window !== 'undefined' ? window.location.host : 'app';
                      const triggerHref = m.trigger_link?.short_code
                        ? `/t/${m.trigger_link.short_code}`
                        : null;
                      const ChannelIcon = isInternal
                        ? Lock
                        : m.channel === 'sms'
                          ? MessageSquare
                          : Mail;
                      const channelLabel = isInternal
                        ? 'Team only'
                        : m.channel === 'sms'
                          ? 'SMS'
                          : 'Email';
                      const badgeClass = isInternal
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : m.channel === 'sms'
                          ? 'border-gray-300 bg-gray-100 text-gray-600'
                          : 'border-gray-300 bg-gray-100 text-gray-600';
                      const timestamp = new Date(m.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      });
                      return (
                        <div
                          key={m.id}
                          className={classNames(
                            'flex min-w-0 items-start gap-1.5',
                            isEmail ? 'w-full max-w-full' : 'max-w-[88%]',
                            alignRight && !isEmail ? 'ml-auto flex-row-reverse' : 'mr-auto',
                            alignRight && isEmail ? 'flex-row-reverse' : '',
                          )}
                        >
                          <div
                            className={classNames(
                              'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                              badgeClass,
                            )}
                            title={channelLabel}
                            aria-label={channelLabel}
                          >
                            <ChannelIcon size={10} strokeWidth={2} />
                          </div>
                          <div
                            className={classNames(
                              'flex min-w-0 flex-col gap-0.5',
                              isEmail ? 'flex-1' : '',
                              alignRight && !isEmail ? 'items-end' : 'items-start',
                            )}
                          >
                            {isEmail ? (
                              <EmailCard
                                subject={m.email_subject || '(no subject)'}
                                body={m.body}
                                cc={m.email_cc || null}
                                bcc={m.email_bcc || null}
                                timestamp={timestamp}
                                fullTimestamp={new Date(m.created_at).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                                authorLabel={m.author_label}
                                fromName={
                                  fromUs
                                    ? m.author_label || 'You'
                                    : m.contact_from_name ||
                                      [
                                        threadDetail?.venue_customers?.first_name,
                                        threadDetail?.venue_customers?.last_name,
                                      ]
                                        .filter(Boolean)
                                        .join(' ') ||
                                      'Contact'
                                }
                                fromEmail={
                                  fromUs
                                    ? null
                                    : m.contact_from_email ||
                                      threadDetail?.venue_customers?.customer_email ||
                                      null
                                }
                                toName={
                                  fromUs
                                    ? [
                                        threadDetail?.venue_customers?.first_name,
                                        threadDetail?.venue_customers?.last_name,
                                      ]
                                        .filter(Boolean)
                                        .join(' ') || null
                                    : 'You'
                                }
                                toEmail={
                                  fromUs
                                    ? threadDetail?.venue_customers?.customer_email || null
                                    : null
                                }
                                direction={fromUs ? 'outgoing' : 'incoming'}
                                expanded={emailExpanded}
                                onToggle={toggleEmail}
                                onReply={() => {
                                  setComposerTab('email');
                                  setComposerExpanded(true);
                                  setEmailSubject((s) => {
                                    if (s.trim()) return s;
                                    const sub = (m.email_subject || '').trim();
                                    if (!sub) return '';
                                    return /^re:/i.test(sub) ? sub : `Re: ${sub}`;
                                  });
                                  setTimeout(
                                    () => composerTextareaRef.current?.focus(),
                                    60,
                                  );
                                }}
                                triggerHref={triggerHref}
                                triggerShort={m.trigger_link?.short_code ?? null}
                                triggerName={m.trigger_link?.name ?? null}
                                host={host}
                              />
                            ) : (
                              <>
                                <div
                                  className={classNames(
                                    'max-w-full rounded-2xl px-3 py-1.5 text-[13px] leading-snug [overflow-wrap:anywhere]',
                                    isInternal
                                      ? 'border border-amber-200/80 bg-amber-50 text-amber-950'
                                      : fromContact
                                        ? 'border border-gray-200 bg-gray-100 text-gray-900'
                                        : 'border border-gray-300 bg-gray-200 text-gray-900',
                                  )}
                                >
                                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                                  {triggerHref && m.trigger_link && (
                                    <p className="mt-1.5 text-[11px] text-gray-700">
                                      <Link
                                        href={triggerHref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-medium text-sky-700 underline"
                                      >
                                        {host}/t/{m.trigger_link.short_code}
                                      </Link>
                                      {m.trigger_link.name ? (
                                        <span className="text-gray-500"> — {m.trigger_link.name}</span>
                                      ) : null}
                                    </p>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10px] text-gray-400">
                                  <span>{timestamp}</span>
                                  {m.visibility === 'external' && m.external_email_sent === false && m.send_error && (
                                    <span className="text-amber-600">
                                      {m.channel === 'sms' ? 'SMS not sent' : 'Email not sent'}: {m.send_error}
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 border-t border-gray-100 bg-gray-50/90 px-3 py-3 sm:px-5">
                <div className="mx-auto max-w-xl">
                  {!composerExpanded && !body.trim() && !emailSubject.trim() ? (
                    <CollapsedComposer
                      composerTab={composerTab}
                      menuOpen={composerMenuOpen}
                      onToggleMenu={() => setComposerMenuOpen((v) => !v)}
                      onCloseMenu={() => setComposerMenuOpen(false)}
                      onChooseTab={(tab) => {
                        setComposerTab(tab);
                        setComposerMenuOpen(false);
                        if (tab !== 'team') setMentionedIds([]);
                      }}
                      onExpand={() => setComposerExpanded(true)}
                      onInputChange={(v) => {
                        setBody(v);
                        setComposerExpanded(true);
                      }}
                    />
                  ) : (
                  <>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex flex-1 rounded-2xl bg-gray-200/80 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setComposerTab('sms');
                        setMentionedIds([]);
                        setSendError('');
                      }}
                      className={classNames(
                        'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors sm:text-xs',
                        composerTab === 'sms'
                          ? 'bg-white text-gray-900 border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900',
                      )}
                    >
                      <MessageSquare size={14} className="hidden shrink-0 sm:inline" />
                      <span className="truncate">SMS</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setComposerTab('email');
                        setMentionedIds([]);
                        setSendError('');
                      }}
                      className={classNames(
                        'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors sm:text-xs',
                        composerTab === 'email'
                          ? 'bg-white text-gray-900 border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900',
                      )}
                    >
                      <Mail size={14} className="hidden shrink-0 sm:inline" />
                      <span className="truncate">Email</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setComposerTab('team');
                        setSendError('');
                      }}
                      className={classNames(
                        'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors sm:text-xs',
                        composerTab === 'team'
                          ? 'bg-white text-gray-900 border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900',
                      )}
                    >
                      <Lock size={14} className="hidden shrink-0 sm:inline" />
                      <span className="truncate">Team only</span>
                    </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setComposerExpanded(false);
                        setBody('');
                        setEmailSubject('');
                        setEmailCc('');
                        setEmailBcc('');
                        setSelectedTriggerLinkId('');
                        setSendError('');
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                      aria-label="Minimize composer"
                      title="Minimize"
                    >
                      <Minus size={14} />
                    </button>
                  </div>
                  {composerTab === 'team' && (
                    <p className="mb-2 text-[11px] text-gray-500">
                      Visible only to your team. @mentions notify teammates.
                    </p>
                  )}

                  {composerTab === 'team' && team.length > 0 && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        <Users size={12} />
                        Notify
                      </span>
                      {team.map((mem) => {
                        const label = [mem.first_name, mem.last_name].filter(Boolean).join(' ') || mem.email || 'Member';
                        const on = mentionedIds.includes(mem.id);
                        return (
                          <button
                            key={mem.id}
                            type="button"
                            onClick={() => toggleMention(mem.id)}
                            className={classNames(
                              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                              on
                                ? 'border-amber-400 bg-amber-100 text-amber-950'
                                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                            )}
                          >
                            @{label.split(' ')[0]}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <form onSubmit={handleSend} className="flex flex-col gap-2">
                    {composerTab === 'email' && (
                      <>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            Subject
                          </label>
                          <input
                            type="text"
                            value={emailSubject}
                            onChange={(e) => setEmailSubject(e.target.value)}
                            placeholder="Enter subject"
                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
                            style={{ fontSize: 16 }}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              CC
                            </label>
                            <input
                              type="text"
                              value={emailCc}
                              onChange={(e) => setEmailCc(e.target.value)}
                              placeholder="email@example.com, …"
                              autoComplete="off"
                              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
                              style={{ fontSize: 16 }}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              BCC
                            </label>
                            <input
                              type="text"
                              value={emailBcc}
                              onChange={(e) => setEmailBcc(e.target.value)}
                              placeholder="email@example.com, …"
                              autoComplete="off"
                              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
                              style={{ fontSize: 16 }}
                            />
                          </div>
                        </div>
                      </>
                    )}
                    <div>
                      {composerTab === 'email' && (
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Message
                        </label>
                      )}
                      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white focus-within:border-gray-500">
                        <textarea
                          ref={composerTextareaRef}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          rows={composerTab === 'team' ? 3 : 4}
                          placeholder={
                            composerTab === 'team'
                              ? 'Write a team note…'
                              : 'Type a message…'
                          }
                          className="block w-full resize-none border-0 bg-transparent px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                          style={{ fontSize: 16 }}
                        />
                        {selectedTriggerMeta && (composerTab === 'email' || composerTab === 'sms') && (
                          <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
                            <Zap size={14} className="shrink-0 text-amber-700" />
                            <span className="min-w-0 flex-1 font-medium truncate">
                              {selectedTriggerMeta.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedTriggerLinkId('')}
                              className="shrink-0 rounded-lg p-1 text-amber-800 hover:bg-amber-100"
                              aria-label="Remove trigger link"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                        {(composerTab === 'email' || composerTab === 'sms') && (
                          <div className="flex flex-wrap items-center gap-0.5 border-t border-gray-100 bg-white px-2 py-1">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setEmojiPickerOpen((o) => !o)}
                                className={classNames(
                                  'rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800',
                                  emojiPickerOpen && 'bg-gray-100 text-gray-800',
                                )}
                                aria-label="Insert emoji"
                              >
                                <Smile size={16} strokeWidth={1.75} />
                              </button>
                              {emojiPickerOpen && (
                                <EmojiPickerPopover
                                  onSelect={(ch) => setBody((b) => b + ch)}
                                  onClose={() => setEmojiPickerOpen(false)}
                                />
                              )}
                            </div>
                            <input
                              ref={composerFileRef}
                              type="file"
                              className="sr-only"
                              onChange={handleComposerAttachmentChange}
                            />
                            <button
                              type="button"
                              disabled={fileAttaching}
                              onClick={() => composerFileRef.current?.click()}
                              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
                              aria-label="Attach file"
                              title="Upload a file (link is inserted into the message)"
                            >
                              {fileAttaching ? (
                                <Loader2 size={16} className="animate-spin" strokeWidth={1.75} />
                              ) : (
                                <Paperclip size={16} strokeWidth={1.75} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setTriggerSearch('');
                                setTriggerModalOpen(true);
                              }}
                              className={classNames(
                                'rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800',
                                selectedTriggerLinkId && 'bg-sky-50 text-sky-700',
                              )}
                              aria-label="Trigger links"
                              title="Insert a trigger link"
                            >
                              <Zap size={16} strokeWidth={1.75} />
                            </button>
                            {composerTab === 'sms' && (
                              <span className="ml-auto pr-1 text-[10px] tabular-nums text-gray-400">
                                {body.length} chars
                                {body.length > 0 ? (
                                  <> · {Math.max(1, Math.ceil(body.length / 160))} seg</>
                                ) : null}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {sendError && <p className="text-xs text-red-600">{sendError}</p>}
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={
                          sending ||
                          (composerTab === 'team' ? !body.trim() : !body.trim() && !selectedTriggerLinkId)
                        }
                        className="inline-flex items-center gap-2 rounded-xl bg-[#171717] px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={16} />}
                        {composerTab === 'team' ?
                          'Send team note'
                        : composerTab === 'sms' ?
                          'Send SMS'
                        : 'Send email'}
                      </button>
                    </div>
                  </form>
                  </>
                  )}
                </div>
              </div>
            </>
          ) : selectedId && loadingThread && !threadDetail ? (
            <div className="flex flex-1 items-center justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
            </div>
          ) : selectedId && !threadDetail && sendError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <MessageCircle size={40} className="text-gray-300" strokeWidth={1.25} />
              <p className="text-sm text-red-600">{sendError}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-gray-500">
              <MessageCircle size={40} className="text-gray-300" strokeWidth={1.25} />
              <p className="text-sm">Select a conversation or start a new one.</p>
            </div>
          )}
        </section>
      </div>

      {triggerModalOpen && (
        <div
          className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trigger-links-title"
          onClick={() => setTriggerModalOpen(false)}
        >
          <div
            className="flex max-h-[min(480px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p id="trigger-links-title" className="font-semibold text-gray-900">
                Trigger links
              </p>
              <button
                type="button"
                onClick={() => setTriggerModalOpen(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="border-b border-gray-100 px-3 py-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={triggerSearch}
                  onChange={(e) => setTriggerSearch(e.target.value)}
                  placeholder="Search trigger links"
                  className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-sm"
                  style={{ fontSize: 16 }}
                  autoFocus
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredTriggerLinks.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-500">
                  {triggerLinkOptions.length === 0 ?
                    'No trigger links yet. Add them in Marketing → Trigger links.'
                  : 'No matches.'}
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {filteredTriggerLinks.map((tl) => (
                    <li key={tl.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTriggerLinkId(tl.id);
                          setTriggerModalOpen(false);
                        }}
                        className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <span className="font-semibold text-gray-900">{tl.name}</span>
                        <span className="break-all font-mono text-[11px] text-gray-500">
                          {triggerPreviewBase ?
                            `${triggerPreviewBase}/t/${tl.short_code}`
                          : `/t/${tl.short_code}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-t-2xl border border-gray-200 bg-white sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="font-semibold text-gray-900">New conversation</p>
              <button
                type="button"
                onClick={() => {
                  setShowNew(false);
                  setContactSearch('');
                  setNewConversationError('');
                }}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              {newConversationError && (
                <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {newConversationError}
                </p>
              )}
              <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts by name, email, or phone…"
                  className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-sm"
                  style={{ fontSize: 16 }}
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100">
                {contactResults.map((c) => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.customer_email;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={creatingThread}
                      onClick={() => createThreadForContact(c.id)}
                      className="flex w-full flex-col items-start gap-0.5 border-b border-gray-50 px-3 py-2.5 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="font-medium text-gray-900">{name}</span>
                      <span className="text-xs text-gray-500">{c.customer_email}</span>
                    </button>
                  );
                })}
                {contactSearch.trim() && contactResults.length === 0 && !creatingThread && (
                  <p className="px-3 py-6 text-center text-xs text-gray-400">No contacts match.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailCard({
  subject,
  body,
  cc,
  bcc,
  timestamp,
  fullTimestamp,
  authorLabel,
  fromName,
  fromEmail,
  toName,
  toEmail,
  expanded,
  onToggle,
  onReply,
  triggerHref,
  triggerShort,
  triggerName,
  host,
}: {
  subject: string;
  body: string;
  cc: string | null;
  bcc: string | null;
  timestamp: string;
  fullTimestamp: string;
  authorLabel?: string;
  fromName: string;
  fromEmail: string | null;
  toName: string | null;
  toEmail: string | null;
  direction: 'incoming' | 'outgoing';
  expanded: boolean;
  onToggle: () => void;
  onReply: () => void;
  triggerHref: string | null;
  triggerShort: string | null;
  triggerName: string | null;
  host: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Strip heavy whitespace for the collapsed preview so we don't stretch the
  // one-line summary with stray newlines/indents copy-pasted from the email.
  const preview = body.replace(/\s+/g, ' ').trim();
  const initials = (fromName || authorLabel || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Close the caret / kebab popovers on outside click so they behave like a
  // normal email client's "details" flyout.
  useEffect(() => {
    if (!detailsOpen && !menuOpen) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (detailsRef.current && !detailsRef.current.contains(t)) setDetailsOpen(false);
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [detailsOpen, menuOpen]);

  const details = (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-gray-700 [overflow-wrap:anywhere]">
      <span className="text-gray-500">From:</span>
      <span className="min-w-0 break-words">
        <span className="font-medium text-gray-900">{fromName}</span>
        {fromEmail ? <span className="text-gray-500"> &lt;{fromEmail}&gt;</span> : null}
      </span>
      <span className="text-gray-500">To:</span>
      <span className="min-w-0 break-words">
        {toName ? <span className="font-medium text-gray-900">{toName}</span> : null}
        {toEmail ? <span className="text-gray-500"> &lt;{toEmail}&gt;</span> : null}
        {!toName && !toEmail ? <span className="text-gray-400">—</span> : null}
      </span>
      {cc ? (
        <>
          <span className="text-gray-500">CC:</span>
          <span className="min-w-0 break-words text-gray-700">{cc}</span>
        </>
      ) : null}
      {bcc ? (
        <>
          <span className="text-gray-500">BCC:</span>
          <span className="min-w-0 break-words text-gray-700">{bcc}</span>
        </>
      ) : null}
      <span className="text-gray-500">Date:</span>
      <span className="min-w-0">{fullTimestamp}</span>
      <span className="text-gray-500">Subject:</span>
      <span className="min-w-0 break-words font-medium text-gray-900">{subject}</span>
    </div>
  );

  return (
    <div
      className={classNames(
        'relative w-full min-w-0 max-w-full rounded-xl border border-gray-200 bg-white',
        expanded ? '' : 'overflow-hidden',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className={classNames(
          'flex w-full min-w-0 items-center justify-between gap-2 border-b border-gray-200 bg-gray-100 px-3 py-2 text-left',
          expanded ? 'rounded-t-xl' : 'rounded-t-xl',
        )}
        aria-expanded={expanded}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900">
          {subject}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-gray-500">
          {expanded ? (
            <ChevronUp size={14} className="text-gray-500" />
          ) : (
            <ChevronDown size={14} className="text-gray-500" />
          )}
        </span>
      </button>

      {expanded ? (
        <div className="min-w-0 px-3 pb-3 pt-3 text-[13px] leading-relaxed text-gray-800 [overflow-wrap:anywhere]">
          {/* Gmail-style header: avatar, from, to w/ details caret, reply + kebab */}
          <div className="mb-3 flex min-w-0 items-start gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate text-[13px] font-semibold text-gray-900">
                  {fromName}
                </span>
              </div>
              <div ref={detailsRef} className="relative mt-0.5 flex min-w-0 items-center gap-1">
                <span className="min-w-0 truncate text-[11.5px] text-gray-500">
                  {toName || toEmail ? (
                    <>
                      To: {toName}
                      {toEmail ? (
                        <span className="text-gray-500"> &lt;{toEmail}&gt;</span>
                      ) : null}
                    </>
                  ) : fromEmail ? (
                    <>From: {fromEmail}</>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailsOpen((v) => !v);
                    setMenuOpen(false);
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Show message details"
                  title="Show details"
                >
                  <ChevronDown size={12} />
                </button>
                {detailsOpen ? (
                  <div
                    role="dialog"
                    className="absolute left-0 top-full z-30 mt-1 w-[min(24rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailsOpen(false);
                      }}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Close details"
                    >
                      <X size={12} />
                    </button>
                    <p className="mb-2 pr-6 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      Message details
                    </p>
                    {details}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <span className="hidden pr-1 text-[11px] text-gray-500 sm:inline">
                {timestamp}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onReply();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Reply"
                title="Reply"
              >
                <ArrowLeft size={14} className="rotate-180" />
              </button>
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                    setDetailsOpen(false);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="More"
                  title="More"
                >
                  <KebabIcon />
                </button>
                {menuOpen ? (
                  <div
                    role="dialog"
                    className="absolute right-0 top-full z-30 mt-1 w-[min(24rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        Message details
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Close"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {details}
                    <div className="mt-3 flex justify-end border-t border-gray-100 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onReply();
                        }}
                        className="rounded-md bg-[#1b1b1b] px-3 py-1 text-[12px] font-medium text-white hover:bg-black"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <EmailBody body={body} />

          {triggerHref && triggerShort ? (
            <p className="mt-3 border-t border-gray-100 pt-2 text-[12px] [overflow-wrap:anywhere]">
              <Link
                href={triggerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sky-700 underline"
              >
                {host}/t/{triggerShort}
              </Link>
              {triggerName ? <span className="text-gray-500"> — {triggerName}</span> : null}
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReply();
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1b1b1b] px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-black"
            >
              <ArrowLeft size={13} className="rotate-180" />
              Reply
            </button>
            <span className="text-[11px] text-gray-400 sm:hidden">{timestamp}</span>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2">
          <p className="truncate text-[12px] text-gray-500">{preview}</p>
        </div>
      )}
    </div>
  );
}

function KebabIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
    >
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

/**
 * Render an email body with some basic polish:
 * - Collapse runs of 3+ newlines to a blank line so verbose templates
 *   (e.g. proposal notification emails) stop towering down the thread.
 * - Break the body into paragraphs so we can add proper spacing/rhythm.
 * - Linkify http(s) URLs.
 */
function EmailBody({ body }: { body: string }) {
  const cleaned = body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const paragraphs = cleaned.split(/\n{2,}/);
  return (
    <div className="min-w-0 max-w-full space-y-2 text-[13px] leading-relaxed text-gray-800 [overflow-wrap:anywhere]">
      {paragraphs.map((para, idx) => (
        <p key={idx} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {linkify(para)}
        </p>
      ))}
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const url = match[0];
    out.push(
      <Link
        key={`${match.index}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-sky-700 underline break-all"
      >
        {url}
      </Link>,
    );
    last = match.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length > 0 ? out : [text];
}

function CollapsedComposer({
  composerTab,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onChooseTab,
  onExpand,
  onInputChange,
}: {
  composerTab: ComposerTab;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onChooseTab: (tab: ComposerTab) => void;
  onExpand: () => void;
  onInputChange: (value: string) => void;
}) {
  const CurrentIcon = composerTab === 'team' ? Lock : composerTab === 'email' ? Mail : MessageSquare;
  const options: Array<{ id: ComposerTab; label: string; icon: typeof Lock }> = [
    { id: 'sms', label: 'SMS', icon: MessageSquare },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'team', label: 'Team only', icon: Lock },
  ];

  return (
    <div className="relative flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-2 py-1.5 shadow-sm">
      <button
        type="button"
        onClick={onToggleMenu}
        className="flex h-8 items-center gap-1 rounded-xl px-2 text-gray-600 transition-colors hover:bg-gray-100"
        aria-label="Change channel"
        title={`Channel: ${composerTab === 'team' ? 'Team only' : composerTab === 'email' ? 'Email' : 'SMS'}`}
      >
        <CurrentIcon size={16} className="text-sky-600" />
        <ChevronDown size={12} className="text-gray-400" />
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onCloseMenu} aria-hidden />
          <div
            className="absolute bottom-full left-0 z-50 mb-2 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
            role="menu"
          >
            {options.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChooseTab(opt.id)}
                  className={classNames(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    composerTab === opt.id
                      ? 'bg-gray-100 font-semibold text-gray-900'
                      : 'text-gray-700 hover:bg-gray-50',
                  )}
                  role="menuitem"
                >
                  <Icon size={14} className="text-gray-500" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <input
        type="text"
        placeholder="Type a message..."
        onFocus={onExpand}
        onChange={(e) => onInputChange(e.target.value)}
        className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
      />

      <button
        type="button"
        onClick={onExpand}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#171717] text-white transition-colors hover:bg-black"
        aria-label="Open composer"
      >
        <Send size={14} />
      </button>
    </div>
  );
}
