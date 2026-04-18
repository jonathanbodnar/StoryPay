'use client';

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import {
 Sparkles, X, Send, Loader2, ChevronDown,
 LifeBuoy, RotateCcw, CheckCircle2, AlertCircle,
 Mic, MicOff, Smile, Paperclip, ChevronRight, BookOpen,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { getArticlesForPath, getArticleById } from '@/lib/help-articles';

interface Message {
 role: 'user' | 'assistant';
 content: string;
 image?: string;
 timestamp?: Date;
}

const BRAND = '#1b1b1b';
const AI_BUBBLE = '#525252'; // neutral grey — no blue tint, darker than user white bubble

// ─── Emoji Picker ─────────────────────────────────────────────────────────────

const EMOJIS = [
 '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
 '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
 '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫣','🤫',
 '🤔','🫠','🤐','🤨','😐','😑','😶','😏','😒','🙄',
 '😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕',
 '👋','🤚','🖐','✋','🖖','🫱','🫲','🤝','👍','👎',
 '👏','🙌','🤲','🫶','❤️','🧡','💛','💚','💙','💜',
 '🎉','🎊','✨','🔥','⚡','💫','⭐','🌟','💯','✅',
];

function EmojiPicker({ onSelect, onClose }: { onSelect: (e: string) => void; onClose: () => void }) {
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
 const handler = (e: MouseEvent) => {
 if (ref.current && !ref.current.contains(e.target as Node)) onClose();
 };
 document.addEventListener('mousedown', handler);
 return () => document.removeEventListener('mousedown', handler);
 }, [onClose]);

 return (
 <div ref={ref} className="rounded-2xl border border-gray-200 bg-white overflow-hidden"
 style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 30 }}>
 <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
 <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Emoji</p>
 <button onMouseDown={e => { e.preventDefault(); onClose(); }} className="text-gray-400 hover:text-gray-600">
 <X size={13} />
 </button>
 </div>
 <div className="overflow-y-auto p-2"
 style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, maxHeight: 180,
 fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>
 {EMOJIS.map((e, i) => (
 <button key={i} type="button"onMouseDown={ev => { ev.preventDefault(); onSelect(e); onClose(); }}
 className="flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
 style={{ height: 38, fontSize: 20, lineHeight: 1 }}>
 {e}
 </button>
 ))}
 </div>
 </div>
 );
}

// ─── Text rendering ────────────────────────────────────────────────────────────

