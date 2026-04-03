'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, FileText, Pencil, Eye, X, PenLine, User, CalendarDays } from 'lucide-react';
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

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Template | null>(null);

  useEffect(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">Templates</h1>
        <Link
          href="/dashboard/proposals/templates/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <Plus size={16} />
          Create Template
        </Link>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="py-16 text-center">
          <FileText size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">No templates yet. Create your first proposal template to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                <h3 className="font-heading text-lg font-semibold text-gray-900 mb-2">
                  {t.name}
                </h3>
                <p className="text-xs text-gray-400">
                  {t.field_count} signing field{t.field_count !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">{formatDate(t.created_at)}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreview(t)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <Eye size={12} />
                    Preview
                  </button>
                  <Link
                    href={`/dashboard/proposals/templates/${t.id}/edit`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil size={12} />
                    Edit
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}
        >
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="font-heading text-lg font-semibold text-gray-900">{preview.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {preview.field_count} signing field{preview.field_count !== 1 ? 's' : ''} · Created {formatDate(preview.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/proposals/templates/${preview.id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Pencil size={12} />
                  Edit
                </Link>
                <button
                  onClick={() => setPreview(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Document body */}
            <div className="px-16 py-10 overflow-y-auto">
              {preview.content ? (
                <>
                  <style>{`
                    .template-preview h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.75rem; font-family: 'Playfair Display', Georgia, serif; }
                    .template-preview h2 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.6rem; }
                    .template-preview h3 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
                    .template-preview h4 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.4rem; }
                    .template-preview p { margin-bottom: 0.75rem; line-height: 1.7; color: #1f2937; }
                    .template-preview ul { list-style: disc; padding-left: 1.5rem; margin-bottom: 0.75rem; }
                    .template-preview ol { list-style: decimal; padding-left: 1.5rem; margin-bottom: 0.75rem; }
                    .template-preview li { margin-bottom: 0.25rem; line-height: 1.6; }
                    .template-preview blockquote { border-left: 3px solid #293745; padding-left: 1rem; color: #4b5563; font-style: italic; margin: 1rem 0; }
                    .template-preview hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
                    .template-preview a { color: #293745; text-decoration: underline; }
                    .template-preview code { background: #f1f5f9; border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.875em; font-family: monospace; }
                    .template-preview pre { background: #1e293b; color: #e2e8f0; border-radius: 8px; padding: 1rem; overflow-x: auto; margin-bottom: 0.75rem; }
                    .template-preview pre code { background: none; padding: 0; }
                    .template-preview img { max-width: 100%; border-radius: 6px; margin: 0.5rem 0; }
                    .template-preview table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
                    .template-preview th { background: #293745; color: white; font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid #293745; }
                    .template-preview td { padding: 8px 12px; border: 1px solid #e5e7eb; vertical-align: top; }
                    .template-preview tr:nth-child(even) td { background: #f9fafb; }
                    .template-preview mark { border-radius: 2px; padding: 0.1em 0.2em; }
                  `}</style>
                  <div
                    className="template-preview"
                    dangerouslySetInnerHTML={{ __html: preview.content }}
                  />
                </>
              ) : (
                <div className="py-16 text-center text-gray-400">
                  <FileText size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No content yet. Edit this template to add content.</p>
                </div>
              )}

              {/* Signing fields preview */}
              {preview.field_count > 0 && (
                <div className="mt-10 pt-8 border-t-2 border-dashed border-gray-200">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Signing Fields</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {(['signature', 'name', 'date'] as const)
                      .filter(() => true)
                      .slice(0, preview.field_count)
                      .map((type, i) => {
                        const Icon = FIELD_ICON[type];
                        const labels: Record<string, string> = { signature: 'Client Signature', name: 'Printed Name', date: 'Date' };
                        return (
                          <div key={i} className="flex flex-col gap-1">
                            <div className="h-12 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                              <Icon size={16} className="text-gray-300" />
                            </div>
                            <p className="text-xs text-center text-gray-400">{labels[type]}</p>
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
