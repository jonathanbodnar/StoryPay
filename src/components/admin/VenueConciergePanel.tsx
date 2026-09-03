'use client';

/**
 * Super-admin Venue Concierge panel.
 *
 * Left: venues with a general concierge conversation (unread + latest preview).
 * Right: the selected venue's thread + a reply composer. Mirrors the venue-side
 * channel (see /dashboard/venue-concierge).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConciergeBell, Loader2, Send, RefreshCw, Inbox, Search, X } from 'lucide-react';
import { useVenueConciergeRealtime } from '@/lib/realtime/use-venue-concierge-realtime';
import { ConciergeMessageBody, ConciergeEmailCard } from '@/components/venue-concierge/ConciergeMessageBody';
import { parseConciergeMessage } from '@/lib/venue-concierge/message-format';

interface ThreadRow {
  venueId: string;
  venueName: string;
  latestBody: string;
  latestAt: string;
  latestFromVenue: boolean;
  unreadCount: number;
}

interface Message {
  id: string;
  fromConcierge: boolean;
  body: string;
  createdAt: string;
  authorName: string;
}

interface SearchMatch {
  id: string;
  body: string;
  createdAt: string;
  fromConcierge: boolean;
  authorName: string;
}

interface SearchVenue {
  venueId: string;
  venueName: string;
  matches: SearchMatch[];
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wrap matched query tokens in <mark> for the search preview. */
function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  const parts = useMemo(() => {
    const clean = tokens.filter(Boolean).map(escapeRegExp);
    if (clean.length === 0) return [{ t: text, hit: false }];
    const re = new RegExp(`(${clean.join('|')})`, 'ig');
    return text.split(re).map((t) => ({ t, hit: clean.some((c) => new RegExp(`^${c}$`, 'i').test(t)) }));
  }, [text, tokens]);
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? <mark key={i} className="bg-amber-200 text-gray-900 rounded px-0.5">{p.t}</mark> : <span key={i}>{p.t}</span>,
      )}
    </>
  );
}

