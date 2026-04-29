'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  DollarSign, Users, FileText, Clock, XCircle, Building2,
  TrendingUp, LogOut, Home,
  Megaphone, Plus, Trash2, Pencil, X, Loader2, ThumbsUp, ThumbsDown,
  Check, BarChart2, ExternalLink, ChevronRight, Search, RefreshCw,
  LayoutDashboard, Menu, Lightbulb, BookOpen, Star, Globe, Layers,
  Repeat, Wallet, BadgeCheck, Sparkles, CalendarDays, Eye, EyeOff,
  Settings, Database, CheckCircle2, AlertCircle,
} from 'lucide-react';
import {
  VenueManagementPortal,
  type AdminVenueRow,
} from '@/components/admin/VenueManagementPortal';
import { DirectoryPlansAdminPanel } from '@/components/admin/DirectoryPlansAdminPanel';
import { DirectoryBadgesAdminPanel } from '@/components/admin/DirectoryBadgesAdminPanel';

// Lazy-load the WYSIWYG editor so it doesn't affect admin initial load
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  ssr: false,
  loading: () => <div className="h-64 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading editor...</div>,
});
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, LineChart, Line, Legend,
} from 'recharts';
import DateRangePicker, { DateRange, PRESETS } from '@/components/DateRangePicker';

const BRAND = '#1b1b1b';

type AdminTabKey =
  | 'dashboard'
  | 'venues'
  | 'directory-plans'
  | 'directory-badges'
  | 'announcements'
  | 'feature-requests'
  | 'changelog'
  | 'suggested-articles'
  | 'search-analytics'
  | 'article-ratings'
  | 'blog'
  | 'seo-pages'
  | 'trends'
  | 'system';

const ADMIN_TAB_KEYS: ReadonlySet<string> = new Set<AdminTabKey>([
  'dashboard',
  'venues',
  'directory-plans',
  'directory-badges',
  'announcements',
  'feature-requests',
  'changelog',
  'suggested-articles',
  'search-analytics',
  'article-ratings',
  'blog',
  'seo-pages',
  'trends',
  'system',
]);

const PAGE_LABELS: Record<string, { label: string; url: string; description: string }> = {
  home:    { label: 'Homepage',       url: 'storypay.io/',          description: 'Main landing page' },
  blog:    { label: 'Blog Index',     url: 'storypay.io/blog',      description: 'Blog listing page' },
  login:   { label: 'Login Page',     url: 'storypay.io/login',     description: 'Sign-in page' },
  privacy: { label: 'Privacy Policy', url: 'storypay.io/privacy',   description: 'Privacy policy page' },
  terms:   { label: 'Terms of Use',   url: 'storypay.io/terms',     description: 'Terms of use page' },
};

function parseAdminSegments(segments: string[]): { tab: AdminTabKey; rest: string[] } {
  if (segments.length === 0) return { tab: 'dashboard', rest: [] };
  const [first, ...rest] = segments;
  if (ADMIN_TAB_KEYS.has(first)) return { tab: first as AdminTabKey, rest };
  return { tab: 'dashboard', rest: [] };
}

