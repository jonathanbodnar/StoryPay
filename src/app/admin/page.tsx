'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  DollarSign, Users, FileText, Clock, XCircle, Building2,
  TrendingUp, LogOut, Home,
  Megaphone, Plus, Trash2, Pencil, X, Loader2, ThumbsUp,
  Check, BarChart2, ExternalLink, ChevronRight, Search,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import DateRangePicker, { DateRange, PRESETS } from '@/components/DateRangePicker';

const BRAND = '#293745';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Venue { id: string; name: string; email: string | null; ghl_location_id: string | null; onboarding_status: string; setup_completed: boolean; created_at: string; login_url: string | null; venue_tokens: { token: string }[]; }
interface AdminStats {
  totalRevenue: number; totalProposals: number; pendingPayments: number;
  failedPayments: number; uniqueCustomers: number; uniqueVenues: number;
  waitlistCount: number; venueCount: number;
  statusBreakdown: Record<string, number>;
  monthlyChart: { month: string; label: string; revenue: number; proposals: number }[];
  featureRequests: { id: string; title: string; vote_count: number; status: string; created_at: string }[];
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

function KPICard({ label, value, icon: Icon, color, onClick }: { label: string; value: string | number; icon: React.ElementType; color: string; onClick?: () => void }) {
  return (
    <div
      className={`rounded-xl bg-white border border-gray-200 shadow-sm p-5 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-gray-300 transition-all' : ''}`}
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
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
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
export default function AdminPage() {
  const [authState, setAuthState]   = useState<AuthState>('loading');
  const [secret, setSecret]         = useState('');
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab]   = useState<'dashboard' | 'venues' | 'announcements'>('dashboard');

  // Stats
  const [stats, setStats]       = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultRange);

  // Venues
  const [venues, setVenues]         = useState<Venue[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [copiedId, setCopiedId]     = useState<string | null>(null);
  const [copiedGhl, setCopiedGhl]   = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating]     = useState(false);
  const [serverError, setServerError] = useState('');
  const [formData, setFormData]     = useState({ name: '', email: '', firstName: '', lastName: '', phone: '', ghlLocationId: '' });

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
  useEffect(() => { if (authState === 'authenticated') { fetchStats(dateRange); fetchAnnouncements(); } }, [authState, fetchStats, fetchAnnouncements, dateRange]);

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
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
    if (!res.ok) { setLoginError('Invalid secret'); return; }
    setSecret(''); fetchVenues();
  }

