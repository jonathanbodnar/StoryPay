'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Send,
  User,
  Users,
  Lock,
  Mail,
  ChevronRight,
  X,
  Smartphone,
  Star,
  Pin,
  Link2,
  Info,
  Phone,
} from 'lucide-react';
import { classNames } from '@/lib/utils';

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
  const [composerTab, setComposerTab] = useState<ComposerTab>('team');
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
  const [dndSaving, setDndSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const deepLinkConsumed = useRef(false);

  const loadThreads = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (threadListFilter === 'unread') params.set('unread', '1');
      if (threadListFilter === 'starred') params.set('starred', '1');
      if (threadListFilter === 'pinned') params.set('pinned', '1');
      const q = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/conversations/threads${q}`);
      if (res.ok) {
        const data = await res.json();
        setThreads(Array.isArray(data) ? data : []);
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
        fetch(`/api/conversations/threads/${id}`),
        fetch(`/api/conversations/threads/${id}/messages`),
      ]);
      if (tRes.ok) {
        const raw = (await tRes.json()) as ThreadDetail & { venue_customers?: ThreadDetail['venue_customers'] | unknown[] };
        const vc = raw.venue_customers;
        const venue_customers = Array.isArray(vc) ? (vc[0] as ThreadDetail['venue_customers']) ?? null : vc ?? null;
        setThreadDetail({ ...raw, venue_customers });
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

  useEffect(() => {
    setComposerTab('team');
    setEmailSubject('');
    setBody('');
    setMentionedIds([]);
    setSendError('');
    setEmailCc('');
    setEmailBcc('');
    setSelectedTriggerLinkId('');
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

  const threadsFiltered = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const name = [t.contact_first_name, t.contact_last_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const em = (t.contact_email || '').toLowerCase();
      const ph = (t.contact_phone || '').toLowerCase();
      return name.includes(q) || em.includes(q) || ph.includes(q);
    });
  }, [threads, threadSearch]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !body.trim()) return;
    if (composerTab !== 'team' && mentionedIds.length > 0) return;

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
    const res = await fetch(`/api/conversations/threads/${threadId}/toggle-star-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field }),
    });
    if (!res.ok) return;
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
          <p className="mt-1 text-sm text-gray-500">
            Pick Team only, Email (subject and message body), or SMS before you send — similar to Go High Level. SMS
            uses your GHL line; email goes to the contact&apos;s address from their profile.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowNew(true);
            setNewConversationError('');
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
        >
          <Plus size={18} />
          New conversation
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {/* Thread list */}
        <aside
          className={classNames(
            'flex w-full flex-shrink-0 flex-col border-gray-200 bg-gray-50/80 md:w-[min(100%,380px)] md:border-r',
            mobileShowThread ? 'hidden md:flex' : 'flex',
          )}
        >
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 p-3">
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
                  <button
                    key={t.thread_id}
                    type="button"
                    onClick={() => {
                      setSelectedId(t.thread_id);
                      setMobileShowThread(true);
                    }}
                    className={classNames(
                      'flex w-full flex-col gap-0.5 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-white',
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
                          <Smartphone size={10} /> SMS
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
                  </button>
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
                          <Smartphone size={12} /> SMS
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
                {contactProfileHref && (
                  <Link
                    href={contactProfileHref}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <User size={14} />
                    Profile
                    <ChevronRight size={14} className="text-gray-400" />
                  </Link>
                )}
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

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
                {loadingThread ? (
                  <div className="flex justify-center py-16 text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-12 text-center text-sm text-gray-500">No messages yet. Say hello below.</p>
                ) : (
                  <div className="mx-auto flex max-w-xl flex-col gap-3">
                    {messages.map((m) => {
                      const isInternal = m.visibility === 'internal';
                      const fromContact = m.sender_kind === 'contact';
                      const fromUs = m.sender_kind === 'owner' || m.sender_kind === 'team';
                      const alignRight = fromUs && !fromContact;
                      const host =
                        typeof window !== 'undefined' ? window.location.host : 'app';
                      const triggerHref = m.trigger_link?.short_code
                        ? `/t/${m.trigger_link.short_code}`
                        : null;
                      return (
                        <div
                          key={m.id}
                          className={classNames(
                            'flex max-w-[92%] flex-col gap-1',
                            alignRight ? 'ml-auto items-end' : 'mr-auto items-start',
                          )}
                        >
                          <div
                            className={classNames(
                              'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                              isInternal
                                ? 'border border-amber-200/80 bg-amber-50 text-amber-950'
                                : fromContact
                                  ? 'border border-gray-200 bg-gray-100 text-gray-900'
                                  : 'border border-neutral-800 bg-[#171717] text-white',
                            )}
                          >
                            {isInternal && (
                              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-800/90">
                                Team only
                              </p>
                            )}
                            {!isInternal && fromUs && (
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                                {m.channel === 'sms' ? 'SMS to contact' : 'Email to contact'}
                              </p>
                            )}
                            {!isInternal && fromUs && m.channel === 'email' && m.email_subject && (
                              <p className="mb-1.5 border-b border-white/15 pb-1.5 text-xs font-medium text-white/95">
                                Subject: {m.email_subject}
                              </p>
                            )}
                            {!isInternal && fromContact && (
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                Contact
                              </p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            {!isInternal && fromUs && m.channel === 'email' && (m.email_cc || m.email_bcc) && (
                              <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-white/75">
                                {m.email_cc ? <p>CC: {m.email_cc}</p> : null}
                                {m.email_bcc ? <p>BCC: {m.email_bcc}</p> : null}
                              </div>
                            )}
                            {triggerHref && m.trigger_link && (
                              <p
                                className={classNames(
                                  'mt-2 text-xs',
                                  fromUs && !isInternal ? 'text-white/85' : 'text-gray-600',
                                )}
                              >
                                <Link
                                  href={triggerHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={classNames(
                                    'font-medium underline',
                                    fromUs && !isInternal ? 'text-white' : 'text-sky-700',
                                  )}
                                >
                                  {host}/t/{m.trigger_link.short_code}
                                </Link>
                                {m.trigger_link.name ? (
                                  <span className="text-gray-500"> — {m.trigger_link.name}</span>
                                ) : null}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10px] text-gray-400">
                            <span>{m.author_label}</span>
                            <span>·</span>
                            <span>
                              {new Date(m.created_at).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                            {m.visibility === 'external' && m.external_email_sent === false && m.send_error && (
                              <span className="text-amber-600">
                                {m.channel === 'sms' ? 'SMS not sent' : 'Email not sent'}: {m.send_error}
                              </span>
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
                  <div className="mb-2 flex rounded-2xl bg-gray-200/80 p-1">
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
                    <button
                      type="button"
                      onClick={() => {
                        setComposerTab('email');
                        setMentionedIds([]);
                        setSendError('');
                        setEmailSubject((s) => {
                          if (s.trim()) return s;
                          const sub = threadDetail.subject?.trim();
                          return sub && sub !== 'Conversation' ? sub : '';
                        });
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
                      <Smartphone size={14} className="hidden shrink-0 sm:inline" />
                      <span className="truncate">SMS</span>
                    </button>
                  </div>
                  <p className="mb-2 text-[11px] text-gray-500">
                    {composerTab === 'team'
                      ? 'Visible only to your team. @mentions notify teammates (stored on this message).'
                      : composerTab === 'email'
                        ? `Email ${threadDetail.venue_customers?.customer_email || 'the contact'} with a subject line and body (like Go High Level). No @mentions.`
                        : `Text ${threadDetail.venue_customers?.phone || 'the contact'} via Go High Level (A2P on your GHL account). No @mentions.`}
                  </p>

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
                              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
                              style={{ fontSize: 16 }}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            <Link2 size={12} />
                            Trigger link (optional)
                          </label>
                          <select
                            value={selectedTriggerLinkId}
                            onChange={(e) => setSelectedTriggerLinkId(e.target.value)}
                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                          >
                            <option value="">None</option>
                            {triggerLinkOptions.map((tl) => (
                              <option key={tl.id} value={tl.id}>
                                {tl.name} ({tl.short_code})
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[10px] text-gray-500">
                            Adds a short tracked link to the email body; clicks go through your trigger link and count
                            toward analytics.
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      {composerTab === 'email' && (
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Message
                        </label>
                      )}
                      <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={composerTab === 'team' ? 3 : 4}
                        placeholder={
                          composerTab === 'team'
                            ? 'Write a team note…'
                            : composerTab === 'sms'
                              ? 'Type a message…'
                              : 'Type a message…'
                        }
                        className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none"
                        style={{ fontSize: 16 }}
                      />
                      {composerTab === 'sms' && (
                        <p className="mt-1 text-right text-[10px] tabular-nums text-gray-400">
                          Chars: {body.length}
                          {body.length > 0 ?
                            <> · Segs: ~{Math.max(1, Math.ceil(body.length / 160))}</>
                          : null}
                        </p>
                      )}
                    </div>
                    {sendError && <p className="text-xs text-red-600">{sendError}</p>}
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={sending || !body.trim()}
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
