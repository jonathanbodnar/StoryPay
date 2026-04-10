'use client';

import { useEffect, useState } from 'react';
import {
  Sparkles, Zap, Wrench, ThumbsUp, Plus, X, Loader2, Trash2,
  ChevronRight, Megaphone, Clock, CheckCircle2, AlertCircle, Lightbulb,
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

interface FeatureRequest {
  id: string;
  title: string;
  description: string | null;
  vote_count: number;
  status: 'open' | 'planned' | 'in_progress' | 'completed';
  created_at: string;
  has_voted: boolean;
  is_mine: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  feature:     { label: 'New Feature',  icon: Sparkles, bg: 'bg-violet-50',  text: 'text-violet-600',  dot: 'bg-violet-500'  },
  improvement: { label: 'Improvement', icon: Zap,       bg: 'bg-blue-50',    text: 'text-blue-600',    dot: 'bg-blue-500'    },
  fix:         { label: 'Fix',         icon: Wrench,    bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500' },
};

const STATUS_CONFIG = {
  open:        { label: 'Open',        icon: Lightbulb,    bg: 'bg-gray-100',    text: 'text-gray-600'    },
  planned:     { label: 'Planned',     icon: Clock,        bg: 'bg-blue-50',     text: 'text-blue-600'    },
  in_progress: { label: 'In Progress', icon: Zap,          bg: 'bg-amber-50',    text: 'text-amber-600'   },
  completed:   { label: 'Completed',   icon: CheckCircle2, bg: 'bg-emerald-50',  text: 'text-emerald-600' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days} days ago`;
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
              <div className="h-8 w-8 rounded-full bg-gray-100 animate-pulse" />
              <div className="flex-1 w-px bg-gray-100 mt-2" />
            </div>
            <div className="flex-1 pb-6">
              <div className="h-4 w-24 bg-gray-100 rounded animate-pulse mb-2" />
              <div className="h-5 w-56 bg-gray-100 rounded animate-pulse mb-3" />
              <div className="h-3 w-full bg-gray-100 rounded animate-pulse mb-1" />
              <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
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
            <div className="flex-1 h-px bg-gray-100" />
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
                    {!isLast && <div className="flex-1 w-px bg-gray-100 mt-2 min-h-6" />}
                  </div>

                  {/* Content card */}
                  <div className="flex-1 rounded-xl border border-gray-200 bg-white p-4 shadow-sm mb-2 hover:shadow transition-shadow">
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
                    <h3 className="mt-2 text-sm font-bold text-gray-900" style={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 700 }}>{entry.title}</h3>
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
          <Megaphone size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No updates yet</p>
        </div>
      )}
    </div>
  );
}

// ─── Feature requests tab ────────────────────────────────────────────────────

function FeatureRequestsTab() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle]       = useState('');
  const [desc, setDesc]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError]       = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetch('/api/feature-requests')
      .then(r => r.ok ? r.json() : [])
      .then(data => setRequests(Array.isArray(data) ? data : []))
      .catch(() => setError('Failed to load feature requests'))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(req: FeatureRequest) {
    if (!confirm(`Delete "${req.title}"? This cannot be undone.`)) return;
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
    if (votingId) return;
    setVotingId(req.id);
    try {
      const res = await fetch(`/api/feature-requests/${req.id}/vote`, { method: 'POST' });
      if (!res.ok) return;
      const { voted, vote_count } = await res.json();
      setRequests(prev =>
        [...prev.map(r => r.id === req.id ? { ...r, has_voted: voted, vote_count } : r)]
          .sort((a, b) => b.vote_count - a.vote_count)
      );
    } finally {
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
        body: JSON.stringify({ title, description: desc }),
      });
      if (!res.ok) {
        const d = await res.json();
        setFormError(d.error || 'Failed to submit');
        return;
      }
      const newReq = await res.json();
      // Always mark newly submitted requests as is_mine = true
      setRequests(prev => [{ ...newReq, is_mine: true }, ...prev].sort((a, b) => b.vote_count - a.vote_count));
      setTitle(''); setDesc('');
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
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 shadow-sm whitespace-nowrap flex-shrink-0"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Submit Request</>}
        </button>
      </div>

      {/* Submission form */}
      {showForm && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-4" style={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 700 }}>Submit a Feature Request</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Feature Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Email reminders for unsigned proposals"
                maxLength={120}
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                Details <span className="text-gray-300">(optional)</span>
              </label>
              <textarea
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Describe what you'd like and why it would help your workflow..."
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
                {submitting && <Loader2 size={14} className="animate-spin flex-shrink-0" />}
                <span>{submitting ? 'Submitting...' : 'Submit Request'}</span>
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
            <div key={i} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="h-12 w-12 rounded-xl bg-gray-100 animate-pulse flex-shrink-0" />
              <div className="flex-1">
                <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-2" />
                <div className="h-3 w-72 bg-gray-100 rounded animate-pulse" />
              </div>
              <div className="h-6 w-16 bg-gray-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <Lightbulb size={36} className="mx-auto mb-3 opacity-30" />
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

            return (
              <div
                key={req.id}
                className={classNames(
                  'flex items-start gap-4 rounded-xl border bg-white p-4 transition-shadow hover:shadow-sm',
                  isTopRequest ? 'border-brand-900/20 bg-brand-900/[0.02]' : 'border-gray-200'
                )}
              >
                {/* Vote button */}
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleVote(req)}
                    disabled={isVoting}
                    className={classNames(
                      'flex flex-col items-center justify-center rounded-xl border-2 w-12 h-12 transition-all',
                      req.has_voted
                        ? 'border-brand-900 bg-brand-900 text-white'
                        : 'border-gray-200 text-gray-400 hover:border-brand-900 hover:text-brand-900 hover:bg-brand-900/5',
                      isVoting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    )}
                  >
                    {isVoting
                      ? <Loader2 size={14} className="animate-spin" />
                      : <ThumbsUp size={14} className={req.has_voted ? '' : ''} />
                    }
                    <span className="text-[11px] font-bold mt-0.5 leading-none">{req.vote_count}</span>
                  </button>
                  {isTopRequest && (
                    <span className="text-[9px] font-semibold text-amber-500 uppercase tracking-wider">Top</span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-gray-900 leading-snug" style={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 700 }}>{req.title}</h4>
                    <span className={classNames('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold flex-shrink-0', statusConf.bg, statusConf.text)}>
                      <StatusIcon size={9} />
                      {statusConf.label}
                    </span>
                  </div>
                  {req.description && (
                    <p className="mt-1 text-xs text-gray-500 leading-relaxed">{req.description}</p>
                  )}
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    {timeAgo(req.created_at)}
                    {req.vote_count > 1 && <span className="ml-1.5 text-gray-300">·</span>}
                    {req.vote_count > 1 && <span className="ml-1.5">{req.vote_count} votes</span>}
                  </p>
                </div>

                {/* Rank + delete */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {idx < 3 && req.vote_count > 0 && (
                    <div className={classNames(
                      'flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold',
                      idx === 0 ? 'bg-amber-100 text-amber-700' :
                      idx === 1 ? 'bg-gray-100 text-gray-600' :
                                  'bg-orange-50 text-orange-600'
                    )}>
                      #{idx + 1}
                    </div>
                  )}
                  {req.is_mine && (
                    <button
                      onClick={() => handleDelete(req)}
                      disabled={deletingId === req.id}
                      className="flex items-center justify-center h-6 w-6 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                      title="Delete your request"
                    >
                      {deletingId === req.id
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Trash2 size={11} />}
                    </button>
                  )}
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
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'changelog' | 'requests';

export default function UpdatesPage() {
  const [tab, setTab] = useState<Tab>('changelog');

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2.5 mb-1">
          <h1 className="font-heading text-2xl text-gray-900">Updates</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active Development
          </span>
        </div>
        <p className="text-sm text-gray-500">See what&apos;s new in StoryPay and help shape what we build next.</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
        {([
          { key: 'changelog', label: "What's New",        icon: Sparkles },
          { key: 'requests',  label: 'Feature Requests',  icon: Lightbulb },
        ] as { key: Tab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={classNames(
              'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Panel */}
      {tab === 'changelog' && <ChangelogTab />}
      {tab === 'requests'  && <FeatureRequestsTab />}
    </div>
  );
}
