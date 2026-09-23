'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, X, Paperclip, Mic, MicOff, Loader2, Send } from 'lucide-react';

/**
 * The compact AI chat shown inside the venue Help Center's Ask AI panel.
 *
 * Venue-only on purpose: it posts to /api/ai/chat, which injects the venue's
 * live account data (revenue, leads, proposals) into the prompt. The couple
 * Help Center is deliberately search-only and does not render this.
 */

const BRAND = '#1b1b1b';

interface AiMsg {
  role: 'user' | 'assistant';
  content: string;
}

// Matches [Button Label](/dashboard/path) — nav deep-links in AI responses
const NAV_LINK_RE_INLINE = /\[([^\]]+)\]\((\/dashboard[^)]*)\)/g;

function renderInlineLineLinks(text: string, navigate: (path: string) => void) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  NAV_LINK_RE_INLINE.lastIndex = 0;
  while ((m = NAV_LINK_RE_INLINE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <button
        key={m.index}
        onClick={() => navigate(m![2])}
        className="mx-0.5 inline-flex items-center gap-1 rounded-lg border border-white/30 bg-white/15 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/25"
      >
        {m[1]} →
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 1 ? <>{parts}</> : text;
}

function renderInlineContent(text: string, navigate: (path: string) => void) {
  return text.split('\n').map((rawLine, i) => {
    if (!rawLine.trim()) return <div key={i} className="h-1" />;
    const trimmed = rawLine.trim();
    const soloMatch = /^\[([^\]]+)\]\((\/dashboard[^)]*)\)$/.exec(trimmed);
    if (soloMatch) {
      return (
        <div key={i} className="mb-0.5 mt-1.5">
          <button
            onClick={() => navigate(soloMatch[2])}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-white/30 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/25"
          >
            {soloMatch[1]} →
          </button>
        </div>
      );
    }
    if (rawLine.trimStart().startsWith('- ')) {
      const withLinks = renderInlineLineLinks(rawLine.replace(/^[-\s]+/, ''), navigate);
      return (
        <div key={i} className="mb-0.5 flex gap-1.5">
          <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-current opacity-60" />
          <span>{withLinks}</span>
        </div>
      );
    }
    return (
      <p key={i} className="mb-0.5 leading-relaxed">
        {renderInlineLineLinks(rawLine, navigate)}
      </p>
    );
  });
}

export default function InlineAI() {
  const inlineRouter = useRouter();
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setSpeechSupported(!!(w['SpeechRecognition'] || w['webkitSpeechRecognition']));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function toggleVoice() {
    const w = window as unknown as Record<string, unknown>;
    const SR = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as
      | (new () => {
          continuous: boolean;
          interimResults: boolean;
          lang: string;
          start(): void;
          stop(): void;
          onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
          onend: (() => void) | null;
          onerror: (() => void) | null;
        })
      | undefined;
    if (!SR) return;
    if (isListening) {
      recRef.current?.stop();
      setIsListening(false);
      return;
    }
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onresult = (e) => setInput((p) => (p ? `${p} ${e.results[0][0].transcript}` : e.results[0][0].transcript));
    r.onend = () => setIsListening(false);
    r.onerror = () => setIsListening(false);
    recRef.current = r;
    r.start();
    setIsListening(true);
  }

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if ((!content && !pendingImage) || loading) return;
      const userMsg: AiMsg = { role: 'user', content: content || '(screenshot attached)' };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setInput('');
      setPendingImage(null);
      setLoading(true);
      setError('');

      const apiMessages = updated.map((m) => ({ role: m.role, content: m.content }));
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Something went wrong.');
          return;
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [input, pendingImage, loading, messages],
  );

  const PROMPTS = [
    'How do I create a proposal?',
    'How do installment plans work?',
    'How do I connect QuickBooks?',
    'How do I customise my emails?',
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: BRAND }}>
                  <Sparkles size={12} className="text-white" />
                </div>
                <span className="text-sm font-semibold text-gray-900">Ask AI</span>
              </div>
              <p className="text-sm leading-relaxed text-gray-600">
                I have access to your live account data. Ask me anything about the platform or your account.
              </p>
            </div>
            <div className="space-y-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-700 transition-all hover:border-gray-300"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div
                  className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                    m.role === 'user' ? 'bg-gray-200' : ''
                  }`}
                  style={m.role === 'assistant' ? { backgroundColor: '#525252' } : {}}
                >
                  {m.role === 'user' ? (
                    <span className="text-[9px] font-bold text-gray-500">You</span>
                  ) : (
                    <Sparkles size={11} className="text-white" />
                  )}
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'rounded-tr-sm border border-gray-200 bg-white text-gray-900'
                      : 'rounded-tl-sm text-white'
                  }`}
                  style={m.role === 'assistant' ? { backgroundColor: '#525252' } : {}}
                >
                  {m.role === 'assistant'
                    ? renderInlineContent(m.content, (path) => inlineRouter.push(path))
                    : m.content.split('\n').map((line, j) =>
                        !line.trim() ? (
                          <div key={j} className="h-1" />
                        ) : (
                          <p key={j} className="mb-0.5 leading-relaxed">
                            {line}
                          </p>
                        ),
                      )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: '#525252' }}>
                  <Sparkles size={11} className="text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm px-3 py-2.5" style={{ backgroundColor: '#525252' }}>
                  <div className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {error && <p className="px-1 text-xs text-red-500">{error}</p>}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-200 p-3">
        {pendingImage && (
          <div className="relative mb-2 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingImage} alt="attachment" className="h-14 rounded-lg border border-gray-200 object-cover" />
            <button
              onClick={() => setPendingImage(null)}
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-700 text-white"
            >
              <X size={9} />
            </button>
          </div>
        )}
        {isListening && (
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-red-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Listening...
          </p>
        )}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 transition-colors focus-within:border-gray-300 focus-within:bg-white">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask anything..."
            rows={1}
            disabled={loading}
            className="w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
            style={{ maxHeight: 80, lineHeight: '1.4', fontSize: 15 }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = `${Math.min(t.scrollHeight, 80)}px`;
            }}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                title="Attach screenshot"
              >
                <Paperclip size={14} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                    isListening ? 'bg-red-100 text-red-500' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                  }`}
                  title="Voice input"
                >
                  {isListening ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              )}
            </div>
            <button
              onClick={() => send()}
              disabled={(!input.trim() && !pendingImage) || loading}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white transition-all disabled:opacity-40"
              style={{ backgroundColor: BRAND }}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
