'use client';

/**
 * Venue Concierge — general relationship channel.
 *
 * A private, contact-independent chat between the venue owner/team and the
 * StoryVenue concierge team. Shows the concierge team's photos + role badges
 * and a full message history with a composer. Gated by the concierge add-on
 * (enforced in the sidebar + DirectoryRouteGuard).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConciergeBell, Loader2, Send, RefreshCw } from 'lucide-react';

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

export default function VenueConciergePage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const r = await fetch('/api/venue-concierge/messages', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setMessages((d.messages ?? []) as Message[]);
      window.dispatchEvent(new Event('storypay:venue-concierge-unread'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

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
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl text-gray-900 inline-flex items-center gap-2">
          <ConciergeBell size={20} className="text-violet-700" />
          Venue Concierge
        </h1>
      </div>

      {/* Meet your concierge team */}
      {team.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Your concierge team
          </p>
          <div className="flex flex-wrap gap-4">
            {team.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                {m.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatarUrl} alt={m.name} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-semibold">
                    {initials(m.name)}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{m.name}</p>
                  <p className="text-[11px] font-medium text-violet-600">{m.roleLabel}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thread */}
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col overflow-hidden" style={{ height: '60vh', minHeight: 380 }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
            messages.map((m) => (
              <div key={m.id} className={`flex gap-2.5 ${m.fromConcierge ? '' : 'flex-row-reverse'}`}>
                {m.fromConcierge ? (
                  m.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.authorAvatar} alt={m.authorName} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-[11px] font-semibold">
                      {initials(m.authorName)}
                    </div>
                  )
                ) : null}
                <div className={`max-w-[72%] ${m.fromConcierge ? '' : 'text-right'}`}>
                  <div className={`inline-block rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    m.fromConcierge
                      ? 'bg-gray-100 text-gray-900 rounded-tl-sm'
                      : 'bg-violet-600 text-white rounded-tr-sm'
                  }`}>
                    {m.body}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {m.authorName} · {timeLabel(m.createdAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {error && (
          <div className="px-4 py-1.5 text-xs text-red-600 border-t border-red-100 bg-red-50">{error}</div>
        )}

        {/* Composer */}
        <div className="border-t border-gray-100 p-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void loadMessages()}
        className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        <RefreshCw size={12} /> Refresh
      </button>
    </div>
  );
}
