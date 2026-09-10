'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, ArrowLeft } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Message = { id: string; body: string; created_at: string; mine: boolean; author: string };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CoupleMessagesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState(true);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollOnNext = useRef(true);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      const supabase = getCoupleSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/couple/login');
        return;
      }
      const res = await coupleAuthedFetch('/api/couple/messages');
      if (res.status === 401) {
        router.replace('/couple/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.linked === false) {
        setLinked(false);
        setLoading(false);
        return;
      }
      setLinked(true);
      setVenueName(typeof data.venueName === 'string' ? data.venueName : null);
      setMessages((prev) => {
        const next = Array.isArray(data.messages) ? (data.messages as Message[]) : [];
        if (next.length !== prev.length) scrollOnNext.current = true;
        return next;
      });
      setLoading(false);
    },
    [router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Light polling so venue replies appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => {
      if (!sending) void load({ silent: true });
    }, 8000);
    return () => clearInterval(t);
  }, [load, sending]);

  useEffect(() => {
    if (scrollOnNext.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      scrollOnNext.current = false;
    }
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/messages', {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not send');
        return;
      }
      setDraft('');
      if (data.message) {
        scrollOnNext.current = true;
        setMessages((prev) => [...prev, data.message as Message]);
      } else {
        await load({ silent: true });
      }
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!linked) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
        <p className="text-sm text-gray-600">You&apos;re not connected to a venue yet.</p>
        <Link href="/couple/wedding" className="mt-3 inline-block text-sm font-medium text-gray-900 underline">
          Connect with your venue
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[420px] flex-col">
      <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
        <Link href="/couple/wedding" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-heading text-lg text-gray-900">{venueName || 'Your venue'}</h1>
          <p className="text-xs text-gray-400">Messages sync with your venue&apos;s inbox.</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No messages yet. Say hello to {venueName || 'your venue'} 👋
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.mine ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[80%]">
                <div
                  className={[
                    'rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words',
                    m.mine ? 'bg-[#1b1b1b] text-white' : 'border border-gray-200 bg-white text-gray-900',
                  ].join(' ')}
                >
                  {m.body}
                </div>
                <p className={`mt-1 text-[11px] text-gray-400 ${m.mine ? 'text-right' : 'text-left'}`}>
                  {m.mine ? 'You' : m.author} · {fmtTime(m.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
            placeholder={`Message ${venueName || 'your venue'}…`}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#1b1b1b] text-white transition-opacity hover:opacity-85 disabled:opacity-40"
            aria-label="Send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
