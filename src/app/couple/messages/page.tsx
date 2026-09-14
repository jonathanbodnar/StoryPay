'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, ArrowLeft, MessageSquare, Mail, Check, Lock } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import { topBarSafeAreaPadding } from '@/lib/platform';

type Channel = 'sms' | 'email';

type Message = {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  author: string;
  channel: Channel;
  sent: boolean;
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

export default function CoupleMessagesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [linked, setLinked] = useState(true);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [canText, setCanText] = useState(false);
  const [channel, setChannel] = useState<Channel>('email');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollOnNext = useRef(true);
  // Below `lg` the chat becomes a fixed panel wedged between the app shell's
  // top bar and bottom tab bar (matching the venue concierge chat), so the
  // composer always sits above the tabs and the list scrolls in between.
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
      setCanText(data.canText === true);
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

  // If texting isn't available for this venue, never leave the composer
  // pointed at a channel the bride can't actually use.
  useEffect(() => {
    if (!canText && channel === 'sms') setChannel('email');
  }, [canText, channel]);

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
        body: JSON.stringify({ body: text, channel }),
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
    <div
      className="flex flex-col bg-[#fafaf9] fixed inset-x-0 z-30 px-4 lg:static lg:z-auto lg:h-[calc(100vh-140px)] lg:min-h-[420px] lg:px-0"
      style={
        isMobile
          ? {
              top: `calc(3.5rem + ${topBarSafeAreaPadding()})`,
              // Clear the bottom tab bar (~72px of content + its safe-area inset).
              bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 10px) + 72px)',
            }
          : undefined
      }
    >
      <div className="flex items-center gap-3 border-b border-gray-200 pb-3 pt-4 lg:pt-0">
        <Link href="/couple/wedding" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-heading text-lg text-gray-900">{venueName || 'Your venue'}</h1>
          <p className="text-xs text-gray-400">Messages sync with your venue&apos;s inbox.</p>
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No messages yet. Say hello to {venueName || 'your venue'} 👋
          </div>
        ) : (
          messages.map((m) => {
            const ChannelIcon = m.channel === 'sms' ? MessageSquare : Mail;
            const channelLabel = m.channel === 'sms' ? 'SMS' : 'Email';
            return (
              <div
                key={m.id}
                className={classNames(
                  'flex max-w-[85%] items-start gap-1.5',
                  m.mine ? 'ml-auto flex-row-reverse' : 'mr-auto',
                )}
              >
                <div
                  className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-gray-600"
                  title={channelLabel}
                  aria-label={channelLabel}
                >
                  <ChannelIcon size={10} strokeWidth={2} />
                </div>
                <div className={classNames('flex min-w-0 flex-col gap-0.5', m.mine ? 'items-end' : 'items-start')}>
                  <div
                    className={classNames(
                      'max-w-full rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words',
                      m.mine ? 'bg-[#1b1b1b] text-white' : 'border border-gray-200 bg-white text-gray-900',
                    )}
                  >
                    {m.body}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-gray-400">
                    <span>{m.mine ? 'You' : m.author} · {fmtTime(m.created_at)}</span>
                    {m.mine && m.sent && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-600" title={`${channelLabel} delivered`}>
                        <Check size={10} strokeWidth={3} /> Sent
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="border-t border-gray-200 pb-3 pt-3">
        <div className="mb-2 flex rounded-2xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => canText && setChannel('sms')}
            title={canText ? undefined : 'Texting isn\u2019t set up for this venue yet — messages will be sent by email.'}
            className={classNames(
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-colors',
              channel === 'sms' && canText
                ? 'border border-gray-200 bg-white text-gray-900'
                : canText
                  ? 'text-gray-600 hover:text-gray-900'
                  : 'cursor-not-allowed text-gray-300',
            )}
          >
            {canText ? <MessageSquare size={14} /> : <Lock size={12} />}
            Text
          </button>
          <button
            type="button"
            onClick={() => setChannel('email')}
            className={classNames(
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-colors',
              channel === 'email' ? 'border border-gray-200 bg-white text-gray-900' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            <Mail size={14} />
            Email
          </button>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            className="min-h-[44px] max-h-40 flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
            placeholder={`Message ${venueName || 'your venue'} by ${channel === 'sms' ? 'text' : 'email'}…`}
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