export function VenueConciergePanel() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeVenue, setActiveVenue] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchVenue[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusPendingRef = useRef(false);
  const searchTokens = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const loadThreads = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/venue-concierge/threads', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setThreads((d.threads ?? []) as ThreadRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  const loadMessages = useCallback(async (venueId: string) => {
    setLoadingMsgs(true);
    try {
      const r = await fetch(`/api/admin/venue-concierge/messages?venueId=${encodeURIComponent(venueId)}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setMessages((d.messages ?? []) as Message[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    const id = setInterval(loadThreads, 30_000);
    return () => clearInterval(id);
  }, [loadThreads]);

  useEffect(() => {
    if (activeVenue) void loadMessages(activeVenue);
  }, [activeVenue, loadMessages]);

  useEffect(() => {
    // Don't yank to the bottom when we're about to focus a searched message.
    if (focusPendingRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Debounced global search across all concierge conversations.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/venue-concierge/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { results?: SearchVenue[] } | null) => setSearchResults(d?.results ?? []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // After a searched message's thread loads, scroll to + briefly highlight it.
  useEffect(() => {
    if (!focusMessageId) return;
    const el = document.getElementById(`vc-msg-${focusMessageId}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightId(focusMessageId);
    setFocusMessageId(null);
    focusPendingRef.current = false;
    const t = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(t);
  }, [messages, focusMessageId]);

  const openMatch = useCallback((venueId: string, messageId: string) => {
    focusPendingRef.current = true;
    setFocusMessageId(messageId);
    setActiveVenue(venueId);
    setThreads((prev) => prev.map((t) => (t.venueId === venueId ? { ...t, unreadCount: 0 } : t)));
    setQuery('');
  }, []);

  const openVenue = useCallback((venueId: string) => {
    setActiveVenue(venueId);
    setThreads((prev) => prev.map((t) => (t.venueId === venueId ? { ...t, unreadCount: 0 } : t)));
  }, []);

  const { otherOnline, otherTyping, notifyTyping } = useVenueConciergeRealtime({
    venueId: activeVenue,
    side: 'concierge',
    self: { id: 'concierge', name: 'Concierge' },
    onMessage: () => {
      if (activeVenue) void loadMessages(activeVenue);
      void loadThreads();
    },
  });

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !activeVenue || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/venue-concierge/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId: activeVenue, body: text }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed to send');
      setDraft('');
      await loadMessages(activeVenue);
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }, [draft, activeVenue, sending, loadMessages, loadThreads]);

  const activeName = threads.find((t) => t.venueId === activeVenue)?.venueName;

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm text-gray-500 inline-flex items-center gap-2">
          <ConciergeBell size={15} className="text-gray-400" />
          Private relationship threads between venues and the concierge team.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4" style={{ minHeight: 520 }}>
        {/* Thread list */}
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          {/* Search box */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search messages, venue, name, email, phone, date…"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-8 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {searchResults !== null ? (
            /* Search results */
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {searching ? (
                <div className="flex items-center justify-center py-10 text-sm text-gray-500 gap-2">
                  <Loader2 size={14} className="animate-spin" /> Searching…
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-10 text-center text-xs text-gray-500">
                  <Search size={22} className="mx-auto text-gray-300 mb-2" />
                  No matches for “{query.trim()}”.
                </div>
              ) : (
                searchResults.map((r) => (
                  <div key={r.venueId} className="py-1.5">
                    <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {r.venueName}
                    </p>
                    {r.matches.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => openMatch(r.venueId, m.id)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-gray-600 truncate">
                            {m.fromConcierge ? m.authorName : `${m.authorName} (venue)`}
                          </span>
                          <span className="ml-auto text-[10px] text-gray-400 shrink-0">{timeLabel(m.createdAt)}</span>
                        </div>
                        <p className="text-xs text-gray-600 line-clamp-2 mt-0.5">
                          <Highlighted text={parseConciergeMessage(m.body).reply || m.body} tokens={searchTokens} />
                        </p>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Venues</span>
                <button type="button" onClick={() => void loadThreads()} className="text-gray-400 hover:text-gray-700">
                  <RefreshCw size={13} className={loadingThreads ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {loadingThreads ? (
                  <div className="flex items-center justify-center py-10 text-sm text-gray-500 gap-2">
                    <Loader2 size={14} className="animate-spin" /> Loading…
                  </div>
                ) : threads.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-gray-500">
                    <Inbox size={24} className="mx-auto text-gray-300 mb-2" />
                    No conversations yet.
                  </div>
                ) : (
                  threads.map((t) => (
                    <button
                      key={t.venueId}
                      type="button"
                      onClick={() => openVenue(t.venueId)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 ${activeVenue === t.venueId ? 'bg-gray-100' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <p className={`text-sm truncate ${t.unreadCount > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
                          {t.venueName}
                        </p>
                        {t.unreadCount > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                            {t.unreadCount}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-gray-400 shrink-0">{timeLabel(t.latestAt)}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {t.latestFromVenue ? '' : 'You: '}{parseConciergeMessage(t.latestBody).reply || t.latestBody}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Thread view */}
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          {!activeVenue ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Select a venue to view the conversation
            </div>
          ) : (
            <>
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{activeName}</p>
                {otherOnline && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    Venue online
                  </span>
                )}
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {loadingMsgs ? (
                  <div className="flex items-center justify-center h-full text-sm text-gray-500 gap-2">
                    <Loader2 size={14} className="animate-spin" /> Loading…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-xs text-gray-400">No messages yet.</div>
                ) : (
                  messages.map((m) => {
                    const emailed = parseConciergeMessage(m.body).isEmail;
                    if (emailed) {
                      const who = m.fromConcierge ? 'You → Venue' : `${m.authorName} → You`;
                      return (
                        <div key={m.id} id={`vc-msg-${m.id}`}>
                          <ConciergeEmailCard
                            body={m.body}
                            who={who}
                            time={timeLabel(m.createdAt)}
                            highlighted={highlightId === m.id}
                          />
                        </div>
                      );
                    }
                    return (
                    <div key={m.id} id={`vc-msg-${m.id}`} className={`flex ${m.fromConcierge ? 'flex-row-reverse' : ''}`}>
                      <div className={`max-w-[72%] ${m.fromConcierge ? 'text-right' : ''}`}>
                        <div className={`inline-block text-left rounded-2xl px-3.5 py-2 transition-shadow ${
                          m.fromConcierge
                            ? 'bg-gray-100 text-gray-900 rounded-tr-sm'
                            : 'bg-white border border-gray-200 text-gray-900 rounded-tl-sm'
                        } ${highlightId === m.id ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}>
                          <ConciergeMessageBody body={m.body} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {m.fromConcierge ? m.authorName : `${m.authorName} (venue)`} · {timeLabel(m.createdAt)}
                        </p>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
              {otherTyping && (
                <div className="px-4 py-1.5 text-xs text-gray-500 border-t border-gray-100 inline-flex items-center gap-1.5">
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '240ms' }} />
                  </span>
                  Venue is typing…
                </div>
              )}
              <div className="border-t border-gray-100 p-3 flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); notifyTyping(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                  }}
                  rows={1}
                  placeholder="Reply to this venue…"
                  className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm focus:border-gray-400 focus:bg-white focus:outline-none max-h-40"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
