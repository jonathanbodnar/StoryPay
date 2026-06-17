'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
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
  MailOpen,
  MailCheck,
  Trash2,
  Smartphone,
  ShieldCheck,
  Building2,
  Sparkles,
  Wand2,
  AlertCircle,
  FileText,
  Pause,
  BotOff,
  Play,
  Clock,
  BookOpen,
} from 'lucide-react';
import { classNames, toTitleCase, dispatchStageChange, onStageChange } from '@/lib/utils';
import { EmojiPickerPopover } from '@/components/EmojiPickerPopover';
import ContactProfileDrawer from '@/components/conversations/ContactProfileDrawer';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type BrideMessageEvent, type StageChangedEvent } from '@/lib/realtime/channels';
import { CannedReplyPicker } from '@/components/support/CannedReplyPicker';

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
  contact_stage?: { name: string; color: string | null } | null;
  contact_stage_id?: string | null;
  contact_dnd_any?: boolean;
  contact_dnd_sms?: boolean;
  contact_dnd_email?: boolean;
}

interface ThreadDetail {
  id: string;
  subject: string;
  last_message_at: string;
  venue_customer_id: string;
  venue_id?: string;
  external_reply_channel?: string;
  contact_stage?: { name: string; color: string | null } | null;
  /** Authoritative DB stage_id — use this to highlight the correct pill. */
  contact_stage_id?: string | null;
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
    stage_id?: string | null;
    pipeline_id?: string | null;
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
  /** Address the message was actually delivered to (email or E.164 phone).
   *  Persisted at send time so the UI stays correct even if the contact's
   *  primary email/phone changes later. See migration 136. */
  email_to?: string | null;
  contact_from_name?: string | null;
  contact_from_email?: string | null;
  trigger_link?: { short_code: string; name: string | null } | null;
  trigger_link_id?: string | null;
  /** Set when a StoryVenue support agent replied on behalf of the venue. */
  sent_on_behalf_of_venue?: boolean | null;
  sent_by_support_user_id?: string | null;
  support_agent_name?: string | null;
  support_internal_note?: string | null;
  /** Migration 114 — distinguishes 'external' bride messages from 'venue_direct'
   *  concierge↔venue side-channel messages on the same thread. */
  audience?: 'external' | 'support_only' | 'venue_direct' | null;
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

type ComposerTab = 'team' | 'email' | 'sms' | 'concierge';
type ThreadListFilter = 'all' | 'unread' | 'starred' | 'pinned' | 'team_contacts';

interface TeamContact {
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: 'owner' | 'admin' | 'member';
  sort_order: number;
}

// ── TeamContactButton ──────────────────────────────────────────────────────────
// Small helper: opens/creates a conversation thread for a team contact and
// sets the appropriate composer tab (email | sms).
function TeamContactButton({
  icon, label, email, compose, existingThreadId, onSelectThread, onLoadThreads, title: titleProp,
}: {
  icon: React.ReactNode; label: string; email: string;
  compose: 'email' | 'sms';
  existingThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onLoadThreads: () => Promise<void>;
  title?: string;
}) {
  const [loading, setLoading] = useState(false);
  async function handle() {
    if (loading) return;
    if (existingThreadId) { onSelectThread(existingThreadId); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/open-or-create?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const { thread_id } = await res.json() as { thread_id: string };
        await onLoadThreads();
        onSelectThread(thread_id);
      }
    } finally { setLoading(false); }
  }
  const iconOnly = !label;
  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={loading}
      title={titleProp ?? `${label || compose.toUpperCase()} ${email}`}
      className={classNames(
        'inline-flex items-center justify-center transition-colors disabled:opacity-40',
        iconOnly
          ? classNames(
              'h-7 w-7 rounded-lg border border-gray-200 text-gray-500',
              compose === 'sms' ? 'hover:border-green-300 hover:bg-green-50 hover:text-green-700' : 'hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700',
            )
          : classNames(
              'gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              compose === 'email' ? 'hover:border-blue-300 hover:text-blue-700' : 'hover:border-green-300 hover:text-green-700',
            ),
      )}
    >
      {loading ? <Loader2 size={iconOnly ? 13 : 11} className="animate-spin" /> : icon}
      {!iconOnly && label}
    </button>
  );
}

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
  const [mentionPopupOpen, setMentionPopupOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamContacts, setTeamContacts] = useState<TeamContact[]>([]);

  // Pipeline stages for inline stage selector in thread view
  const [threadPipelines, setThreadPipelines] = useState<{id:string;name:string;is_default:boolean;stages:{id:string;name:string;color:string;position:number}[]}[]>([]);
  const threadPipelinesLoaded = useRef(false);
  const [stageUpdating, setStageUpdating] = useState(false);
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
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [draftIntent, setDraftIntent] = useState('');
  const [guideAdded, setGuideAdded] = useState(false);
  const [showDraftIntent, setShowDraftIntent] = useState(false);
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false);
  const [dndSaving, setDndSaving] = useState(false);
  const [showDndPanel, setShowDndPanel] = useState(false);
  const [listActionError, setListActionError] = useState('');

  // ── AI Concierge quick-control (venue side) ────────────────────────────────
  const [aiAddonEnabled, setAiAddonEnabled]     = useState(false);
  interface ContactLead { id: string; ai_state: string | null; ai_next_send_at: string | null }
  const [contactLead, setContactLead]           = useState<ContactLead | null>(null);
  const [aiMenuOpen, setAiMenuOpen]             = useState(false);
  const [aiActing, setAiActing]                 = useState(false);
  const [aiActionMsg, setAiActionMsg]           = useState<string | null>(null);
  const aiMenuRef                               = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const stuckToBottomRef = useRef(true);
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

  // Auto-hide scrollbar: add `is-scrolling` class while scrolling,
  // remove it 600 ms after the last scroll event.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    function onScroll() {
      el!.classList.add('is-scrolling');
      clearTimeout(timer);
      timer = setTimeout(() => el!.classList.remove('is-scrolling'), 600);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, []);

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

  // Fetch lead AI state whenever the active thread contact changes.
  // The contact-lead endpoint returns BOTH the lead (if any) AND the venue's
  // AI eligibility — so we drive button visibility from a single source.
  useEffect(() => {
    const vcId  = threadDetail?.venue_customer_id;
    const email = threadDetail?.venue_customers?.customer_email;
    if (!vcId && !email) { setContactLead(null); setAiAddonEnabled(false); return; }
    let cancelled = false;
    const params = new URLSearchParams();
    if (vcId)  params.set('vcId',  vcId);
    if (email) params.set('email', email);
    fetch(`/api/listing/ai-concierge/contact-lead?${params.toString()}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled) return;
        setContactLead(d?.lead ?? null);
        // Show the button whenever the venue has the AI Concierge addon
        setAiAddonEnabled(d?.eligible === true);
      })
      .catch(() => { if (!cancelled) { setContactLead(null); setAiAddonEnabled(false); } });
    return () => { cancelled = true; };
  }, [threadDetail?.venue_customer_id, threadDetail?.venue_customers?.customer_email]);

  // Close AI menu on outside click
  useEffect(() => {
    if (!aiMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setAiMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [aiMenuOpen]);

  useEffect(() => {
    fetch('/api/team')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTeam(d); })
      .catch(() => {});
    fetch('/api/conversations/team-contacts')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTeamContacts(d); })
      .catch(() => {});

    // Keep the thread header AND the left-list stage badge in sync when the
    // profile drawer (or any other component) changes the stage.
    return onStageChange(({ vcId, stageId, stageName, stageColor }) => {
      if (!vcId) return;
      setThreadDetail((prev) => {
        if (!prev || prev.venue_customer_id !== vcId) return prev;
        return {
          ...prev,
          contact_stage: { name: stageName, color: stageColor },
          contact_stage_id: stageId,
        };
      });
      setThreads((prev) =>
        prev.map((t) =>
          t.venue_customer_id === vcId
            ? { ...t, contact_stage: { name: stageName, color: stageColor }, contact_stage_id: stageId }
            : t,
        ),
      );
    });
  }, []);

  useEffect(() => {
    fetch('/api/marketing/trigger-links')
      .then((r) => r.json())
      .then((d: { links?: TriggerLinkOpt[] }) => {
        if (Array.isArray(d?.links)) setTriggerLinkOptions(d.links);
      })
      .catch(() => {});
  }, []);

  // Multi-attempt scroll to bottom — handles late layout from async content
  // (embedded email cards, image loads, etc.). Schedules immediate, rAF,
  // and several timed scrolls so we win regardless of when layout settles.
  const scrollToBottomNow = useCallback(() => {
    const fire = () => {
      const el = messagesScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    fire();
    requestAnimationFrame(() => {
      fire();
      requestAnimationFrame(fire);
    });
    setTimeout(fire, 50);
    setTimeout(fire, 200);
    setTimeout(fire, 500);
  }, []);

  const reloadMessages = useCallback(async (id: string) => {
    setLoadingThread(true);
    setSendError('');
    setShowDndPanel(false);
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

        // Defensive enrichment: ALWAYS hit /api/venue-customers/[id] in
        // parallel — same endpoint the profile drawer uses — and use its
        // pipeline_context as the authoritative source of stage info.
        // This eliminates any divergence between the conversation pill bar
        // and the rest of the app.
        const vcId = raw.venue_customer_id;
        if (vcId) {
          fetch(`/api/venue-customers/${vcId}`, { cache: 'no-store' })
            .then((r) => r.ok ? r.json() : null)
            .then((vcData: { pipeline_context?: { pipelineId: string; stageId: string } } | null) => {
              const stageId = vcData?.pipeline_context?.stageId;
              if (!stageId) return;
              setThreadDetail((prev) => {
                if (!prev || prev.id !== id) return prev;
                if (prev.contact_stage_id === stageId) return prev;
                return { ...prev, contact_stage_id: stageId };
              });
            })
            .catch(() => {});
        }
      } else {
        const err = await tRes.json().catch(() => ({}));
        setThreadDetail(null);
        setSendError(typeof err?.error === 'string' ? err.error : 'Could not load conversation');
      }
      if (mRes.ok) setMessages(await mRes.json());
      else setMessages([]);
      // Force re-pin to bottom after messages render (handles late layout).
      stuckToBottomRef.current = true;
      scrollToBottomNow();
      if (tRes.ok) {
        await fetch(`/api/conversations/threads/${id}/read`, { method: 'POST' });
        await loadThreads();
      }
    } finally {
      setLoadingThread(false);
    }
  }, [loadThreads, scrollToBottomNow]);

  useEffect(() => {
    if (!selectedId) {
      setThreadDetail(null);
      setMessages([]);
      return;
    }
    void reloadMessages(selectedId);
  }, [selectedId, reloadMessages]);

  // ── AI-drafted reply ───────────────────────────────────────────────────────
  const draftReply = useCallback(async () => {
    if (!selectedId || drafting) return;
    setDrafting(true);
    setDraftError('');
    try {
      const channel = composerTab === 'email' ? 'email' : 'sms';
      const r = await fetch(`/api/conversations/threads/${selectedId}/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          intent: draftIntent.trim() || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Draft failed (${r.status})`);
      setBody(d.text || '');
      setComposerExpanded(true);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setDrafting(false);
    }
  }, [selectedId, drafting, composerTab, draftIntent]);

  // Reset draft state when switching threads
  useEffect(() => {
    setDraftError('');
    setDraftIntent('');
    setShowDraftIntent(false);
  }, [selectedId]);

  // ── Realtime: append new external messages live ────────────────────────────
  // Subscribed only when the venue id and active thread id are both known.
  // Inbound bride replies AND support replies (sent on behalf of venue) AND
  // outbound owner/team replies all arrive here. We dedupe by message id.
  useBroadcastChannel(
    threadDetail?.venue_id && selectedId
      ? supportChannels.venueThread(threadDetail.venue_id, selectedId)
      : null,
    ['message', 'stage_changed'],
    useCallback((_evt, payload) => {
      // Handle stage change from support admin side
      if (_evt === 'stage_changed') {
        const sc = payload as StageChangedEvent;
        if (!sc) return;
        setThreadDetail(prev => prev ? {
          ...prev,
          contact_stage: { name: sc.stageName, color: sc.stageColor },
          contact_stage_id: sc.stageId,
        } : prev);
        setThreads(prev => prev.map(t =>
          t.venue_customer_id === sc.vcId
            ? { ...t, contact_stage: { name: sc.stageName, color: sc.stageColor }, contact_stage_id: sc.stageId }
            : t,
        ));
        dispatchStageChange({ vcId: sc.vcId, pipelineId: sc.pipelineId, stageId: sc.stageId, stageName: sc.stageName, stageColor: sc.stageColor ?? '' });
        return;
      }
      const evt = payload as BrideMessageEvent;
      if (!evt) return;
      setMessages(prev => {
        if (prev.some(m => m.id === evt.messageId)) return prev;
        const newMsg: Msg = {
          id:                      evt.messageId,
          visibility:              'external',
          channel:                 evt.channel,
          body:                    evt.body,
          sender_kind:             evt.senderKind,
          created_at:              evt.createdAt,
          external_email_sent:     null,
          send_error:              null,
          mentioned_member_ids:    [],
          author_label:            evt.sentByVenueSupport
            ? 'StoryVenue Support'
            : evt.senderKind === 'ai'
              ? 'AI Concierge'
              : undefined,
          sent_on_behalf_of_venue: evt.sentByVenueSupport,
          sent_by_support_user_id: evt.supportAgentId,
        };
        return [...prev, newMsg];
      });
      // Pin to bottom — same UX as a fresh send
      stuckToBottomRef.current = true;
      scrollToBottomNow();
    }, [scrollToBottomNow]),
  );

  // Re-fetch the thread detail + threads list (incl. latest stages) when the user
  // switches back to this browser tab after changing a stage elsewhere.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      // Refresh the threads list so left-pane stage badges stay current.
      void loadThreads();
      // Refresh the open thread's stage info without disrupting the chat.
      if (selectedId) {
        fetch(`/api/conversations/threads/${selectedId}`, { cache: 'no-store' })
          .then((r) => r.ok ? r.json() : null)
          .then((raw) => {
            if (!raw) return;
            const vc = raw.venue_customers;
            setThreadDetail((prev) => prev ? {
              ...prev,
              contact_stage: raw.contact_stage ?? prev.contact_stage,
              contact_stage_id: raw.contact_stage_id ?? prev.contact_stage_id,
              venue_customers: (Array.isArray(vc) ? vc[0] : vc) ?? prev.venue_customers,
            } : prev);
          })
          .catch(() => {});
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [selectedId, loadThreads]);

  function isNearBottom(el: HTMLElement, threshold = 80) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  function scrollToBottomIfStuck() {
    const el = messagesScrollRef.current;
    if (!el) return;
    if (stuckToBottomRef.current) el.scrollTop = el.scrollHeight;
  }

  // Update "stuck to bottom" flag whenever the user scrolls.
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const onScroll = () => { stuckToBottomRef.current = isNearBottom(el); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [selectedId]);

  // When the messages container OR its inner content resizes (composer
  // textarea growing as you type, new messages added, images loading, etc.)
  // re-pin the scroll to the bottom if the user was already there.
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { scrollToBottomIfStuck(); });
    ro.observe(el);
    // Also observe the inner content so growing message bubbles trigger pin.
    const inner = el.firstElementChild as HTMLElement | null;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [selectedId]);

  // Force-scroll on send / thread switch / new messages / loading-done —
  // useLayoutEffect runs synchronously after DOM mutations but before paint,
  // so the user never sees an "unstuck" frame. The `loadingThread` dep is
  // critical: when the spinner is replaced by the messages list, this is
  // the moment scrollHeight finally reflects the real content height.
  useLayoutEffect(() => {
    if (!selectedId) return;
    if (loadingThread) return; // skip while spinner is up — content not rendered yet
    stuckToBottomRef.current = true;
    scrollToBottomNow();
  }, [messages, selectedId, composerExpanded, loadingThread, scrollToBottomNow]);

  // Whenever a thread with venue_direct messages is opened (or those
  // messages arrive via poll), mark them read for the current viewer so the
  // sidebar Concierge bell badge clears. Cheap server call; debounced via
  // the dependency on selectedId (we re-run only on thread switch, not on
  // every individual message update).
  useEffect(() => {
    if (!selectedId) return;
    const hasVenueDirect = messages.some(m => m.audience === 'venue_direct');
    if (!hasVenueDirect) return;
    void fetch(`/api/conversations/threads/${selectedId}/venue-direct/mark-read`, {
      method: 'POST',
    })
      .then(() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('storypay:concierge-unread'));
        }
      })
      .catch(() => {});
  }, [selectedId, messages]);

  // Background poll — silently fetch new messages every 3 s for iMessage-style
  // tightness. We ALWAYS hit the full endpoint (no nosync gating) so the
  // server-side GHL → DB pull runs every tick; the DB dedup index prevents
  // duplicate inserts so this is safe even when GHL is also delivering inbound
  // via the webhook. This is the reliability backstop for when the venue's
  // GHL sub-account isn't configured with our webhook URL.
  useEffect(() => {
    if (!selectedId) return;

    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const url = `/api/conversations/threads/${selectedId}/messages`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const fresh = await res.json();
        setMessages(prev => {
          if (!Array.isArray(fresh)) return prev;
          if (fresh.length !== prev.length) return fresh;
          const lastFresh = fresh[fresh.length - 1]?.id;
          const lastPrev  = prev[prev.length - 1]?.id;
          return lastFresh !== lastPrev ? fresh : prev;
        });
      } catch { /* ignore — next tick retries */ }
    };

    const interval = setInterval(tick, 3_000);
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
      const name = [v.first_name, v.last_name].filter(Boolean).join(' ');
      return toTitleCase(name) || v.customer_email || 'Contact';
    }
    const row = threads.find((t) => t.thread_id === selectedId);
    if (row) {
      const name = [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' ');
      return toTitleCase(name) || row.contact_email || 'Contact';
    }
    return 'Contact';
  }, [threadDetail, threads, selectedId]);

  const contactProfileHref = threadDetail?.venue_customer_id
    ? `/dashboard/contacts/${threadDetail.venue_customer_id}`
    : null;

  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);

  // AI concierge quick-control helpers
  async function aiAction(action: 'resume' | 'handoff') {
    if (!contactLead) return;
    setAiActing(true); setAiActionMsg(null);
    try {
      const r = await fetch(`/api/listing/ai-concierge/leads/${contactLead.id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const d = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (r.ok) {
        setContactLead((prev) => prev ? {
          ...prev,
          ai_state: action === 'resume' ? 'ai_active' : 'handoff',
          // On resume, server sets ai_next_send_at = NOW. Clear stale future
          // value locally so the soft-pause label disappears immediately.
          ai_next_send_at: action === 'resume' ? new Date().toISOString() : null,
        } : prev);
        setAiActionMsg(action === 'resume' ? 'AI resumed.' : 'AI stopped — handed off.');
      } else {
        setAiActionMsg(d.error ?? 'Action failed.');
      }
    } catch { setAiActionMsg('Network error.'); }
    finally { setAiActing(false); setAiMenuOpen(false); }
  }

  async function aiSnooze(minutes: number) {
    if (!contactLead) return;
    setAiActing(true); setAiActionMsg(null);
    try {
      const r = await fetch(`/api/listing/ai-concierge/leads/${contactLead.id}/snooze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      });
      const d = await r.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string; nextSendAt?: string };
      if (r.ok && d.ok) {
        setContactLead((prev) => prev ? {
          ...prev,
          ai_state: 'paused',
          ai_next_send_at: d.nextSendAt ?? prev.ai_next_send_at,
        } : prev);
        setAiActionMsg(d.message ?? 'AI paused.');
      } else {
        setAiActionMsg(d.error ?? 'Snooze failed.');
      }
    } catch { setAiActionMsg('Network error.'); }
    finally { setAiActing(false); setAiMenuOpen(false); }
  }

  // Start AI for this contact — creates a lead if missing, then activates AI.
  // Server gates on the venue's AI Concierge addon eligibility.
  async function aiStart() {
    const vcId = threadDetail?.venue_customer_id;
    if (!vcId) return;
    setAiActing(true); setAiActionMsg(null);
    try {
      const r = await fetch('/api/listing/ai-concierge/contact-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vcId }),
      });
      const d = await r.json().catch(() => ({})) as { ok?: boolean; lead?: ContactLead | null; error?: string };
      if (r.ok && d.ok) {
        setContactLead(d.lead ?? null);
        setAiActionMsg('AI activated for this contact.');
      } else {
        setAiActionMsg(d.error ?? 'Could not start AI — check that your plan includes the AI Concierge addon.');
      }
    } catch { setAiActionMsg('Network error.'); }
    finally { setAiActing(false); setAiMenuOpen(false); }
  }

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

    // For team_contacts filter: show only threads whose contact email matches
    // a team contact. Apply before search so search still works within it.
    let base = threads;
    if (threadListFilter === 'team_contacts' && teamContacts.length > 0) {
      const emailSet = new Set(teamContacts.map((tc) => tc.email.toLowerCase()));
      base = threads.filter((t) => emailSet.has((t.contact_email || '').toLowerCase()));
    }

    if (q) {
      base = base.filter((t) => {
        const name = [t.contact_first_name, t.contact_last_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const em = (t.contact_email || '').toLowerCase();
        const ph = (t.contact_phone || '').toLowerCase();
        return name.includes(q) || em.includes(q) || ph.includes(q);
      });
    }

    if (threadListFilter === 'team_contacts' && teamContacts.length > 0) {
      // Sort: owner first (sort_order 0), then members, then by last message
      const emailOrder = new Map(
        teamContacts
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order || a.first_name.localeCompare(b.first_name))
          .map((tc, idx) => [tc.email.toLowerCase(), idx]),
      );
      return [...base].sort((a, b) => {
        const aIdx = emailOrder.get((a.contact_email || '').toLowerCase()) ?? 9999;
        const bIdx = emailOrder.get((b.contact_email || '').toLowerCase()) ?? 9999;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });
    }

    return [...base].sort((a, b) => {
      const ap = a.has_pinned ? 1 : 0;
      const bp = b.has_pinned ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });
  }, [threads, threadSearch, threadListFilter, teamContacts]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    if (composerTab !== 'team' && mentionedIds.length > 0) return;

    if (composerTab === 'concierge') {
      if (!body.trim()) return;
      setSending(true);
      setSendError('');
      try {
        const res = await fetch(`/api/conversations/threads/${selectedId}/venue-direct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: body.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSendError(data.error || 'Failed to send');
          return;
        }
        setBody('');
        setComposerExpanded(false);
        // Reload messages so the new venue_direct bubble renders correctly.
        // (We don't append optimistically here because the GET endpoint is
        // already cheap and the audience-based styling depends on extra
        // fields we'd otherwise have to backfill.)
        try {
          const r = await fetch(`/api/conversations/threads/${selectedId}/messages`, { cache: 'no-store' });
          const msgs = (await r.json()) as Msg[];
          if (Array.isArray(msgs)) setMessages(msgs);
        } catch { /* non-fatal */ }
        void loadThreads();
      } finally {
        setSending(false);
      }
      return;
    }

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
      // Append the returned message directly — no full reload, no scroll jump.
      // The API returns the raw DB row; add the author_label so it renders correctly.
      if (data?.id) {
        const newMsg: Msg = {
          ...data,
          author_label: data.sender_kind === 'team'
            ? (data.venue_team_member_id ? 'Team member' : 'Owner')
            : 'Owner',
          trigger_link: null,
        };
        setMessages(prev => [...prev, newMsg]);
      }
      void loadThreads();
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

  // Load pipelines on page mount so the active stage pill can be highlighted
  // the moment a thread's detail arrives (no first-open delay).
  useEffect(() => {
    if (threadPipelinesLoaded.current) return;
    threadPipelinesLoaded.current = true;
    fetch('/api/pipelines', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.pipelines) setThreadPipelines(d.pipelines); })
      .catch(() => {});
  }, []);

  async function patchThreadStage(stageId: string) {
    const vcId = threadDetail?.venue_customer_id;
    if (!vcId || stageUpdating) return;
    const pipe = threadPipelines.find((p) => p.stages.some((s) => s.id === stageId));
    if (!pipe) return;
    setStageUpdating(true);
    const res = await fetch(`/api/venue-customers/${vcId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineId: pipe.id, stageId }),
    });
    if (res.ok) {
      const st = pipe.stages.find((s) => s.id === stageId);
      if (st && threadDetail) {
        setThreadDetail((prev) => prev ? {
          ...prev,
          contact_stage: { name: st.name, color: st.color },
          contact_stage_id: stageId,
        } : prev);
        setThreads((prev) =>
          prev.map((t) =>
            t.venue_customer_id === vcId
              ? { ...t, contact_stage: { name: st.name, color: st.color }, contact_stage_id: stageId }
              : t,
          ),
        );
        dispatchStageChange({ vcId, pipelineId: pipe.id, stageId, stageName: st.name, stageColor: st.color });
      }
    }
    setStageUpdating(false);
  }

  async function markThreadUnread(threadId: string, e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    setListActionError('');
    const res = await fetch(`/api/conversations/threads/${threadId}/read`, { method: 'DELETE', cache: 'no-store' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setListActionError((d as { error?: string }).error || 'Could not mark unread'); return; }
    setThreads((prev) => prev.map((t) => t.thread_id === threadId ? { ...t, unread_count: 1 } : t));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('storypay:conversations-unread'));
  }

  async function markThreadRead(threadId: string, e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    setListActionError('');
    const res = await fetch(`/api/conversations/threads/${threadId}/read`, { method: 'POST', cache: 'no-store' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setListActionError((d as { error?: string }).error || 'Could not mark read'); return; }
    setThreads((prev) => prev.map((t) => t.thread_id === threadId ? { ...t, unread_count: 0 } : t));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('storypay:conversations-unread'));
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function deleteThread(threadId: string) {
    setListActionError('');
    const res = await fetch(`/api/conversations/threads/${threadId}`, { method: 'DELETE', cache: 'no-store' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setListActionError((d as { error?: string }).error || 'Could not delete thread'); return; }
    setThreads((prev) => prev.filter((t) => t.thread_id !== threadId));
    if (selectedId === threadId) { setSelectedId(null); setMobileShowThread(false); }
    setConfirmDeleteId(null);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('storypay:conversations-unread'));
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
            'flex w-full flex-shrink-0 flex-col border-gray-200 bg-gray-50/80 md:w-[min(100%,340px)] md:border-r',
            mobileShowThread ? 'hidden md:flex' : 'flex',
          )}
        >
          <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-gray-200 px-3 py-2">
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
                { id: 'team_contacts' as const, label: 'Team' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setThreadListFilter(tab.id)}
                className={classNames(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors',
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
          <div ref={listRef} className="sp-thread-list min-h-0 flex-1 overflow-y-auto">
            {/* ── Team contacts directory (shown at top when Team filter is active) ── */}
            {threadListFilter === 'team_contacts' && teamContacts.length > 0 && (
              <div className="border-b border-gray-200 bg-gray-50/60 px-3 py-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Account Owner &amp; Team</p>
                <div className="space-y-1.5">
                  {teamContacts.map((tc) => {
                    const tcFirst = toTitleCase(tc.first_name?.trim() || '');
                    const tcLast  = toTitleCase(tc.last_name?.trim()  || '');
                    const tcName  = [tcFirst, tcLast].filter(Boolean).join(' ') || tc.email;
                    const tcInitial = (tcFirst || tcName).charAt(0).toUpperCase();
                    const existingThread = threads.find(
                      (t) => (t.contact_email || '').toLowerCase() === tc.email.toLowerCase(),
                    );
                    const roleLabel = tc.role === 'owner' ? 'Owner' : tc.role === 'admin' ? 'Admin' : 'Team';
                    return (
                      <div key={tc.email} className="flex items-center gap-2 rounded-xl bg-white border border-gray-100 px-3 py-2">
                        {/* Avatar */}
                        <div className={classNames(
                          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                          tc.role === 'owner' ? 'bg-indigo-700' : 'bg-gray-700',
                        )}>
                          {tcInitial}
                        </div>
                        {/* Name + badge */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-1.5 leading-tight">
                            <span className="text-sm font-semibold text-gray-900">{tcName}</span>
                            <span className={classNames(
                              'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide leading-none',
                              tc.role === 'owner' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-600',
                            )}>
                              {roleLabel}
                            </span>
                          </div>
                        </div>
                        {/* Icon-only SMS → Email quick-start buttons */}
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <TeamContactButton
                            icon={<MessageSquare size={15} />}
                            label=""
                            email={tc.email}
                            compose="sms"
                            existingThreadId={existingThread?.thread_id ?? null}
                            onSelectThread={(id) => { setSelectedId(id); setMobileShowThread(true); setComposerTab('sms'); }}
                            onLoadThreads={loadThreads}
                            title={`SMS ${tcName}`}
                          />
                          <TeamContactButton
                            icon={<Mail size={15} />}
                            label=""
                            email={tc.email}
                            compose="email"
                            existingThreadId={existingThread?.thread_id ?? null}
                            onSelectThread={(id) => { setSelectedId(id); setMobileShowThread(true); setComposerTab('email'); }}
                            onLoadThreads={loadThreads}
                            title={`Email ${tcName}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {threadsFiltered.length > 0 && (
                  <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Recent Threads</p>
                )}
              </div>
            )}

            {loadingList ? (
              <div className="flex justify-center py-12 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : threads.length === 0 && threadListFilter !== 'team_contacts' ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">
                {threadListFilter === 'starred'
                  ? 'No starred conversations. Star a thread from the list using the star icon.'
                  : threadListFilter === 'pinned'
                    ? 'No pinned conversations. Pin a thread from the list using the pin icon.'
                    : threadListFilter === 'unread'
                      ? 'No unread conversations.'
                      : 'No conversations yet. Start one with a contact.'}
              </p>
            ) : threadsFiltered.length === 0 && threadListFilter !== 'team_contacts' ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">
                No threads match your search.
              </p>
            ) : threadsFiltered.length > 0 ? (
              threadsFiltered.map((t) => {
                const name =
                  toTitleCase([t.contact_first_name, t.contact_last_name].filter(Boolean).join(' ')) ||
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
                      setProfileDrawerOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(t.thread_id);
                        setMobileShowThread(true);
                        setProfileDrawerOpen(false);
                      }
                    }}
                    className={classNames(
                      'flex w-full cursor-pointer flex-col gap-0.5 border-b border-gray-100 px-4 py-3 text-left transition-colors',
                      selectedId === t.thread_id && unread
                        ? 'bg-blue-50 border-l-[3px] border-l-blue-500'
                        : selectedId === t.thread_id
                          ? 'bg-white border-l-[3px] border-l-neutral-900'
                          : unread
                            ? 'bg-blue-50/60 border-l-[3px] border-l-blue-500 hover:bg-blue-50'
                            : 'hover:bg-white',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={classNames('min-w-0 truncate text-sm font-semibold', unread ? 'text-gray-900' : 'text-gray-700')}>
                        {name}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        {/* Always-visible: star + pin */}
                        <button
                          type="button"
                          title={t.has_starred ? 'Remove star' : 'Star thread'}
                          onClick={(e) => void toggleThreadStarPin(t.thread_id, 'is_starred', e)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-amber-600"
                        >
                          <Star size={15} className={t.has_starred ? 'fill-amber-400 text-amber-500' : ''} />
                        </button>
                        <button
                          type="button"
                          title={t.has_pinned ? 'Unpin' : 'Pin thread'}
                          onClick={(e) => void toggleThreadStarPin(t.thread_id, 'is_pinned', e)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-sky-700"
                        >
                          <Pin size={15} className={t.has_pinned ? 'text-sky-600' : ''} />
                        </button>
                        {/* Always-visible: mark read/unread + delete */}
                        {unread ? (
                          <button
                            type="button"
                            title="Mark as read"
                            onClick={(e) => void markThreadRead(t.thread_id, e)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-emerald-600"
                          >
                            <MailCheck size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Mark as unread"
                            onClick={(e) => void markThreadUnread(t.thread_id, e)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
                          >
                            <MailOpen size={14} />
                          </button>
                        )}
                        {confirmDeleteId === t.thread_id ? (
                          <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              title="Confirm delete"
                              onClick={(e) => { e.stopPropagation(); void deleteThread(t.thread_id); }}
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white bg-red-600 hover:bg-red-700"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            title="Delete conversation"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.thread_id); }}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                        {/* Unread count badge */}
                        {unread && unreadN > 1 ? (
                          <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                            {unreadN > 99 ? '99+' : unreadN}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className={classNames('truncate text-xs', unread ? 'text-gray-700 font-medium' : 'text-gray-500')}>
                      {t.last_message_preview || t.subject || 'No messages'}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-400">
                      {t.contact_stage?.name ? (
                        <span
                          className="inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold"
                          style={t.contact_stage.color ? {
                            backgroundColor: `${t.contact_stage.color}1f`,
                            color: t.contact_stage.color,
                            borderColor: `${t.contact_stage.color}55`,
                          } : { backgroundColor: '#f3f4f6', color: '#374151', borderColor: '#e5e7eb' }}
                          title={t.contact_stage.name}
                        >
                          {t.contact_stage.name}
                        </span>
                      ) : null}
                      {t.contact_dnd_any && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0 text-[10px] font-semibold text-red-700 border border-red-200">
                          DND
                        </span>
                      )}
                      {t.last_message_visibility === 'internal' && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0 text-amber-800">
                          <Lock size={10} /> Team
                        </span>
                      )}
                      {(() => {
                        const tc = teamContacts.find(
                          (c) => c.email.toLowerCase() === (t.contact_email || '').toLowerCase(),
                        );
                        if (!tc) return null;
                        return (
                          <span
                            className={classNames(
                              'inline-flex items-center rounded px-1.5 py-0',
                              tc.role === 'owner'
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-gray-100 text-gray-600',
                            )}
                          >
                            {tc.role === 'owner' ? 'Owner' : 'Team'}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })
            ) : null}
          </div>
        </aside>

        {/* Thread pane
            Desktop (md+): flex column in the normal flow.
            Mobile with thread open: fixed full-screen overlay (z-[45] sits above
            the tab bar at z-40 so the composer is always reachable, but below the
            sidebar slide-out at z-50 so navigation still works).  The bottom
            padding on the composer balances the tab bar height. */}
        <section
          className={classNames(
            'flex min-w-0 flex-col bg-white',
            // md+: always in-flow, fills remaining width
            'md:relative md:flex-1 md:min-h-0',
            // mobile: hidden when list is shown; fixed overlay when thread is open
            !mobileShowThread ? 'hidden md:flex' : 'flex fixed inset-x-0 z-[45]',
          )}
          style={mobileShowThread ? { top: 0, bottom: 0 } : undefined}
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
                    {threadDetail.external_reply_channel === 'sms'
                      ? threadDetail.venue_customers?.phone ?? ''
                      : threadDetail.venue_customers?.customer_email ?? ''}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                  {/* AI Concierge quick-control — ALWAYS shown.
                      Server gates the actual actions on plan/addon eligibility. */}
                  <div className="relative" ref={aiMenuRef}>
                    {(() => {
                      // Treat ai_active + future ai_next_send_at as "soft paused"
                      // (server-side snooze keeps state=ai_active and pushes
                      // ai_next_send_at into the future to skip cron sends).
                      const nextSendDate = contactLead?.ai_next_send_at ? new Date(contactLead.ai_next_send_at) : null;
                      const nowDate = new Date();
                      const isPausedSoft = contactLead?.ai_state === 'ai_active'
                        && nextSendDate !== null
                        && nextSendDate.getTime() > nowDate.getTime() + 60_000; // 1 min buffer
                      const isPausedHard = contactLead?.ai_state === 'paused';
                      const isPaused = isPausedHard || isPausedSoft;
                      const resumeLabel = nextSendDate
                        ? nextSendDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : null;

                      return (<>
                    <button
                      type="button"
                      onClick={() => { setAiMenuOpen((o) => !o); setAiActionMsg(null); }}
                      disabled={aiActing}
                      title="AI Concierge controls"
                      className={classNames(
                        'inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
                        isPaused
                          ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                          : contactLead?.ai_state === 'ai_active'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100',
                      )}
                    >
                      {aiActing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : isPaused ? (
                        <Pause size={13} />
                      ) : contactLead?.ai_state === 'ai_active' ? (
                        <Sparkles size={13} />
                      ) : (
                        <BotOff size={13} />
                      )}
                      <span className="truncate max-w-[80px] sm:max-w-none">
                        {isPaused
                          ? (resumeLabel ? `Paused until ${resumeLabel}` : 'AI Paused')
                          : contactLead?.ai_state === 'ai_active' ? 'AI Active'
                          : contactLead ? 'AI Off' : 'Start AI'}
                      </span>
                      <ChevronDown size={12} className="text-current opacity-60" />
                    </button>

                    {aiMenuOpen && (
                      <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-gray-200 bg-white shadow-lg">
                        <div className="px-3 py-2 border-b border-gray-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">AI Concierge</p>
                          {/* Show resume time when paused (hard or soft) */}
                          {isPaused && (
                            <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                              <Clock size={9} />
                              Resumes {resumeLabel ?? 'next cron run'}
                            </p>
                          )}
                        </div>

                        {/* No lead yet → offer to start AI for this contact */}
                        {!contactLead && (
                          <button
                            type="button"
                            onClick={() => void aiStart()}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50 text-left rounded-b-xl"
                          >
                            <Play size={11} className="flex-shrink-0" />
                            Start AI for this contact
                          </button>
                        )}

                        {/* Pause for duration — only when AI is fully active (not soft-paused) */}
                        {contactLead?.ai_state === 'ai_active' && !isPausedSoft && (
                          <>
                            <div className="px-3 pt-2 pb-1">
                              <p className="text-[10px] font-medium text-gray-400 flex items-center gap-1"><Clock size={10}/> Pause AI for…</p>
                            </div>
                            {([
                              { label: '1 minute',  minutes: 1    },
                              { label: '30 minutes', minutes: 30   },
                              { label: '1 hour',    minutes: 60   },
                              { label: '4 hours',   minutes: 240  },
                              { label: '1 day',     minutes: 1440 },
                            ] as const).map(({ label, minutes }) => (
                              <button
                                key={minutes}
                                type="button"
                                onClick={() => void aiSnooze(minutes)}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 text-left"
                              >
                                <Pause size={11} className="text-amber-500 flex-shrink-0" />
                                {label}
                              </button>
                            ))}
                            <div className="my-1 border-t border-gray-100" />
                            <button
                              type="button"
                              onClick={() => void aiAction('handoff')}
                              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 text-left rounded-b-xl"
                            >
                              <BotOff size={11} className="flex-shrink-0" />
                              Stop AI (hand off)
                            </button>
                          </>
                        )}

                        {/* Resume — when paused (hard or soft) or otherwise off */}
                        {contactLead && (isPaused || contactLead.ai_state !== 'ai_active') && (
                          <>
                            <button
                              type="button"
                              onClick={() => void aiAction('resume')}
                              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50 text-left"
                            >
                              <Play size={11} className="flex-shrink-0" />
                              Resume AI now
                            </button>
                            <div className="my-1 border-t border-gray-100" />
                            <button
                              type="button"
                              onClick={() => void aiAction('handoff')}
                              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 text-left rounded-b-xl"
                            >
                              <BotOff size={11} className="flex-shrink-0" />
                              Stop AI (hand off)
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    </>);
                    })()}
                  </div>

                  {/* Feedback toast */}
                  {aiActionMsg && (
                    <span className="text-xs text-gray-500 max-w-[160px] truncate">{aiActionMsg}</span>
                  )}

                  {contactProfileHref ? (
                    <button
                      type="button"
                      onClick={() => setProfileDrawerOpen(true)}
                      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <User size={14} />
                      Profile
                      <ChevronRight size={14} className="text-gray-400" />
                    </button>
                  ) : null}
                </div>
              </header>

              {/* ── Inline pipeline stage selector ── */}
              {(() => {
                const allStages = threadPipelines.flatMap((p) => p.stages.map((s) => ({...s, pipelineId: p.id})));
                if (!allStages.length && !threadDetail.contact_stage?.name) return null;

                // Resolve the active stage ID with multiple fallbacks so the pill
                // *always* highlights when we have any stage data at all.
                let activeId =
                  threadDetail.contact_stage_id ??
                  // venue_customers.stage_id is embedded in the response
                  ((threadDetail.venue_customers as { stage_id?: string | null } | null)?.stage_id ?? null);

                // Last-ditch: match by name if we have a name but no ID.
                const activeName = threadDetail.contact_stage?.name?.toLowerCase().trim();
                if (!activeId && activeName) {
                  const byName = allStages.find((s) => s.name.toLowerCase().trim() === activeName);
                  if (byName) activeId = byName.id;
                }

                return (
                  <div className="flex-shrink-0 border-b border-gray-100 px-3 py-2 sm:px-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex flex-nowrap items-center gap-1.5 min-w-max sm:flex-wrap sm:min-w-0">
                      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Stage</span>
                      {allStages.length > 0 ? allStages.map((st) => {
                        // ID match is authoritative; name match is fallback for legacy data.
                        const isActive = activeId
                          ? st.id === activeId
                          : (activeName ? st.name.toLowerCase().trim() === activeName : false);
                        const color = st.color || null;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            disabled={stageUpdating}
                            onClick={() => void patchThreadStage(st.id)}
                            className={classNames(
                              'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50',
                              isActive ? '' : 'border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700',
                            )}
                            style={isActive && color ? {
                              backgroundColor: `${color}22`,
                              color,
                              borderColor: `${color}55`,
                            } : isActive ? { backgroundColor: '#f3f4f6', color: '#111827', borderColor: '#d1d5db' } : undefined}
                          >
                            {st.name}
                          </button>
                        );
                      }) : threadDetail.contact_stage?.name ? (
                        <span
                          className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                          style={threadDetail.contact_stage.color ? {
                            backgroundColor: `${threadDetail.contact_stage.color}22`,
                            color: threadDetail.contact_stage.color,
                            borderColor: `${threadDetail.contact_stage.color}55`,
                          } : { borderColor: '#e5e7eb', color: '#374151' }}
                        >
                          {threadDetail.contact_stage.name}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })()}

              {/* DND is managed in the Profile drawer — show a compact status-only pill when any channel is blocked */}
              {(() => {
                const vc = threadDetail.venue_customers;
                if (!vc) return null;
                const anyActive = vc.conversation_dnd_all || vc.sms_dnd || vc.conversation_dnd_email || vc.conversation_dnd_calls;
                if (!anyActive) return null;
                const blocked: string[] = [];
                if (vc.conversation_dnd_all) blocked.push('All channels');
                else {
                  if (vc.conversation_dnd_email) blocked.push('Email');
                  if (vc.sms_dnd) blocked.push('SMS');
                  if (vc.conversation_dnd_calls) blocked.push('Calls');
                }
                return (
                  <div className="flex-shrink-0 border-b border-red-100 bg-red-50 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
                        <Smartphone size={11} />
                      </span>
                      <span className="text-xs font-semibold text-red-800">DND active —</span>
                      <span className="text-xs text-red-700">{blocked.join(', ')} blocked</span>
                      <button
                        type="button"
                        onClick={() => setProfileDrawerOpen(true)}
                        className="ml-auto text-[11px] font-medium text-red-700 underline underline-offset-2 hover:text-red-900"
                      >
                        Manage in Profile
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div
                ref={messagesScrollRef}
                style={{ scrollBehavior: 'auto' }}
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
                      // Venue Direct (concierge ↔ venue side-channel) renders
                      // as a full-width violet card that's visually distinct
                      // from bride conversation bubbles. The contact never
                      // sees these — they're a private thread between this
                      // venue and the StoryVenue Concierge team.
                      if (m.audience === 'venue_direct') {
                        const isFromConcierge = m.sender_kind === 'concierge';
                        const ts = new Date(m.created_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                        });
                        const isVdEmail = m.channel === 'email';
                        const vdExpanded = expandedEmailIds.has(m.id);
                        const toggleVd = () =>
                          setExpandedEmailIds((prev) => {
                            const n = new Set(prev);
                            n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                            return n;
                          });
                        // 110-char single-line snippet for collapsed email VD messages
                        const SNIPPET = 110;
                        const oneLine = m.body.replace(/\s+/g, ' ').trim();
                        const snippet = oneLine.length > SNIPPET
                          ? oneLine.slice(0, SNIPPET).trimEnd() + '…'
                          : oneLine || '(empty)';

                        return (
                          <div key={m.id} className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 shadow-sm">
                            <div className="flex items-center gap-2 text-[10px] text-violet-800 mb-1 flex-wrap">
                              <Building2 size={11} />
                              <span className="font-semibold uppercase tracking-wide">
                                {isFromConcierge ? 'StoryVenue Concierge team' : 'You · to Concierge'}
                              </span>
                              <span className="rounded-full bg-violet-100 border border-violet-300 px-1.5 py-0.5 text-[9px] font-semibold">
                                Venue Direct · contact hidden
                              </span>
                              {m.support_agent_name && isFromConcierge && (
                                <span className="text-violet-700">— {m.support_agent_name}</span>
                              )}
                              <span className="ml-auto text-violet-600">{ts}</span>
                            </div>
                            {isVdEmail ? (
                              vdExpanded ? (
                                <div>
                                  <p className="text-sm text-violet-950 whitespace-pre-wrap break-words">{m.body}</p>
                                  <button
                                    type="button"
                                    onClick={toggleVd}
                                    className="mt-2 inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 hover:bg-violet-200"
                                  >
                                    <ChevronUp size={11} /> Hide
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={toggleVd}
                                  className="group flex w-full items-center gap-2 rounded-md border border-violet-300 bg-violet-100 px-2 py-1.5 text-left text-[12px] font-medium text-violet-800 hover:bg-violet-200"
                                  title="Click to expand email"
                                >
                                  <ChevronDown size={12} className="shrink-0 opacity-70 group-hover:opacity-100" />
                                  <span className="truncate">{snippet}</span>
                                </button>
                              )
                            ) : (
                              <p className="text-sm text-violet-950 whitespace-pre-wrap break-words">{m.body}</p>
                            )}
                          </div>
                        );
                      }

                      const isInternal = m.visibility === 'internal';
                      const fromContact = m.sender_kind === 'contact';
                      const fromSupport =
                        m.sender_kind === 'concierge' || Boolean(m.sent_on_behalf_of_venue);
                      const fromAi = m.sender_kind === 'ai';
                      // 'system' = automated outbound message (guide delivery, sequences, etc.)
                      const fromSystem = m.sender_kind === 'system';
                      const fromUs =
                        m.sender_kind === 'owner' ||
                        m.sender_kind === 'team' ||
                        fromSupport ||
                        fromAi ||
                        fromSystem;
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
                                    ? m.email_to ||
                                      threadDetail?.venue_customers?.customer_email ||
                                      null
                                    : null
                                }
                                direction={fromUs ? 'outgoing' : 'incoming'}
                                sendStatus={
                                  fromUs && m.visibility === 'external'
                                    ? m.external_email_sent === true
                                      ? 'sent'
                                      : m.external_email_sent === false
                                        ? 'failed'
                                        : 'unknown'
                                    : undefined
                                }
                                sendError={m.send_error ?? null}
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
                                  {isInternal && (m.mentioned_member_ids?.length ?? 0) > 0 ? (
                                    <p className="whitespace-pre-wrap break-words">
                                      {m.body.split(/(@\w+)/g).map((seg, si) =>
                                        seg.startsWith('@') ? (
                                          <mark key={si} className="rounded bg-amber-200/70 px-0.5 font-semibold text-amber-900 not-italic">
                                            {seg}
                                          </mark>
                                        ) : (
                                          seg
                                        ),
                                      )}
                                    </p>
                                  ) : (
                                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                                  )}
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
                                  {fromSupport && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700"
                                      title={
                                        m.support_agent_name
                                          ? `Sent by StoryVenue Support — ${m.support_agent_name}`
                                          : 'Sent by StoryVenue Support'
                                      }
                                    >
                                      <ShieldCheck size={9} /> Sent by Support
                                    </span>
                                  )}
                                  {fromAi && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-purple-700"
                                      title="Sent by AI Concierge"
                                    >
                                      <Sparkles size={9} /> AI
                                    </span>
                                  )}
                                  {fromSystem && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700"
                                      title="Sent automatically by the system (guide delivery or sequence)"
                                    >
                                      <Zap size={9} /> Automated
                                    </span>
                                  )}
                                  {m.visibility === 'external' && m.external_email_sent === true && !m.send_error && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700"
                                      title={
                                        m.channel === 'sms'
                                          ? 'SMS handed off to GoHighLevel successfully'
                                          : 'Email handed off to Resend successfully'
                                      }
                                    >
                                      <Check size={9} strokeWidth={3} />
                                      Sent
                                    </span>
                                  )}
                                  {m.visibility === 'external' && m.external_email_sent === false && m.send_error && (
                                    <span className="text-amber-600">
                                      {m.channel === 'sms' ? 'SMS not sent' : 'Email not sent'}: {m.send_error}
                                    </span>
                                  )}
                                  {isInternal && (m.mentioned_member_ids?.length ?? 0) > 0 && (
                                    <span className="flex items-center gap-1 text-amber-700">
                                      <Users size={10} />
                                      {team
                                        .filter((t) => m.mentioned_member_ids?.includes(t.id))
                                        .map((t) => `@${t.first_name || [t.first_name, t.last_name].filter(Boolean).join(' ')}`)
                                        .join(', ')}
                                    </span>
                                  )}
                                  {m.support_internal_note && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-800"
                                      title={m.support_internal_note}
                                    >
                                      Note from support
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

              <div
                className="flex-shrink-0 border-t border-gray-100 bg-gray-50/90 px-3 pt-3 pb-3 sm:px-5"
                style={mobileShowThread ? {
                  // Push the composer above the fixed tab bar (≈56px) + home-indicator
                  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 60px)',
                } : undefined}
              >
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
                    <button
                      type="button"
                      onClick={() => {
                        setComposerTab('concierge');
                        setMentionedIds([]);
                        setSendError('');
                      }}
                      className={classNames(
                        'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors sm:text-xs',
                        composerTab === 'concierge'
                          ? 'bg-white text-violet-800 border border-violet-300'
                          : 'text-gray-600 hover:text-violet-700',
                      )}
                    >
                      <Building2 size={14} className="hidden shrink-0 sm:inline" />
                      <span className="truncate">Concierge</span>
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
                  {composerTab === 'concierge' && (
                    <p className="mb-2 text-[11px] text-violet-700 inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-2.5 py-1 border border-violet-200 w-fit">
                      <Building2 size={11} /> Direct line to the StoryVenue Concierge team. The contact never sees these messages.
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
                    {showDraftIntent && composerTab !== 'team' && (
                      <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-2">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-violet-700 mb-1">
                          Steer AI draft
                        </label>
                        <input
                          type="text"
                          value={draftIntent}
                          onChange={(e) => setDraftIntent(e.target.value)}
                          placeholder="Optional — tell the AI what to say (e.g. 'invite for a Saturday tour')"
                          className="w-full rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
                        />
                      </div>
                    )}
                    {draftError && (
                      <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        <AlertCircle size={12} /> {draftError}
                      </div>
                    )}
                    <div>
                      {composerTab === 'email' && (
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          Message
                        </label>
                      )}
                      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white focus-within:border-gray-500">
                        {/* @mention autocomplete popup */}
                        {mentionPopupOpen && composerTab === 'team' && (() => {
                          const filtered = team.filter((m) => {
                            const name = [m.first_name, m.last_name].filter(Boolean).join(' ').toLowerCase();
                            return name.startsWith(mentionQuery.toLowerCase()) || m.first_name?.toLowerCase().startsWith(mentionQuery.toLowerCase());
                          });
                          if (!filtered.length) return null;
                          return (
                            <div className="mx-2 mb-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                              {filtered.map((m, i) => {
                                const label = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member';
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      // Replace @query in body with @FirstName
                                      const ta = composerTextareaRef.current;
                                      if (ta) {
                                        const cursor = ta.selectionStart ?? body.length;
                                        const before = body.slice(0, cursor);
                                        const after = body.slice(cursor);
                                        const atMatch = before.match(/@(\w*)$/);
                                        if (atMatch && atMatch.index !== undefined) {
                                          const newBody = before.slice(0, atMatch.index) + `@${m.first_name || label} ` + after;
                                          setBody(newBody);
                                          // Restore focus + move cursor after the inserted mention
                                          requestAnimationFrame(() => {
                                            const pos = (atMatch.index ?? 0) + (m.first_name || label).length + 2;
                                            ta.setSelectionRange(pos, pos);
                                            ta.focus();
                                          });
                                        }
                                      }
                                      if (!mentionedIds.includes(m.id)) setMentionedIds((p) => [...p, m.id]);
                                      setMentionPopupOpen(false);
                                      setMentionQuery('');
                                    }}
                                    className={classNames(
                                      'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                                      i === mentionHighlight ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50',
                                    )}
                                  >
                                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-white">
                                      {(m.first_name || label).charAt(0).toUpperCase()}
                                    </span>
                                    <span className="font-medium">{label}</span>
                                    {mentionedIds.includes(m.id) && <span className="ml-auto text-[10px] font-semibold text-amber-600">Tagged</span>}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                        <textarea
                          ref={composerTextareaRef}
                          value={body}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBody(val);
                            if (composerTab === 'team') {
                              const cursor = e.target.selectionStart ?? val.length;
                              const before = val.slice(0, cursor);
                              const atMatch = before.match(/@(\w*)$/);
                              if (atMatch) {
                                setMentionQuery(atMatch[1]);
                                setMentionPopupOpen(true);
                                setMentionHighlight(0);
                              } else {
                                setMentionPopupOpen(false);
                                setMentionQuery('');
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            // Navigate @mention popup
                            if (mentionPopupOpen && composerTab === 'team') {
                              const filtered = team.filter((m) => {
                                const name = [m.first_name, m.last_name].filter(Boolean).join(' ').toLowerCase();
                                return name.startsWith(mentionQuery.toLowerCase()) || m.first_name?.toLowerCase().startsWith(mentionQuery.toLowerCase());
                              });
                              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionHighlight((h) => Math.min(h + 1, filtered.length - 1)); return; }
                              if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionHighlight((h) => Math.max(h - 1, 0)); return; }
                              if (e.key === 'Escape')    { setMentionPopupOpen(false); setMentionQuery(''); return; }
                              if ((e.key === 'Enter' || e.key === 'Tab') && filtered[mentionHighlight]) {
                                e.preventDefault();
                                const m = filtered[mentionHighlight];
                                const ta = composerTextareaRef.current;
                                if (ta) {
                                  const cursor = ta.selectionStart ?? body.length;
                                  const before = body.slice(0, cursor);
                                  const after = body.slice(cursor);
                                  const atMatch = before.match(/@(\w*)$/);
                                  if (atMatch && atMatch.index !== undefined) {
                                    const label = m.first_name || [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member';
                                    const newBody = before.slice(0, atMatch.index) + `@${label} ` + after;
                                    setBody(newBody);
                                    requestAnimationFrame(() => {
                                      const pos = (atMatch.index ?? 0) + label.length + 2;
                                      ta.setSelectionRange(pos, pos);
                                      ta.focus();
                                    });
                                  }
                                }
                                if (!mentionedIds.includes(m.id)) setMentionedIds((p) => [...p, m.id]);
                                setMentionPopupOpen(false);
                                setMentionQuery('');
                                return;
                              }
                            }
                            // SMS/Email: Enter sends. Shift+Enter inserts a newline.
                            // Team notes: Enter always inserts a newline (no hot-send).
                            if (e.key === 'Enter' && !e.shiftKey && composerTab !== 'team') {
                              e.preventDefault();
                              const form = (e.target as HTMLTextAreaElement).closest('form');
                              if (form) form.requestSubmit();
                            }
                          }}
                          rows={composerTab === 'team' ? 3 : 4}
                          placeholder={
                            composerTab === 'team'
                              ? 'Write a team note… type @ to mention a teammate'
                              : composerTab === 'sms'
                              ? 'Type a message… (Enter to send, Shift+Enter for new line)'
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
                          <div className="relative flex flex-wrap items-center gap-0.5 border-t border-gray-100 bg-white px-2 py-1">
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
                            {/* Pricing guide link — always live, always current version */}
                            {threadDetail?.venue_id && (
                              <button
                                type="button"
                                title="Insert pricing guide link (always shows the current version of your guide)"
                                aria-label="Insert pricing guide link"
                                onClick={() => {
                                  const guideUrl = `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/guide/${threadDetail.venue_id}`;
                                  setBody((b) => b ? `${b}\n${guideUrl}` : guideUrl);
                                  setComposerExpanded(true);
                                  setGuideAdded(true);
                                  setTimeout(() => setGuideAdded(false), 2000);
                                }}
                                className={classNames(
                                  'rounded-lg p-1.5 transition-colors hover:bg-emerald-50 hover:text-emerald-700',
                                  guideAdded ? 'bg-emerald-50 text-emerald-600' : 'text-gray-500',
                                )}
                              >
                                <BookOpen size={16} strokeWidth={1.75} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setSavedRepliesOpen((v) => !v)}
                              className={classNames(
                                'rounded-lg p-1.5 transition-colors hover:bg-gray-100',
                                savedRepliesOpen ? 'bg-violet-50 text-violet-700' : 'text-gray-500 hover:text-gray-800',
                              )}
                              aria-label="Saved replies"
                              title="Insert a saved reply"
                            >
                              <FileText size={16} strokeWidth={1.75} />
                            </button>
                            {selectedId && (
                              <CannedReplyPicker
                                open={savedRepliesOpen}
                                onClose={() => setSavedRepliesOpen(false)}
                                listEndpoint="/api/dashboard/canned-replies"
                                renderEndpoint={(id) => `/api/dashboard/canned-replies/${id}/render`}
                                threadId={selectedId}
                                channel={composerTab === 'email' ? 'email' : 'sms'}
                                onInsert={(b) => { setBody(b); setComposerExpanded(true); }}
                                fullWidth
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setShowDraftIntent((v) => !v)}
                              className={classNames(
                                'rounded-lg p-1.5 transition-colors hover:bg-gray-100',
                                showDraftIntent ? 'bg-violet-50 text-violet-700' : 'text-gray-500 hover:text-gray-800',
                              )}
                              aria-label="Steer AI draft"
                              title="Tell the AI what to say"
                            >
                              <Wand2 size={16} strokeWidth={1.75} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void draftReply()}
                              disabled={drafting}
                              className="inline-flex items-center gap-1 rounded-lg bg-violet-50 hover:bg-violet-100 px-2 py-1.5 text-[11px] font-semibold text-violet-700 transition-colors disabled:opacity-50"
                              aria-label="Suggest reply"
                              title="Generate a reply with AI using your venue voice"
                            >
                              {drafting ? (
                                <Loader2 size={13} className="animate-spin" strokeWidth={2} />
                              ) : (
                                <Sparkles size={13} strokeWidth={2} />
                              )}
                              {drafting ? 'Drafting…' : 'Suggest'}
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

      {/* Contact profile drawer */}
      {profileDrawerOpen && threadDetail?.venue_customer_id && (
        <ContactProfileDrawer
          venueCustomerId={threadDetail.venue_customer_id}
          onClose={() => setProfileDrawerOpen(false)}
          initialContact={
            threadDetail.venue_customers
              ? {
                  id: threadDetail.venue_customers.id,
                  first_name: threadDetail.venue_customers.first_name,
                  last_name: threadDetail.venue_customers.last_name,
                  customer_email: threadDetail.venue_customers.customer_email,
                  phone: threadDetail.venue_customers.phone,
                  contact_stage: threadDetail.contact_stage ?? null,
                }
              : null
          }
        />
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
  direction,
  sendStatus,
  sendError,
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
  /** Outbound send status from the SaaS — only meaningful for outgoing messages. */
  sendStatus?: 'sent' | 'failed' | 'unknown';
  sendError?: string | null;
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

  const isOutgoing = direction === 'outgoing';
  const showSentBadge = isOutgoing && sendStatus === 'sent';
  const showFailedBadge = isOutgoing && sendStatus === 'failed';

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
      {isOutgoing && sendStatus && sendStatus !== 'unknown' ? (
        <>
          <span className="text-gray-500">Status:</span>
          {sendStatus === 'sent' ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 break-words font-medium text-emerald-700">
              <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
              Sent from StoryVenue
              {toEmail ? (
                <span className="text-gray-500"> · delivered to inbox by your provider</span>
              ) : null}
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5 break-words font-medium text-amber-700">
              <AlertCircle size={13} className="shrink-0 text-amber-600" />
              Not sent{sendError ? `: ${sendError}` : ''}
            </span>
          )}
        </>
      ) : null}
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
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-gray-500">
          {showSentBadge ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700"
              title="Email handed off to Resend successfully — check the contact's inbox to confirm delivery."
            >
              <Check size={9} strokeWidth={3} />
              Sent
            </span>
          ) : showFailedBadge ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700"
              title={sendError || 'Email failed to send'}
            >
              <AlertCircle size={9} />
              Failed
            </span>
          ) : null}
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
  const CurrentIcon = composerTab === 'team'
    ? Lock
    : composerTab === 'email'
      ? Mail
      : composerTab === 'concierge'
        ? Building2
        : MessageSquare;
  const options: Array<{ id: ComposerTab; label: string; icon: typeof Lock }> = [
    { id: 'sms', label: 'SMS', icon: MessageSquare },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'team', label: 'Team only', icon: Lock },
    { id: 'concierge', label: 'Concierge', icon: Building2 },
  ];

  return (
    <div className="relative flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-2 py-1.5 shadow-sm">
      <button
        type="button"
        onClick={onToggleMenu}
        className="flex h-8 items-center gap-1 rounded-xl px-2 text-gray-600 transition-colors hover:bg-gray-100"
        aria-label="Change channel"
        title={`Channel: ${composerTab === 'team' ? 'Team only' : composerTab === 'email' ? 'Email' : composerTab === 'concierge' ? 'Concierge' : 'SMS'}`}
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
