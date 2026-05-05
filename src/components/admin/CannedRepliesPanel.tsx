'use client';

/**
 * Canned Replies admin panel — manage the support_canned_replies table.
 *
 * Super admin (or support_admin role) can: list, create, edit, delete, and
 * preview templates with placeholder bride/venue values. Other support agents
 * can view them via the picker but not edit (that's enforced server-side).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, Pencil, Trash2, Save, X, Loader2, AlertCircle,
  CheckCircle2, FileText, Tag, Eye,
} from 'lucide-react';
import { previewCannedReply, CANNED_REPLY_VARIABLES } from '@/lib/support/canned-replies';

const BRAND = '#1b1b1b';

type Scope = 'admin' | 'venue' | 'both';
type Channel = 'sms' | 'email';

interface Template {
  id:        string;
  title:     string;
  body:      string;
  scope:     Scope;
  shortcut?: string | null;
  category?: string | null;
  channels:  Channel[];
  use_count: number;
  updated_at: string;
}

const SCOPE_LABEL: Record<Scope, string> = {
  admin: 'Admin only',
  venue: 'Venue only',
  both:  'Admin + Venue',
};

const SCOPE_PILL: Record<Scope, string> = {
  admin: 'bg-violet-100 text-violet-800 border-violet-200',
  venue: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  both:  'bg-blue-100 text-blue-800 border-blue-200',
};

const EMPTY_DRAFT: Omit<Template, 'id' | 'use_count' | 'updated_at'> = {
  title:    '',
  body:     '',
  scope:    'both',
  shortcut: '',
  category: '',
  channels: ['sms', 'email'],
};

export function CannedRepliesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [search,    setSearch]    = useState('');
  const [editing,   setEditing]   = useState<Template | typeof EMPTY_DRAFT | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/support/canned-replies', { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as { templates: Template[] };
      setTemplates(d.templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      (t.shortcut || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q),
    );
  }, [templates, search]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isNew = !('id' in editing);
      const url = isNew
        ? '/api/admin/support/canned-replies'
        : `/api/admin/support/canned-replies/${(editing as Template).id}`;
      const method = isNew ? 'POST' : 'PATCH';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:    editing.title.trim(),
          body:     editing.body.trim(),
          scope:    editing.scope,
          shortcut: editing.shortcut?.trim() || null,
          category: editing.category?.trim() || null,
          channels: editing.channels,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Save failed');
      await load();
      setEditing(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function del(id: string) {
    try {
      const r = await fetch(`/api/admin/support/canned-replies/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Delete failed');
      }
      await load();
      setConfirmDelete(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl text-gray-900">Saved replies</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Reusable message templates with merge variables. Pickable from the support inbox + venue conversations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing({ ...EMPTY_DRAFT })}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
            style={{ backgroundColor: BRAND }}
          >
            <Plus size={12} /> New template
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-gray-200 bg-white p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates by title, body, shortcut, category…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300"
          />
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-gray-200 bg-white">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}
        {error && (
          <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={14} className="inline mr-1.5" /> {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="py-16 text-center text-sm text-gray-400">
            <FileText size={28} className="mx-auto mb-2 text-gray-300" />
            {templates.length === 0 ? 'No templates yet. Click "New template" to create one.' : 'No templates match your search.'}
          </div>
        )}
        {filtered.map(tpl => (
          <div key={tpl.id} className="border-b border-gray-100 last:border-b-0 px-4 py-3 hover:bg-gray-50/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="text-sm font-semibold text-gray-900">{tpl.title}</h3>
                  {tpl.shortcut && (
                    <span className="rounded bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-mono font-semibold">
                      {tpl.shortcut}
                    </span>
                  )}
                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SCOPE_PILL[tpl.scope]}`}>
                    {SCOPE_LABEL[tpl.scope]}
                  </span>
                  {tpl.category && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      <Tag size={9} /> {tpl.category}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">{tpl.use_count}× used</span>
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{tpl.body}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditing(tpl)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(tpl.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-700"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Editor modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h3 className="font-semibold text-gray-900">
                {'id' in editing ? 'Edit template' : 'New template'}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {saveError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
                  <AlertCircle size={14} /> {saveError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Title</label>
                  <input
                    value={editing.title}
                    onChange={e => setEditing(prev => prev ? { ...prev, title: e.target.value } : prev)}
                    placeholder="e.g. Tour invite"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Shortcut</label>
                  <input
                    value={editing.shortcut || ''}
                    onChange={e => setEditing(prev => prev ? { ...prev, shortcut: e.target.value } : prev)}
                    placeholder="/tour"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Visibility</label>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                    {(['admin', 'venue', 'both'] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setEditing(prev => prev ? { ...prev, scope: s } : prev)}
                        className={`flex-1 px-2.5 py-1.5 font-medium transition-colors ${
                          editing.scope === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {SCOPE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Channels</label>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                    {(['sms', 'email'] as const).map(c => {
                      const active = editing.channels.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditing(prev => {
                            if (!prev) return prev;
                            const has = prev.channels.includes(c);
                            const next: Channel[] = has
                              ? prev.channels.filter(x => x !== c)
                              : [...prev.channels, c];
                            // Don't allow zero channels
                            return next.length === 0 ? prev : { ...prev, channels: next };
                          })}
                          className={`flex-1 px-2.5 py-1.5 font-medium transition-colors uppercase ${
                            active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Category (optional)</label>
                <input
                  value={editing.category || ''}
                  onChange={e => setEditing(prev => prev ? { ...prev, category: e.target.value } : prev)}
                  placeholder="e.g. tour, pricing, follow_up"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Body</label>
                <textarea
                  value={editing.body}
                  onChange={e => setEditing(prev => prev ? { ...prev, body: e.target.value } : prev)}
                  rows={5}
                  placeholder="Hi {{bride_first_name}}! Thanks for reaching out about {{venue_name}}…"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand-900/10 focus:border-gray-300 font-mono"
                />
              </div>

              <details className="rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <Tag size={11} /> Available merge variables
                </summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2 text-[11px]">
                  {CANNED_REPLY_VARIABLES.map(v => (
                    <button
                      key={v.token}
                      type="button"
                      onClick={() => setEditing(prev => prev ? { ...prev, body: prev.body + v.token } : prev)}
                      className="text-left rounded-md border border-gray-200 bg-white hover:bg-violet-50 hover:border-violet-200 px-2 py-1.5 transition-colors"
                    >
                      <span className="font-mono font-semibold text-violet-700">{v.token}</span>
                      <span className="block text-[10px] text-gray-500 mt-0.5">{v.description}</span>
                    </button>
                  ))}
                </div>
              </details>

              {editing.body.trim() && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    <Eye size={10} /> Preview (using sample bride / venue)
                  </div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">
                    {previewCannedReply(editing.body).body}
                  </p>
                  {previewCannedReply(editing.body).unknown.length > 0 && (
                    <p className="text-[10px] text-amber-700 mt-2">
                      Unknown tokens: {previewCannedReply(editing.body).unknown.map(u => `{{${u}}}`).join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 bg-gray-50/50">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-sm text-gray-600 hover:text-gray-900 font-medium px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !editing.title.trim() || !editing.body.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: BRAND }}
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete this template?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This permanently removes the template. Anyone using it in the picker will no longer see it.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="text-sm text-gray-600 hover:text-gray-900 font-medium px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => del(confirmDelete)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Suppress unused-import warning for CheckCircle2 (reserved for future "saved!" toast)
void CheckCircle2;
