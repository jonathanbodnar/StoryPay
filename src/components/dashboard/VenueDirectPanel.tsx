'use client';

/**
 * Venue-side panel for the "Venue Direct" thread on a bride contact page.
 *
 * Shows every venue_direct message exchanged between the StoryVenue concierge
 * team and this venue's staff, scoped to a single contact (bride). Lets venue
 * staff reply back without ever exposing the conversation to the bride.
 *
 * The thread is automatically attached to the most-recent conversation_thread
 * for the contact — the concierge always opens the bride's thread first when
 * they want to message the venue, so there's exactly one venue_direct stream
 * per contact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Loader2, Send, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

interface VenueDirectMessage {
  id:                      string;
  thread_id:               string;
  body:                    string;
  sender_kind:             string;
  audience:                string | null;
  sent_by_support_user_id: string | null;
  venue_team_member_id:    string | null;
  created_at:              string;
  author_label:            string;
}

function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function VenueDirectPanel({ contactId, contactName }: { contactId: string; contactName: string }) {
  const [messages, setMessages] = useState<VenueDirectMessage[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [body,     setBody]     = useState('');
  const [sending,  setSending]  = useState(false);
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/conversations/contacts/${contactId}/venue-direct`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setMessages((d.messages ?? []) as VenueDirectMessage[]);
      // The GET endpoint marks this thread as read for the current viewer.
      // Tell the sidebar so the bell badge updates instantly.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('storypay:concierge-unread'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { void load(); }, [load]);

  // Light polling so new concierge messages appear without manual refresh.
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (!loading) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  const send = useCallback(async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setSendStatus(null);
    try {
      const r = await fetch(`/api/conversations/contacts/${contactId}/venue-direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Send failed (${r.status})`);
      setBody('');
      setSendStatus({ ok: true, msg: 'Sent to StoryVenue Support' });
      await load();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('storypay:concierge-unread'));
      }
    } catch (e) {
      setSendStatus({ ok: false, msg: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setSending(false);
    }
  }, [body, sending, contactId, load]);

  const lastConcierge = useMemo(
    () => [...messages].reverse().find(m => m.sender_kind === 'concierge'),
    [messages],
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-heading text-lg text-gray-900 inline-flex items-center gap-2">
            <Building2 size={16} className="text-violet-700" />
            Venue Direct — StoryVenue Support
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Private thread between StoryVenue Support and your venue team about{' '}
            <span className="font-semibold text-gray-700">{contactName}</span>. The bride never sees these messages.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 mb-3 flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div className="rounded-2xl border border-violet-200 bg-violet-50/30 p-3 mb-4 max-h-[420px] overflow-y-auto space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-6 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 px-4">
            <Building2 size={28} className="mx-auto text-violet-400 mb-2" />
            <p className="text-sm font-semibold text-gray-700">No messages yet</p>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              When StoryVenue Support has a question about {contactName}, their message will appear here. You can reply
              below at any time without ever leaving your dashboard.
            </p>
          </div>
        ) : (
          messages.map(m => {
            const isConcierge = m.sender_kind === 'concierge';
            return (
              <div key={m.id} className={`rounded-xl border px-3 py-2 ${
                isConcierge
                  ? 'border-violet-300 bg-white'
                  : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center gap-2 text-[10px] mb-1">
                  <span className={`font-semibold ${isConcierge ? 'text-violet-800' : 'text-gray-700'}`}>
                    {m.author_label}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-500">{relativeTime(m.created_at)}</span>
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {sendStatus && (
        <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 mb-2 ${
          sendStatus.ok
            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border border-red-200 bg-red-50 text-red-700'
        }`}>
          {sendStatus.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {sendStatus.msg}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-3">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={
            lastConcierge
              ? `Reply to StoryVenue Support about ${contactName}…`
              : `Send a message to StoryVenue Support about ${contactName}…`
          }
          rows={4}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px] text-gray-500">
            Replies go to the StoryVenue Support team. The bride doesn&apos;t see this thread.
          </p>
          <button
            type="button"
            onClick={send}
            disabled={!body.trim() || sending}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {sending ? 'Sending…' : 'Send to Support'}
          </button>
        </div>
      </div>
    </div>
  );
}
