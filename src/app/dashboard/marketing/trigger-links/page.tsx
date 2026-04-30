'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Copy, ExternalLink, Link2, Loader2, Pencil, Plus, Trash2, X, Tags, Braces,
} from 'lucide-react';
import { SYSTEM_MERGE_VARIABLES, type MergeVarCategory } from '@/lib/merge-variables';

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

const APP_ORIGIN =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '')
    : (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

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
  created_at: string;
  updated_at: string;
}

function shortUrl(code: string) {
  const base = APP_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/t/${code}`;
}

function SystemVariablesSection() {
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<MergeVarCategory | 'all'>('all');

  function copyTag(tag: string) {
    void navigator.clipboard.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 2000);
  }

  const visibleVars = activeCategory === 'all'
    ? SYSTEM_MERGE_VARIABLES
    : SYSTEM_MERGE_VARIABLES.filter((v) => v.category === activeCategory);

  const groupedByCategory = CATEGORY_ORDER.reduce<Record<string, typeof SYSTEM_MERGE_VARIABLES>>((acc, cat) => {
    const items = visibleVars.filter((v) => v.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-brand-700 mb-1">
            <Braces className="w-5 h-5" />
            <span className="text-xs font-semibold uppercase tracking-wider">System Variables</span>
          </div>
          <h2 className="font-heading text-xl text-gray-900">Merge Variables</h2>
          <p className="mt-1 text-sm text-gray-500 max-w-xl">
            These are the system-default merge variables available across all email, SMS, and calendar templates.
            They are <strong className="text-gray-700">read-only</strong> and cannot be deleted. Click any tag to copy it.
          </p>
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
            activeCategory === 'all'
              ? 'bg-brand-900 text-white border-brand-900'
              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
          }`}
        >
          All ({SYSTEM_MERGE_VARIABLES.length})
        </button>
        {CATEGORY_ORDER.map((cat) => {
          const count = SYSTEM_MERGE_VARIABLES.filter((v) => v.category === cat).length;
          return (
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
              {CATEGORY_LABELS[cat]} ({count})
            </button>
          );
        })}
      </div>

      {/* Variables grid */}
      <div className="space-y-6">
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
                  className="group relative flex flex-col gap-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-brand-400 hover:bg-brand-50/30 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-xs font-mono font-semibold text-brand-700 truncate">
                      {v.tag}
                    </code>
                    <span className="shrink-0 text-[10px] font-medium text-gray-400 group-hover:text-brand-600 transition">
                      {copiedTag === v.tag ? '✓ Copied' : 'Copy'}
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-500 leading-snug">{v.description}</p>
                  <p className="text-[11px] text-gray-400 italic truncate">e.g. {v.example}</p>
                  {/* "Where it works" badges */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {v.usedIn.map((ctx) => (
                      <span
                        key={ctx}
                        className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500 uppercase tracking-wide"
                      >
                        {ctx}
                      </span>
                    ))}
                  </div>
                  {/* Lock badge */}
                  <span className="absolute right-2 top-2 text-[9px] font-semibold text-gray-300 uppercase tracking-widest">
                    system
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

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
    <div className="mx-auto min-h-full max-w-4xl bg-white px-4 py-8">
      <Link
        href="/dashboard/marketing/analytics"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Marketing
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-pink-600 mb-1">
            <Link2 className="w-5 h-5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Marketing</span>
          </div>
          <h1 className="font-heading text-2xl text-gray-900">Trigger Links & Tags</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-xl">
            Each link gets a permanent short URL (<code className="text-xs bg-gray-100 px-1 rounded">/t/…</code>). You can
            change where it points anytime — the short code never changes, so emails and automations stay valid.{' '}
            <strong className="text-gray-700">Automatic attribution:</strong> open a lead in Leads and use &quot;Trigger
            links for this lead&quot; to copy a URL that already includes their{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">?t=TRACK_TOKEN</code>. Legacy{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">?l=LEAD_UUID</code> still works.
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
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
            >
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
                      <button
                        type="button"
                        onClick={() => copyShort(row)}
                        className="text-left text-xs font-medium text-pink-600 hover:text-pink-800 inline-flex items-center gap-1 w-fit"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedId === row.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell max-w-xs">
                    <a
                      href={row.target_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-gray-600 hover:text-gray-900 truncate inline-flex items-center gap-1 max-w-full"
                    >
                      <span className="truncate">{row.target_url}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{Number(row.click_count ?? 0)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-800"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(row.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Tags ───────────────────────────────────────────────────────────── */}
      <div className="mt-12 mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-violet-600 mb-1">
            <Tags className="w-5 h-5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Tags</span>
          </div>
          <p className="text-sm text-gray-500 max-w-xl">
            Tags appear on lead cards in Kanban and List views. Use them to segment leads now; later they can drive
            automations. Tags use your StoryVenue accent styling on the board.
          </p>
        </div>
        <button
          type="button"
          onClick={openTagCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-800"
        >
          <Plus className="h-4 w-4" /> New tag
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 overflow-hidden">
        {tagsLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading tags…
          </div>
        ) : tags.length === 0 ? (
          <div className="text-center py-14 px-4">
            <Tags className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-600 font-medium">No tags yet</p>
            <p className="text-sm text-gray-400 mt-1 mb-4">Create tags to label leads from the board or lead profile.</p>
            <button
              type="button"
              onClick={openTagCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
            >
              <Plus className="h-4 w-4" /> Create tag
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-200">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {tags.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openTagEdit(row)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-800"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTag(row.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-lg text-gray-400 hover:bg-gray-100"
            >
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
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  placeholder="Spring promo landing"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                  Destination URL
                </label>
                <input
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  placeholder="https://…"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || !formName.trim() || !formUrl.trim()}
                  onClick={() => void saveModal()}
                  className="rounded-xl bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : editRow ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6">
            <button
              type="button"
              onClick={() => setTagModalOpen(false)}
              className="absolute right-4 top-4 p-1 rounded-lg text-gray-400 hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="font-heading text-lg font-semibold text-gray-900 pr-8">
              {tagEdit ? 'Edit tag' : 'New tag'}
            </h2>
            <div className="space-y-4 mt-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Name</label>
                <input
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  placeholder="VIP tour"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTagModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={tagSaving || !tagName.trim()}
                  onClick={() => void saveTagModal()}
                  className="rounded-xl bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-40"
                >
                  {tagSaving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : tagEdit ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── System Variables ────────────────────────────────────────────── */}
      <SystemVariablesSection />
    </div>
  );
}