function cleanLine(text: string) {
 return text
 .replace(/\*\*([^*]+)\*\*/g, '$1')
 .replace(/\*([^*]+)\*/g, '$1')
 .replace(/^#{1,6}\s+/, '')
 .replace(/`([^`]+)`/g, '$1')
 .trim();
}

// Matches [Button Label](/dashboard/path) — navigation deep-links emitted by AI
const NAV_LINK_RE = /\[([^\]]+)\]\((\/dashboard[^)]*)\)/g;

function renderLineWithLinks(text: string, onNavigate: (path: string) => void) {
 const parts: React.ReactNode[] = [];
 let last = 0;
 let m: RegExpExecArray | null;
 NAV_LINK_RE.lastIndex = 0;
 while ((m = NAV_LINK_RE.exec(text)) !== null) {
 if (m.index > last) parts.push(text.slice(last, m.index));
 const [, label, path] = m;
 parts.push(
 <button
 key={m.index}
 onClick={() => onNavigate(path)}
 className="inline-flex items-center gap-1 rounded-lg border border-white/30 bg-white/15 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/25 transition-colors mx-0.5"
 >
 {label} →
 </button>
 );
 last = m.index + m[0].length;
 }
 if (last < text.length) parts.push(text.slice(last));
 return parts.length > 1 ? <>{parts}</> : text;
}

function renderContent(text: string, onNavigate: (path: string) => void) {
 return text.split('\n').map((rawLine, i) => {
 const line = cleanLine(rawLine);
 if (!line) return <div key={i} className="h-1.5"/>;
 // A line that is purely a nav link becomes a standalone button row
 const trimmed = line.trim();
 const soloMatch = /^\[([^\]]+)\]\((\/dashboard[^)]*)\)$/.exec(trimmed);
 if (soloMatch) {
 return (
 <div key={i} className="mt-1.5 mb-0.5">
 <button
 onClick={() => onNavigate(soloMatch[2])}
 className="inline-flex items-center gap-1.5 rounded-2xl border border-white/30 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25 transition-colors"
 >
 {soloMatch[1]} →
 </button>
 </div>
 );
 }
 if (rawLine.trimStart().startsWith('- ') || rawLine.trimStart().startsWith('• ')) {
 return (
 <div key={i} className="flex gap-1.5 mb-0.5">
 <span className="mt-1.5 h-1 w-1 rounded-full bg-current flex-shrink-0 opacity-60"/>
 <span>{renderLineWithLinks(line.replace(/^[-•]\s*/, ''), onNavigate)}</span>
 </div>
 );
 }
 if (/^\d+\.\s/.test(line)) return <p key={i} className="mb-0.5 pl-1">{renderLineWithLinks(line, onNavigate)}</p>;
 return <p key={i} className="mb-0.5 leading-relaxed">{renderLineWithLinks(line, onNavigate)}</p>;
 });
}

function renderArticleBody(text: string) {
 return text.split('\n').map((line, i) => {
 if (!line.trim()) return <div key={i} className="h-1"/>;
 if (line.trimStart().startsWith('- ')) return (
 <div key={i} className="flex gap-1.5 items-start mb-0.5">
 <span className="mt-1.5 h-1 w-1 rounded-full bg-gray-400 flex-shrink-0"/>
 <span>{line.replace(/^[-\s]+/, '')}</span>
 </div>
 );
 if (/^\d+\.\s/.test(line.trimStart())) return (
 <p key={i} className="font-medium text-gray-800 mb-0.5">{line}</p>
 );
 return <p key={i} className="mb-0.5">{line}</p>;
 });
}

function formatTime(d?: Date) {
 if (!d) return '';
 return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Must be declared OUTSIDE AskAIWidget. An inline `const InputBar = () => …`
 * inside the parent creates a new component type every render, so React
 * remounts the textarea after each keystroke and focus is lost.
 */
function AskAIInputBar({
 input,
 onInputChange,
 inputRef,
 pendingImage,
 onClearImage,
 isListening,
 showEmoji,
 onToggleEmoji,
 speechSupported,
 onToggleVoice,
 fileRef,
 onImagePick,
 placeholder,
 loading,
 onSend,
 onEmojiSelect,
 onEmojiClose,
}: {
 input: string;
 onInputChange: (v: string) => void;
 inputRef: RefObject<HTMLTextAreaElement | null>;
 pendingImage: string | null;
 onClearImage: () => void;
 isListening: boolean;
 showEmoji: boolean;
 onToggleEmoji: () => void;
 speechSupported: boolean;
 onToggleVoice: () => void;
 fileRef: RefObject<HTMLInputElement | null>;
 onImagePick: (e: React.ChangeEvent<HTMLInputElement>) => void;
 placeholder: string;
 loading: boolean;
 onSend: () => void;
 onEmojiSelect: (emoji: string) => void;
 onEmojiClose: () => void;
}) {
 return (
 <div className="relative z-10 flex-shrink-0 border-t border-gray-200 bg-white p-3 pointer-events-auto">
 {pendingImage && (
 <div className="relative mb-2 inline-block">
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={pendingImage} alt="attachment"className="h-16 rounded-xl object-cover border border-gray-200"/>
 <button type="button" onClick={onClearImage}
 className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-white">
 <X size={10} />
 </button>
 </div>
 )}
 {isListening && (
 <div className="flex items-center gap-2 mb-2 text-xs text-red-500 font-medium">
 <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse"/>
 Listening… speak now
 </div>
 )}
 <div className="rounded-2xl border border-gray-200 bg-gray-50 focus-within:border-gray-300 focus-within:bg-white transition-colors overflow-hidden">
 <textarea
 ref={inputRef}
 value={input}
 onChange={e => onInputChange(e.target.value)}
 onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
 placeholder={placeholder}
 rows={1}
 className="w-full bg-transparent px-3.5 pt-3 pb-1 text-gray-900 placeholder:text-gray-400 focus:outline-none resize-none"
 style={{ maxHeight: 80, lineHeight: '1.4', fontSize: 16 }}
 onInput={e => {
 const t = e.target as HTMLTextAreaElement;
 t.style.height = 'auto';
 t.style.height = Math.min(t.scrollHeight, 80) + 'px';
 }}
 />
 <div className="flex items-center justify-between px-2 pb-2">
 <div className="flex items-center gap-0.5">
 <button type="button" onClick={onToggleEmoji}
 className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${showEmoji ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
 title="Emoji">
 <Smile size={17} />
 </button>
 <button type="button" onClick={() => fileRef.current?.click()}
 className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
 title="Attach screenshot">
 <Paperclip size={16} />
 </button>
 <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImagePick} />
 {speechSupported && (
 <button type="button" onClick={onToggleVoice}
 className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${isListening ? 'bg-red-100 text-red-500' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
 title={isListening ? 'Stop recording' : 'Voice input'}>
 {isListening ? <MicOff size={16} /> : <Mic size={16} />}
 </button>
 )}
 </div>
 <button type="button" onClick={onSend} disabled={(!input.trim() && !pendingImage) || loading}
 className="flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-40 transition-all"
 style={{ backgroundColor: BRAND }}>
 {loading ? <Loader2 size={14} className="animate-spin"/> : <Send size={14} />}
 </button>
 </div>
 </div>
 {showEmoji && <EmojiPicker onSelect={onEmojiSelect} onClose={onEmojiClose} />}
 </div>
 );
}

// ─── Main widget ───────────────────────────────────────────────────────────────

export default function AskAIWidget() {
 const pathname = usePathname();
 const router = useRouter();

 const [open, setOpen] = useState(false);
 const [messages, setMessages] = useState<Message[]>([]);
 const [input, setInput] = useState('');
 const [loading, setLoading] = useState(false);
 const [escalating, setEscalating] = useState(false);
 const [escalated, setEscalated] = useState(false);
 const [error, setError] = useState('');
 const [showEscalate, setShowEscalate] = useState(false);
 const [unread, setUnread] = useState(0);
 const [supportNote, setSupportNote] = useState('');
 const [showSupportForm, setShowSupportForm] = useState(false);
 const [showEmoji, setShowEmoji] = useState(false);
 const [pendingImage, setPendingImage] = useState<string | null>(null);
 const [isListening, setIsListening] = useState(false);
 const [speechSupported, setSpeechSupported] = useState(false);
 // Article shown inline in the widget (null = not viewing an article)
 const [inlineArticleId, setInlineArticleId] = useState<string | null>(null);

 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const recognitionRef = useRef<any>(null);
 const bottomRef = useRef<HTMLDivElement>(null);
 const scrollContainerRef = useRef<HTMLDivElement>(null);
 const inputRef = useRef<HTMLTextAreaElement>(null);
 const fileRef = useRef<HTMLInputElement>(null);

 const hasInteracted = messages.length >= 2;
 const isEmpty = messages.length === 0;

 // Contextual articles for the current page (up to 3)
 const contextualArticleIds = getArticlesForPath(pathname).slice(0, 3);
 const contextualArticles = contextualArticleIds
 .map(id => getArticleById(id))
 .filter(Boolean) as NonNullable<ReturnType<typeof getArticleById>>[];

 const inlineArticle = inlineArticleId ? getArticleById(inlineArticleId) : null;

 // Suggested AI prompts — page-aware: use article titles as prompts when available
 const suggestedPrompts = contextualArticles.length > 0
 ? contextualArticles.slice(0, 3).map(a => `Tell me about: ${a.title}`)
 : [
 'How do I use this dashboard?',
 'Help me understand my reports',
 'Where can I find my invoices?',
 'How do proposals work?',
 ];

 // Speech support
 useEffect(() => {
 const w = window as unknown as Record<string, unknown>;
 setSpeechSupported(!!(w['SpeechRecognition'] || w['webkitSpeechRecognition']));
 }, []);

 // Listen for sidebar open event
 useEffect(() => {
 const handler = () => setOpen(true);
 window.addEventListener('open-ask-ai', handler);
 return () => window.removeEventListener('open-ask-ai', handler);
 }, []);

 useEffect(() => {
 if (open) { setUnread(0); setTimeout(() => inputRef.current?.focus(), 100); }
 }, [open]);

 useEffect(() => {
 // scrollIntoView can steal focus / scroll the wrong ancestor on mobile.
 // Keep the message list pinned to the bottom inside our panel only.
 const el = scrollContainerRef.current;
 if (el) el.scrollTop = el.scrollHeight;
 }, [messages, loading, inlineArticleId]);

 // Close article view when navigating to a new page
 useEffect(() => {
 setInlineArticleId(null);
 }, [pathname]);

 // ── Voice ────────────────────────────────────────────────────────────────────
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
 if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
 const r = new SR();
 r.continuous = false; r.interimResults = false; r.lang = 'en-US';
 r.onresult = e => setInput(p => p ? p + ' ' + e.results[0][0].transcript : e.results[0][0].transcript);
 r.onend = () => setIsListening(false);
 r.onerror = () => setIsListening(false);
 recognitionRef.current = r; r.start(); setIsListening(true);
 }

 // ── Image ────────────────────────────────────────────────────────────────────
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

 // Leave article view when starting to chat
 setInlineArticleId(null);

 const userMsg: Message = {
 role: 'user',
 content: content || '(screenshot attached)',
 image: pendingImage || undefined,
 timestamp: new Date(),
 };
 const updated = [...messages, userMsg];
 setMessages(updated);
 setInput(''); setPendingImage(null); setLoading(true); setError(''); setShowEscalate(false);

 const apiMessages = updated.map(m => {
 if (m.image) return {
 role: m.role,
 content: [
 { type: 'image_url', image_url: { url: m.image, detail: 'low' } },
 { type: 'text', text: m.content || 'Please help me with this screenshot.' },
 ],
 };
 return { role: m.role, content: m.content };
 });

 try {
		 const res = await fetch('/api/ai/chat', {
			 method: 'POST', headers: { 'Content-Type': 'application/json' },
			 body: JSON.stringify({ messages: apiMessages, pathname }),
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
 }, [input, pendingImage, loading, messages, open, pathname]);

 // ── Escalate ─────────────────────────────────────────────────────────────────
 async function escalate() {
 if (!supportNote.trim()) return;
 setEscalating(true);
 const convo = messages.map(m => ({ role: m.role, content: m.content }));
 const question = messages.find(m => m.role === 'user')?.content || '';
 try {
 const res = await fetch('/api/ai/escalate', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 question,
 conversation: convo,
 currentPage: pathname,
 supportNote: supportNote.trim(),
 }),
 });
 const data = await res.json();
 if (!res.ok) { setError(data.error || 'Failed to send support request.'); return; }
 setEscalated(true); setShowSupportForm(false); setSupportNote('');
 setMessages(prev => [...prev, {
 role: 'assistant',
 content:"I've sent your request to our support team with a full summary of our conversation. Someone will follow up with you via email shortly.",
 timestamp: new Date(),
 }]);
 // Fire-and-forget: draft a help article from this unanswered conversation
 fetch('/api/help/suggest-article', {
 method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ conversation: convo }),
 }).catch(() => { /* non-critical */ });
 } catch {
 setError('Could not send request. Please email clients@storyvenuemarketing.com directly.');
 } finally {
 setEscalating(false); setShowEscalate(false);
 }
 }

 function reset() {
 setMessages([]); setInput(''); setError('');
 setShowEscalate(false); setEscalated(false);
 setPendingImage(null); setShowEmoji(false);
 setInlineArticleId(null);
 }

 return (
 <>
 {/* ── Floating bubble ── */}
 <button
 onClick={() => setOpen(v => !v)}
 className="fixed bottom-6 right-4 sm:right-6 z-[100] flex h-14 w-14 items-center justify-center rounded-full text-white transition-all hover:scale-105 active:scale-95"
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
 className="fixed z-[100] flex flex-col min-h-0 overflow-hidden bg-white border border-gray-200 bottom-0 left-0 right-0 rounded-t-2xl sm:bottom-24 sm:right-6 sm:left-auto sm:rounded-2xl sm:w-[380px]"
 style={{ height: 'min(680px, 88vh)' }}
 >
 {/* ── Header ── */}
 <div className="flex items-center justify-between px-4 py-3.5 flex-shrink-0"style={{ backgroundColor: BRAND }}>
 <div className="flex items-center gap-2.5">
 {/* Back button when reading an article inline */}
 {inlineArticle ? (
 <button onClick={() => setInlineArticleId(null)}
 className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:bg-white/15 transition-colors"
 title="Back">
 <ChevronDown size={18} className="rotate-90"/>
 </button>
 ) : (
 <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
 <Sparkles size={16} className="text-white"/>
 </div>
 )}
 <div>
 <p className="text-sm font-semibold text-white leading-none">
 {inlineArticle ? inlineArticle.title : 'Ask AI'}
 </p>
 <p className="text-[11px] text-white/60 mt-0.5">
 {inlineArticle ? inlineArticle.catLabel : 'Powered by your live account data'}
 </p>
 </div>
 </div>
 <div className="flex items-center gap-1.5">
 {(messages.length > 0 || inlineArticle) && (
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

 {/* ── Content area ── */}
 <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ backgroundColor: '#f9fafb' }}>

 {/* ── STATE A: Article inline view ── */}
 {isEmpty && inlineArticle && (
 <div className="p-5">
 <div className="text-xs text-gray-600 leading-relaxed space-y-1.5">
 {renderArticleBody(inlineArticle.body)}
 </div>
 {/* Hint to use chat */}
 <div className="mt-5 rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 flex items-center gap-2">
 <Sparkles size={13} className="text-gray-400 flex-shrink-0"/>
 <p className="text-xs text-gray-500">Have a question about this? Type below and Ask AI.</p>
 </div>
 <div ref={bottomRef} />
 </div>
 )}

 {/* ── STATE B: Empty / home state (hybrid help + AI) ── */}
 {isEmpty && !inlineArticle && (
 <div className="p-4 space-y-4">

 {/* AI intro */}
 <div className="rounded-2xl bg-white border border-gray-200 p-4">
 <div className="flex items-center gap-2 mb-2">
 <div className="flex h-7 w-7 items-center justify-center rounded-full"style={{ backgroundColor: AI_BUBBLE }}>
 <Sparkles size={13} className="text-white"/>
 </div>
 <span className="text-sm font-semibold text-gray-900">Hi! I&apos;m Ask AI 👋</span>
 </div>
 <p className="text-sm text-gray-600 leading-relaxed">
 {pathname?.startsWith('/dashboard/leads')
 ? 'I know your account data and, on this page, your lead pipeline snapshot (stages, totals, recent leads). Ask about weighted pipeline, owners, or anything else — or attach a screenshot.'
 : 'I know your account data in real time — revenue, proposals, customers. Ask me anything, or attach a screenshot.'}
 </p>
 </div>

 <div ref={bottomRef} />
 </div>
 )}

 {/* ── STATE C: Active chat ── */}
 {!isEmpty && (
 <div className="p-4 space-y-3">
 {messages.map((msg, i) => (
 <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
 <div
 className={`flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full mt-0.5 ${msg.role === 'user' ? 'bg-gray-200' : ''}`}
 style={msg.role === 'assistant' ? { backgroundColor: AI_BUBBLE } : {}}>
 {msg.role === 'user'
 ? <span className="text-[10px] font-bold text-gray-500">You</span>
 : <Sparkles size={12} className="text-white"/>}
 </div>
 <div
 className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
 msg.role === 'user'
 ? 'bg-white border border-gray-200 text-gray-900 rounded-tr-sm'
 : 'text-white rounded-tl-sm'
 }`}
 style={msg.role === 'assistant' ? { backgroundColor: AI_BUBBLE } : {}}>
 {msg.image && (
 // eslint-disable-next-line @next/next/no-img-element
 <img src={msg.image} alt="screenshot"className="rounded-xl max-w-full mb-2 max-h-40 object-contain"/>
 )}
 <div className={msg.role === 'assistant' ? 'text-white/95' : ''}>
 {renderContent(msg.content, (path) => { router.push(path); setOpen(false); })}
 </div>
 {msg.timestamp && (
 <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-gray-400 text-right' : 'text-white/60'}`}>
 {formatTime(msg.timestamp)}
 </p>
 )}
 </div>
 </div>
 ))}

 {loading && (
 <div className="flex gap-2.5">
 <div className="flex h-7 w-7 items-center justify-center rounded-full"style={{ backgroundColor: AI_BUBBLE }}>
 <Sparkles size={12} className="text-white"/>
 </div>
 <div className="rounded-2xl rounded-tl-sm px-4 py-3"style={{ backgroundColor: AI_BUBBLE }}>
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
 className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 hover:border-gray-300 hover: transition-all">
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
 placeholder="Describe your issue so our team can help quickly…"
 rows={3}
 className="w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-amber-400 resize-none"
 style={{ fontSize: 16 }}
 />
 <div className="flex gap-2">
 <button onClick={() => { setShowSupportForm(false); setSupportNote(''); }}
 className="flex-1 rounded-2xl border border-gray-200 bg-white py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
 Cancel
 </button>
 <button onClick={escalate} disabled={!supportNote.trim() || escalating}
 className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-40 transition-all"
 style={{ backgroundColor: BRAND }}>
 {escalating ? <><Loader2 size={11} className="animate-spin"/> Sending…</> : 'Send to Support'}
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
 <AlertCircle size={13} className="flex-shrink-0"/> {error}
 </div>
 )}
 <div ref={bottomRef} />
 </div>
 )}
 </div>

 {/* ── Input bar (stable component — do not define inline in parent) ── */}
 <AskAIInputBar
 input={input}
 onInputChange={setInput}
 inputRef={inputRef}
 pendingImage={pendingImage}
 onClearImage={() => setPendingImage(null)}
 isListening={isListening}
 showEmoji={showEmoji}
 onToggleEmoji={() => setShowEmoji(v => !v)}
 speechSupported={speechSupported}
 onToggleVoice={toggleVoice}
 fileRef={fileRef}
 onImagePick={handleImagePick}
 placeholder={inlineArticle ? 'Ask a follow-up question…' : 'Message…'}
 loading={loading}
 onSend={() => { void send(); }}
 onEmojiSelect={e => setInput(p => p + e)}
 onEmojiClose={() => setShowEmoji(false)}
 />
 </div>
 )}
 </>
 );
}
