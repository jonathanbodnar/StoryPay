'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Braces, ChevronDown, ChevronUp, Copy, ExternalLink, Link2,
  Loader2, Lock, Pencil, Plus, Search, Tags, Trash2, X,
} from 'lucide-react';
import { SYSTEM_MERGE_VARIABLES, type MergeVarCategory } from '@/lib/merge-variables';

// ── Merge-variable category metadata ─────────────────────────────────────────

const CATEGORY_LABELS: Record<MergeVarCategory, string> = {
  contact:      'Contact',
  appointment:  'Appointment',
  venue:        'Venue',
  lead:         'Lead',
  invoice:      'Invoice',
  proposal:     'Proposal',
  subscription: 'Subscription',
  marketing:    'Marketing',
  system:       'System',
};

const CATEGORY_COLORS: Record<MergeVarCategory, string> = {
  contact:      'bg-blue-50 text-blue-700 border-blue-200',
  appointment:  'bg-violet-50 text-violet-700 border-violet-200',
  venue:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  lead:         'bg-pink-50 text-pink-700 border-pink-200',
  invoice:      'bg-amber-50 text-amber-700 border-amber-200',
  proposal:     'bg-orange-50 text-orange-700 border-orange-200',
  subscription: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  marketing:    'bg-rose-50 text-rose-700 border-rose-200',
  system:       'bg-gray-50 text-gray-600 border-gray-200',
};

const CATEGORY_ORDER: MergeVarCategory[] = [
  'contact', 'appointment', 'venue', 'lead',
  'invoice', 'proposal', 'subscription', 'marketing', 'system',
];

// Tag category colors (for system tags)
const TAG_CATEGORY_COLORS: Record<string, string> = {
  'Lead Lifecycle': 'bg-blue-50 text-blue-700 border-blue-200',
  'Booking':        'bg-violet-50 text-violet-700 border-violet-200',
  'Proposal':       'bg-purple-50 text-purple-700 border-purple-200',
  'Payments':       'bg-amber-50 text-amber-700 border-amber-200',
  'Marketing':      'bg-rose-50 text-rose-700 border-rose-200',
  'Communication':  'bg-sky-50 text-sky-700 border-sky-200',
  'Forms':          'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Event':          'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Referral':       'bg-teal-50 text-teal-700 border-teal-200',
  'Integration':    'bg-orange-50 text-orange-700 border-orange-200',
};

// ── Short URL helper ──────────────────────────────────────────────────────────

