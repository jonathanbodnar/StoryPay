'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, X, Send, Loader2, ChevronDown,
  LifeBuoy, RotateCcw, CheckCircle2, AlertCircle,
  Mic, MicOff, Smile, Paperclip, ImageIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  image?: string; // base64 data URL for user-uploaded images
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

// Common emoji grid
const EMOJIS = [
  '😊','😂','🙏','👍','❤️','🎉','✅','⚡','🔥','💡',
  '😅','🤔','👋','💪','🙌','😍','🥳','😬','😭','🤝',
  '📊','📋','💰','📝','🏷️','📅','🔗','⚙️','🔒','✉️',
];

function formatTime(d?: Date) {
  if (!d) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function cleanLine(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function renderContent(text: string) {
  return text.split('\n').map((rawLine, i) => {
    const line = cleanLine(rawLine);
    if (!line) return <div key={i} className="h-1.5" />;
    if (rawLine.trimStart().startsWith('- ') || rawLine.trimStart().startsWith('• ')) {
      return (
        <div key={i} className="flex gap-1.5 mb-0.5">
          <span className="mt-1.5 h-1 w-1 rounded-full bg-current flex-shrink-0 opacity-60" />
          <span>{line.replace(/^[-•]\s*/, '')}</span>
        </div>
      );
    }
    if (/^\d+\.\s/.test(line)) return <p key={i} className="mb-0.5 pl-1">{line}</p>;
    return <p key={i} className="mb-0.5 leading-relaxed">{line}</p>;
  });
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
function EmojiPicker({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute bottom-full left-0 mb-2 z-10 rounded-2xl border border-gray-200 bg-white shadow-xl p-3" style={{ width: 220 }}>
      <div className="grid grid-cols-10 gap-1">
        {EMOJIS.map(e => (
          <button key={e} type="button" onClick={() => { onSelect(e); onClose(); }}
            className="flex items-center justify-center h-7 w-7 rounded-lg text-lg hover:bg-gray-100 transition-colors">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
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
  const [supportNote, setSupportNote] = useState('');
  const [showSupportForm, setShowSupportForm] = useState(false);
  const [showEmoji, setShowEmoji]     = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);

  const hasInteracted = messages.length >= 2;

  // Check speech support
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const SR = w['SpeechRecognition'] || w['webkitSpeechRecognition'];
    setSpeechSupported(!!SR);
  }, []);

  // Listen for sidebar event
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-ask-ai', handler);
    return () => window.removeEventListener('open-ask-ai', handler);
  }, []);

  useEffect(() => {
    if (open) { setUnread(0); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Voice dictation ──────────────────────────────────────────────────────────
  function toggleVoice() {
    const w = window as unknown as Record<string, unknown>;
    const SR = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as (new () => {
      continuous: boolean; interimResults: boolean; lang: string;
      start(): void; stop(): void;
      onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
    }) | undefined;
    if (!SR) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(prev => prev ? prev + ' ' + transcript : transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  // ── Image upload ─────────────────────────────────────────────────────────────
  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return; }
    const reader = new FileReader();
    reader.onload = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // ── Send ─────────────────────────────────────────────────────────────────────
  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if ((!content && !pendingImage) || loading) return;

    const userMsg: Message = {
      role: 'user',
      content: content || '(screenshot attached)',
      image: pendingImage || undefined,
      timestamp: new Date(),
    };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setPendingImage(null);
    setLoading(true);
    setError('');
    setShowEscalate(false);

    // Build messages for API — include image as vision content if present
    const apiMessages = updated.map(m => {
      if (m.image) {
        return {
          role: m.role,
          content: [
            { type: 'image_url', image_url: { url: m.image, detail: 'low' } },
            { type: 'text', text: m.content || 'Please help me with this screenshot.' },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
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
  }, [input, pendingImage, loading, messages, open]);

  async function escalate() {
    if (!supportNote.trim()) return;
    setEscalating(true);
    const question = messages.find(m => m.role === 'user')?.content || '';
    try {
      const res = await fetch('/api/ai/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          conversation: messages.map(m => ({ role: m.role, content: m.content })),
          currentPage: pathname,
          supportNote: supportNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to send support request.'); return; }
      setEscalated(true);
      setShowSupportForm(false);
      setSupportNote('');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I've sent your request to our support team with a full summary of our conversation. Someone will follow up with you via email shortly.",
        timestamp: new Date(),
      }]);
    } catch {
      setError('Could not send request. Please email clients@storyvenuemarketing.com directly.');
    } finally {
      setEscalating(false);
      setShowEscalate(false);
    }
  }

  function reset() {
    setMessages([]); setInput(''); setError('');
    setShowEscalate(false); setEscalated(false);
    setPendingImage(null); setShowEmoji(false);
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* ── Floating bubble ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-4 sm:right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl text-white transition-all hover:scale-105 active:scale-95"
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
          className="fixed z-50 flex flex-col shadow-2xl overflow-hidden bg-white border border-gray-200 bottom-0 left-0 right-0 rounded-t-2xl sm:bottom-24 sm:right-6 sm:left-auto sm:rounded-2xl sm:w-[380px]"
          style={{ height: 'min(520px, 82vh)' }}
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
              <div className="p-5">
                <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: BRAND }}>
                      <Sparkles size={13} className="text-white" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">Hi! I'm Ask AI 👋</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    I can help with your dashboard, proposals, reports, invoices, and more. You can also send a screenshot and I'll help you figure it out.
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
                    <div className={`flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full mt-0.5 ${msg.role === 'user' ? 'bg-gray-200' : ''}`}
                      style={msg.role === 'assistant' ? { backgroundColor: BRAND } : {}}>
                      {msg.role === 'user'
                        ? <span className="text-[10px] font-bold text-gray-500">You</span>
                        : <Sparkles size={12} className="text-white" />
                      }
                    </div>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-white border border-gray-200 text-gray-900 rounded-tr-sm'
                        : 'text-white rounded-tl-sm'
                    }`} style={msg.role === 'assistant' ? { backgroundColor: BRAND } : {}}>
                      {msg.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={msg.image} alt="screenshot" className="rounded-xl max-w-full mb-2 max-h-40 object-contain" />
                      )}
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

                {showEscalate && hasInteracted && !escalated && !loading && !showSupportForm && (
                  <div className="flex justify-center">
                    <button onClick={() => setShowSupportForm(true)}
                      className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 hover:border-gray-300 hover:shadow-sm transition-all">
                      <LifeBuoy size={12} />
                      Still need help? Contact support →
                    </button>
                  </div>
                )}

                {showSupportForm && !escalated && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 space-y-2.5">
                    <p className="text-xs font-semibold text-amber-900">Tell us what you need help with</p>
                    <textarea
                      value={supportNote}
                      onChange={e => setSupportNote(e.target.value)}
                      placeholder="Describe your issue so our team can help quickly..."
                      rows={3}
                      className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-amber-400 resize-none"
                      style={{ fontSize: 16 }}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setShowSupportForm(false); setSupportNote(''); }}
                        className="flex-1 rounded-xl border border-gray-200 bg-white py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                        Cancel
                      </button>
                      <button onClick={escalate} disabled={!supportNote.trim() || escalating}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-40 transition-all"
                        style={{ backgroundColor: BRAND }}>
                        {escalating ? <><Loader2 size={11} className="animate-spin" /> Sending...</> : 'Send to Support'}
                      </button>
                    </div>
                  </div>
                )}

                {escalated && (
                  <div className="flex justify-center">
                    <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 font-medium">
                      <CheckCircle2 size={12} /> Support request sent
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-600">
                    <AlertCircle size={13} className="flex-shrink-0" /> {error}
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 border-t border-gray-100 bg-white p-3">
            {/* Pending image preview */}
            {pendingImage && (
              <div className="relative mb-2 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingImage} alt="attachment" className="h-16 rounded-xl object-cover border border-gray-200" />
                <button onClick={() => setPendingImage(null)}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-white">
                  <X size={10} />
                </button>
              </div>
            )}

            {/* Listening indicator */}
            {isListening && (
              <div className="flex items-center gap-2 mb-2 text-xs text-red-500 font-medium">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Listening... speak now
              </div>
            )}

            {/* Text input row */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 focus-within:border-gray-300 focus-within:bg-white transition-colors overflow-hidden">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Message..."
                rows={1}
                disabled={loading}
                className="w-full bg-transparent px-3.5 pt-3 pb-1 text-gray-900 placeholder:text-gray-400 focus:outline-none resize-none disabled:opacity-50"
                style={{ maxHeight: 80, lineHeight: '1.4', fontSize: 16 }}
                onInput={e => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = 'auto';
                  t.style.height = Math.min(t.scrollHeight, 80) + 'px';
                }}
              />

              {/* Toolbar row */}
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-0.5 relative">
                  {/* Emoji */}
                  <button type="button" onClick={() => setShowEmoji(v => !v)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    title="Emoji">
                    <Smile size={17} />
                  </button>
                  {showEmoji && <EmojiPicker onSelect={e => setInput(p => p + e)} onClose={() => setShowEmoji(false)} />}

                  {/* Image upload */}
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    title="Attach screenshot">
                    <Paperclip size={16} />
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

                  {/* Microphone */}
                  {speechSupported && (
                    <button type="button" onClick={toggleVoice}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                        isListening
                          ? 'bg-red-100 text-red-500 hover:bg-red-200'
                          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                      }`}
                      title={isListening ? 'Stop recording' : 'Voice input'}>
                      {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                  )}
                </div>

                {/* Send */}
                <button onClick={() => send()} disabled={(!input.trim() && !pendingImage) || loading}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-40 transition-all"
                  style={{ backgroundColor: BRAND }}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
