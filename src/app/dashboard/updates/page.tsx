'use client';

import { useEffect, useRef, useState } from 'react';
import {
 Sparkles, Zap, Wrench, ThumbsUp, Plus, X, Loader2, Trash2, Pencil,
 ChevronRight, ChevronUp, Megaphone, Clock, CheckCircle2, AlertCircle, Lightbulb, Bug,
} from 'lucide-react';
import { classNames } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChangelogEntry {
 id: string;
 version: string | null;
 title: string;
 description: string;
 category: 'feature' | 'improvement' | 'fix';
 released_at: string;
}

type RequestCategory = 'feature_request' | 'bug_report' | 'improvement' | 'other';

interface FeatureRequest {
 id: string;
 title: string;
 description: string | null;
 vote_count: number;
 status: 'open' | 'planned' | 'in_progress' | 'completed';
 created_at: string;
 completed_at: string | null;
 has_voted: boolean;
 is_mine: boolean;
 category: RequestCategory;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
 feature: { label: 'New Feature', icon: Sparkles, bg: 'bg-violet-50', text: 'text-violet-600', dot: 'bg-violet-500' },
 improvement: { label: 'Improvement', icon: Zap, bg: 'bg-blue-50', text: 'text-blue-600', dot: 'bg-blue-500' },
 fix: { label: 'Fix', icon: Wrench, bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500' },
};

const STATUS_CONFIG = {
 open: { label: 'Open', icon: Lightbulb, bg: 'bg-gray-100', text: 'text-gray-600' },
 planned: { label: 'Planned', icon: Clock, bg: 'bg-blue-50', text: 'text-blue-600' },
 in_progress: { label: 'In Progress', icon: Zap, bg: 'bg-amber-50', text: 'text-amber-600' },
 completed: { label: 'Completed', icon: CheckCircle2, bg: 'bg-emerald-50', text: 'text-emerald-600' },
};

const REQUEST_CATEGORY_CONFIG: Record<RequestCategory, { label: string; icon: React.ElementType; bg: string; text: string; border: string }> = {
 feature_request: { label: 'Feature Request', icon: Sparkles,  bg: 'bg-violet-50',  text: 'text-violet-700', border: 'border-violet-200' },
 bug_report:      { label: 'Bug Report',      icon: Bug,        bg: 'bg-red-50',     text: 'text-red-700',    border: 'border-red-200'    },
 improvement:     { label: 'Improvement',     icon: Zap,        bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200'   },
 other:           { label: 'Other',           icon: Lightbulb,  bg: 'bg-gray-100',   text: 'text-gray-600',   border: 'border-gray-200'   },
};

function timeAgo(iso: string) {
 const diff = Date.now() - new Date(iso).getTime();
 const days = Math.floor(diff / 86400000);
 if (days === 0) return 'Today';
 if (days === 1) return 'Yesterday';
 if (days < 7) return `${days} days ago`;
 if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
 if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
 return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`;
}

function formatDate(iso: string) {
 return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Group changelog by date proximity
function groupByVersion(entries: ChangelogEntry[]) {
 const groups: { date: string; entries: ChangelogEntry[] }[] = [];
 for (const entry of entries) {
 const dateKey = entry.released_at.slice(0, 10);
 const existing = groups.find(g => g.date === dateKey);
 if (existing) existing.entries.push(entry);
 else groups.push({ date: dateKey, entries: [entry] });
 }
 return groups;
}

// ─── Changelog tab ───────────────────────────────────────────────────────────

function ChangelogTab() {
 const [entries, setEntries] = useState<ChangelogEntry[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
 fetch('/api/changelog')
 .then(r => r.ok ? r.json() : [])
 .then(setEntries)
 .finally(() => setLoading(false));
 }, []);

 if (loading) {
 return (
 <div className="space-y-6">
 {Array.from({ length: 4 }).map((_, i) => (
 <div key={i} className="flex gap-5">
 <div className="flex flex-col items-center">
 <div className="h-8 w-8 rounded-full bg-gray-100 animate-pulse"/>
 <div className="flex-1 w-px bg-gray-100 mt-2"/>
 </div>
 <div className="flex-1 pb-6">
 <div className="h-4 w-24 bg-gray-100 rounded animate-pulse mb-2"/>
 <div className="h-5 w-56 bg-gray-100 rounded animate-pulse mb-3"/>
 <div className="h-3 w-full bg-gray-100 rounded animate-pulse mb-1"/>
 <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse"/>
 </div>
 </div>
 ))}
 </div>
 );
 }

 const groups = groupByVersion(entries);

 return (
 <div className="relative">
 {groups.map((group, gi) => (
 <div key={group.date}>
 {/* Date header */}
 <div className="flex items-center gap-3 mb-5">
 <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
 {formatDate(group.date)}
 </span>
 <div className="flex-1 h-px bg-gray-100"/>
 <span className="text-xs text-gray-400">{timeAgo(group.date)}</span>
 </div>

 {/* Entries for this date */}
 <div className="space-y-4 mb-10">
 {group.entries.map((entry, ei) => {
 const cat = CATEGORY_CONFIG[entry.category] ?? CATEGORY_CONFIG.feature;
 const CatIcon = cat.icon;
 const isLast = gi === groups.length - 1 && ei === group.entries.length - 1;

 return (
 <div key={entry.id} className="flex gap-4">
 {/* Timeline dot */}
 <div className="flex flex-col items-center flex-shrink-0 w-8">
 <div className={classNames('flex h-8 w-8 items-center justify-center rounded-full', cat.bg)}>
 <CatIcon size={14} className={cat.text} />
 </div>
 {!isLast && <div className="flex-1 w-px bg-gray-100 mt-2 min-h-6"/>}
 </div>

 {/* Content card */}
 <div className="flex-1 rounded-2xl border border-gray-200 bg-white p-4 mb-2 transition-colors hover:border-gray-300">
 <div className="flex items-start justify-between gap-3 flex-wrap">
 <div className="flex items-center gap-2">
 <span className={classNames('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cat.bg, cat.text)}>
 <CatIcon size={10} />
 {cat.label}
 </span>
 {entry.version && (
 <span className="inline-block rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-mono text-gray-500">
 v{entry.version}
 </span>
 )}
 </div>
 </div>
 <h3 className="mt-2 text-sm font-bold text-gray-900"style={{ fontFamily:"'Open Sans', sans-serif", fontWeight: 700 }}>{entry.title}</h3>
 <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{entry.description}</p>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 ))}

 {entries.length === 0 && !loading && (
 <div className="py-16 text-center text-gray-400">
 <Megaphone size={36} className="mx-auto mb-3 opacity-30"/>
 <p className="text-sm">No updates yet</p>
 </div>
 )}
 </div>
 );
}

// ─── Feature requests tab ────────────────────────────────────────────────────

function FeatureRequestsTab() {
 const [requests, setRequests] = useState<FeatureRequest[]>([]);
 const [completedRequests, setCompletedRequests] = useState<FeatureRequest[]>([]);
 const [loading, setLoading] = useState(true);
 const [completedOpen, setCompletedOpen] = useState(false);
 const [showForm, setShowForm] = useState(false);
 const [title, setTitle] = useState('');
 const [desc, setDesc] = useState('');
 const [category, setCategory] = useState<RequestCategory>('feature_request');
 const [submitting, setSubmitting] = useState(false);
 const [votingId, setVotingId] = useState<string | null>(null);
 const votingInFlight = useRef<Set<string>>(new Set());
 const [deletingId, setDeletingId] = useState<string | null>(null);
 const [editingId, setEditingId] = useState<string | null>(null);
 const [editTitle, setEditTitle] = useState('');
 const [editDesc, setEditDesc] = useState('');
 const [savingEdit, setSavingEdit] = useState(false);
 const [error, setError] = useState('');
 const [formError, setFormError] = useState('');

 useEffect(() => {
 Promise.all([
   fetch('/api/feature-requests').then(r => r.ok ? r.json() : []),
   fetch('/api/feature-requests/completed').then(r => r.ok ? r.json() : []),
 ])
 .then(([active, completed]) => {
   setRequests(Array.isArray(active) ? active : []);
   setCompletedRequests(Array.isArray(completed) ? completed : []);
 })
 .catch(() => setError('Failed to load feature requests'))
 .finally(() => setLoading(false));
 }, []);

 function startEdit(req: FeatureRequest) {
 setEditingId(req.id);
 setEditTitle(req.title);
 setEditDesc(req.description || '');
 }

 async function saveEdit(req: FeatureRequest) {
 if (!editTitle.trim()) return;
 setSavingEdit(true);
 try {
 const res = await fetch(`/api/feature-requests/${req.id}`, {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ title: editTitle.trim(), description: editDesc.trim() }),
 });
 if (res.ok) {
 setRequests(prev => prev.map(r => r.id === req.id ? { ...r, title: editTitle.trim(), description: editDesc.trim() } : r));
 setEditingId(null);
 }
 } finally { setSavingEdit(false); }
 }

 async function handleDelete(req: FeatureRequest) {
 setDeletingId(req.id);
 try {
 const res = await fetch(`/api/feature-requests/${req.id}`, { method: 'DELETE' });
 if (res.ok) {
 setRequests(prev => prev.filter(r => r.id !== req.id));
 }
 } finally {
 setDeletingId(null);
 }
 }

 async function handleVote(req: FeatureRequest) {
 if (votingInFlight.current.has(req.id)) return;
 votingInFlight.current.add(req.id);
 setVotingId(req.id);
 try {
   const res = await fetch(`/api/feature-requests/${req.id}/vote`, { method: 'POST' });
   const data = await res.json() as { voted?: boolean; vote_count?: number; error?: string };
   if (!res.ok) {
     setError(data.error ?? 'Failed to record vote. Please try again.');
     return;
   }
   setRequests(prev =>
     [...prev.map(r => r.id === req.id ? { ...r, has_voted: data.voted ?? false, vote_count: data.vote_count ?? r.vote_count } : r)]
     .sort((a, b) => b.vote_count - a.vote_count)
   );
 } catch {
   setError('Network error — please try again.');
 } finally {
   votingInFlight.current.delete(req.id);
   setVotingId(null);
 }
 }

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault();
 if (!title.trim()) { setFormError('Please enter a title'); return; }
 setSubmitting(true);
 setFormError('');
 try {
 const res = await fetch('/api/feature-requests', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ title, description: desc, category }),
 });
 if (!res.ok) {
 const d = await res.json();
 setFormError(d.error || 'Failed to submit');
 return;
 }
 const newReq = await res.json();
 // Always mark newly submitted requests as is_mine = true
 setRequests(prev => [{ ...newReq, is_mine: true, category }, ...prev].sort((a, b) => b.vote_count - a.vote_count));
 setTitle(''); setDesc(''); setCategory('feature_request');
 setShowForm(false);
 } catch {
 setFormError('Network error — please try again');
 } finally {
 setSubmitting(false);
 }
 }

 return (
 <div>
 {/* Header row */}
 <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
 <p className="text-sm text-gray-600 flex-1 min-w-0">Vote on features you want most. The most-requested features guide our roadmap.</p>
 <button
 onClick={() => setShowForm(v => !v)}
 className="inline-flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
 >
 {showForm ? <><X size={18} /> Cancel</> : <><Plus size={18} /> Submit request</>}
 </button>
 </div>

 {/* Submission form */}
 {showForm && (
 <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
 <h3 className="text-base font-bold text-gray-900 mb-4" style={{ fontFamily:"'Open Sans', sans-serif", fontWeight: 700 }}>Submit a Request</h3>
 <form onSubmit={handleSubmit} className="space-y-4">
 {/* Category selector */}
 <div>
   <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
     Category <span className="text-red-400">*</span>
   </label>
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
     {(Object.entries(REQUEST_CATEGORY_CONFIG) as [RequestCategory, typeof REQUEST_CATEGORY_CONFIG[RequestCategory]][]).map(([key, cfg]) => {
       const CatIcon = cfg.icon;
       const isSelected = category === key;
       return (
         <button
           key={key}
           type="button"
           onClick={() => setCategory(key)}
           className={classNames(
             'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-all',
             isSelected
               ? `${cfg.bg} ${cfg.text} ${cfg.border} ring-2 ring-offset-1 ring-current`
               : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
           )}
         >
           <CatIcon size={13} className={isSelected ? cfg.text : 'text-gray-400'} />
           {cfg.label}
         </button>
       );
     })}
   </div>
 </div>

 {/* Title */}
 <div>
 <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
 Title <span className="text-red-400">*</span>
 </label>
 <input
 type="text"
 value={title}
 onChange={e => setTitle(e.target.value)}
 placeholder={
   category === 'bug_report'  ? 'e.g. Contact phone number not saving' :
   category === 'improvement' ? 'e.g. Make the calendar week view the default' :
   category === 'other'       ? 'e.g. Question about billing' :
   'e.g. Email reminders for unsigned proposals'
 }
 maxLength={120}
 className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
 />
 </div>

 {/* Details */}
 <div>
 <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
 Details <span className="text-gray-300">(optional)</span>
 </label>
 <textarea
 value={desc}
 onChange={e => setDesc(e.target.value)}
 placeholder={
   category === 'bug_report' ? 'Describe the steps to reproduce the issue and what you expected to happen...' :
   'Describe what you\'d like and why it would help your workflow...'
 }
 rows={3}
 className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 resize-none"
 />
 </div>

 {formError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
 <div className="flex justify-end">
 <button
 type="submit"
 disabled={submitting}
 className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 transition-colors whitespace-nowrap"
 style={{ backgroundColor: '#1b1b1b' }}
 >
 {submitting && <Loader2 size={14} className="animate-spin flex-shrink-0"/>}
 <span>{submitting ? 'Submitting...' : 'Submit'}</span>
 </button>
 </div>
 </form>
 </div>
 )}

 {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

 {/* Requests list */}
 {loading ? (
 <div className="space-y-3">
 {Array.from({ length: 5 }).map((_, i) => (
 <div key={i} className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4">
 <div className="h-12 w-12 rounded-xl bg-gray-100 animate-pulse flex-shrink-0"/>
 <div className="flex-1">
 <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-2"/>
 <div className="h-3 w-72 bg-gray-100 rounded animate-pulse"/>
 </div>
 <div className="h-6 w-16 bg-gray-100 rounded animate-pulse"/>
 </div>
 ))}
 </div>
 ) : requests.length === 0 ? (
 <div className="py-16 text-center text-gray-400">
 <Lightbulb size={36} className="mx-auto mb-3 opacity-30"/>
 <p className="text-sm font-medium text-gray-500">No feature requests yet</p>
 <p className="text-xs text-gray-400 mt-1">Be the first to suggest a feature!</p>
 </div>
 ) : (
 <div className="space-y-3">
 {requests.map((req, idx) => {
 const statusConf = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.open;
 const StatusIcon = statusConf.icon;
 const isVoting = votingId === req.id;
 const isTopRequest = idx === 0 && req.vote_count > 1;

 const catConf = REQUEST_CATEGORY_CONFIG[req.category ?? 'feature_request'] ?? REQUEST_CATEGORY_CONFIG.feature_request;
 const CatIcon = catConf.icon;

 return (
 <div
 key={req.id}
 className={classNames(
 'rounded-2xl border bg-white p-4 transition-colors hover:border-gray-300',
 isTopRequest ? 'border-brand-900/20 bg-brand-900/[0.02]' : 'border-gray-200'
 )}
 >
 {/* Top row: title + status + rank/actions */}
 <div className="flex items-start gap-3">
 <div className="flex-1 min-w-0">
 {editingId === req.id ? (
 <div className="space-y-2">
 <input
 type="text"
 value={editTitle}
 onChange={e => setEditTitle(e.target.value)}
 style={{ fontSize: 16 }}
 className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
 />
 <textarea
 value={editDesc}
 onChange={e => setEditDesc(e.target.value)}
 rows={2}
 placeholder="Description (optional)"
 className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none resize-none"
 />
 <div className="flex items-center gap-2">
 <button onClick={() => saveEdit(req)} disabled={savingEdit || !editTitle.trim()}
 className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all">
 {savingEdit ? <Loader2 size={11} className="animate-spin"/> : null}
 Save
 </button>
 <button onClick={() => setEditingId(null)}
 className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
 Cancel
 </button>
 </div>
 </div>
 ) : (
 <>
 {/* Category + status badges */}
 <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
   <span className={classNames('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold flex-shrink-0', catConf.bg, catConf.text, catConf.border)}>
     <CatIcon size={9} />{catConf.label}
   </span>
   <span className={classNames('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold flex-shrink-0', statusConf.bg, statusConf.text)}>
     <StatusIcon size={9} />{statusConf.label}
   </span>
   {isTopRequest && (
     <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
       ★ Top request
     </span>
   )}
 </div>
 <h4 className="text-sm font-bold text-gray-900 leading-snug">{req.title}</h4>
 {req.description && <p className="mt-1 text-xs text-gray-500 leading-relaxed">{req.description}</p>}
 <p className="mt-1 text-[11px] text-gray-400">{timeAgo(req.created_at)}</p>
 </>
 )}
 </div>

 {/* Rank + edit + delete */}
 <div className="flex items-center gap-1 flex-shrink-0">
 {req.is_mine && editingId !== req.id && (
 <>
 <button onClick={() => startEdit(req)}
 className="flex items-center justify-center h-7 w-7 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
 title="Edit">
 <Pencil size={12} />
 </button>
 <button onClick={() => handleDelete(req)} disabled={deletingId === req.id}
 className="flex items-center justify-center h-7 w-7 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
 title="Delete">
 {deletingId === req.id ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>}
 </button>
 </>
 )}
 </div>
 </div>

 {/* Bottom row: vote chips + vote button */}
 <div className="mt-3 flex items-center gap-2 flex-wrap">
 {/* One thumbs-up chip per vote already cast */}
 {Array.from({ length: Math.min(req.vote_count, 8) }).map((_, i) => {
 const isOwn = req.has_voted && i === req.vote_count - 1;
 return (
 <span
 key={i}
 className={classNames(
 'inline-flex items-center justify-center h-7 w-7 rounded-full border-2 text-[13px]',
 isOwn
 ? 'border-[#1b1b1b] bg-[#1b1b1b] text-white'
 : 'border-gray-200 bg-gray-50 text-gray-500'
 )}
 title={isOwn ? 'Your vote' : 'Vote'}
 >
 <ThumbsUp size={12} strokeWidth={2.25} />
 </span>
 );
 })}
 {req.vote_count > 8 && (
 <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
 +{req.vote_count - 8} more
 </span>
 )}

 {/* Vote / un-vote action button */}
 <button
 onClick={() => handleVote(req)}
 disabled={isVoting}
 className={classNames(
 'ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-all',
 req.has_voted
 ? 'border-[#1b1b1b] bg-[#1b1b1b] text-white hover:bg-gray-800'
 : 'border-gray-300 bg-white text-gray-600 hover:border-[#1b1b1b] hover:text-[#1b1b1b]',
 isVoting && 'opacity-50 cursor-not-allowed'
 )}
 >
 {isVoting
 ? <Loader2 size={12} className="animate-spin"/>
 : <ThumbsUp size={12} strokeWidth={2.25} />
 }
 {req.has_voted ? 'Voted' : 'Vote'}
 </button>
 </div>
 </div>
 );
 })}
 </div>
 )}

 {requests.length > 0 && (
 <p className="mt-4 text-center text-xs text-gray-400">
 {requests.length} feature request{requests.length !== 1 ? 's' : ''} · Sorted by most votes
 </p>
 )}

 {/* ── Completed section ── */}
 {!loading && completedRequests.length > 0 && (
 <div className="mt-6">
   <button
     type="button"
     onClick={() => setCompletedOpen(v => !v)}
     className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
   >
     <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
     <span className="flex-1 text-sm font-semibold text-gray-700">
       Completed requests
     </span>
     <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
       {completedRequests.length}
     </span>
     {completedOpen
       ? <ChevronUp size={15} className="shrink-0 text-gray-400" />
       : <ChevronRight size={15} className="shrink-0 text-gray-400" />}
   </button>

   {completedOpen && (
     <div className="mt-2 space-y-2">
       {completedRequests.map(req => (
         <div
           key={req.id}
           className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4"
         >
           <div className="flex items-start gap-3">
             <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
               <CheckCircle2 size={14} className="text-emerald-600" />
             </div>
             <div className="flex-1 min-w-0">
               <div className="flex flex-wrap items-center gap-2">
                 <h4 className="text-sm font-bold text-gray-900 leading-snug">{req.title}</h4>
                 {req.is_mine && (
                   <span className="inline-flex items-center gap-1 rounded-full bg-[#1b1b1b]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1b1b1b]">
                     Your request
                   </span>
                 )}
                 {req.has_voted && !req.is_mine && (
                   <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                     You voted
                   </span>
                 )}
               </div>
               {req.description && (
                 <p className="mt-1 text-xs text-gray-500 leading-relaxed">{req.description}</p>
               )}
               <p className="mt-1 text-[11px] text-emerald-600 font-medium">
                 ✓ Shipped{req.completed_at ? ` · ${formatDate(req.completed_at)}` : ''}
               </p>
             </div>
             <div className="shrink-0 flex items-center gap-1 text-[11px] text-gray-400">
               <ThumbsUp size={11} className="text-gray-400" />
               <span>{req.vote_count}</span>
             </div>
           </div>
         </div>
       ))}
     </div>
   )}
 </div>
 )}
 </div>
 );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'changelog' | 'requests';

export default function UpdatesPage() {
 const [tab, setTab] = useState<Tab>('changelog');

 useEffect(() => {
   fetch('/api/changelog/mark-seen', { method: 'POST' })
     .catch(() => {})
     .finally(() => {
       window.dispatchEvent(new Event('storypay:updates-seen'));
     });
 }, []);

 return (
 <div>
 {/* Header */}
 <div className="mb-8">
 <div className="flex items-center gap-2.5 mb-1">
 <h1 className="font-heading text-2xl text-gray-900">Updates</h1>
 <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
 <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"/>
 Active Development
 </span>
 </div>
 <p className="text-sm text-gray-500">See what&apos;s new in StoryVenue and help shape what we build next.</p>
 </div>

 {/* Tabs */}
 <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
 {([
 { key: 'changelog', label:"What's New", icon: Sparkles },
 { key: 'requests', label: 'Feature Requests', icon: Lightbulb },
 ] as { key: Tab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
 <button
 key={key}
 onClick={() => setTab(key)}
 className={classNames(
 'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
 tab === key ? 'bg-white text-gray-900 ' : 'text-gray-500 hover:text-gray-700'
 )}
 >
 <Icon size={14} />
 {label}
 </button>
 ))}
 </div>

 {/* Panel */}
 {tab === 'changelog' && <ChangelogTab />}
 {tab === 'requests' && <FeatureRequestsTab />}
 </div>
 );
}