const APP_ORIGIN =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '')
    : (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

function shortUrl(code: string) {
  const base = APP_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/t/${code}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TriggerLinkRow {
  id: string;
  name: string;
  target_url: string;
  short_code: string;
  click_count: number;
  created_at: string;
  updated_at: string;
}

interface MarketingTagRow {
  id: string;
  name: string;
  icon: string;
  color: string | null;
  position: number;
  is_system: boolean;
  system_key: string | null;
  category: string | null;
  description: string | null;
  auto_apply_events: string[];
  created_at: string;
  updated_at: string;
}

// ── Accordion wrapper component ───────────────────────────────────────────────

function AccordionSection({
  id,
  icon,
  iconColor,
  label,
  title,
  count,
  defaultOpen = false,
  children,
  headerRight,
}: {
  id: string;
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mt-8 rounded-2xl border border-gray-200 overflow-hidden" id={id}>
      {/* Header / toggle row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 bg-gray-50 hover:bg-gray-100/70 transition text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`flex-shrink-0 ${iconColor}`}>{icon}</span>
          <div className="min-w-0">
            <div className={`text-[10px] font-bold uppercase tracking-widest ${iconColor} mb-0.5`}>{label}</div>
            <div className="font-semibold text-sm text-gray-900 flex items-center gap-2">
              {title}
              {count !== undefined && (
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                  {count}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerRight}
          {open
            ? <ChevronUp className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />
          }
        </div>
      </button>

      {/* Collapsible body */}
      {open && <div className="p-5">{children}</div>}
    </section>
  );
}

// ── System Variables accordion body ──────────────────────────────────────────

function SystemVariablesBody() {
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MergeVarCategory | 'all'>('all');

  function copyTag(tag: string) {
    void navigator.clipboard.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 2000);
  }

  const filtered = SYSTEM_MERGE_VARIABLES.filter((v) => {
    const matchesCat = activeCategory === 'all' || v.category === activeCategory;
    const q = search.toLowerCase();
    const matchesSearch = !q || v.tag.toLowerCase().includes(q) || v.description.toLowerCase().includes(q) || v.key.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  const groupedByCategory = CATEGORY_ORDER.reduce<Record<string, typeof SYSTEM_MERGE_VARIABLES>>((acc, cat) => {
    const items = filtered.filter((v) => v.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        System-default merge variables for email, SMS, and calendar templates.{' '}
        <strong className="text-gray-700">Read-only</strong> — click any tag to copy it.
      </p>

      {/* Search row + category filters */}
      <div className="space-y-3 mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search variables…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
              activeCategory === 'all'
                ? 'bg-brand-900 text-white border-brand-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            All
          </button>
          {CATEGORY_ORDER.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                activeCategory === cat
                  ? 'bg-brand-900 text-white border-brand-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400">No variables match your search.</p>
      ) : (
        <div className="space-y-5">
          {Object.entries(groupedByCategory).map(([cat, vars]) => (
            <div key={cat}>
              <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border mb-3 ${CATEGORY_COLORS[cat as MergeVarCategory]}`}>
                {CATEGORY_LABELS[cat as MergeVarCategory]}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {vars.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => copyTag(v.tag)}
                    title={`Click to copy ${v.tag}`}
                    className="group flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-brand-400 hover:bg-brand-50/30 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <code className="text-xs font-mono font-semibold text-brand-700 leading-tight break-all">{v.tag}</code>
                      <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border transition ${
                        copiedTag === v.tag
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-gray-50 text-gray-400 border-gray-200 group-hover:bg-brand-50 group-hover:text-brand-600 group-hover:border-brand-200'
                      }`}>
                        <Copy className="w-2.5 h-2.5" />
                        {copiedTag === v.tag ? 'Copied' : 'Copy'}
                      </span>
                    </div>
                    <p className="text-[12px] text-gray-600 leading-snug">{v.description}</p>
                    <p className="text-[11px] text-gray-400 italic truncate">e.g. {v.example}</p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {v.usedIn.map((ctx) => (
                        <span key={ctx} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500 uppercase tracking-wide">
                          {ctx}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tags accordion body ───────────────────────────────────────────────────────

function TagsBody({
  tags,
  tagsLoading,
  onCreateTag,
  onEditTag,
  onDeleteTag,
}: {
  tags: MarketingTagRow[];
  tagsLoading: boolean;
  onCreateTag: () => void;
  onEditTag: (row: MarketingTagRow) => void;
  onDeleteTag: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const systemTags = tags.filter((t) => t.is_system);
  const customTags = tags.filter((t) => !t.is_system);

  // Unique categories from system tags
  const systemCategories = [...new Set(systemTags.map((t) => t.category ?? 'Other'))];

  const filteredSystem = systemTags.filter((t) => {
    const q = search.toLowerCase();
    const matchesCat = activeCategory === 'all' || activeCategory === 'system-cat-' + (t.category ?? 'Other');
    const matchesSearch = !q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  const filteredCustom = customTags.filter((t) => {
    if (activeCategory !== 'all' && activeCategory !== 'custom') return false;
    const q = search.toLowerCase();
    return !q || t.name.toLowerCase().includes(q);
  });

  const groupedSystem = systemCategories.reduce<Record<string, MarketingTagRow[]>>((acc, cat) => {
    const items = filteredSystem.filter((t) => (t.category ?? 'Other') === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  if (tagsLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading tags…
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Tags appear on lead cards. System tags are auto-applied at key moments and{' '}
        <strong className="text-gray-700">cannot be deleted</strong>. Create custom tags for anything else.
      </p>

      {/* Controls — search row on top, filters + new tag below */}
      <div className="space-y-3 mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-wrap gap-1.5 items-center flex-1 min-w-0">
            <button type="button" onClick={() => setActiveCategory('all')}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition ${activeCategory === 'all' ? 'bg-brand-900 text-white border-brand-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
              All
            </button>
            {systemCategories.map((cat) => (
              <button key={cat} type="button" onClick={() => setActiveCategory('system-cat-' + cat)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition ${activeCategory === 'system-cat-' + cat ? 'bg-brand-900 text-white border-brand-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                {cat}
              </button>
            ))}
            {customTags.length > 0 && (
              <button type="button" onClick={() => setActiveCategory('custom')}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition ${activeCategory === 'custom' ? 'bg-brand-900 text-white border-brand-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                Custom
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onCreateTag}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 shrink-0"
          >
            <Plus className="h-4 w-4" /> New tag
          </button>
        </div>
      </div>

      {/* Custom tags (always on top when visible) */}
      {filteredCustom.length > 0 && (
        <div className="mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border border-gray-200 bg-gray-50 text-gray-600 mb-3">
            Custom
          </div>
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            {filteredCustom.map((row, i) => (
              <div
                key={row.id}
                className={`flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50/80 ${i < filteredCustom.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {row.color && (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                  )}
                  <span className="font-medium text-sm text-gray-900 truncate">{row.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => onEditTag(row)}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-800" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => onDeleteTag(row.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No custom tags message */}
      {filteredCustom.length === 0 && activeCategory === 'custom' && (
        <p className="text-center py-8 text-sm text-gray-400">No custom tags yet.{' '}
          <button type="button" onClick={onCreateTag} className="text-brand-700 underline">Create one</button>
        </p>
      )}

      {/* System tags grouped by category — card grid matching variables layout */}
      {(activeCategory === 'all' || activeCategory.startsWith('system-cat-')) && (
        <>
          {filteredSystem.length === 0 && search ? (
            <p className="text-center py-8 text-sm text-gray-400">No system tags match your search.</p>
          ) : (
            <div className="space-y-5">
              {Object.entries(groupedSystem).map(([cat, rows]) => (
                <div key={cat}>
                  <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border mb-3 ${TAG_CATEGORY_COLORS[cat] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {cat}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {rows.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-3"
                      >
                        {/* Tag name row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {row.color && (
                              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: row.color }} />
                            )}
                            <span className="text-sm font-semibold text-gray-900 leading-tight truncate">{row.name}</span>
                          </div>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                            <Lock className="w-2.5 h-2.5" /> System
                          </span>
                        </div>
                        {/* Description */}
                        {row.description && (
                          <p className="text-[12px] text-gray-500 leading-snug">{row.description}</p>
                        )}
                        {/* System key pill + auto-apply badge */}
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {row.system_key && (
                            <code className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-mono text-gray-500">
                              {row.system_key}
                            </code>
                          )}
                          {row.auto_apply_events?.length > 0 && (
                            <span className="rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-[9px] font-semibold text-green-700 uppercase tracking-wide">
                              Auto-applied
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* If no tags at all */}
      {tags.length === 0 && (
        <div className="text-center py-12 px-4">
          <Tags className="w-10 h-10 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-medium">No tags yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Create tags to label leads from the board or lead profile.</p>
          <button type="button" onClick={onCreateTag}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800">
            <Plus className="h-4 w-4" /> Create tag
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TriggerLinksPage() {
  const [links, setLinks] = useState<TriggerLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRow, setEditRow] = useState<TriggerLinkRow | null>(null);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [tags, setTags] = useState<MarketingTagRow[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagEdit, setTagEdit] = useState<MarketingTagRow | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagSaving, setTagSaving] = useState(false);

  const loadTags = useCallback(async () => {
    setTagsLoading(true);
    const res = await fetch('/api/marketing/tags', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setTags(d.tags ?? []);
    } else setTags([]);
    setTagsLoading(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/marketing/trigger-links', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setLinks(d.links ?? []);
    } else {
      setLinks([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    void loadTags();
  }, [load, loadTags]);

  function openCreate() {
    setEditRow(null);
    setFormName('');
    setFormUrl('https://');
    setModalOpen(true);
  }

  function openEdit(row: TriggerLinkRow) {
    setEditRow(row);
    setFormName(row.name);
    setFormUrl(row.target_url);
    setModalOpen(true);
  }

  async function saveModal() {
    setSaving(true);
    try {
      if (editRow) {
        const res = await fetch(`/api/marketing/trigger-links/${editRow.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, targetUrl: formUrl }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          alert(e.error || 'Save failed');
          return;
        }
      } else {
        const res = await fetch('/api/marketing/trigger-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: formName, targetUrl: formUrl }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          alert(e.error || 'Create failed');
          return;
        }
      }
      setModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this trigger link? The short URL will stop working. Past activity stays in lead timelines.')) return;
    const res = await fetch(`/api/marketing/trigger-links/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || 'Delete failed');
      return;
    }
    await load();
  }

  function copyShort(row: TriggerLinkRow) {
    const u = shortUrl(row.short_code);
    void navigator.clipboard.writeText(u);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function openTagCreate() {
    setTagEdit(null);
    setTagName('');
    setTagModalOpen(true);
  }

  function openTagEdit(row: MarketingTagRow) {
    setTagEdit(row);
    setTagName(row.name);
    setTagModalOpen(true);
  }

  async function saveTagModal() {
    setTagSaving(true);
    try {
      const payload = { name: tagName.trim() };
      if (tagEdit) {
        const res = await fetch(`/api/marketing/tags/${tagEdit.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          alert(e.error || 'Save failed');
          return;
        }
      } else {
        const res = await fetch('/api/marketing/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          alert(e.error || 'Create failed');
          return;
        }
      }
      setTagModalOpen(false);
      await loadTags();
    } finally {
      setTagSaving(false);
    }
  }

  async function removeTag(id: string) {
    const tag = tags.find((t) => t.id === id);
    if (tag?.is_system) {
      alert('System tags cannot be deleted.');
      return;
    }
    if (!confirm('Delete this tag? It will be removed from all leads.')) return;
    const res = await fetch(`/api/marketing/tags/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || 'Delete failed');
      return;
    }
    await loadTags();
  }

  return (
    <div className="mx-auto min-h-full max-w-5xl bg-white px-4 py-8">
      <Link
        href="/dashboard/marketing/analytics"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Marketing
      </Link>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-pink-600 mb-1">
            <Link2 className="w-5 h-5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Marketing</span>
          </div>
          <h1 className="font-heading text-2xl text-gray-900">Trigger Links, Tags &amp; Variables</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-xl">
            Each link gets a permanent short URL (<code className="text-xs bg-gray-100 px-1 rounded">/t/…</code>).
            Tags label leads and drive automations. Variables power personalized templates.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-800"
        >
          <Plus className="h-4 w-4" /> New trigger link
        </button>
      </div>

      {/* ── Trigger Links table (always visible) ─────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : links.length === 0 ? (
          <div className="text-center py-16 px-4">
            <Link2 className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-600 font-medium">No trigger links yet</p>
            <p className="text-sm text-gray-400 mt-1 mb-4">Create one to get a trackable short URL.</p>
            <button type="button" onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800">
              <Plus className="h-4 w-4" /> Create trigger link
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-200">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Short URL</th>
                <th className="px-4 py-3 hidden md:table-cell">Destination</th>
                <th className="px-4 py-3 text-right">Clicks</th>
                <th className="px-4 py-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {links.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <code className="text-xs text-gray-700 truncate max-w-[220px]">{shortUrl(row.short_code)}</code>
                      <button type="button" onClick={() => copyShort(row)}
                        className="text-left text-xs font-medium text-pink-600 hover:text-pink-800 inline-flex items-center gap-1 w-fit">
                        <Copy className="w-3 h-3" />
                        {copiedId === row.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell max-w-xs">
                    <a href={row.target_url} target="_blank" rel="noreferrer"
                      className="text-xs text-gray-600 hover:text-gray-900 truncate inline-flex items-center gap-1 max-w-full">
                      <span className="truncate">{row.target_url}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{Number(row.click_count ?? 0)}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openEdit(row)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-800" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => remove(row.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Tags accordion ────────────────────────────────────────────────── */}
      <AccordionSection
        id="tags-section"
        icon={<Tags className="w-5 h-5" />}
        iconColor="text-violet-600"
        label="Tags"
        title="Lead Tags"
        count={tags.length}
        defaultOpen={true}
      >
        <TagsBody
          tags={tags}
          tagsLoading={tagsLoading}
          onCreateTag={openTagCreate}
          onEditTag={openTagEdit}
          onDeleteTag={removeTag}
        />
      </AccordionSection>

      {/* ── System Variables accordion ────────────────────────────────────── */}
      <AccordionSection
        id="variables-section"
        icon={<Braces className="w-5 h-5" />}
        iconColor="text-brand-700"
        label="System Variables"
        title="Merge Variables"
        count={SYSTEM_MERGE_VARIABLES.length}
        defaultOpen={false}
      >
        <SystemVariablesBody />
      </AccordionSection>

      {/* ── Trigger link modal ────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6">
            <button type="button" onClick={() => setModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-lg text-gray-400 hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
            <h2 className="font-heading text-lg font-semibold text-gray-900 pr-8">
              {editRow ? 'Edit trigger link' : 'New trigger link'}
            </h2>
            {!editRow && (
              <p className="text-xs text-gray-500 mt-1 mb-4">
                A short code is generated once and never changes. You can edit the destination any time.
              </p>
            )}
            {editRow && (
              <p className="text-xs text-gray-500 mt-1 mb-4">
                Short URL stays: <code className="bg-gray-100 px-1 rounded">{shortUrl(editRow.short_code)}</code>
              </p>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Name</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  placeholder="Spring promo landing" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Destination URL</label>
                <input value={formUrl} onChange={(e) => setFormUrl(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  placeholder="https://…" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" disabled={saving || !formName.trim() || !formUrl.trim()}
                  onClick={() => void saveModal()}
                  className="rounded-xl bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-40">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : editRow ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tag modal ─────────────────────────────────────────────────────── */}
      {tagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6">
            <button type="button" onClick={() => setTagModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-lg text-gray-400 hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
            <h2 className="font-heading text-lg font-semibold text-gray-900 pr-8">
              {tagEdit ? 'Edit tag' : 'New tag'}
            </h2>
            {!tagEdit && (
              <p className="text-xs text-gray-500 mt-1 mb-4">
                Custom tags can be used to label leads and trigger automations.
              </p>
            )}
            <div className="space-y-4 mt-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Name</label>
                <input value={tagName} onChange={(e) => setTagName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  placeholder="VIP tour" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setTagModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" disabled={tagSaving || !tagName.trim()}
                  onClick={() => void saveTagModal()}
                  className="rounded-xl bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-40">
                  {tagSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : tagEdit ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
