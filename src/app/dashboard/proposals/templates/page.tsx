'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Plus, FileText, Pencil, Eye, X, PenLine, User, CalendarDays, Search, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface Field {
  id: string;
  field_type: 'signature' | 'name' | 'date';
  label: string;
  required: boolean;
}

interface Template {
  id: string;
  name: string;
  content: string;
  field_count: number;
  created_at: string;
  fields?: Field[];
}

const FIELD_ICON: Record<string, typeof PenLine> = {
  signature: PenLine,
  name: User,
  date: CalendarDays,
};

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [preview, setPreview]     = useState<Template | null>(null);

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(d => setTemplates(Array.isArray(d) ? d : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  // iMessage-style search: score by match position (earlier = higher score)
  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates
      .map(t => {
        const nameIdx    = t.name.toLowerCase().indexOf(q);
        const contentIdx = stripHtml(t.content).toLowerCase().indexOf(q);
        const score = nameIdx >= 0 ? nameIdx : contentIdx >= 0 ? 1000 + contentIdx : Infinity;
        return { t, score };
      })
      .filter(({ score }) => score < Infinity)
      .sort((a, b) => a.score - b.score)
      .map(({ t }) => t);
  }, [templates, search]);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proposal Templates</h1>
          <p className="mt-1 text-sm text-gray-500">Create and manage reusable contract templates</p>
        </div>
        <Link
          href="/dashboard/proposals/templates/new"
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shadow-sm"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          <Plus size={15} />
          Create Proposal Template
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-lg">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search templates by name or content..."
          className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-10 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors shadow-sm"
          style={{ fontSize: 16 }}
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Count */}
      {search && (
        <p className="text-sm text-gray-500 mb-4">
          {filtered.length === 0 ? 'No templates match your search' : `${filtered.length} template${filtered.length !== 1 ? 's' : ''} found`}
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 && !search ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-gray-200 bg-white">
          <FileText size={40} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-medium text-gray-500">No templates yet</p>
          <p className="text-xs text-gray-400 mt-1">Create your first proposal template to get started</p>
          <Link href="/dashboard/proposals/templates/new"
            className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shadow-sm"
            style={{ backgroundColor: '#1b1b1b' }}>
            <Plus size={14} /> Create Template
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => (
            <div key={t.id} className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col justify-between hover:shadow-md transition-shadow group">
              <div className="flex-1 min-w-0">
                {/* Highlight matching name */}
                <h3 className="text-sm font-bold text-gray-900 mb-1 truncate">
                  {search ? <HighlightText text={t.name} query={search} /> : t.name}
                </h3>
                <p className="text-xs text-gray-400 mb-2">{t.field_count} signing field{t.field_count !== 1 ? 's' : ''}</p>
                {/* Content snippet with highlight */}
                {t.content && (
                  <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                    {search ? <HighlightText text={stripHtml(t.content).slice(0, 120)} query={search} /> : stripHtml(t.content).slice(0, 120)}
                    {stripHtml(t.content).length > 120 ? '...' : ''}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-100">
                <span className="text-[11px] text-gray-400">{formatDate(t.created_at)}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPreview(t)}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <Eye size={12} /> Preview
                  </button>
                  <Link
                    href={`/dashboard/proposals/templates/${t.id}/edit`}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil size={12} /> Edit
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-8"
          onClick={e => { if (e.target === e.currentTarget) setPreview(null); }}>
          {/* Modal: fixed height, overflow-hidden clips content behind header */}
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
            {/* Header — never scrolls */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="text-base font-bold text-gray-900">{preview.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{preview.field_count} signing field{preview.field_count !== 1 ? 's' : ''} · Created {formatDate(preview.created_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/dashboard/proposals/templates/${preview.id}/edit`}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  <Pencil size={12} /> Edit
                </Link>
                <button onClick={() => setPreview(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>
            {/* Scrollable body — flex-1 ensures it fills remaining height */}
            <div className="flex-1 overflow-y-auto px-8 py-8">
              {preview.content ? (
                <>
                  <style>{`
                    .tmpl-preview h1{font-size:1.75rem;font-weight:700;margin-bottom:.75rem}
                    .tmpl-preview h2{font-size:1.35rem;font-weight:600;margin-bottom:.5rem}
                    .tmpl-preview h3{font-size:1.1rem;font-weight:600;margin-bottom:.4rem}
                    .tmpl-preview p{margin-bottom:.75rem;line-height:1.7;color:#374151}
                    .tmpl-preview ul{list-style:disc;padding-left:1.5rem;margin-bottom:.75rem}
                    .tmpl-preview ol{list-style:decimal;padding-left:1.5rem;margin-bottom:.75rem}
                    .tmpl-preview li{margin-bottom:.25rem;line-height:1.6}
                    .tmpl-preview table{width:100%;border-collapse:collapse;margin-bottom:1rem}
                    .tmpl-preview th{background:#1b1b1b;color:white;padding:8px 12px;text-align:left;font-weight:600}
                    .tmpl-preview td{padding:8px 12px;border:1px solid #e5e7eb}
                    .tmpl-preview blockquote{border-left:3px solid #1b1b1b;padding-left:1rem;color:#4b5563;font-style:italic;margin:1rem 0}
                  `}</style>
                  <div className="tmpl-preview" dangerouslySetInnerHTML={{ __html: preview.content }} />
                </>
              ) : (
                <div className="py-12 text-center text-gray-400">
                  <FileText size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No content yet. Edit this template to add content.</p>
                </div>
              )}
              {/* Signing fields */}
              {preview.field_count > 0 && (
                <div className="mt-10 pt-8 border-t-2 border-dashed border-gray-200">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Signing Fields</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {(['signature','name','date'] as const).slice(0, preview.field_count).map((type, i) => {
                      const Icon = FIELD_ICON[type];
                      return (
                        <div key={i} className="flex flex-col gap-1">
                          <div className="h-12 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center">
                            <Icon size={16} className="text-gray-300" />
                          </div>
                          <p className="text-[10px] text-center text-gray-400 capitalize">{type === 'name' ? 'Printed Name' : type}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Highlight matching text
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="bg-yellow-100 text-yellow-900 rounded px-0.5">{part}</mark> : part
      )}
    </>
  );
}
