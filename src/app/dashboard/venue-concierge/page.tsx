'use client';

/**
 * Venue Concierge — general relationship channel.
 *
 * A private, contact-independent chat between the venue owner/team and the
 * StoryVenue concierge team. Shows the concierge team's photos + role badges
 * and a full message history with a composer. Gated by the concierge add-on
 * (enforced in the sidebar + DirectoryRouteGuard).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConciergeBell, Loader2, Send, RefreshCw, Clock, Search, X } from 'lucide-react';
import { useVenueConciergeRealtime } from '@/lib/realtime/use-venue-concierge-realtime';
import { ConciergeMessageBody, ConciergeEmailCard } from '@/components/venue-concierge/ConciergeMessageBody';
import { parseConciergeMessage } from '@/lib/venue-concierge/message-format';

interface TeamMember {
  id: string;
  name: string;
  roleLabel: string;
  avatarUrl: string | null;
}

interface Message {
  id: string;
  fromConcierge: boolean;
  body: string;
  createdAt: string;
  authorName: string;
  authorAvatar: string | null;
}

function initials(name: string): string {
  return (name.match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase() || '?';
}

function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Human-readable date/time variants so "Sep 2", "9/2/2026", "Wednesday",
 *  "2026-09-02", "4:36 PM" all match a message (browser-local, matching what
 *  the owner sees in the thread). */
function dateTimeHaystack(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts: string[] = [iso.slice(0, 10)];
  try {
    parts.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    parts.push(d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }));
    parts.push(d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }));
    parts.push(d.toLocaleDateString(undefined, { weekday: 'long' }));
    parts.push(d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  } catch { /* ISO is enough */ }
  return parts.join(' ');
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

export default function VenueConciergePage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [sla, setSla] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusPendingRef = useRef(false);
  const searchTokens = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const searchResults = useMemo(() => {
    if (searchTokens.length === 0) return null;
    return messages.filter((m) => {
      const hay = [m.body, m.authorName, dateTimeHaystack(m.createdAt)].join(' ').toLowerCase();
      return searchTokens.every((t) => hay.includes(t));
    });
  }, [messages, searchTokens]);

  const loadMessages = useCallback(async () => {
    try {
      const r = await fetch('/api/venue-concierge/messages', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setMessages((d.messages ?? []) as Message[]);
      if (typeof d.venueId === 'string') setVenueId(d.venueId);
      if (d.sla && typeof d.sla.label === 'string') setSla(d.sla.label);
      window.dispatchEvent(new Event('storypay:venue-concierge-unread'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  const { otherOnline, otherTyping, notifyTyping } = useVenueConciergeRealtime({
    venueId,
    side: 'venue',
    self: venueId ? { id: venueId, name: 'Your team' } : null,
    onMessage: () => { void loadMessages(); },
  });

  const loadTeam = useCallback(async () => {
    try {
      const r = await fetch('/api/venue-concierge/team', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setTeam((d.team ?? []) as TeamMember[]);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    void Promise.all([loadTeam(), loadMessages()]).finally(() => setLoading(false));
  }, [loadTeam, loadMessages]);

  useEffect(() => {
    const id = setInterval(loadMessages, 30_000);
    return () => clearInterval(id);
  }, [loadMessages]);

  useEffect(() => {
    if (focusPendingRef.current || searchResults) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, searchResults]);

  // Jump to + briefly highlight a message picked from search results.
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
  }, [focusMessageId, searchResults]);

  const openMatch = useCallback((messageId: string) => {
    focusPendingRef.current = true;
    setQuery('');
    setFocusMessageId(messageId);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch('/api/venue-concierge/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed to send');
      setDraft('');
      await loadMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }, [draft, sending, loadMessages]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 lg:flex-none lg:gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <h1 className="font-heading text-2xl text-gray-900 inline-flex items-center gap-2">
          <ConciergeBell size={20} className="text-gray-900" />
          Venue Concierge
        </h1>
        <div className="flex items-center gap-2">
          {sla && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600">
              <Clock size={12} className="text-gray-400" />
              Typically replies in {sla}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadMessages()}
            title="Refresh"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:text-gray-700"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Meet your concierge team */}
      {team.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-3 lg:p-4 shrink-0">
          <div className="flex items-center justify-between mb-2.5 lg:mb-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Your concierge team
            </p>
            {otherOnline && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Concierge online
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {team.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5">
                {m.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatarUrl} alt={m.name} className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-semibold">
                    {initials(m.name)}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{m.name}</p>
                  <p className="text-[11px] font-medium text-gray-500">{m.roleLabel}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thread */}
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col overflow-hidden flex-1 min-h-0 lg:flex-none lg:h-[60vh] lg:min-h-[380px]">
        {/* Search */}
        <div className="border-b border-gray-100 p-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages, name, date, time…"
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
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100">
            {searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <Search size={24} className="text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No matches for “{query.trim()}”.</p>
              </div>
            ) : (
              searchResults.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => openMatch(m.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-gray-600 truncate">
                      {m.fromConcierge ? m.authorName : 'You'}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-400 shrink-0">{timeLabel(m.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2 mt-0.5">
                    <Highlighted text={parseConciergeMessage(m.body).reply || m.body} tokens={searchTokens} />
                  </p>
                </button>
              ))
            )}
          </div>
        ) : (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-gray-500 gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <ConciergeBell size={28} className="text-gray-300 mb-2" />
              <p className="text-sm font-semibold text-gray-700">Start the conversation</p>
              <p className="text-xs text-gray-500 mt-1 max-w-sm">
                Send a message and your concierge team will reply here.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const emailed = parseConciergeMessage(m.body).isEmail;
              if (emailed) {
                const who = m.fromConcierge ? `${m.authorName} → You` : 'You → Concierge';
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
              <div key={m.id} id={`vc-msg-${m.id}`} className={`flex gap-2.5 ${m.fromConcierge ? '' : 'flex-row-reverse'}`}>
                {m.fromConcierge ? (
                  m.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.authorAvatar} alt={m.authorName} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-[11px] font-semibold">
                      {initials(m.authorName)}
                    </div>
                  )
                ) : null}
                <div className={`max-w-[72%] ${m.fromConcierge ? '' : 'text-right'}`}>
                  <div className={`inline-block text-left rounded-2xl px-3.5 py-2 transition-shadow ${
                    m.fromConcierge
                      ? 'bg-white border border-gray-200 text-gray-900 rounded-tl-sm'
                      : 'bg-gray-100 text-gray-900 rounded-tr-sm'
                  } ${highlightId === m.id ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}>
                    <ConciergeMessageBody body={m.body} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {m.authorName} · {timeLabel(m.createdAt)}
                  </p>
                </div>
              </div>
              );
            })
          )}
        </div>
        )}

        {otherTyping && (
          <div className="px-4 py-1.5 text-xs text-gray-500 border-t border-gray-100 inline-flex items-center gap-1.5">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '120ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '240ms' }} />
            </span>
            Concierge is typing…
          </div>
        )}

        {error && (
          <div className="px-4 py-1.5 text-xs text-red-600 border-t border-red-100 bg-red-50">{error}</div>
        )}

        {/* Composer */}
        <div className="border-t border-gray-100 p-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); notifyTyping(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Message your concierge team…"
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none max-h-40"
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
      </div>

      <button
        type="button"
        onClick={() => void loadMessages()}
        className="hidden lg:inline-flex self-start items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        <RefreshCw size={12} /> Refresh
      </button>
    </div>
  );
}
