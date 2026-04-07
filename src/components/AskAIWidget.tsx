'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, X, Send, Loader2, ChevronDown,
  LifeBuoy, RotateCcw, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

const BRAND = '#293745';

const SUGGESTED_PROMPTS = [
  'How do I use this dashboard?',
  'Help me understand my reports',
  'Where can I find my invoices?',
  'How do proposals work?',
  'How do I create a template?',
  'I need help with my account',
];

function formatTime(d?: Date) {
  if (!d) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderContent(text: string) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) {
      return <p key={i} className="font-semibold text-gray-900 mt-1">{line.replace(/\*\*/g, '')}</p>;
    }
    if (/^\*\*(.+?)\*\*/.test(line)) {
      return (
        <p key={i} className="mb-0.5">
          {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
            part.startsWith('**') ? <strong key={j}>{part.replace(/\*\*/g, '')}</strong> : part
          )}
        </p>
      );
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      return (
        <div key={i} className="flex gap-1.5 mb-0.5">
          <span className="mt-1.5 h-1 w-1 rounded-full bg-current flex-shrink-0 opacity-60" />
          <span>{line.replace(/^[-•] /, '')}</span>
        </div>
      );
    }
    if (/^\d+\.\s/.test(line)) {
      return <p key={i} className="mb-0.5 pl-1">{line}</p>;
    }
    if (line === '') return <div key={i} className="h-1.5" />;
    return <p key={i} className="mb-0.5 leading-relaxed">{line}</p>;
  });
}

export default function AskAIWidget() {
  const pathname = usePathname();
  const [open, setOpen]               = useState(false);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [escalating, setEscalating]   = useState(false);
  const [escalated, setEscalated]     = useState(false);
  const [error, setError]             = useState('');
  const [showEscalate, setShowEscalate] = useState(false);
  const [unread, setUnread]           = useState(0);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  const hasInteracted = messages.length >= 2;

  useEffect(() => {
    if (open) { setUnread(0); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const userMsg: Message = { role: 'user', content, timestamp: new Date() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);
    setError('');
    setShowEscalate(false);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return; }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, timestamp: new Date() }]);
      setShowEscalate(true);
      if (!open) setUnread(n => n + 1);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, open]);

  async function escalate() {
    if (!hasInteracted) return;
    setEscalating(true);
    const question = messages.find(m => m.role === 'user')?.content || '';
    try {
      await fetch('/api/ai/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          conversation: messages.map(m => ({ role: m.role, content: m.content })),
          currentPage: pathname,
        }),
      });
      setEscalated(true);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I've sent your request to our support team with a full summary of our conversation. Someone will follow up with you via email shortly. Is there anything else I can help you with in the meantime?",
        timestamp: new Date(),
      }]);
    } catch {
      setError('Could not send support request. Please email clients@storyvenuemarketing.com directly.');
    } finally {
      setEscalating(false);
      setShowEscalate(false);
    }
  }

  function reset() {
    setMessages([]);
    setInput('');
    setError('');
    setShowEscalate(false);
    setEscalated(false);
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* ── Floating bubble ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl text-white transition-all hover:scale-105 active:scale-95"
        style={{ backgroundColor: BRAND }}
        aria-label="Open Ask AI"
      >
        {open ? <ChevronDown size={22} /> : <Sparkles size={22} />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 flex flex-col rounded-2xl shadow-2xl overflow-hidden"
          style={{
            width: 'min(380px, calc(100vw - 24px))',
            height: 'min(580px, calc(100vh - 140px))',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 flex-shrink-0" style={{ backgroundColor: BRAND }}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <Sparkles size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-none">Ask AI</p>
                <p className="text-[11px] text-white/60 mt-0.5">Powered by your live account data</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button onClick={reset} title="New conversation"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/15 transition-colors">
                  <RotateCcw size={13} />
                </button>
              )}
              <button onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/15 transition-colors">
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#f9fafb' }}>
            {isEmpty ? (
              /* Welcome */
              <div className="p-5">
                <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: BRAND }}>
                      <Sparkles size={13} className="text-white" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">Hi! I'm Ask AI 👋</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    I can help you with your StoryPay dashboard, proposals, reports, invoices, and more. What can I help you with today?
                  </p>
                </div>

                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2.5 px-1">Suggested questions</p>
                <div className="space-y-2">
                  {SUGGESTED_PROMPTS.map(p => (
                    <button key={p} onClick={() => send(p)}
                      className="w-full text-left rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-700 hover:border-gray-300 hover:shadow-sm transition-all">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar */}
                    <div className={`flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full mt-0.5 ${
                      msg.role === 'user' ? 'bg-gray-200' : ''
                    }`} style={msg.role === 'assistant' ? { backgroundColor: BRAND } : {}}>
                      {msg.role === 'user'
                        ? <span className="text-[10px] font-bold text-gray-500">You</span>
                        : <Sparkles size={12} className="text-white" />
                      }
                    </div>

                    {/* Bubble */}
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-white border border-gray-200 text-gray-900 rounded-tr-sm'
                        : 'text-white rounded-tl-sm'
                    }`} style={msg.role === 'assistant' ? { backgroundColor: BRAND } : {}}>
                      <div className={msg.role === 'assistant' ? 'text-white/95' : ''}>
                        {renderContent(msg.content)}
                      </div>
                      {msg.timestamp && (
                        <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-gray-400 text-right' : 'text-white/50'}`}>
                          {formatTime(msg.timestamp)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: BRAND }}>
                      <Sparkles size={12} className="text-white" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ backgroundColor: BRAND }}>
                      <div className="flex gap-1 items-center h-3">
                        {[0,1,2].map(i => (
                          <div key={i} className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce"
                            style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Escalation prompt */}
                {showEscalate && hasInteracted && !escalated && !loading && (
                  <div className="flex justify-center">
                    <button onClick={escalate} disabled={escalating}
                      className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 hover:border-gray-300 hover:shadow-sm transition-all disabled:opacity-50">
                      {escalating ? <Loader2 size={12} className="animate-spin" /> : <LifeBuoy size={12} />}
                      {escalating ? 'Contacting support...' : 'Still need help? Contact support →'}
                    </button>
                  </div>
                )}

                {escalated && (
                  <div className="flex justify-center">
                    <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 font-medium">
                      <CheckCircle2 size={12} />
                      Support request sent
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-600">
                    <AlertCircle size={13} className="flex-shrink-0" />
                    {error}
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex-shrink-0 border-t border-gray-100 bg-white p-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-gray-300 focus-within:bg-white transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask a question..."
                rows={1}
                disabled={loading}
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none resize-none disabled:opacity-50"
                style={{ maxHeight: 80, lineHeight: '1.4' }}
                onInput={e => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = 'auto';
                  t.style.height = Math.min(t.scrollHeight, 80) + 'px';
                }}
              />
              <button onClick={() => send()} disabled={!input.trim() || loading}
                className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-white disabled:opacity-40 transition-all"
                style={{ backgroundColor: BRAND }}>
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
            <p className="text-[10px] text-gray-300 text-center mt-1.5">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}
    </>
  );
}
