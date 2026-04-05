'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, GripVertical, PenLine, User, CalendarDays, Sparkles } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });
const AIProposalGenerator = dynamic(() => import('@/components/AIProposalGenerator'), { ssr: false });

interface Field {
  id: string;
  field_type: 'signature' | 'name' | 'date';
  label: string;
  required: boolean;
}

const fieldTypeIcon: Record<string, typeof PenLine> = {
  signature: PenLine,
  name: User,
  date: CalendarDays,
};

const fieldTypeLabel: Record<string, string> = {
  signature: 'Signature',
  name: 'Full Name',
  date: 'Date',
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const DEFAULT_FIELDS: Field[] = [
  { id: uid(), field_type: 'signature', label: 'Client Signature', required: true },
  { id: uid(), field_type: 'name', label: 'Printed Name', required: true },
  { id: uid(), field_type: 'date', label: 'Date', required: true },
];

export default function NewTemplatePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [fields, setFields] = useState<Field[]>(DEFAULT_FIELDS);
  const [showAI, setShowAI] = useState(false);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);

  function addField(type: Field['field_type']) {
    setFields((prev) => [
      ...prev,
      { id: uid(), field_type: type, label: fieldTypeLabel[type], required: true },
    ]);
    setFieldMenuOpen(false);
  }

  function updateField(id: string, updates: Partial<Field>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  function moveField(idx: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);

    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          content,
          fields: fields.map((f, i) => ({
            field_type: f.field_type,
            label: f.label,
            required: f.required,
            sort_order: i,
          })),
        }),
      });

      if (res.ok) {
        router.push('/dashboard/proposals/templates');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <Link
        href="/dashboard/proposals/templates"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Templates
      </Link>
      <h1 className="font-heading text-2xl font-semibold text-gray-900 mb-8">Create Template</h1>

      <div className="space-y-8">
        {/* Template Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Template Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Premium Wedding Package"
            className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
          />
        </div>

        {/* WYSIWYG Content */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">Contract Content</label>
            <button
              type="button"
              onClick={() => setShowAI(true)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 shadow-sm"
              style={{ backgroundColor: '#293745' }}
            >
              <Sparkles size={13} />
              Generate with AI
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            Write your proposal manually or let AI draft it for you in seconds.
          </p>
          <RichTextEditor
            content={content}
            onChange={setContent}
            placeholder="Start writing your contract terms, packages, inclusions, policies..."
            minHeight={600}
          />
        </div>

        {/* Signature Fields */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Signing Fields</label>
              <p className="text-xs text-gray-400 mt-0.5">
                These fields appear at the bottom of the proposal for the customer to fill in when signing.
              </p>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setFieldMenuOpen(!fieldMenuOpen)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Plus size={12} />
                Add Field
              </button>
              {fieldMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-10 w-40 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                  {(['signature', 'name', 'date'] as const).map((type) => {
                    const Icon = fieldTypeIcon[type];
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => addField(type)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Icon size={14} className="text-gray-400" />
                        {fieldTypeLabel[type]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {fields.map((field, idx) => {
              const Icon = fieldTypeIcon[field.field_type];
              return (
                <div
                  key={field.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveField(idx, -1)}
                      disabled={idx === 0}
                      className="text-gray-300 hover:text-gray-500 disabled:opacity-30"
                    >
                      <GripVertical size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(idx, 1)}
                      disabled={idx === fields.length - 1}
                      className="text-gray-300 hover:text-gray-500 disabled:opacity-30"
                    >
                      <GripVertical size={14} />
                    </button>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
                    <Icon size={14} className="text-gray-500" />
                  </div>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(field.id, { label: e.target.value })}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
                  />
                  <span className="text-xs text-gray-400 capitalize">{field.field_type}</span>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => updateField(field.id, { required: e.target.checked })}
                      className="rounded border-gray-300 text-brand-900 focus:ring-brand-900/20"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(field.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Save */}
        <div className="pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-brand-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>

      {showAI && (
        <AIProposalGenerator
          onGenerated={(html) => { setContent(html); setShowAI(false); }}
          onClose={() => setShowAI(false)}
        />
      )}
    </div>
  );
}