  async function handleLogout() {
    await fetch('/api/admin/login', { method: 'DELETE' }).catch(() => {});
    document.cookie = 'admin_token=; Max-Age=0; path=/';
    setAuthState('unauthenticated');
    setVenues([]); setStats(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setCreating(true); setServerError('');
    try {
      const res = await fetch('/api/admin/venues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
      if (res.ok) { setFormData({ name: '', email: '', firstName: '', lastName: '', phone: '', ghlLocationId: '' }); setShowCreateForm(false); fetchVenues(); }
      else { const d = await res.json(); setServerError(d.error || 'Create failed'); }
    } catch (err) { setServerError(err instanceof Error ? err.message : 'Request failed'); }
    setCreating(false);
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors">
            <Home size={14} /> Back to homepage
          </Link>
          <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-lg p-8">
            <h2 className="font-heading text-2xl text-gray-900 mb-6 text-center">Admin Login</h2>
            {loginError && <div className="bg-red-50 text-red-700 text-sm rounded-xl px-4 py-2 mb-4">{loginError}</div>}
            <label className="block text-sm font-medium text-gray-700 mb-1">Admin Secret</label>
            <input type="password" value={secret} onChange={e => setSecret(e.target.value)} required
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-900 focus:border-brand-900 outline-none mb-4"
              placeholder="Enter admin secret..." />
            <button type="submit" className="w-full text-white font-semibold py-2.5 rounded-xl transition-colors hover:opacity-90" style={{ backgroundColor: BRAND }}>
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Authenticated ───────────────────────────────────────────────────────────
  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: BarChart2 },
    { key: 'venues',    label: 'Venues',    icon: Building2 },
    { key: 'announcements', label: 'Announcements', icon: Megaphone },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="text-white shadow-lg" style={{ backgroundColor: BRAND }}>
        {/* Top row: logo + logout/home */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4">
          <h1 className="font-heading text-lg sm:text-xl tracking-wide">StoryPay Admin</h1>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/" className="flex items-center gap-1 sm:gap-1.5 rounded-lg border border-white/20 px-2.5 sm:px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
              <Home size={13} />
              <span className="hidden sm:inline">Homepage</span>
            </Link>
            <button onClick={handleLogout} className="flex items-center gap-1 sm:gap-1.5 rounded-lg border border-white/20 px-2.5 sm:px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
              <LogOut size={13} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
        {/* Tab nav row */}
        <div className="flex border-t border-white/10 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 sm:px-5 py-2.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap min-w-[80px] ${
                activeTab === key
                  ? 'bg-white/15 text-white border-b-2 border-white'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="p-4 sm:p-6 max-w-7xl mx-auto">

        {/* ── Dashboard Tab ── */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="font-heading text-xl text-gray-900">Super Admin Dashboard</h2>
              <DateRangePicker value={dateRange} onChange={r => { setDateRange(r); fetchStats(r); }} />
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <KPICard label="Total Revenue" value={statsLoading ? '...' : formatCents(stats?.totalRevenue ?? 0)} icon={DollarSign} color={BRAND} />
              <KPICard label="Active Venues" value={statsLoading ? '...' : stats?.venueCount ?? 0} icon={Building2} color="#7c3aed" onClick={() => openDrill('venues')} />
              <KPICard label="Proposals" value={statsLoading ? '...' : stats?.totalProposals ?? 0} icon={FileText} color="#3b82f6" />
              <KPICard label="Waitlist" value={statsLoading ? '...' : stats?.waitlistCount ?? 0} icon={Users} color="#10b981" onClick={() => openDrill('waitlist')} />
              <KPICard label="Unique Customers" value={statsLoading ? '...' : stats?.uniqueCustomers ?? 0} icon={Users} color="#f59e0b" onClick={() => openDrill('customers')} />
              <KPICard label="Pending Payments" value={statsLoading ? '...' : stats?.pendingPayments ?? 0} icon={Clock} color="#f59e0b" onClick={() => openDrill('pending')} />
              <KPICard label="Failed Payments" value={statsLoading ? '...' : stats?.failedPayments ?? 0} icon={XCircle} color="#ef4444" onClick={() => openDrill('failed')} />
              <KPICard label="Total Customers" value={statsLoading ? '...' : stats?.uniqueCustomers ?? 0} icon={Users} color="#6b8aab" onClick={() => openDrill('customers')} />
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
                  title={drillKey === 'venues' ? 'Active Venues' : drillKey === 'waitlist' ? 'Waitlist Signups' : drillKey === 'customers' ? 'Customers' : drillKey === 'failed' ? 'Failed Payments' : 'Pending Payments'}
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
                    filteredCustomers.length === 0 ? <p className="text-center text-gray-400 py-8 text-sm">{q ? 'No customers match your search' : 'No customers found'}</p> : (
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* Revenue chart */}
              <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Platform Revenue</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{statsLoading ? '...' : formatCents(stats?.totalRevenue ?? 0)}</p>
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
              <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6">
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
            </div>

            {/* Feature requests */}
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ThumbsUp size={16} style={{ color: BRAND }} />
                  <p className="text-sm font-semibold text-gray-900">Top Feature Requests</p>
                </div>
                <Link href="/admin#announcements" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">View all in venues</Link>
              </div>
              <div className="divide-y divide-gray-50">
                {!statsLoading && (stats?.featureRequests ?? []).length === 0 && (
                  <p className="px-6 py-8 text-sm text-center text-gray-400">No feature requests yet</p>
                )}
                {(stats?.featureRequests ?? []).map((req, i) => (
                  <div key={req.id} className="flex items-center gap-4 px-6 py-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: i === 0 ? '#f59e0b' : i === 1 ? '#6b7280' : i === 2 ? '#cd7c2f' : BRAND }}>
                      #{i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{req.title}</p>
                      <span className="text-[11px] text-gray-400 capitalize">{req.status}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <ThumbsUp size={13} style={{ color: BRAND }} />
                      <span className="text-sm font-bold" style={{ color: BRAND }}>{req.vote_count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Venues Tab ── */}
        {activeTab === 'venues' && (
          <div>
            {serverError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                <strong>Error:</strong> {serverError}
                <button onClick={fetchVenues} className="ml-3 underline">Retry</button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-heading text-xl text-gray-900">Venues ({venues.length})</h2>
              <button onClick={() => setShowCreateForm(!showCreateForm)}
                className="text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors hover:opacity-90" style={{ backgroundColor: BRAND }}>
                {showCreateForm ? 'Cancel' : '+ Create Venue'}
              </button>
            </div>

            {showCreateForm && (
              <form onSubmit={handleCreate} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-5">
                <h3 className="font-heading text-lg text-gray-900 mb-4">New Venue</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label>
                    <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 outline-none" required /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                    <input type="text" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 outline-none" required /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                    <input type="text" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 outline-none" required /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                    <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 outline-none" required /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 outline-none" /></div>
                  <div className="md:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">GHL Location ID</label>
                    <input type="text" value={formData.ghlLocationId} onChange={e => setFormData({...formData, ghlLocationId: e.target.value})} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-brand-900 outline-none" /></div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="submit" disabled={creating} className="text-white font-medium px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-50 transition-colors" style={{ backgroundColor: BRAND }}>
                    {creating ? 'Creating...' : 'Create Venue'}
                  </button>
                </div>
              </form>
            )}

            <div className="mb-4 flex items-center justify-between rounded-lg border border-brand-900/20 bg-brand-900/5 px-4 py-3">
              <div>
                <p className="text-sm font-medium" style={{ color: BRAND }}>Universal GHL Login Link</p>
                <p className="text-xs text-gray-500 mt-0.5">Auto-detects venue from referring GHL location</p>
              </div>
              <button onClick={() => { const url = venues[0]?.login_url?.split('/login/')[0] || 'https://www.storypay.io'; navigator.clipboard.writeText(`${url}/login/ghl`); setCopiedGhl(true); setTimeout(() => setCopiedGhl(false), 2000); }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-colors" style={{ backgroundColor: BRAND }}>
                {copiedGhl ? 'Copied!' : 'Copy Link'}
              </button>
            </div>

            {/* Mobile: card view. Desktop: table */}
            <div className="sm:hidden space-y-3">
              {venuesLoading ? <div className="text-center py-8 text-gray-400"><Loader2 size={20} className="animate-spin inline" /></div>
              : venues.length === 0 ? <p className="text-center text-gray-400 py-8 text-sm">No venues yet</p>
              : venues.map(venue => (
                <div key={venue.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold text-gray-900">{venue.name}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {statusBadge(venue.onboarding_status)}
                      {venue.setup_completed && <span className="inline-block h-5 w-5 rounded-full bg-emerald-100 text-emerald-600 text-center text-xs leading-5">✓</span>}
                    </div>
                  </div>
                  {venue.email && <p className="text-xs text-gray-500 mb-1">{venue.email}</p>}
                  {venue.ghl_location_id && <p className="text-xs font-mono text-gray-400 mb-2">ID: {venue.ghl_location_id.slice(0,16)}…</p>}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">{new Date(venue.created_at).toLocaleDateString()}</span>
                    <button onClick={() => { if (!venue.login_url) return; navigator.clipboard.writeText(venue.login_url); setCopiedId(venue.id); setTimeout(() => setCopiedId(null), 2000); }}
                      disabled={!venue.login_url}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-40">
                      {copiedId === venue.id ? 'Copied!' : 'Copy Login'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden sm:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      {['Name','Email','GHL Location','Status','Setup','Created','Actions'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {venuesLoading ? (
                      <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading...</td></tr>
                    ) : venues.length === 0 ? (
                      <tr><td colSpan={7} className="text-center text-gray-400 py-12 text-sm">No venues yet</td></tr>
                    ) : venues.map(venue => (
                      <tr key={venue.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{venue.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{venue.email || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{venue.ghl_location_id ? `${venue.ghl_location_id.slice(0,12)}…` : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3">{statusBadge(venue.onboarding_status)}</td>
                        <td className="px-4 py-3">{venue.setup_completed ? <span className="inline-block h-5 w-5 rounded-full bg-emerald-100 text-emerald-600 text-center text-xs leading-5">✓</span> : <span className="inline-block h-5 w-5 rounded-full bg-gray-100 text-gray-400 text-center text-xs leading-5">—</span>}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{new Date(venue.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => { if (!venue.login_url) return; navigator.clipboard.writeText(venue.login_url); setCopiedId(venue.id); setTimeout(() => setCopiedId(null), 2000); }}
                            disabled={!venue.login_url}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-40">
                            {copiedId === venue.id ? 'Copied!' : 'Copy Login'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Announcements Tab ── */}
        {activeTab === 'announcements' && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-heading text-xl text-gray-900">Announcements</h2>
                <p className="text-sm text-gray-500 mt-0.5">Active announcements show as a scrolling ticker on all venue dashboards</p>
              </div>
              {!showAnnForm && !editingAnn && (
                <button onClick={() => setShowAnnForm(true)}
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shadow-sm" style={{ backgroundColor: BRAND }}>
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
                  <div key={ann.id} className={`rounded-xl border bg-white p-5 transition-all ${ann.is_active ? 'border-gray-200 shadow-sm' : 'border-gray-100 opacity-60'}`}>
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

      </main>
    </div>
  );
}
