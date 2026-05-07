'use client';

/**
 * Venue-side "Concierge" inbox.
 *
 * Single landing page that lists every contact for which StoryVenue Support
 * has had a Venue Direct conversation with this venue. Lets venues see all
 * of those threads in one place (instead of having to remember which contact
 * they were about), with unread badges per row.
 *
 * Click a row → /dashboard/contacts/{id}?tab=concierge — the dedicated
 * VenueDirectPanel handles read/reply.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Loader2, AlertCircle, RefreshCw, ChevronRight, Inbox } from 'lucide-react';

interface ThreadRow {
  threadId:            string;
  contactId:           string;
  contactName:         string;
  contactEmail:        string | null;
  latestBody:          string;
  latestAuthor:        string;
  latestAt:            string;
  latestFromConcierge: boolean;
  unreadCount:         number;
}

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

export default function ConciergeInboxPage() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<'all' | 'unread'>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/conversations/venue-direct/threads', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      setThreads((d.threads ?? []) as ThreadRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const visible = useMemo(
    () => filter === 'unread' ? threads.filter(t => t.unreadCount > 0) : threads,
    [threads, filter],
  );
  const totalUnread = useMemo(
    () => threads.reduce((s, t) => s + t.unreadCount, 0),
    [threads],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl text-gray-900 inline-flex items-center gap-2">
            <Building2 size={20} className="text-violet-700" />
            Concierge messages
            {totalUnread > 0 && (
              <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Private messages from the StoryVenue Support team about specific contacts. Replies stay between
            the support team and your venue — the contact never sees these threads.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            filter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          All ({threads.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            filter === 'unread' ? 'bg-violet-700 text-white border-violet-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Unread ({totalUnread})
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-gray-500 gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
          <Inbox size={32} className="mx-auto text-gray-400 mb-3" />
          <p className="text-sm font-semibold text-gray-700">
            {filter === 'unread' ? 'No unread messages' : 'No concierge messages yet'}
          </p>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            {filter === 'unread'
              ? 'You\u2019re all caught up. New messages from StoryVenue Support will show up here automatically.'
              : 'When the StoryVenue Support team has a question about one of your contacts, the thread will appear here.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {visible.map(t => (
            <Link
              key={t.threadId}
              href={`/dashboard/contacts/${t.contactId}?tab=concierge`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className={`mt-0.5 w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${
                t.unreadCount > 0
                  ? 'bg-violet-100 text-violet-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {(t.contactName.match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate ${t.unreadCount > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
                    {t.contactName}
                  </p>
                  {t.unreadCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {t.unreadCount}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-gray-400 shrink-0">{relativeTime(t.latestAt)}</span>
                </div>
                <p className="text-[11px] text-violet-700 font-medium mt-0.5">
                  {t.latestAuthor}
                </p>
                <p className={`text-xs truncate mt-0.5 ${t.unreadCount > 0 ? 'text-gray-800' : 'text-gray-500'}`}>
                  {t.latestFromConcierge ? '' : 'You: '}{t.latestBody}
                </p>
              </div>
              <ChevronRight size={16} className="text-gray-300 shrink-0 mt-2" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