function adminHref(tab: AdminTabKey, rest: string[] = []): string {
  if (tab === 'dashboard') return '/admin';
  const base = `/admin/${tab}`;
  if (rest.length) return `${base}/${rest.map(encodeURIComponent).join('/')}`;
  return base;
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface Venue { id: string; name: string; email: string | null; ghl_location_id: string | null; onboarding_status: string; setup_completed: boolean; created_at: string; login_url: string | null; venue_tokens: { token: string }[]; }
interface AdminStats {
  totalRevenue: number; totalProposals: number; pendingPayments: number;
  failedPayments: number; uniqueCustomers: number; uniqueVenues: number;
  waitlistCount: number; venueCount: number;
  statusBreakdown: Record<string, number>;
  monthlyChart: { month: string; label: string; revenue: number; proposals: number }[];
  featureRequests: { id: string; title: string; vote_count: number; status: string; created_at: string; admin_read_at: string | null; category: string; venue_id: string | null }[];
  directoryActiveMrrCents?: number;
  directoryAssignedMrrCents?: number;
  directoryActiveSubscriptionCount?: number;
  directoryAssignedPayingVenueCount?: number;
  directoryMrrByPlan?: { planId: string; name: string; slug: string; venueCount: number; mrrCents: number }[];
  platformSaaSRevenueInRangeCents?: number;
  platformSaaSMonthlyChart?: { month: string; label: string; revenue: number }[];
}
interface Announcement { id: string; message: string; link_text: string | null; link_url: string | null; is_active: boolean; created_at: string; }
type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

function formatCents(c: number) { return (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
function formatShort(c: number) { const d = c / 100; return d >= 1000 ? `$${(d/1000).toFixed(1)}k` : `$${d.toFixed(0)}`; }
function getDefaultRange(): DateRange { const p = PRESETS.find(x => x.label === 'Last 30 days')!; return { ...p.getRange(), label: p.label }; }

// Drill-down types
type DrillKey = 'venues' | 'waitlist' | 'customers' | 'failed' | 'pending' | null;
interface WaitlistEntry { id: string; first_name: string | null; last_name: string | null; email: string; phone: string | null; venue_name: string | null; referral_source: string | null; created_at: string; }
interface FailedPayment { id: string; customer_name: string | null; price: number; status: string; created_at: string; }
interface ChangelogEntry { id: string; title: string; description: string; category: string; released_at: string; }
interface FeatureRequestDetail { id: string; title: string; description: string | null; vote_count: number; status: string; created_at: string; completed_at: string | null; changelog_id: string | null; changelogEntry: ChangelogEntry | null; voters: { venue_id: string; venue_name: string; voted_at: string }[]; }

const STATUS_COLORS_FR: Record<string, string> = { open: 'bg-gray-100 text-gray-600', planned: 'bg-blue-100 text-blue-700', in_progress: 'bg-amber-100 text-amber-700', completed: 'bg-emerald-100 text-emerald-700' };
const STATUS_LABELS_FR: Record<string, string> = { open: 'Open', planned: 'Planned', in_progress: 'In Progress', completed: 'Completed' };

function KPICard({ label, value, icon: Icon, color, onClick }: { label: string; value: string | number; icon: React.ElementType; color: string; onClick?: () => void }) {
  return (
    <div
      className={`rounded-xl bg-white border border-gray-200 p-5 ${onClick ? 'cursor-pointer hover:hover:border-gray-300 transition-all' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</span>
        <div className="flex items-center gap-1">
          {onClick && <ChevronRight size={12} className="text-gray-300" />}
          <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '18' }}>
            <Icon size={15} style={{ color }} />
          </div>
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
    </div>
  );
}

function DrillModal({ title, count, onClose, searchQuery, onSearchChange, searchPlaceholder, children }: {
  title: string;
  count?: number;
  onClose: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: BRAND }}>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-white">{title}</h3>
            {count !== undefined && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold text-white">{count}</span>
            )}
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors">
            <X size={14} />
          </button>
        </div>
        {/* Search bar */}
        {onSearchChange !== undefined && (
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder || 'Search...'}
                className="w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3.5 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                autoFocus
              />
            </div>
          </div>
        )}
        {/* Content — scrollable */}
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Announcement Form ────────────────────────────────────────────────────────
function AnnouncementForm({ initial, onSave, onCancel }: {
  initial?: Announcement;
  onSave: (data: { message: string; link_text: string; link_url: string; is_active: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  const [message, setMessage]     = useState(initial?.message || '');
  const [linkText, setLinkText]   = useState(initial?.link_text || '');
  const [linkUrl, setLinkUrl]     = useState(initial?.link_url || '');
  const [isActive, setIsActive]   = useState(initial?.is_active ?? true);
  const [saving, setSaving]       = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({ message, link_text: linkText, link_url: linkUrl, is_active: isActive });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
          Announcement Message <span className="text-red-400">*</span>
        </label>
        <textarea
          value={message} onChange={e => setMessage(e.target.value)} required rows={2}
          placeholder="New feature: AI proposal generation is now live!"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:bg-white transition-colors resize-none"
        />
        <p className="text-[11px] text-gray-400 mt-1">
          To link a word, type it in Link Text and add the URL. It will appear as a clickable link inside the announcement.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Link Text (optional)</label>
          <input type="text" value={linkText} onChange={e => setLinkText(e.target.value)} placeholder="Learn more"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:bg-white transition-colors" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Link URL (optional)</label>
          <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:bg-white transition-colors" />
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
            className="rounded border-gray-300 text-brand-900" />
          Active (visible to all venues)
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all" style={{ backgroundColor: BRAND }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {initial ? 'Update' : 'Publish'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// ─── Feature Requests Admin Tab ──────────────────────────────────────────────
function FeatureRequestsAdminTab({
  requests, loading, onDelete, onOpen, onRefresh, frDeleting, onToggleRead,
}: {
  requests: { id: string; title: string; vote_count: number; status: string; created_at: string; admin_read_at: string | null; category: string; venue_id: string | null }[];
  loading: boolean;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  frDeleting: string | null;
  onToggleRead: (id: string, markRead: boolean) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle]       = useState('');
  const [desc, setDesc]         = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState('');
  const [togglingRead, setTogglingRead] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setFormError('Title is required'); return; }
    setSubmitting(true); setFormError('');
    try {
      const res = await fetch('/api/admin/feature-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: desc.trim() || null }),
      });
      if (!res.ok) { const d = await res.json(); setFormError(d.error || 'Failed'); return; }
      setTitle(''); setDesc(''); setShowForm(false);
      onRefresh();
    } catch { setFormError('Network error'); }
    finally { setSubmitting(false); }
  }

  async function handleToggleRead(id: string, markRead: boolean) {
    setTogglingRead(id);
    try {
      await fetch(`/api/admin/feature-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_read: markRead }),
      });
      onToggleRead(id, markRead);
    } catch { /* non-critical */ }
    finally { setTogglingRead(null); }
  }

  const unreadCount = requests.filter(r => r.venue_id && r.status !== 'completed' && !r.admin_read_at).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl text-gray-900">Feature Requests</h1>
            {unreadCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-0.5 text-[11px] font-bold text-white">
                {unreadCount} new
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Manage and prioritize venue feature requests</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {showForm ? <><X size={14}/> Cancel</> : <><Plus size={14}/> New Request</>}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Create Feature Request</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Title <span className="text-red-400">*</span></label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Bulk invoice export" maxLength={120}
                style={{ fontSize: 16 }}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Description <span className="text-gray-300">(optional)</span></label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Describe the feature and why it would help..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors resize-none" />
            </div>
            {formError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
            <div className="flex justify-end">
              <button type="submit" disabled={submitting}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
                style={{ backgroundColor: '#1b1b1b' }}>
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {submitting ? 'Creating...' : 'Create Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lists */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
      ) : (() => {
        // Venue-submitted requests first, then admin-created; within each group, by date desc
        const active = requests.filter(r => r.status !== 'completed');
        const completed = requests.filter(r => r.status === 'completed');

        // Sort: unread venue submissions at top, then read venue, then admin-created
        const sortedActive = [...active].sort((a, b) => {
          const aUnread = a.venue_id && !a.admin_read_at ? 1 : 0;
          const bUnread = b.venue_id && !b.admin_read_at ? 1 : 0;
          if (bUnread !== aUnread) return bUnread - aUnread;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        const RequestRow = ({ req, i }: { req: typeof requests[0]; i: number }) => {
          const isUnread = !!req.venue_id && !req.admin_read_at && req.status !== 'completed';
          const isToggling = togglingRead === req.id;
          return (
            <div className={`transition-colors ${isUnread ? 'bg-red-50/40' : 'hover:bg-gray-50'}`}>
              {/* Mobile layout */}
              <div className="sm:hidden flex items-center gap-3 px-4 py-3.5">
                {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                <button onClick={() => onOpen(req.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-medium truncate ${isUnread ? 'text-gray-900 font-semibold' : 'text-gray-900'}`}>{req.title}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS_FR[req.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS_FR[req.status] || req.status}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400"><ThumbsUp size={11}/> {req.vote_count} · {new Date(req.created_at).toLocaleDateString()}</div>
                </button>
                {req.venue_id && (
                  <button
                    onClick={() => handleToggleRead(req.id, !req.admin_read_at ? true : false)}
                    disabled={isToggling}
                    title={isUnread ? 'Mark as read' : 'Mark as unread'}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 ${
                      isUnread ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    {isToggling ? <Loader2 size={13} className="animate-spin"/> : isUnread ? <Check size={13}/> : <Repeat size={13}/>}
                  </button>
                )}
                <button onClick={() => onDelete(req.id)} disabled={frDeleting === req.id}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40">
                  {frDeleting === req.id ? <Loader2 size={13} className="animate-spin"/> : <Trash2 size={13}/>}
                </button>
              </div>
              {/* Desktop layout */}
              <div className="hidden sm:grid grid-cols-[1fr_110px_80px_120px_48px_48px] gap-4 px-6 py-4 items-center">
                <button onClick={() => onOpen(req.id)} className="text-left flex items-center gap-3 min-w-0">
                  {isUnread
                    ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500"><span className="h-2 w-2 rounded-full bg-white" /></span>
                    : <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style={{ backgroundColor: i===0?'#f59e0b':i===1?'#6b7280':i===2?'#cd7c2f':'#1b1b1b' }}>#{i+1}</div>
                  }
                  <span className={`text-sm truncate hover:underline ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}`}>{req.title}</span>
                  {isUnread && <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">NEW</span>}
                </button>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit ${STATUS_COLORS_FR[req.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS_FR[req.status] || req.status}</span>
                <div className="flex items-center gap-1 text-sm text-gray-600"><ThumbsUp size={13} className="text-gray-400"/>{req.vote_count}</div>
                <span className="text-sm text-gray-500">{new Date(req.created_at).toLocaleDateString()}</span>
                {req.venue_id ? (
                  <button
                    onClick={() => handleToggleRead(req.id, !req.admin_read_at ? true : false)}
                    disabled={isToggling}
                    title={isUnread ? 'Mark as read' : 'Mark as unread'}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 ${
                      isUnread ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-gray-200 text-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    {isToggling ? <Loader2 size={13} className="animate-spin"/> : isUnread ? <Check size={13}/> : <Repeat size={13}/>}
                  </button>
                ) : <span />}
                <button onClick={() => onDelete(req.id)} disabled={frDeleting === req.id}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40">
                  {frDeleting === req.id ? <Loader2 size={13} className="animate-spin"/> : <Trash2 size={13}/>}
                </button>
              </div>
            </div>
          );
        };

        return (
          <div className="space-y-8">
            {/* Active requests */}
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Active Requests ({active.length})</h2>
              {active.length === 0 ? (
                <div className="py-12 text-center rounded-2xl border border-dashed border-gray-200">
                  <Lightbulb size={32} className="mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-500">No active feature requests</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  <div className="hidden sm:grid grid-cols-[1fr_110px_80px_120px_48px_48px] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100">
                    {['Title','Status','Votes','Date','Read',''].map(h => <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>)}
                  </div>
                  <div className="divide-y divide-gray-100">
                    {sortedActive.map((req, i) => <RequestRow key={req.id} req={req} i={i} />)}
                  </div>
                </div>
              )}
            </div>

            {/* Completed archive */}
            {completed.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">✅ Completed &amp; Shipped ({completed.length})</h2>
                <div className="rounded-2xl border border-emerald-200 bg-white overflow-hidden">
                  <div className="hidden sm:grid grid-cols-[1fr_110px_80px_120px_48px_48px] gap-4 px-6 py-3 bg-emerald-50 border-b border-emerald-100">
                    {['Title','Status','Votes','Completed','',''].map(h => <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">{h}</span>)}
                  </div>
                  <div className="divide-y divide-gray-100">
                    {completed.map((req, i) => <RequestRow key={req.id} req={req} i={i} />)}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

const ADMIN_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'venues', label: 'Venue management', icon: Building2 },
  { key: 'directory-badges', label: 'Verified & Sponsored', icon: BadgeCheck },
  { key: 'directory-plans', label: 'Directory plans', icon: Layers },
  { key: 'blog', label: 'Blog Posts', icon: BookOpen },
  { key: 'seo-pages', label: 'SEO / Pages', icon: Globe },
  { key: 'trends', label: 'Google Trends', icon: TrendingUp },
  { key: 'announcements', label: 'Announcements', icon: Megaphone },
  { key: 'feature-requests', label: 'Feature Requests', icon: Lightbulb },
  { key: 'changelog', label: 'Changelog', icon: Sparkles },
  { key: 'suggested-articles', label: 'Suggested Articles', icon: BookOpen },
  { key: 'search-analytics', label: 'Search Analytics', icon: BarChart2 },
  { key: 'article-ratings', label: 'Article Ratings', icon: Star },
  { key: 'system', label: 'System / Migrations', icon: Settings },
] as const;

/** Module-level component so React does not remount the sidebar on every parent render. */
function AdminNavSidebar({
  activeTab,
  onMobileClose,
  onLogout,
  frUnreadCount,
}: {
  activeTab: AdminTabKey;
  onMobileClose: () => void;
  onLogout: () => void;
  frUnreadCount: number;
}) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#fafaf9' }}>
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/storyvenue-dark-logo.png" alt="StoryVenue Admin" className="h-8 object-contain" />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mt-1.5">Super Admin</p>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {ADMIN_NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          const href =
            key === 'seo-pages'
              ? adminHref('seo-pages', ['home'])
              : adminHref(key as AdminTabKey);
          const showBadge = key === 'feature-requests' && frUnreadCount > 0;
          return (
            <Link
              key={key}
              href={href}
              scroll={false}
              prefetch
              onClick={() => onMobileClose()}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${active ? 'text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}
              style={active ? { backgroundColor: BRAND } : {}}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{label}</span>
              {showBadge && (
                <span className="ml-auto shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                  {frUnreadCount > 99 ? '99+' : frUnreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-gray-100 space-y-1">
        <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-gray-700 transition-colors text-sm w-full px-2 py-1.5 rounded-lg hover:bg-gray-50">
          <Home size={16} /><span>Homepage</span>
        </Link>
        <button type="button" onClick={onLogout} className="flex items-center gap-2 text-gray-400 hover:text-gray-700 transition-colors text-sm w-full px-2 py-1.5 rounded-lg hover:bg-gray-50">
          <LogOut size={16} /><span>Logout</span>
        </button>
      </div>
    </div>
  );
}

export default function AdminSlugLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const pathSegments = useMemo(() => {
    const raw = params.slug;
    if (raw == null) return [] as string[];
    return Array.isArray(raw) ? raw : [raw];
  }, [params.slug]);

  const { tab: activeTab, rest: tabRest } = parseAdminSegments(pathSegments);

  const goBlog = useCallback(
    (sub: string[]) => {
      router.push(sub.length ? adminHref('blog', sub) : adminHref('blog'));
    },
    [router],
  );

  const goSeoPage = useCallback(
    (key: string) => {
      router.replace(adminHref('seo-pages', [key]));
    },
    [router],
  );

  const [authState, setAuthState]   = useState<AuthState>('loading');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPass, setAdminPass]   = useState('');
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Feature request unread badge
  const [frUnreadCount, setFrUnreadCount] = useState(0);

  const fetchFrUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/feature-requests/unread-count');
      if (res.ok) {
        const d = await res.json() as { count?: number };
        if (typeof d.count === 'number') setFrUnreadCount(d.count);
      }
    } catch { /* non-critical */ }
  }, []);

  // Stats
  const [stats, setStats]       = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange);

  // Venues
  const [venues, setVenues]         = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);

  // Announcements
  const [announcements, setAnnouncements]   = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading]         = useState(false);
  const [showAnnForm, setShowAnnForm]       = useState(false);
  const [editingAnn, setEditingAnn]         = useState<Announcement | null>(null);

  // Drill-down
  const [drillKey, setDrillKey]         = useState<DrillKey>(null);
  const [drillData, setDrillData]       = useState<Record<string, unknown>[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillSearch, setDrillSearch]   = useState('');

  // Feature request detail
  const [frDetail, setFrDetail]           = useState<FeatureRequestDetail | null>(null);
  const [frDetailLoading, setFrDetailLoading] = useState(false);
  const [frDetailError, setFrDetailError] = useState('');
  const [frDeleting, setFrDeleting]       = useState<string | null>(null);
  const [frStatusSaving, setFrStatusSaving] = useState(false);
  // Inline edit state
  const [frEditing, setFrEditing] = useState(false);
  const [frEditTitle, setFrEditTitle] = useState('');
  const [frEditDesc, setFrEditDesc] = useState('');
  const [frEditSaving, setFrEditSaving] = useState(false);
  // Changelog form (shown when marking a request completed)
  const [showChangelogForm, setShowChangelogForm] = useState(false);
  const [clTitle, setClTitle]   = useState('');
  const [clDesc, setClDesc]     = useState('');
  const [clCat, setClCat]       = useState<'feature' | 'improvement' | 'fix'>('feature');

  // Inline edit for linked changelog entry inside FR modal
  const [clEditingId, setClEditingId]   = useState<string | null>(null);
  const [clEditTitle, setClEditTitle]   = useState('');
  const [clEditDesc, setClEditDesc]     = useState('');
  const [clEditCat, setClEditCat]       = useState<'feature' | 'improvement' | 'fix'>('feature');
  const [clEditSaving, setClEditSaving] = useState(false);
  const [clDeleting, setClDeleting]     = useState<string | null>(null);

  // Standalone Changelog admin tab
  interface ChangelogAdminEntry { id: string; title: string; description: string; category: string; version: string | null; released_at: string; }
  const [clEntries, setClEntries]           = useState<ChangelogAdminEntry[]>([]);
  const [clLoading, setClLoading]           = useState(false);
  const [clCreateOpen, setClCreateOpen]     = useState(false);
  const [clNewTitle, setClNewTitle]         = useState('');
  const [clNewDesc, setClNewDesc]           = useState('');
  const [clNewCat, setClNewCat]             = useState<'feature' | 'improvement' | 'fix'>('feature');
  const [clNewVersion, setClNewVersion]     = useState('');
  const [clNewDate, setClNewDate]           = useState('');
  const [clCreating, setClCreating]         = useState(false);
  const [clCreateError, setClCreateError]   = useState('');
  const [clTabEditId, setClTabEditId]       = useState<string | null>(null);
  const [clTabEditTitle, setClTabEditTitle] = useState('');
  const [clTabEditDesc, setClTabEditDesc]   = useState('');
  const [clTabEditCat, setClTabEditCat]     = useState<'feature' | 'improvement' | 'fix'>('feature');
  const [clTabEditVersion, setClTabEditVersion] = useState('');
  const [clTabEditDate, setClTabEditDate]   = useState('');
  const [clTabEditSaving, setClTabEditSaving] = useState(false);
  const [clTabDeleting, setClTabDeleting]   = useState<string | null>(null);

  // ── Suggested Articles ──────────────────────────────────────────────────────
  interface SuggestedArticle { id: string; title: string; body: string; source_question: string | null; venue_id: string | null; status: string; created_at: string; }
  const [suggestedArticles, setSuggestedArticles]       = useState<SuggestedArticle[]>([]);
  const [suggestedLoading, setSuggestedLoading]         = useState(false);
  const [suggestedExpandedId, setSuggestedExpandedId]   = useState<string | null>(null);
  const [suggestedSaving, setSuggestedSaving]           = useState<string | null>(null);

  const fetchSuggestedArticles = useCallback(async () => {
    setSuggestedLoading(true);
    try {
      const res = await fetch('/api/admin/suggested-articles');
      if (res.ok) setSuggestedArticles(await res.json());
    } finally { setSuggestedLoading(false); }
  }, []);

  async function updateSuggestedStatus(id: string, status: string) {
    setSuggestedSaving(id);
    try {
      const res = await fetch('/api/admin/suggested-articles', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) setSuggestedArticles(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    } finally { setSuggestedSaving(null); }
  }

  async function deleteSuggestedArticle(id: string) {
    const res = await fetch('/api/admin/suggested-articles', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setSuggestedArticles(prev => prev.filter(a => a.id !== id));
  }

  // ── Search Analytics ────────────────────────────────────────────────────────
  interface SearchAnalytics {
    zeroResults: { term: string; count: number }[];
    topSearches: { term: string; count: number }[];
    totalSearches: number;
    totalZeroResults: number;
  }
  const [searchAnalytics, setSearchAnalytics]     = useState<SearchAnalytics | null>(null);
  const [searchAnalyticsLoading, setSearchAnalyticsLoading] = useState(false);

  const fetchSearchAnalytics = useCallback(async () => {
    setSearchAnalyticsLoading(true);
    try {
      const res = await fetch('/api/admin/search-analytics');
      if (res.ok) setSearchAnalytics(await res.json());
    } finally { setSearchAnalyticsLoading(false); }
  }, []);

  // ── Article Ratings ─────────────────────────────────────────────────────────
  interface ArticleRatingRow { article_id: string; up: number; down: number; total: number; }
  const [articleRatings, setArticleRatings]       = useState<ArticleRatingRow[]>([]);
  const [ratingsLoading, setRatingsLoading]       = useState(false);

  const fetchArticleRatings = useCallback(async () => {
    setRatingsLoading(true);
    try {
      const res = await fetch('/api/admin/article-ratings');
      if (res.ok) setArticleRatings(await res.json());
    } finally { setRatingsLoading(false); }
  }, []);

  const fetchStats = useCallback(async (range: DateRange) => {
    setStatsLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(`/api/admin/stats?${params}`);
      if (res.ok) setStats(await res.json());
    } finally { setStatsLoading(false); }
  }, []);

  const fetchVenues = useCallback(async () => {
    setVenuesLoading(true);
    try {
      const res = await fetch('/api/admin/venues');
      if (res.status === 401) { setAuthState('unauthenticated'); return; }
      if (res.ok) { const d = await res.json(); setVenues(d.venues || []); setAuthState('authenticated'); }
    } catch { setAuthState('unauthenticated'); }
    finally { setVenuesLoading(false); }
  }, []);

  const fetchAnnouncements = useCallback(async () => {
    setAnnLoading(true);
    try {
      const res = await fetch('/api/admin/announcements');
      if (res.ok) setAnnouncements(await res.json());
    } finally { setAnnLoading(false); }
  }, []);

  useEffect(() => { fetchVenues(); }, [fetchVenues]);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    if (pathSegments.length === 0) return;
    if (!ADMIN_TAB_KEYS.has(pathSegments[0])) router.replace('/admin');
  }, [authState, pathSegments, router]);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    if (activeTab !== 'seo-pages') return;
    if (tabRest.length === 0) {
      router.replace(adminHref('seo-pages', ['home']));
      return;
    }
    const key = tabRest[0];
    if (tabRest.length > 1 || !(key in PAGE_LABELS)) {
      router.replace(adminHref('seo-pages', ['home']));
    }
  }, [authState, activeTab, tabRest, router]);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    if (activeTab !== 'blog') return;
    if (tabRest.length === 0) return;
    const [a, b] = tabRest;
    if (a === 'new' && tabRest.length === 1) return;
    if (a === 'edit' && b && tabRest.length === 2) return;
    router.replace(adminHref('blog'));
  }, [authState, activeTab, tabRest, router]);

  useEffect(() => { if (authState === 'authenticated') { fetchStats(dateRange); fetchAnnouncements(); fetchFrUnreadCount(); } }, [authState, fetchStats, fetchAnnouncements, fetchFrUnreadCount, dateRange]);
  useEffect(() => { if (authState === 'authenticated' && activeTab === 'suggested-articles') fetchSuggestedArticles(); }, [authState, activeTab, fetchSuggestedArticles]);
  useEffect(() => { if (authState === 'authenticated' && activeTab === 'search-analytics') fetchSearchAnalytics(); }, [authState, activeTab, fetchSearchAnalytics]);
  useEffect(() => { if (authState === 'authenticated' && activeTab === 'article-ratings') fetchArticleRatings(); }, [authState, activeTab, fetchArticleRatings]);
  useEffect(() => { if (authState === 'authenticated' && activeTab === 'changelog') loadClEntries(); }, [authState, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
  async function openFeatureRequest(id: string) {
    setFrDetailLoading(true);
    setFrDetail(null);
    setFrDetailError('');
    try {
      const res = await fetch(`/api/admin/feature-requests/${id}`);
      if (res.ok) {
        const detail = await res.json();
        setFrDetail(detail);
        // Auto-mark as read when admin opens the detail view (only venue-submitted requests)
        const listItem = stats?.featureRequests.find(r => r.id === id);
        if (listItem && listItem.venue_id && !listItem.admin_read_at && listItem.status !== 'completed') {
          // Fire-and-forget — don't block modal open on this
          fetch(`/api/admin/feature-requests/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_read: true }),
          }).catch(() => {});
          toggleFeatureRequestRead(id, true);
        }
      } else {
        const d = await res.json().catch(() => ({}));
        setFrDetailError(d.error || `Error ${res.status}`);
      }
    } catch {
      setFrDetailError('Network error — could not load request');
    } finally {
      setFrDetailLoading(false);
    }
  }




  function toggleFeatureRequestRead(id: string, markRead: boolean) {
    setStats(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        featureRequests: prev.featureRequests.map(r =>
          r.id === id ? { ...r, admin_read_at: markRead ? new Date().toISOString() : null } : r
        ),
      };
    });
    // Keep sidebar badge count in sync
    setFrUnreadCount(prev => markRead ? Math.max(0, prev - 1) : prev + 1);
  }

  async function deleteFeatureRequest(id: string, fromModal = false) {
    // Skip confirm dialog — just delete directly (admin-only action)
    setFrDeleting(id);
    try {
      const res = await fetch(`/api/admin/feature-requests/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (fromModal) setFrDetail(null);
        setStats(prev => {
          if (!prev) return prev;
          const removed = prev.featureRequests.find(r => r.id === id);
          // If the removed request was unread, decrement badge
          if (removed && removed.venue_id && !removed.admin_read_at && removed.status !== 'completed') {
            setFrUnreadCount(c => Math.max(0, c - 1));
          }
          return { ...prev, featureRequests: prev.featureRequests.filter(r => r.id !== id) };
        });
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Delete failed');
      }
    } finally { setFrDeleting(null); }
  }

  async function updateFeatureRequestStatus(id: string, status: string, changelogData?: { title: string; description: string; category: string }) {
    setFrStatusSaving(true);
    try {
      const res = await fetch(`/api/admin/feature-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          changelogTitle: changelogData?.title,
          changelogDescription: changelogData?.description,
          changelogCategory: changelogData?.category,
        }),
      });
      if (res.ok) {
        // If marking completed, always close modal immediately
        if (status === 'completed') {
          setFrDetail(null);
          setFrDetailError('');
          setShowChangelogForm(false);
          setClTitle(''); setClDesc(''); setClCat('feature');
        } else {
          const updated = await res.json();
          setFrDetail(prev => prev ? { ...prev, status: updated.status } : prev);
          setShowChangelogForm(false);
        }
        fetchStats(dateRange);
      } else {
        const d = await res.json().catch(() => ({}));
        setFrDetailError(d.error || 'Failed to update status');
      }
    } finally { setFrStatusSaving(false); }
  }

  async function markCompleted() {
    if (!frDetail) return;
    await updateFeatureRequestStatus(frDetail.id, 'completed', {
      title: clTitle,
      description: clDesc,
      category: clCat,
    });
  }

  async function approveAutoGenerate() {
    if (!frDetail) return;
    // Pass empty strings — the API will auto-generate an outcome-based
    // headline + description from the feature-request copy.
    await updateFeatureRequestStatus(frDetail.id, 'completed', {
      title: '',
      description: '',
      category: clCat,
    });
  }

  function startFrEdit() {
    if (!frDetail) return;
    setFrEditTitle(frDetail.title);
    setFrEditDesc(frDetail.description || '');
    setFrEditing(true);
  }

  async function saveFrEdit() {
    if (!frDetail) return;
    if (!frEditTitle.trim()) return;
    setFrEditSaving(true);
    try {
      const res = await fetch(`/api/admin/feature-requests/${frDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: frEditTitle.trim(), description: frEditDesc.trim() || null }),
      });
      if (res.ok) {
        setFrDetail(prev => prev ? { ...prev, title: frEditTitle.trim(), description: frEditDesc.trim() || null } : prev);
        setFrEditing(false);
        fetchStats(dateRange);
      } else {
        const d = await res.json().catch(() => ({}));
        setFrDetailError(d.error || 'Failed to save edits');
      }
    } finally { setFrEditSaving(false); }
  }

  // ── Changelog entry helpers (linked entry in FR modal) ──────────────────
  function startClEdit(entry: { id: string; title: string; description: string; category: string }) {
    setClEditingId(entry.id);
    setClEditTitle(entry.title);
    setClEditDesc(entry.description || '');
    setClEditCat((entry.category as 'feature' | 'improvement' | 'fix') || 'feature');
  }

  async function saveClEdit() {
    if (!clEditingId || !clEditTitle.trim()) return;
    setClEditSaving(true);
    try {
      const res = await fetch(`/api/admin/changelog-entries/${clEditingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: clEditTitle.trim(), description: clEditDesc.trim(), category: clEditCat }),
      });
      if (res.ok) {
        const updated = await res.json();
        setFrDetail(prev => prev ? {
          ...prev,
          changelogEntry: prev.changelogEntry ? { ...prev.changelogEntry, ...updated } : prev.changelogEntry,
        } : prev);
        setClEditingId(null);
      } else {
        const d = await res.json().catch(() => ({}));
        setFrDetailError(d.error || 'Failed to save changelog entry');
      }
    } finally { setClEditSaving(false); }
  }

  async function deleteClEntry(id: string) {
    if (!confirm('Delete this changelog entry? This will remove it from the What\'s New page.')) return;
    setClDeleting(id);
    try {
      const res = await fetch(`/api/admin/changelog-entries/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setFrDetail(prev => prev ? { ...prev, changelogEntry: null, changelog_id: null } : prev);
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Delete failed');
      }
    } finally { setClDeleting(null); }
  }

  // ── Standalone Changelog tab helpers ────────────────────────────────────
  async function loadClEntries() {
    setClLoading(true);
    try {
      const res = await fetch('/api/admin/changelog-entries');
      if (res.ok) setClEntries(await res.json());
    } finally { setClLoading(false); }
  }

  async function createClEntry() {
    if (!clNewTitle.trim() || !clNewDesc.trim()) return;
    setClCreating(true);
    setClCreateError('');
    try {
      const res = await fetch('/api/admin/changelog-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: clNewTitle.trim(),
          description: clNewDesc.trim(),
          category: clNewCat,
          version: clNewVersion.trim() || null,
          released_at: clNewDate ? new Date(clNewDate).toISOString() : new Date().toISOString(),
        }),
      });
      if (res.ok) {
        const entry = await res.json();
        setClEntries(prev => [entry, ...prev]);
        setClCreateOpen(false);
        setClNewTitle(''); setClNewDesc(''); setClNewCat('feature'); setClNewVersion(''); setClNewDate('');
      } else {
        const d = await res.json().catch(() => ({}));
        setClCreateError(d.error || 'Failed to create entry');
      }
    } finally { setClCreating(false); }
  }

  function startClTabEdit(e: { id: string; title: string; description: string; category: string; version: string | null; released_at: string }) {
    setClTabEditId(e.id);
    setClTabEditTitle(e.title);
    setClTabEditDesc(e.description || '');
    setClTabEditCat((e.category as 'feature' | 'improvement' | 'fix') || 'feature');
    setClTabEditVersion(e.version || '');
    setClTabEditDate(e.released_at ? e.released_at.slice(0, 10) : '');
  }

  async function saveClTabEdit() {
    if (!clTabEditId || !clTabEditTitle.trim()) return;
    setClTabEditSaving(true);
    try {
      const res = await fetch(`/api/admin/changelog-entries/${clTabEditId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: clTabEditTitle.trim(),
          description: clTabEditDesc.trim(),
          category: clTabEditCat,
          version: clTabEditVersion.trim() || null,
          released_at: clTabEditDate ? new Date(clTabEditDate + 'T12:00:00').toISOString() : undefined,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setClEntries(prev => prev.map(e => e.id === clTabEditId ? { ...e, ...updated } : e));
        setClTabEditId(null);
      }
    } finally { setClTabEditSaving(false); }
  }

  async function deleteClTabEntry(id: string) {
    if (!confirm('Delete this changelog entry? Venues will no longer see it in What\'s New.')) return;
    setClTabDeleting(id);
    try {
      const res = await fetch(`/api/admin/changelog-entries/${id}`, { method: 'DELETE' });
      if (res.ok) setClEntries(prev => prev.filter(e => e.id !== id));
      else { const d = await res.json().catch(() => ({})); alert(d.error || 'Delete failed'); }
    } finally { setClTabDeleting(null); }
  }

  async function openDrill(key: DrillKey) {
    if (!key) return;
    setDrillKey(key);
    setDrillData(null);
    setDrillSearch('');
    setDrillLoading(true);
    try {
      if (key === 'venues') {
        const res = await fetch('/api/admin/venues');
        if (res.ok) { const d = await res.json(); setDrillData(d.venues || []); }
      } else if (key === 'waitlist') {
        const res = await fetch('/api/admin/waitlist');
        if (res.ok) setDrillData(await res.json());
      } else if (key === 'customers') {
        const res = await fetch('/api/admin/customers');
        if (res.ok) setDrillData(await res.json());
      } else if (key === 'failed' || key === 'pending') {
        const res = await fetch(`/api/admin/payments?status=${key}`);
        if (res.ok) setDrillData(await res.json());
      }
    } finally { setDrillLoading(false); }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail.trim(), password: adminPass }),
    });
    if (!res.ok) { setLoginError('Invalid email or password.'); return; }
    setAdminEmail(''); setAdminPass(''); fetchVenues();
  }

  async function handleLogout() {
    await fetch('/api/admin/login', { method: 'DELETE' }).catch(() => {});
    document.cookie = 'admin_token=; Max-Age=0; path=/';
    setAuthState('unauthenticated');
    setVenues([]); setStats(null);
  }

  async function saveAnnouncement(data: { message: string; link_text: string; link_url: string; is_active: boolean }) {
    if (editingAnn) {
      await fetch(`/api/admin/announcements/${editingAnn.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      setEditingAnn(null);
    } else {
      await fetch('/api/admin/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      setShowAnnForm(false);
    }
    fetchAnnouncements();
  }

  async function toggleAnnActive(ann: Announcement) {
    await fetch(`/api/admin/announcements/${ann.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: !ann.is_active }) });
    fetchAnnouncements();
  }

  async function deleteAnn(id: string) {
    if (!confirm('Delete this announcement?')) return;
    await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
    fetchAnnouncements();
  }

  function statusBadge(status: string) {
    const cls: Record<string, string> = { active: 'bg-emerald-100 text-emerald-800', pending: 'bg-amber-100 text-amber-800', bank_information_sent: 'bg-blue-100 text-blue-800' };
    const lbl: Record<string, string> = { active: 'Active', pending: 'Pending', bank_information_sent: 'Bank Info Sent' };
    return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${cls[status] || 'bg-gray-100 text-gray-800'}`}>{lbl[status] || status}</span>;
  }

  // ── Login screen ────────────────────────────────────────────────────────────
  if (authState === 'loading') {
    return (
      <>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-gray-400" />
        </div>
        {children}
      </>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
            <Home size={14} /> Back to homepage
          </Link>
          <form onSubmit={handleLogin} className="bg-white rounded-2xl p-8">
            <div className="flex justify-center mb-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/storyvenue-dark-logo.png" alt="StoryVenue" className="h-8 object-contain" />
            </div>
            <h2 className="font-heading text-xl text-gray-900 mb-6 text-center">Admin Login</h2>
            {loginError && <div className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-2 mb-4">{loginError}</div>}
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={adminEmail}
                  onChange={e => setAdminEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none"
                  placeholder="admin@storyvenue.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showAdminPass ? 'text' : 'password'}
                    required
                    value={adminPass}
                    onChange={e => setAdminPass(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showAdminPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            <button type="submit" className="w-full text-white font-semibold py-2.5 rounded-xl transition-colors hover:opacity-85" style={{ backgroundColor: BRAND }}>
              Sign In
            </button>
          </form>
        </div>
      </div>
      {children}
      </>
    );
  }

  // ── Authenticated ───────────────────────────────────────────────────────────
  return (
    <>
    <div className="min-h-screen bg-white flex">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden lg:block fixed left-0 top-0 bottom-0 w-[260px] border-r border-gray-200 z-30">
        <AdminNavSidebar
          activeTab={activeTab}
          onMobileClose={() => {}}
          onLogout={handleLogout}
          frUnreadCount={frUnreadCount}
        />
      </aside>

      {/* ── Mobile top bar ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 border-b border-gray-200 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/storyvenue-dark-logo.png" alt="StoryVenue" className="h-7 object-contain" />
        <button onClick={() => setMobileSidebarOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
          {mobileSidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* ── Mobile drawer ── */}
      {mobileSidebarOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/20" onClick={() => setMobileSidebarOpen(false)} />}
      <aside className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[280px] border-r border-gray-200 transition-transform duration-300 ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <AdminNavSidebar
          activeTab={activeTab}
          onMobileClose={() => setMobileSidebarOpen(false)}
          onLogout={handleLogout}
          frUnreadCount={frUnreadCount}
        />
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 lg:ml-[260px]">
        <div className="h-14 lg:hidden" />
        <main className="min-h-screen pt-6 lg:pt-10 px-6 sm:px-8 lg:px-10 pb-10 max-w-7xl mx-auto">

        {/* ── Dashboard Tab ── */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="font-heading text-xl text-gray-900">Super Admin Dashboard</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    const res = await fetch('/api/admin/setup-db', { method: 'POST' });
                    const data = await res.json();
                    const missing = data.missing ?? [];
                    if (missing.length === 0) {
                      alert('All tables and columns exist — production DB is up to date.');
                    } else {
                      const sql = data.sqlToRun;
                      prompt(
                        `${missing.length} item(s) missing. Copy this SQL and run it in your production Supabase SQL Editor:`,
                        sql
                      );
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  🛠 Setup DB
                </button>
                <button
                  onClick={async () => {
                    const res = await fetch('/api/admin/setup-directory-db', { method: 'POST' });
                    const data = await res.json();
                    if (data.ok) {
                      alert(`Directory schema OK:\n${(data.results ?? []).map((r: { name: string; status: string }) => `• ${r.name}: ${r.status}`).join('\n')}`);
                    } else {
                      const errs = (data.results ?? []).filter((r: { status: string }) => r.status === 'error');
                      alert(`Directory schema had errors:\n${errs.map((r: { name: string; error: string }) => `• ${r.name}: ${r.error}`).join('\n')}`);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  🌐 Setup Directory Schema
                </button>
                <button
                  onClick={async () => {
                    const res = await fetch('/api/admin/setup-directory-storage', { method: 'POST' });
                    const data = await res.json();
                    if (res.ok) {
                      alert(`Storage bucket: ${data.bucket}\n${data.created ? 'Created new bucket.' : (data.note ?? 'Already existed.')}`);
                    } else {
                      alert(`Failed to provision bucket: ${data.error ?? 'unknown error'}`);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  🖼 Setup Directory Bucket
                </button>
                <DateRangePicker value={dateRange} onChange={r => { setDateRange(r); fetchStats(r); }} />
              </div>
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <KPICard label="Total Revenue" value={statsLoading ? '...' : formatCents(stats?.totalRevenue ?? 0)} icon={DollarSign} color={BRAND} />
              <KPICard label="Active Venues" value={statsLoading ? '...' : stats?.venueCount ?? 0} icon={Building2} color="#7c3aed" onClick={() => openDrill('venues')} />
              <KPICard label="Proposals" value={statsLoading ? '...' : stats?.totalProposals ?? 0} icon={FileText} color="#1b1b1b" />
              <KPICard label="Waitlist" value={statsLoading ? '...' : stats?.waitlistCount ?? 0} icon={Users} color="#10b981" onClick={() => openDrill('waitlist')} />
              <KPICard label="Unique Contacts" value={statsLoading ? '...' : stats?.uniqueCustomers ?? 0} icon={Users} color="#f59e0b" onClick={() => openDrill('customers')} />
              <KPICard label="Pending Payments" value={statsLoading ? '...' : stats?.pendingPayments ?? 0} icon={Clock} color="#f59e0b" onClick={() => openDrill('pending')} />
              <KPICard label="Failed Payments" value={statsLoading ? '...' : stats?.failedPayments ?? 0} icon={XCircle} color="#ef4444" onClick={() => openDrill('failed')} />
              <KPICard label="Total Contacts" value={statsLoading ? '...' : stats?.uniqueCustomers ?? 0} icon={Users} color="#888888" onClick={() => openDrill('customers')} />
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 sm:p-5 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Directory SaaS (StoryVenue)</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-3xl">
                  MRR from priced directory plans assigned to venues. &quot;Active&quot; counts venues with subscription status
                  active or trialing (set when recurring billing is wired). &quot;Assigned&quot; includes all non-canceled
                  assignments
                  {statsLoading
                    ? '.'
                    : ` (${stats?.directoryAssignedPayingVenueCount ?? 0} paying venues).`}{' '}
                  SaaS cash sums <code className="text-[10px] bg-white px-1 rounded border">platform_billing_events</code>{' '}
                  in the selected date range (populate via webhooks or jobs).
                </p>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <KPICard
                  label="MRR (active subs)"
                  value={statsLoading ? '...' : formatCents(stats?.directoryActiveMrrCents ?? 0)}
                  icon={Repeat}
                  color="#0d9488"
                />
                <KPICard
                  label="MRR (assigned plans)"
                  value={statsLoading ? '...' : formatCents(stats?.directoryAssignedMrrCents ?? 0)}
                  icon={Layers}
                  color="#6366f1"
                />
                <KPICard
                  label="Active subscriptions"
                  value={statsLoading ? '...' : stats?.directoryActiveSubscriptionCount ?? 0}
                  icon={Check}
                  color="#0d9488"
                />
                <KPICard
                  label="SaaS cash (range)"
                  value={statsLoading ? '...' : formatCents(stats?.platformSaaSRevenueInRangeCents ?? 0)}
                  icon={Wallet}
                  color="#b45309"
                />
              </div>
              {(stats?.directoryMrrByPlan?.length ?? 0) > 0 ? (
                <div className="rounded-lg border border-gray-100 bg-white p-3 text-xs">
                  <p className="font-semibold text-gray-600 mb-2">MRR by plan (assigned, non-canceled)</p>
                  <ul className="space-y-1.5">
                    {stats!.directoryMrrByPlan!.map((row) => (
                      <li key={row.planId} className="flex flex-wrap justify-between gap-2 text-gray-700">
                        <span>
                          {row.name}{' '}
                          <span className="text-gray-400 font-mono">({row.slug})</span> — {row.venueCount} venue
                          {row.venueCount === 1 ? '' : 's'}
                        </span>
                        <span className="font-medium tabular-nums">{formatCents(row.mrrCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* Drill-down modal */}
            {drillKey && (() => {
              const q = drillSearch.toLowerCase().trim();

              const filteredVenues = drillKey === 'venues' && drillData
                ? (drillData as unknown as Venue[]).filter(v =>
                    !q ||
                    v.name?.toLowerCase().includes(q) ||
                    v.email?.toLowerCase().includes(q) ||
                    v.ghl_location_id?.toLowerCase().includes(q)
                  )
                : [];

              const filteredCustomers = drillKey === 'customers' && drillData
                ? (drillData as unknown as { id: string; name: string | null; email: string | null; phone: string | null; created_at: string }[]).filter(c =>
                    !q ||
                    c.name?.toLowerCase().includes(q) ||
                    c.email?.toLowerCase().includes(q) ||
                    c.phone?.toLowerCase().includes(q)
                  )
                : [];

              const filteredWaitlist = drillKey === 'waitlist' && drillData
                ? (drillData as unknown as WaitlistEntry[]).filter(w =>
                    !q ||
                    w.email?.toLowerCase().includes(q) ||
                    w.first_name?.toLowerCase().includes(q) ||
                    w.last_name?.toLowerCase().includes(q) ||
                    w.phone?.toLowerCase().includes(q) ||
                    w.venue_name?.toLowerCase().includes(q)
                  )
                : [];

              const filteredPayments = (drillKey === 'failed' || drillKey === 'pending') && drillData
                ? (drillData as unknown as FailedPayment[]).filter(p =>
                    !q || p.customer_name?.toLowerCase().includes(q)
                  )
                : [];

              const resultCount = drillKey === 'venues' ? filteredVenues.length
                : drillKey === 'customers' ? filteredCustomers.length
                : drillKey === 'waitlist' ? filteredWaitlist.length
                : filteredPayments.length;

              const showSearch = drillKey === 'venues' || drillKey === 'customers' || drillKey === 'waitlist';

              return (
                <DrillModal
                  title={drillKey === 'venues' ? 'Active Venues' : drillKey === 'waitlist' ? 'Waitlist Signups' : drillKey === 'customers' ? 'Contacts' : drillKey === 'failed' ? 'Failed Payments' : 'Pending Payments'}
                  count={drillLoading ? undefined : resultCount}
                  onClose={() => { setDrillKey(null); setDrillData(null); setDrillSearch(''); }}
                  searchQuery={showSearch ? drillSearch : undefined}
                  onSearchChange={showSearch ? setDrillSearch : undefined}
                  searchPlaceholder={
                    drillKey === 'venues' ? 'Search by name, email, or location ID...' :
                    drillKey === 'customers' ? 'Search by name, email, or phone...' :
                    'Search by name, email, phone, or venue...'
                  }
                >
                  {drillLoading ? (
                    <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
                  ) : drillKey === 'venues' ? (
                    filteredVenues.length === 0 ? <p className="text-center text-gray-400 py-8 text-sm">{q ? 'No venues match your search' : 'No venues found'}</p> : (
                      <div className="space-y-2">
                        {filteredVenues.map(v => (
                          <div key={v.id} className="rounded-xl border border-gray-100 px-4 py-3.5 hover:border-gray-200 hover:bg-gray-50/50 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-900">{v.name}</p>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                  {v.email && <p className="text-xs text-gray-500">{v.email}</p>}
                                  {v.ghl_location_id && <p className="text-xs font-mono text-gray-400">ID: {v.ghl_location_id}</p>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${v.setup_completed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {v.setup_completed ? 'Active' : 'Setup Pending'}
                                </span>
                                <span className="text-[11px] text-gray-400">{new Date(v.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : drillKey === 'customers' ? (
                    filteredCustomers.length === 0 ? <p className="text-center text-gray-400 py-8 text-sm">{q ? 'No contacts match your search' : 'No contacts found'}</p> : (
                      <div className="space-y-2">
                        {filteredCustomers.map((c, i) => (
                          <div key={i} className="rounded-xl border border-gray-100 px-4 py-3.5 hover:border-gray-200 hover:bg-gray-50/50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{c.name || '—'}</p>
                                <div className="flex flex-wrap gap-x-3 mt-0.5">
                                  {c.email && <p className="text-xs text-gray-500">{c.email}</p>}
                                  {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                                </div>
                              </div>
                              <span className="text-[11px] text-gray-400 shrink-0">{new Date(c.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : drillKey === 'waitlist' ? (
                    filteredWaitlist.length === 0 ? <p className="text-center text-gray-400 py-8 text-sm">{q ? 'No results match your search' : 'No waitlist entries'}</p> : (
                      <div className="space-y-2">
                        {filteredWaitlist.map(w => (
                          <div key={w.id} className="rounded-xl border border-gray-100 px-4 py-3.5 hover:border-gray-200 hover:bg-gray-50/50 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-900">{[w.first_name, w.last_name].filter(Boolean).join(' ') || w.email}</p>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                  <p className="text-xs text-gray-500">{w.email}</p>
                                  {w.phone && <p className="text-xs text-gray-400">{w.phone}</p>}
                                  {w.venue_name && <p className="text-xs text-gray-400">Venue: {w.venue_name}</p>}
                                  {w.referral_source && <p className="text-xs text-gray-400">Via: {w.referral_source}</p>}
                                </div>
                              </div>
                              <span className="text-[11px] text-gray-400 shrink-0">{new Date(w.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    filteredPayments.length === 0 ? <p className="text-center text-gray-400 py-8 text-sm">No payments found</p> : (
                      <div className="space-y-2">
                        {filteredPayments.map(p => (
                          <div key={p.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3.5 hover:border-gray-200 hover:bg-gray-50/50 transition-colors">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{p.customer_name || 'Unknown'}</p>
                              <p className="text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString()}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold text-gray-900">{formatCents(p.price)}</span>
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.status === 'failed' || p.status === 'declined' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{p.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </DrillModal>
              );
            })()}

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Venue customer proposal revenue */}
              <div className="rounded-xl bg-white border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Venue customer payments</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{statsLoading ? '...' : formatCents(stats?.totalRevenue ?? 0)}</p>
                    <p className="text-[11px] text-gray-400 mt-1">Paid proposals in range (your venues&apos; buyers)</p>
                  </div>
                  <TrendingUp size={20} style={{ color: BRAND }} />
                </div>
                <div style={{ height: 200 }}>
                  {!statsLoading && stats?.monthlyChart && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.monthlyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="adminRevGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={BRAND} stopOpacity={0.15} />
                            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={formatShort} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} />
                        <Tooltip formatter={v => [formatCents(Number(v)), 'Revenue']} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                        <Area type="monotone" dataKey="revenue" stroke={BRAND} strokeWidth={2} fill="url(#adminRevGrad)" dot={false} activeDot={{ r: 4, fill: BRAND }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Proposals chart */}
              <div className="rounded-xl bg-white border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Proposals Sent</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{statsLoading ? '...' : stats?.totalProposals ?? 0}</p>
                  </div>
                  <BarChart2 size={20} style={{ color: BRAND }} />
                </div>
                <div style={{ height: 200 }}>
                  {!statsLoading && stats?.monthlyChart && (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.monthlyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} />
                        <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                        <Bar dataKey="proposals" fill={BRAND} radius={[4, 4, 0, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* StoryVenue SaaS cash (platform_billing_events) */}
              <div className="rounded-xl bg-white border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">StoryVenue SaaS cash</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {statsLoading ? '...' : formatCents(stats?.platformSaaSRevenueInRangeCents ?? 0)}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">Recorded platform charges in range</p>
                  </div>
                  <Wallet size={20} style={{ color: '#b45309' }} />
                </div>
                <div style={{ height: 200 }}>
                  {!statsLoading && stats?.platformSaaSMonthlyChart && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.platformSaaSMonthlyChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="adminSaasGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#b45309" stopOpacity={0.15} />
                            <stop offset="100%" stopColor="#b45309" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={formatShort} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={44} />
                        <Tooltip formatter={v => [formatCents(Number(v)), 'SaaS cash']} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                        <Area type="monotone" dataKey="revenue" stroke="#b45309" strokeWidth={2} fill="url(#adminSaasGrad)" dot={false} activeDot={{ r: 4, fill: '#b45309' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Feature requests */}
            <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ThumbsUp size={16} style={{ color: BRAND }} />
                  <p className="text-sm font-semibold text-gray-900">Top Feature Requests</p>
                </div>
                <Link href={adminHref('announcements')} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">View all in venues</Link>
              </div>
              <div className="divide-y divide-gray-50">
                {!statsLoading && (stats?.featureRequests ?? []).length === 0 && (
                  <p className="px-6 py-8 text-sm text-center text-gray-400">No feature requests yet</p>
                )}
                {(stats?.featureRequests ?? []).filter(r => r.status !== 'completed').slice(0, 3).map((req, i) => (
                  <div key={req.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 transition-colors">
                    <button
                      onClick={() => openFeatureRequest(req.id)}
                      className="flex items-center gap-4 flex-1 min-w-0 text-left"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: i === 0 ? '#f59e0b' : i === 1 ? '#6b7280' : i === 2 ? '#cd7c2f' : BRAND }}>
                        #{i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{req.title}</p>
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS_FR[req.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS_FR[req.status] || req.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1">
                          <ThumbsUp size={13} style={{ color: BRAND }} />
                          <span className="text-sm font-bold" style={{ color: BRAND }}>{req.vote_count}</span>
                        </div>
                        <ChevronRight size={13} className="text-gray-300" />
                      </div>
                    </button>
                    <button
                      onClick={() => deleteFeatureRequest(req.id)}
                      disabled={frDeleting === req.id}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40"
                      title="Delete feature request"
                    >
                      {frDeleting === req.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Venue management (plans, badges, impersonation) ── */}
        {activeTab === 'venues' && (
          <VenueManagementPortal
            venues={venues as unknown as AdminVenueRow[]}
            venuesLoading={venuesLoading}
            onRefresh={fetchVenues}
          />
        )}

        {activeTab === 'directory-badges' && (
          <DirectoryBadgesAdminPanel
            venues={venues as unknown as AdminVenueRow[]}
            venuesLoading={venuesLoading}
            onRefresh={fetchVenues}
          />
        )}

        {activeTab === 'directory-plans' && <DirectoryPlansAdminPanel />}

        {/* ── Announcements Tab ── */}
        {activeTab === 'announcements' && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-heading text-xl text-gray-900">Announcements</h2>
                <p className="text-sm text-gray-500 mt-0.5">Active announcements show as a scrolling ticker on every venue dashboard. Venues cannot dismiss the ticker — toggle <span className="font-semibold text-gray-700">Deactivate</span> on a row to remove it for everyone.</p>
              </div>
              {!showAnnForm && !editingAnn && (
                <button onClick={() => setShowAnnForm(true)}
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all" style={{ backgroundColor: BRAND }}>
                  <Plus size={15} /> New Announcement
                </button>
              )}
            </div>

            {(showAnnForm || editingAnn) && (
              <div className="mb-5">
                <AnnouncementForm
                  initial={editingAnn || undefined}
                  onSave={saveAnnouncement}
                  onCancel={() => { setShowAnnForm(false); setEditingAnn(null); }}
                />
              </div>
            )}

            {annLoading ? (
              <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
            ) : announcements.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white py-14 text-center">
                <Megaphone size={36} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm text-gray-500">No announcements yet</p>
                <p className="text-xs text-gray-400 mt-1">Create one to broadcast a message to all venues</p>
              </div>
            ) : (
              <div className="space-y-3">
                {announcements.map(ann => (
                  <div key={ann.id} className={`rounded-xl border bg-white p-5 transition-all ${ann.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${ann.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                            {ann.is_active ? 'Active' : 'Inactive'}
                          </span>
                          <span className="text-[11px] text-gray-400">{new Date(ann.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-sm text-gray-900">{ann.message}</p>
                        {ann.link_text && ann.link_url && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <ExternalLink size={12} className="text-gray-400" />
                            <a href={ann.link_url} target="_blank" rel="noreferrer" className="text-xs font-medium hover:underline" style={{ color: BRAND }}>{ann.link_text}</a>
                            <span className="text-[11px] text-gray-400 truncate max-w-xs">({ann.link_url})</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => toggleAnnActive(ann)}
                          className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${ann.is_active ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                          {ann.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => { setEditingAnn(ann); setShowAnnForm(false); }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteAnn(ann.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Feature Requests Tab ── */}
        {activeTab === 'feature-requests' && (
          <FeatureRequestsAdminTab
            requests={stats?.featureRequests ?? []}
            loading={statsLoading}
            onDelete={deleteFeatureRequest}
            onOpen={openFeatureRequest}
            onRefresh={() => fetchStats(dateRange)}
            frDeleting={frDeleting}
            onToggleRead={toggleFeatureRequestRead}
          />
        )}

        {/* ── Changelog Tab ── */}
        {activeTab === 'changelog' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="font-heading text-2xl text-gray-900">Changelog</h1>
                <p className="mt-0.5 text-sm text-gray-500">Manage all What&apos;s New entries visible to venues.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadClEntries} disabled={clLoading}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  {clLoading ? <Loader2 size={14} className="animate-spin"/> : <TrendingUp size={14}/>} Refresh
                </button>
                <button onClick={() => setClCreateOpen(v => !v)}
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
                  style={{ backgroundColor: '#1b1b1b' }}>
                  {clCreateOpen ? <><X size={14}/> Cancel</> : <><Plus size={14}/> New Entry</>}
                </button>
              </div>
            </div>

            {/* Create form */}
            {clCreateOpen && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                <h3 className="text-sm font-bold text-gray-900">New Changelog Entry</h3>
                {/* Category */}
                <div className="flex gap-2 flex-wrap">
                  {([
                    { val: 'feature',     label: '✨ New Feature',  cls: 'border-violet-300 text-violet-700 bg-violet-50' },
                    { val: 'improvement', label: '⚡ Improvement',  cls: 'border-blue-300 text-blue-700 bg-blue-50' },
                    { val: 'fix',         label: '🔧 Bug Fix',      cls: 'border-amber-300 text-amber-700 bg-amber-50' },
                  ] as const).map(({ val, label, cls }) => (
                    <button key={val} type="button" onClick={() => setClNewCat(val)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold border-2 transition-all ${clNewCat === val ? cls + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Headline <span className="text-red-400">*</span></label>
                    <input type="text" value={clNewTitle} onChange={e => setClNewTitle(e.target.value)} placeholder="What did we ship?"
                      style={{ fontSize: 16 }}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Description <span className="text-red-400">*</span></label>
                    <textarea value={clNewDesc} onChange={e => setClNewDesc(e.target.value)} rows={3}
                      placeholder="Outcome-based description for venue owners..."
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none resize-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Version (optional)</label>
                    <input type="text" value={clNewVersion} onChange={e => setClNewVersion(e.target.value)} placeholder="e.g. 2.4.0"
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Release Date (optional)</label>
                    <input type="date" value={clNewDate} onChange={e => setClNewDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none" />
                  </div>
                </div>
                {clCreateError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{clCreateError}</p>}
                <div className="flex gap-2">
                  <button onClick={createClEntry} disabled={clCreating || !clNewTitle.trim() || !clNewDesc.trim()}
                    className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: '#1b1b1b' }}>
                    {clCreating ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} Create Entry
                  </button>
                  <button onClick={() => setClCreateOpen(false)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
                </div>
              </div>
            )}

            {/* Entries list */}
            {clLoading ? (
              <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-300"/></div>
            ) : clEntries.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <Sparkles size={36} className="mx-auto mb-3 opacity-30"/>
                <p className="text-sm">No changelog entries yet.</p>
                <p className="text-xs mt-1">Click &ldquo;New Entry&rdquo; to create one.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {clEntries.map(entry => {
                  const CAT_STYLES: Record<string, { label: string; cls: string }> = {
                    feature:     { label: '✨ New Feature',  cls: 'bg-violet-50 text-violet-700 border-violet-200' },
                    improvement: { label: '⚡ Improvement',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
                    fix:         { label: '🔧 Bug Fix',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
                  };
                  const cat = CAT_STYLES[entry.category] ?? CAT_STYLES.feature;
                  const isEditing = clTabEditId === entry.id;

                  return (
                    <div key={entry.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="flex gap-2 flex-wrap">
                            {(['feature','improvement','fix'] as const).map(v => {
                              const s = CAT_STYLES[v];
                              return (
                                <button key={v} type="button" onClick={() => setClTabEditCat(v)}
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border-2 transition-all ${clTabEditCat === v ? s.cls + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                  {s.label}
                                </button>
                              );
                            })}
                          </div>
                          <input type="text" value={clTabEditTitle} onChange={e => setClTabEditTitle(e.target.value)}
                            style={{ fontSize: 16 }}
                            className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none" />
                          <textarea value={clTabEditDesc} onChange={e => setClTabEditDesc(e.target.value)} rows={3}
                            className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none resize-none" />
                          <div className="flex gap-2">
                            <input type="text" value={clTabEditVersion} onChange={e => setClTabEditVersion(e.target.value)} placeholder="Version (optional)"
                              className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none w-32" />
                            <input type="date" value={clTabEditDate} onChange={e => setClTabEditDate(e.target.value)}
                              className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveClTabEdit} disabled={clTabEditSaving || !clTabEditTitle.trim()}
                              className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all">
                              {clTabEditSaving ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>} Save
                            </button>
                            <button onClick={() => setClTabEditId(null)}
                              className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cat.cls}`}>{cat.label}</span>
                              {entry.version && (
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-mono text-gray-500">v{entry.version}</span>
                              )}
                              <span className="flex items-center gap-1 text-[11px] text-gray-400">
                                <CalendarDays size={10}/>{new Date(entry.released_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-gray-900">{entry.title}</p>
                            <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{entry.description}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => startClTabEdit(entry)} title="Edit"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
                              <Pencil size={13}/>
                            </button>
                            <button onClick={() => deleteClTabEntry(entry.id)} disabled={clTabDeleting === entry.id} title="Delete"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
                              {clTabDeleting === entry.id ? <Loader2 size={13} className="animate-spin"/> : <Trash2 size={13}/>}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="text-center text-xs text-gray-400 pt-1">{clEntries.length} entr{clEntries.length === 1 ? 'y' : 'ies'} total</p>
              </div>
            )}
          </div>
        )}

      {/* Feature Request Detail Modal */}
      {(frDetail || frDetailLoading || frDetailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-2xl bg-white overflow-hidden max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: BRAND }}>
              <h3 className="text-base font-semibold text-white">Feature Request Detail</h3>
              <button
                onClick={() => { setFrDetail(null); setFrDetailError(''); setShowChangelogForm(false); }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6">
              {frDetailLoading ? (
                <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
              ) : frDetailError ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 mb-3">{frDetailError}</p>
                  <button onClick={() => { setFrDetail(null); setFrDetailError(''); }} className="text-sm text-gray-500 hover:underline">Close</button>
                </div>
              ) : frDetail ? (
                <div className="space-y-5">
                  {/* Title & meta */}
                  {frEditing ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400">Request Title</label>
                      <input
                        type="text"
                        value={frEditTitle}
                        onChange={e => setFrEditTitle(e.target.value)}
                        style={{ fontSize: 16 }}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                      />
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mt-2">Request Description</label>
                      <textarea
                        value={frEditDesc}
                        onChange={e => setFrEditDesc(e.target.value)}
                        rows={3}
                        placeholder="Request details from the venue..."
                        className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none resize-none"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveFrEdit}
                          disabled={frEditSaving || !frEditTitle.trim()}
                          className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all"
                        >
                          {frEditSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                        </button>
                        <button
                          onClick={() => setFrEditing(false)}
                          className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-base font-bold text-gray-900 mb-1 flex-1">{frDetail.title}</h4>
                        <button
                          onClick={startFrEdit}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                          title="Edit request"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS_FR[frDetail.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS_FR[frDetail.status] || frDetail.status}</span>
                        <span className="text-xs text-gray-400">{new Date(frDetail.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}</span>
                      </div>
                    </div>
                  )}

                  {/* Description */}
                  {!frEditing && frDetail.description && (
                    <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                      <p className="text-sm text-gray-700 leading-relaxed">{frDetail.description}</p>
                    </div>
                  )}

                  {/* Votes */}
                  <div className="flex items-center gap-3 rounded-xl border border-gray-100 px-4 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: BRAND + '18' }}>
                      <ThumbsUp size={18} style={{ color: BRAND }} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold" style={{ color: BRAND }}>{frDetail.vote_count}</p>
                      <p className="text-xs text-gray-400">{frDetail.vote_count} {frDetail.vote_count === 1 ? 'vote' : 'votes'} · {frDetail.voters.length} {frDetail.voters.length === 1 ? 'venue' : 'venues'}</p>
                    </div>
                  </div>

                  {/* Status buttons */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Change Status</p>
                    <div className="flex flex-wrap gap-2">
                      {(['open','planned','in_progress'] as const).map(val => (
                        <button key={val} onClick={() => updateFeatureRequestStatus(frDetail.id, val)}
                          disabled={frStatusSaving}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold border-2 transition-all disabled:opacity-50 ${frDetail.status === val ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                          {STATUS_LABELS_FR[val]}
                        </button>
                      ))}
                      {frDetail.status === 'completed' && (
                        <span className="rounded-full px-3 py-1.5 text-xs font-semibold border-2 border-emerald-400 bg-emerald-500 text-white">✓ Completed</span>
                      )}
                    </div>
                  </div>

                  {/* Approve — auto-publishes to What's New with a generated headline + outcome copy */}
                  {frDetail.status !== 'completed' && (
                    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-emerald-200">
                          <Check size={16} className="text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">Approve &amp; publish to What&apos;s New</p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            Approving generates an outcome-based headline and description, publishes it to the venue changelog, and hides this request from the venue side.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={approveAutoGenerate}
                          disabled={frStatusSaving}
                          className="flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                        >
                          {frStatusSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          Approve &amp; auto-publish
                        </button>
                        <button
                          onClick={() => { setShowChangelogForm(v => !v); setClTitle(frDetail.title); setClDesc(frDetail.description || ''); }}
                          className="rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors"
                        >
                          {showChangelogForm ? 'Hide custom copy' : 'Customize changelog copy'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Changelog form — shown when marking completed */}
                  {showChangelogForm && frDetail.status !== 'completed' && (
                    <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">📋 Post to Client Changelog</p>

                      {/* Category */}
                      <div className="flex gap-2">
                        {([
                          { val: 'feature',     label: '✨ New Feature',  cls: 'border-violet-300 text-violet-700 bg-violet-50' },
                          { val: 'improvement', label: '⚡ Improvement',  cls: 'border-blue-300 text-blue-700 bg-blue-50' },
                          { val: 'fix',         label: '🔧 Bug Fix',      cls: 'border-amber-300 text-amber-700 bg-amber-50' },
                        ] as const).map(({ val, label, cls }) => (
                          <button key={val} type="button" onClick={() => setClCat(val)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold border-2 transition-all ${clCat === val ? cls + ' ring-2 ring-offset-1 ring-current' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                            {label}
                          </button>
                        ))}
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Changelog Heading <span className="text-red-400">*</span></label>
                        <input type="text" value={clTitle} onChange={e => setClTitle(e.target.value)} placeholder="What did we ship?"
                          style={{ fontSize: 16 }}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none transition-colors" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Description</label>
                        <textarea value={clDesc} onChange={e => setClDesc(e.target.value)} rows={3}
                          placeholder="Describe what clients can now do with this update..."
                          className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none transition-colors resize-none" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={markCompleted} disabled={!clTitle.trim() || frStatusSaving}
                          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors">
                          {frStatusSaving ? <Loader2 size={14} className="animate-spin"/> : <Check size={14}/>}
                          Complete & Post to Changelog
                        </button>
                        <button onClick={() => setShowChangelogForm(false)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Linked changelog entry */}
                  {frDetail.changelogEntry && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">📢 Posted to Changelog</p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startClEdit(frDetail.changelogEntry!)}
                            title="Edit changelog entry"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-100 transition-colors"
                          ><Pencil size={11} /></button>
                          <button
                            onClick={() => deleteClEntry(frDetail.changelogEntry!.id)}
                            disabled={clDeleting === frDetail.changelogEntry.id}
                            title="Delete changelog entry"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                          >{clDeleting === frDetail.changelogEntry.id ? <Loader2 size={11} className="animate-spin"/> : <Trash2 size={11}/>}</button>
                        </div>
                      </div>
                      {clEditingId === frDetail.changelogEntry.id ? (
                        <div className="space-y-2">
                          <input type="text" value={clEditTitle} onChange={e => setClEditTitle(e.target.value)}
                            style={{ fontSize: 16 }}
                            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none" />
                          <textarea value={clEditDesc} onChange={e => setClEditDesc(e.target.value)} rows={3}
                            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none resize-none" />
                          <div className="flex gap-1.5 flex-wrap">
                            {(['feature','improvement','fix'] as const).map(v => (
                              <button key={v} type="button" onClick={() => setClEditCat(v)}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-all ${clEditCat === v ? 'border-emerald-400 bg-emerald-500 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                {v === 'feature' ? '✨ Feature' : v === 'improvement' ? '⚡ Improvement' : '🔧 Fix'}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={saveClEdit} disabled={clEditSaving || !clEditTitle.trim()}
                              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                              {clEditSaving ? <Loader2 size={11} className="animate-spin"/> : <Check size={11}/>} Save
                            </button>
                            <button onClick={() => setClEditingId(null)}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-gray-900">{frDetail.changelogEntry.title}</p>
                          {frDetail.changelogEntry.description && <p className="text-xs text-gray-600">{frDetail.changelogEntry.description}</p>}
                          <p className="text-[11px] text-emerald-600 capitalize">{frDetail.changelogEntry.category} · {new Date(frDetail.changelogEntry.released_at).toLocaleDateString()}</p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Voters */}
                  {frDetail.voters.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Voted by {frDetail.voters.length} {frDetail.voters.length === 1 ? 'venue' : 'venues'}</p>
                      <div className="space-y-1.5">
                        {frDetail.voters.map((v, i) => (
                          <div key={i} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full text-white text-xs font-bold" style={{ backgroundColor: BRAND }}>{v.venue_name.charAt(0).toUpperCase()}</div>
                              <p className="text-sm text-gray-900">{v.venue_name}</p>
                            </div>
                            <span className="text-xs text-gray-400">{new Date(v.voted_at).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Delete */}
                  <div className="pt-2 border-t border-gray-100">
                    <button onClick={() => deleteFeatureRequest(frDetail.id, true)}
                      className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors w-full justify-center">
                      <Trash2 size={14} /> Delete This Request
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
        {/* ── Suggested Articles Tab ── */}
        {activeTab === 'suggested-articles' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-heading text-xl text-gray-900">Suggested Articles</h2>
                <p className="text-sm text-gray-500 mt-0.5">AI-drafted articles from escalated conversations. Review, publish, or dismiss.</p>
              </div>
              <button onClick={fetchSuggestedArticles} disabled={suggestedLoading}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {suggestedLoading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />} Refresh
              </button>
            </div>
            {suggestedLoading && suggestedArticles.length === 0 ? (
              <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
            ) : suggestedArticles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center">
                <BookOpen size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-500">No suggested articles yet.</p>
                <p className="text-xs text-gray-400 mt-1">Articles are drafted automatically when users escalate to support.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const STATUS_COLORS: Record<string, string> = { draft: 'bg-amber-100 text-amber-700', published: 'bg-emerald-100 text-emerald-700', dismissed: 'bg-gray-100 text-gray-500' };
                  return suggestedArticles.map(a => (
                    <div key={a.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                      <div className="flex items-center gap-3 px-5 py-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[a.status] || 'bg-gray-100 text-gray-600'}`}>{a.status}</span>
                            <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString()}</span>
                            {a.source_question?.startsWith('rewrite:') && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">AI Rewrite</span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-gray-900 truncate">{a.title}</p>
                          {a.source_question && !a.source_question.startsWith('rewrite:') && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">Triggered by: &ldquo;{a.source_question}&rdquo;</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => setSuggestedExpandedId(suggestedExpandedId === a.id ? null : a.id)}
                            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                            {suggestedExpandedId === a.id ? 'Collapse' : 'Preview'}
                          </button>
                          {a.status === 'draft' && (
                            <button onClick={() => updateSuggestedStatus(a.id, 'published')} disabled={suggestedSaving === a.id}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors">
                              {suggestedSaving === a.id ? <Loader2 size={11} className="animate-spin inline" /> : '✓ Publish'}
                            </button>
                          )}
                          {a.status !== 'dismissed' && (
                            <button onClick={() => updateSuggestedStatus(a.id, 'dismissed')} disabled={suggestedSaving === a.id}
                              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                              Dismiss
                            </button>
                          )}
                          <button onClick={() => deleteSuggestedArticle(a.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      {suggestedExpandedId === a.id && (
                        <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Article body</p>
                          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{a.body}</div>
                        </div>
                      )}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        )}

        {/* ── Search Analytics Tab ── */}
        {activeTab === 'search-analytics' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-heading text-xl text-gray-900">Search Analytics</h2>
                <p className="text-sm text-gray-500 mt-0.5">Last 30 days of help center searches. Zero-result queries show content gaps.</p>
              </div>
              <button onClick={fetchSearchAnalytics} disabled={searchAnalyticsLoading}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {searchAnalyticsLoading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />} Refresh
              </button>
            </div>
            {searchAnalyticsLoading && !searchAnalytics ? (
              <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
            ) : searchAnalytics ? (
              <>
                {/* Summary KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Searches</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{searchAnalytics.totalSearches}</p>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Zero Results</p>
                    <p className="text-2xl font-bold text-red-700 mt-1">{searchAnalytics.totalZeroResults}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Zero-Result Rate</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {searchAnalytics.totalSearches > 0 ? Math.round((searchAnalytics.totalZeroResults / searchAnalytics.totalSearches) * 100) : 0}%
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Unique Zero-Result Terms</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{searchAnalytics.zeroResults.length}</p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-6">
                  {/* Zero-result queries — most actionable */}
                  <div className="rounded-2xl border border-red-200 bg-white overflow-hidden">
                    <div className="px-5 py-4 border-b border-red-100 bg-red-50">
                      <p className="text-sm font-semibold text-red-900">Zero-Result Searches</p>
                      <p className="text-xs text-red-500 mt-0.5">Content you should write next</p>
                    </div>
                    {searchAnalytics.zeroResults.length === 0 ? (
                      <div className="px-5 py-8 text-center text-sm text-gray-400">No zero-result searches yet.</div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {searchAnalytics.zeroResults.map((r, i) => (
                          <div key={i} className="flex items-center justify-between px-5 py-3">
                            <span className="text-sm text-gray-800 font-medium truncate flex-1">{r.term}</span>
                            <span className="ml-3 flex-shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">{r.count}×</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Top searches overall */}
                  <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                      <p className="text-sm font-semibold text-gray-900">Top Searches</p>
                      <p className="text-xs text-gray-500 mt-0.5">What users look for most</p>
                    </div>
                    {searchAnalytics.topSearches.length === 0 ? (
                      <div className="px-5 py-8 text-center text-sm text-gray-400">No searches yet.</div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {searchAnalytics.topSearches.map((r, i) => (
                          <div key={i} className="flex items-center justify-between px-5 py-3">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span className="text-[11px] font-bold text-gray-300 flex-shrink-0 w-4 text-right">{i + 1}</span>
                              <span className="text-sm text-gray-800 font-medium truncate">{r.term}</span>
                            </div>
                            <span className="ml-3 flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{r.count}×</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center">
                <BarChart2 size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-500">No analytics data yet.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Article Ratings Tab ── */}
        {activeTab === 'article-ratings' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-heading text-xl text-gray-900">Article Ratings</h2>
                <p className="text-sm text-gray-500 mt-0.5">Thumbs-up / thumbs-down feedback per article. Articles with 2+ thumbs-down get an automatic AI rewrite draft.</p>
              </div>
              <button onClick={fetchArticleRatings} disabled={ratingsLoading}
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {ratingsLoading ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />} Refresh
              </button>
            </div>
            {ratingsLoading && articleRatings.length === 0 ? (
              <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
            ) : articleRatings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center">
                <Star size={32} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-500">No ratings yet.</p>
                <p className="text-xs text-gray-400 mt-1">Ratings appear after users click thumbs-up or thumbs-down on articles.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <div className="hidden sm:grid grid-cols-[1fr_80px_80px_80px_140px] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100">
                  {['Article ID', '👍 Up', '👎 Down', 'Total', 'Status'].map(h => (
                    <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
                  ))}
                </div>
                <div className="divide-y divide-gray-100">
                  {articleRatings.map(r => {
                    const pct = r.total > 0 ? Math.round((r.up / r.total) * 100) : 0;
                    const flagged = r.down >= 2;
                    return (
                      <div key={r.article_id} className={`grid grid-cols-2 sm:grid-cols-[1fr_80px_80px_80px_140px] gap-4 px-5 py-3.5 items-center ${flagged ? 'bg-red-50' : ''}`}>
                        <span className="text-sm text-gray-800 font-mono truncate">{r.article_id}</span>
                        <div className="flex items-center gap-1 text-emerald-600 font-semibold text-sm">
                          <ThumbsUp size={13} />{r.up}
                        </div>
                        <div className="flex items-center gap-1 text-red-500 font-semibold text-sm">
                          <ThumbsDown size={13} />{r.down}
                        </div>
                        <span className="text-sm text-gray-500">{r.total}</span>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                          {flagged && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 whitespace-nowrap">Rewrite queued</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── System / Migrations Tab ── */}
        {activeTab === 'system' && <SystemTab />}

        {/* ── Blog Posts Tab ── */}
        {activeTab === 'blog' && <BlogTab subSegments={tabRest} onNavigate={goBlog} />}

        {/* ── SEO / Pages Tab ── */}
        {activeTab === 'seo-pages' && (
          <SeoPageTab
            urlPageKey={tabRest[0] && tabRest[0] in PAGE_LABELS ? tabRest[0] : 'home'}
            onPageKeyChange={goSeoPage}
          />
        )}

        {/* ── Google Trends Tab ── */}
        {activeTab === 'trends' && <TrendsTab />}

        </main>
      </div>
    </div>
    {children}
    </>
  );
}

// ─── System / Migrations Tab ─────────────────────────────────────────────────

const MIGRATIONS = [
  {
    id: '076',
    name: 'Calendar Settings Tables (076)',
    description: 'Creates venue_calendar_settings, venue_availability, venue_date_overrides, venue_conflict_calendars, and venue_calendar_notifications tables. Required for Google Calendar sync and Calendar Settings.',
    endpoint: '/api/admin/run-migration-076',
  },
];

function SystemTab() {
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});

  async function runMigration(id: string, endpoint: string) {
    setRunning((r) => ({ ...r, [id]: true }));
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      setResults((r) => ({
        ...r,
        [id]: res.ok
          ? { ok: true, message: data.message ?? 'Migration applied successfully.' }
          : { ok: false, message: data.error ?? 'Migration failed.' },
      }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { ok: false, message: String(e) } }));
    } finally {
      setRunning((r) => ({ ...r, [id]: false }));
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="font-heading text-xl text-gray-900">System / Migrations</h2>
        <p className="text-sm text-gray-500 mt-0.5">Run database migrations that haven&apos;t been applied to production yet. Each migration is idempotent — safe to run multiple times.</p>
      </div>

      <div className="space-y-3">
        {MIGRATIONS.map((m) => {
          const result = results[m.id];
          const busy = running[m.id];
          return (
            <div key={m.id} className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                    <Database size={16} className="text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{m.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{m.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => runMigration(m.id, m.endpoint)}
                  disabled={busy}
                  className="shrink-0 flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-85 disabled:cursor-not-allowed transition-opacity"
                  style={{ backgroundColor: '#1b1b1b' }}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Settings size={13} />}
                  {busy ? 'Running…' : 'Run'}
                </button>
              </div>
              {result && (
                <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                  {result.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {result.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Blog CMS component (separate to keep admin page clean) ──────────────────
function BlogTab({
  subSegments,
  onNavigate,
}: {
  subSegments: string[];
  onNavigate: (next: string[]) => void;
}) {
  const [posts, setPosts] = React.useState<BlogPost[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<BlogPost | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<Partial<BlogPost>>(emptyPost());

  function emptyPost(): Partial<BlogPost> {
    return { title: '', slug: '', meta_title: '', meta_description: '', excerpt: '', content: '',
      author_name: 'StoryVenue Team', category: '', tags: [], featured_image: '', og_image: '',
      status: 'draft', noindex: false };
  }

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setForm(emptyPost());
    onNavigate([]);
  }

  React.useEffect(() => {
    fetch('/api/admin/blog').then(r => r.ok ? r.json() : []).then(setPosts).finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    const [a, b] = subSegments;
    if (!a) {
      setCreating(false);
      setEditing(null);
      setForm(emptyPost());
      return;
    }
    if (a === 'new' && subSegments.length === 1) {
      setCreating(true);
      setEditing(null);
      setForm(emptyPost());
      return;
    }
    if (a === 'edit' && b && subSegments.length === 2) {
      setCreating(false);
      setEditing(null);
      setForm(emptyPost());
    }
  }, [subSegments]);

  React.useEffect(() => {
    const [a, b] = subSegments;
    if (a !== 'edit' || !b || loading) return;
    const post = posts.find(p => p.id === b);
    if (post) {
      setEditing(post);
      setForm({ ...post, tags: post.tags || [] });
    } else {
      onNavigate([]);
    }
  }, [subSegments, posts, loading, onNavigate]);

  function autoSlug(title: string) {
    return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
  }

  function upd(k: keyof BlogPost) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const val = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
      setForm(p => ({
        ...p, [k]: val,
        ...(k === 'title' && !p.slug ? { slug: autoSlug(e.target.value) } : {}),
      }));
    };
  }

  async function save() {
    setSaving(true);
    try {
      const method = editing ? 'PATCH' : 'POST';
      const url = editing ? `/api/admin/blog/${editing.id}` : '/api/admin/blog';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) {
        const saved = await res.json();
        setPosts(p => editing ? p.map(x => x.id === saved.id ? saved : x) : [saved, ...p]);
        closeEditor();
      }
    } finally { setSaving(false); }
  }

  async function deletePost(id: string) {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    await fetch(`/api/admin/blog/${id}`, { method: 'DELETE' });
    setPosts(p => p.filter(x => x.id !== id));
    if (editing?.id === id) closeEditor();
  }

  function startEdit(post: BlogPost) {
    onNavigate(['edit', post.id]);
  }

  const INPUT = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
  const LABEL = 'block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl text-gray-900">Blog / SEO</h2>
          <p className="text-sm text-gray-500 mt-0.5">Create and manage blog posts. All posts include automatic Schema markup, OG tags, and sitemap inclusion.</p>
        </div>
        {!creating && !editing && (
          <button onClick={() => onNavigate(['new'])}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all"
            style={{ backgroundColor: BRAND }}>
            <Plus size={15} /> New Post
          </button>
        )}
      </div>

      {/* Editor */}
      {(creating || editing) && (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">{editing ? 'Edit Post' : 'New Post'}</h3>
            <button onClick={closeEditor}
              className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
          </div>
          <div className="px-6 py-5 space-y-5">
            {/* Core fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={LABEL}>Title *</label>
                <input type="text" value={form.title || ''} onChange={upd('title')} placeholder="10 Ways Wedding Venues Can Simplify Payments" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>URL Slug *</label>
                <input type="text" value={form.slug || ''} onChange={upd('slug')} placeholder="simplify-venue-payments" className={INPUT} />
                <p className="text-[10px] text-gray-400 mt-1">storypay.io/blog/{form.slug || 'your-slug'}</p>
              </div>
              <div>
                <label className={LABEL}>Category</label>
                <input type="text" value={form.category || ''} onChange={upd('category')} placeholder="Venue Management" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Author</label>
                <input type="text" value={form.author_name || ''} onChange={upd('author_name')} placeholder="StoryVenue Team" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Status</label>
                <select value={form.status || 'draft'} onChange={upd('status')} className={INPUT}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>

            {/* Excerpt */}
            <div>
              <label className={LABEL}>Excerpt (shown in blog list)</label>
              <textarea value={form.excerpt || ''} onChange={upd('excerpt')} rows={2} placeholder="A brief summary of the post..." className={`${INPUT} resize-none`} />
            </div>

            {/* Content — WYSIWYG editor */}
            <div>
              <label className={LABEL}>Content</label>
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <RichTextEditor
                  content={form.content || ''}
                  onChange={html => setForm(p => ({ ...p, content: html }))}
                  placeholder="Start writing your post... Use headings (H2, H3) for structure and SEO."
                  minHeight={400}
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Use H2 and H3 headings for structure. The editor outputs clean HTML that renders on the blog.</p>
            </div>

            {/* Images */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Featured Image URL</label>
                <input type="url" value={form.featured_image || ''} onChange={upd('featured_image')} placeholder="https://..." className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>OG / Social Share Image URL</label>
                <input type="url" value={form.og_image || ''} onChange={upd('og_image')} placeholder="https://... (1200×630px)" className={INPUT} />
              </div>
            </div>

            {/* SEO Controls */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">SEO Controls</p>
              <div>
                <label className={LABEL}>SEO Title (overrides post title in search results)</label>
                <input type="text" value={form.meta_title || ''} onChange={upd('meta_title')} placeholder="Leave blank to use post title" className={INPUT} />
                <p className="text-[10px] text-gray-400 mt-0.5">{(form.meta_title || form.title || '').length}/60 characters recommended</p>
              </div>
              <div>
                <label className={LABEL}>Meta Description</label>
                <textarea value={form.meta_description || ''} onChange={upd('meta_description')} rows={2}
                  placeholder="155 character description for search results..." className={`${INPUT} resize-none`} />
                <p className="text-[10px] text-gray-400 mt-0.5">{(form.meta_description || '').length}/155 characters recommended</p>
              </div>
              <div>
                <label className={LABEL}>Tags (comma-separated)</label>
                <input type="text" value={(form.tags || []).join(', ')} onChange={e => setForm(p => ({ ...p, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }))}
                  placeholder="wedding venue, payments, proposals" className={INPUT} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.noindex || false}
                  onChange={e => setForm(p => ({ ...p, noindex: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300" />
                <span className="text-sm text-gray-700">Noindex (hide from search engines)</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeEditor}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !form.title?.trim() || !form.slug?.trim()}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                style={{ backgroundColor: BRAND }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Saving...' : form.status === 'published' ? 'Publish Post' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Posts list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <BookOpen size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-500">No blog posts yet. Create your first post to start driving SEO traffic.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_120px_100px_100px_80px] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100">
            {['Title', 'Category', 'Status', 'Published', ''].map(h => (
              <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
            ))}
          </div>
          <div className="divide-y divide-gray-100">
            {posts.map(post => (
              <div key={post.id} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_100px_100px_80px] gap-4 px-5 py-4 items-center hover:bg-gray-50/50">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{post.title}</p>
                  <a href={`/blog/${post.slug}`} target="_blank" rel="noreferrer"
                    className="text-xs text-gray-400 hover:text-gray-600 truncate block">/blog/{post.slug}</a>
                </div>
                <span className="text-sm text-gray-500 truncate">{post.category || '—'}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${post.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {post.status}
                </span>
                <span className="text-xs text-gray-400">{post.published_at ? new Date(post.published_at).toLocaleDateString() : '—'}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => startEdit(post)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => deletePost(post.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface BlogPost {
  id: string; slug: string; title: string; meta_title: string | null;
  meta_description: string | null; og_image: string | null; excerpt: string | null;
  content: string; author_name: string; category: string | null; tags: string[];
  featured_image: string | null; status: string; noindex: boolean; published_at: string | null;
}

// ─── SEO Pages Tab ────────────────────────────────────────────────────────────

interface PageSeo {
  page_key: string; title: string | null; description: string | null;
  og_image: string | null; og_title: string | null; og_description: string | null;
  noindex: boolean; canonical: string | null; schema_json: string | null;
}

function SeoPageTab({
  urlPageKey,
  onPageKeyChange,
}: {
  urlPageKey: string;
  onPageKeyChange: (key: string) => void;
}) {
  const [pages, setPages] = React.useState<PageSeo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState<Partial<PageSeo>>({});
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/admin/page-seo')
      .then(r => r.ok ? r.json() : [])
      .then((data: PageSeo[]) => { setPages(data); })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (!pages.length) return;
    const p = pages.find(x => x.page_key === urlPageKey);
    setForm(p ?? { page_key: urlPageKey });
    setSaved(false);
  }, [urlPageKey, pages]);

  function selectPage(key: string) {
    onPageKeyChange(key);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/page-seo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, page_key: urlPageKey }),
      });
      if (res.ok) {
        const updated = await res.json();
        setPages(p => p.map(x => x.page_key === urlPageKey ? updated : x).concat(
          p.find(x => x.page_key === urlPageKey) ? [] : [updated]
        ));
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally { setSaving(false); }
  }

  const INPUT = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
  const LABEL = 'block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide';

  const pageInfo = PAGE_LABELS[urlPageKey];
  const titleLen = (form.title || '').length;
  const descLen  = (form.description || '').length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl text-gray-900">SEO / Pages</h2>
        <p className="text-sm text-gray-500 mt-0.5">Edit meta titles, descriptions, OG images, and schema for every public page.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">

          {/* Page selector */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pages</p>
            </div>
            <nav className="p-2 space-y-0.5">
              {Object.entries(PAGE_LABELS).map(([key, meta]) => (
                <button key={key} onClick={() => selectPage(key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${urlPageKey === key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <Globe size={14} className={urlPageKey === key ? 'text-white/60' : 'text-gray-400'} />
                  <div className="min-w-0">
                    <p className="truncate">{meta.label}</p>
                    <p className={`text-[10px] truncate ${urlPageKey === key ? 'text-white/50' : 'text-gray-400'}`}>{meta.url}</p>
                  </div>
                </button>
              ))}
            </nav>
          </div>

          {/* Editor */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <p className="font-semibold text-gray-900">{pageInfo?.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{pageInfo?.description} · <a href={`https://${pageInfo?.url}`} target="_blank" rel="noreferrer" className="underline hover:text-gray-600">{pageInfo?.url}</a></p>
              </div>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                style={{ backgroundColor: BRAND }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Check size={14} />}
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save SEO'}
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Basic SEO */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Search Engine Optimization</p>

                <div>
                  <label className={LABEL}>
                    Page Title
                    <span className={`ml-2 font-normal normal-case ${titleLen > 60 ? 'text-red-400' : titleLen > 50 ? 'text-amber-500' : 'text-gray-400'}`}>
                      {titleLen}/60
                    </span>
                  </label>
                  <input type="text" value={form.title || ''} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="SEO-optimized page title..." className={INPUT} />
                  <p className="text-[10px] text-gray-400 mt-1">Shown in browser tab and Google search results. 50–60 characters ideal.</p>
                </div>

                <div>
                  <label className={LABEL}>
                    Meta Description
                    <span className={`ml-2 font-normal normal-case ${descLen > 160 ? 'text-red-400' : descLen > 140 ? 'text-amber-500' : 'text-gray-400'}`}>
                      {descLen}/160
                    </span>
                  </label>
                  <textarea value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    rows={3} placeholder="Describe this page in 140–160 characters for search results..."
                    className={`${INPUT} resize-none`} />
                </div>

                <div>
                  <label className={LABEL}>Canonical URL (optional)</label>
                  <input type="url" value={form.canonical || ''} onChange={e => setForm(p => ({ ...p, canonical: e.target.value }))}
                    placeholder="https://storypay.io/... (leave blank to use page URL)" className={INPUT} />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.noindex || false}
                    onChange={e => setForm(p => ({ ...p, noindex: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300" />
                  <div>
                    <span className="text-sm text-gray-700">Noindex — hide from search engines</span>
                    <p className="text-[10px] text-gray-400">Use for login, setup, and utility pages that shouldn&apos;t appear in Google.</p>
                  </div>
                </label>
              </div>

              {/* Open Graph / Social */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Social Sharing (Open Graph)</p>

                <div>
                  <label className={LABEL}>OG Title (overrides page title for social)</label>
                  <input type="text" value={form.og_title || ''} onChange={e => setForm(p => ({ ...p, og_title: e.target.value }))}
                    placeholder="Leave blank to use page title" className={INPUT} />
                </div>

                <div>
                  <label className={LABEL}>OG Description (overrides meta description for social)</label>
                  <textarea value={form.og_description || ''} onChange={e => setForm(p => ({ ...p, og_description: e.target.value }))}
                    rows={2} placeholder="Leave blank to use meta description" className={`${INPUT} resize-none`} />
                </div>

                <div>
                  <label className={LABEL}>OG Image URL (1200×630px recommended)</label>
                  <input type="url" value={form.og_image || ''} onChange={e => setForm(p => ({ ...p, og_image: e.target.value }))}
                    placeholder="https://storypay.io/og-image.png" className={INPUT} />
                  {form.og_image && (
                    <div className="mt-2 rounded-xl overflow-hidden border border-gray-200 max-w-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.og_image} alt="OG preview" className="w-full" onError={e => (e.currentTarget.style.display = 'none')} />
                    </div>
                  )}
                </div>
              </div>

              {/* Schema / JSON-LD */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Custom JSON-LD Schema</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Advanced: override the auto-generated schema for this page. Leave blank to use the default.</p>
                </div>
                <textarea value={form.schema_json || ''} onChange={e => setForm(p => ({ ...p, schema_json: e.target.value }))}
                  rows={6} placeholder={'{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  ...\n}'}
                  className={`${INPUT} resize-y font-mono text-xs`} />
              </div>

              {/* Live preview */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Google Search Preview</p>
                <div className="max-w-xl">
                  <p className="text-[13px] text-blue-700 truncate">{pageInfo?.url}</p>
                  <p className="text-lg text-blue-800 font-medium leading-tight truncate">{form.title || '(no title set)'}</p>
                  <p className="text-sm text-gray-600 leading-snug mt-0.5 line-clamp-2">{form.description || '(no description set)'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ─── Google Trends Tab ────────────────────────────────────────────────────────

interface TrendWidget {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  months?: number; // override for 5-year charts
}

const CHART_COLORS = ['#1b1b1b', '#6366f1', '#f59e0b', '#10b981', '#ef4444'];

const VENUE_WIDGETS: TrendWidget[] = [
  { id: 'v1', title: 'Wedding Venue — Overall Interest',  description: 'Search interest for "wedding venue" over time.',           keywords: ['wedding venue'] },
  { id: 'v2', title: 'Venue Styles Comparison',           description: 'Barn vs Garden vs Ballroom vs Vineyard.',                  keywords: ['barn wedding venue', 'garden wedding venue', 'ballroom wedding venue', 'vineyard wedding venue'] },
  { id: 'v3', title: 'Venue Search Intent',               description: '"Near me", outdoor, rustic, and intimate searches.',       keywords: ['wedding venue near me', 'outdoor wedding venue', 'rustic wedding venue', 'intimate wedding venue'] },
  { id: 'v4', title: 'Venue Pricing Searches',            description: 'How couples research venue costs and packages.',           keywords: ['wedding venue cost', 'wedding venue packages', 'affordable wedding venue'] },
];

const WEDDING_WIDGETS: TrendWidget[] = [
  { id: 'w1', title: 'Wedding Planning Trends',           description: 'Planning, elopement, micro wedding, intimate wedding.',   keywords: ['wedding planning', 'elopement', 'micro wedding', 'intimate wedding'] },
  { id: 'w2', title: 'What Brides Are Searching For',     description: 'Dress, flowers, photographer, hair searches.',            keywords: ['wedding dress trends', 'wedding photographer', 'wedding hair'] },
  { id: 'w3', title: 'Wedding Décor & Themes',            description: 'Boho, modern décor, centerpieces, arch trends.',          keywords: ['boho wedding', 'modern wedding decor', 'wedding centerpieces', 'wedding arch'] },
  { id: 'w4', title: 'Budget & Planning Tools',           description: 'Budget, checklist, website, planner searches.',           keywords: ['wedding budget', 'wedding checklist', 'wedding planner'] },
  { id: 'w5', title: 'Food, Catering & Cake',             description: 'Catering, cake, food stations, bar ideas.',               keywords: ['wedding catering', 'wedding cake trends', 'wedding food stations'] },
  { id: 'w6', title: 'Wedding — 5-Year Seasonality',      description: 'See exactly when wedding season peaks each year.',        keywords: ['wedding'], months: 60 },
];

const TIME_OPTIONS = [
  { label: 'Past 3 months',  value: 3 },
  { label: 'Past 12 months', value: 12 },
  { label: 'Past 2 years',   value: 24 },
  { label: 'Past 5 years',   value: 60 },
];

interface TrendPoint { date: string; value: number; }
interface ChartState {
  status: 'idle' | 'loading' | 'done' | 'error';
  data: Record<string, TrendPoint[]>;
  error?: string;
  cachedAt?: string;
}

function TrendChartCard({ widget, months, forceRefreshTick = 0 }: { widget: TrendWidget; months: number; forceRefreshTick?: number }) {
  const effectiveMonths = widget.months ?? months;
  const lsKey = `trends|${widget.keywords.join(',')}|${effectiveMonths}`;

  // Seed state from localStorage immediately so charts appear with no delay.
  const [state, setState] = React.useState<ChartState>(() => {
    if (typeof window === 'undefined') return { status: 'idle', data: {} };
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const { data, cachedAt } = JSON.parse(raw) as { data: Record<string, TrendPoint[]>; cachedAt: string };
        return { status: 'done', data, cachedAt };
      }
    } catch { /* ignore */ }
    return { status: 'idle', data: {} };
  });

  const loadChart = React.useCallback(async (force = false) => {
    // If we already have data and this isn't a forced refresh, fetch silently in background.
    const hasData = Object.values(state.data ?? {}).some(d => d.length > 0);
    if (!hasData || force) setState(s => ({ ...s, status: 'loading' }));

    try {
      const qs = new URLSearchParams({ keywords: widget.keywords.join(','), months: String(effectiveMonths) });
      if (force) qs.set('refresh', '1');
      const res  = await fetch(`/api/admin/trends?${qs}`);
      const json = await res.json() as { data?: Record<string, TrendPoint[]>; cachedAt?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      const newState: ChartState = { status: 'done', data: json.data ?? {}, cachedAt: json.cachedAt };
      setState(newState);
      try { localStorage.setItem(lsKey, JSON.stringify({ data: json.data, cachedAt: json.cachedAt })); } catch { /* ignore */ }
    } catch (e) {
      setState(s => ({ ...s, status: s.status === 'done' ? 'done' : 'error', error: e instanceof Error ? e.message : 'Unknown error' }));
    }
  }, [widget.keywords, effectiveMonths, lsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount (or when months changes): silently fetch from API to get latest cached data.
  React.useEffect(() => {
    void loadChart(false);
  }, [loadChart]);

  // When parent triggers a forced refresh (Refresh All button), reload with ?refresh=1.
  const prevTick = React.useRef(forceRefreshTick);
  React.useEffect(() => {
    if (forceRefreshTick !== prevTick.current) {
      prevTick.current = forceRefreshTick;
      void loadChart(true);
    }
  }, [forceRefreshTick, loadChart]);

  // Merge per-keyword series into [{date, kw1, kw2, ...}] for Recharts
  const chartData = React.useMemo(() => {
    const firstKw = widget.keywords[0];
    const base = state.data[firstKw] ?? [];
    return base.map((pt, i) => {
      const row: Record<string, string | number> = { date: pt.date };
      for (const kw of widget.keywords) {
        row[kw] = state.data[kw]?.[i]?.value ?? 0;
      }
      return row;
    });
  }, [state.data, widget.keywords]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-gray-200">
        <div>
          <p className="text-sm font-semibold text-gray-900">{widget.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{widget.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {state.cachedAt && state.status !== 'loading' && (
            <span className="text-[10px] text-gray-300 whitespace-nowrap">
              {new Date(state.cachedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          {state.status === 'loading' && <Loader2 size={12} className="animate-spin text-gray-400" />}
          <a href={`https://trends.google.com/trends/explore?q=${encodeURIComponent(widget.keywords[0])}&geo=US`}
            target="_blank" rel="noreferrer"
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap">
            Open ↗
          </a>
        </div>
      </div>
      <div className="p-4">
        {(state.status === 'idle' || state.status === 'loading') && Object.keys(state.data).length === 0 && (
          <div className="flex items-center justify-center py-14">
            <Loader2 size={22} className="animate-spin text-gray-300" />
          </div>
        )}
        {state.status === 'error' && Object.keys(state.data).length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 bg-red-50 rounded-xl">
            <p className="text-xs text-red-500 text-center max-w-[240px]">{state.error}</p>
            <button onClick={() => void loadChart(false)}
              className="rounded-xl border border-red-200 px-4 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">
              Retry
            </button>
          </div>
        )}
        {state.status === 'done' && chartData.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
                interval={Math.floor(chartData.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                formatter={(val, name) => [val, name]}
              />
              {widget.keywords.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {widget.keywords.map((kw, i) => (
                <Line key={kw} type="monotone" dataKey={kw} stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
        {state.status === 'done' && chartData.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-10">No data returned.</p>
        )}
      </div>
    </div>
  );
}

function TrendsTab() {
  const [section, setSection]           = React.useState<'venues' | 'wedding'>('venues');
  const [months, setMonths]             = React.useState(12);
  const [refreshTick, setRefreshTick]   = React.useState(0);
  const [refreshing, setRefreshing]     = React.useState(false);
  const widgets = section === 'venues' ? VENUE_WIDGETS : WEDDING_WIDGETS;

  async function handleRefreshAll() {
    setRefreshing(true);
    setRefreshTick(t => t + 1);
    // Give cards time to finish fetching before clearing spinner.
    await new Promise(r => setTimeout(r, widgets.length * 3000 + 2000));
    setRefreshing(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl text-gray-900">Google Trends — Wedding Industry</h2>
          <p className="text-sm text-gray-500 mt-0.5">Live search trend data pulled from Google. Find content angles, seasonal patterns, and what brides are searching for right now.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRefreshAll()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
          <a href="https://trends.google.com/trends/explore?q=wedding+venue&geo=US" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <ExternalLink size={13} /> Open Google Trends ↗
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-gray-200 overflow-hidden">
          <button onClick={() => setSection('venues')}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${section === 'venues' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            🏛 Wedding Venues
          </button>
          <button onClick={() => setSection('wedding')}
            className={`px-4 py-2 text-sm font-semibold transition-colors border-l border-gray-200 ${section === 'wedding' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            💍 Wedding Industry
          </button>
        </div>
        <select value={months} onChange={e => setMonths(Number(e.target.value))}
          className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:border-gray-400 transition-colors">
          {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <strong>Note:</strong> Charts show cached data instantly and auto-refresh every 24 h. Use &ldquo;Refresh now&rdquo; to force a new pull from Google. Values are indexed 0–100 (relative search interest).
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {widgets.map(widget => (
          <TrendChartCard key={`${widget.id}-${months}`} widget={widget} months={months} forceRefreshTick={refreshTick} />
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <p className="text-sm font-semibold text-gray-900 mb-3">Quick Search — Open Directly in Google Trends</p>
        <div className="flex flex-wrap gap-2">
          {['wedding venue','barn wedding','outdoor wedding','elopement','micro wedding','boho wedding','wedding photographer','wedding catering','wedding budget','wedding dress trends 2026','wedding checklist','honeymoon destinations','wedding arch','rustic wedding','all inclusive wedding venue'].map(q => (
            <a key={q} href={`https://trends.google.com/trends/explore?q=${encodeURIComponent(q)}&geo=US`}
              target="_blank" rel="noreferrer"
              className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors">
              {q} ↗
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
