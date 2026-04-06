'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Loader2, User, RotateCcw } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'How much revenue did I collect this month?',
  'Which proposals are still unsigned?',
  'Who are my top clients by spend?',
  'What is my conversion rate?',
  'Show me my pending payments',
  'How do I create a proposal template?',
  'How do I issue a refund?',
  'What payment types do I offer?',
];

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full ${isUser ? 'bg-gray-200' : ''}`}
        style={!isUser ? { backgroundColor: '#293745' } : {}}>
        {isUser
          ? <User size={15} className="text-gray-500" />
          : <Sparkles size={14} className="text-white" />
        }
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-gray-100 text-gray-900 rounded-tr-sm'
          : 'text-white rounded-tl-sm'
      }`} style={!isUser ? { backgroundColor: '#293745' } : {}}>
        {/* Render with basic markdown-like formatting */}
        {msg.content.split('\n').map((line, i) => {
          if (line.startsWith('- ') || line.startsWith('• ')) {
            return (
              <div key={i} className="flex gap-2 mb-0.5">
                <span className="mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: isUser ? '#6b7280' : 'rgba(255,255,255,0.5)' }} />
                <span>{line.replace(/^[-•] /, '')}</span>
              </div>
            );
          }
          if (line.startsWith('**') && line.endsWith('**')) {
            return <p key={i} className="font-semibold mt-2 mb-0.5">{line.replace(/\*\*/g, '')}</p>;
          }
          if (line === '') return <div key={i} className="h-2" />;
          return <p key={i} className="mb-0.5">{line}</p>;
        })}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: '#293745' }}>
        <Sparkles size={14} className="text-white" />
      </div>
      <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ backgroundColor: '#293745' }}>
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AskAIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: Message = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function reset() {
    setMessages([]);
    setError('');
    setInput('');
    inputRef.current?.focus();
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)] max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm" style={{ backgroundColor: '#293745' }}>
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-heading text-xl sm:text-2xl text-gray-900 leading-tight">Ask AI</h1>
            <p className="text-xs text-gray-400 mt-0.5">Powered by your live venue data</p>
          </div>
        </div>
        {!isEmpty && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <RotateCcw size={12} />
            New chat
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-sm flex flex-col">

        {isEmpty ? (
          /* Welcome screen */
          <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg mb-5" style={{ backgroundColor: '#293745' }}>
              <Sparkles size={28} className="text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">How can I help you today?</h2>
            <p className="text-sm text-gray-500 max-w-sm mb-8 leading-relaxed">
              I have access to your live venue data — proposals, revenue, customers, and more. Ask me anything.
            </p>

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-white hover:shadow-sm transition-all text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {loading && <TypingIndicator />}
            {error && (
              <div className="flex justify-center">
                <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-2.5 text-xs text-red-600 text-center max-w-xs">{error}</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input area */}
        <div className="flex-shrink-0 border-t border-gray-100 p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 sm:px-4 py-2.5 focus-within:border-gray-300 focus-within:bg-white transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about your revenue, proposals, customers..."
              rows={1}
              disabled={loading}
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none resize-none disabled:opacity-50 py-1"
              style={{ maxHeight: 120, lineHeight: '1.5' }}
              onInput={e => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 120) + 'px';
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#293745' }}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          <p className="text-[10px] text-gray-300 text-center mt-2">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
