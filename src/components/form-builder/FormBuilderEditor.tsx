'use client';

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Copy,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import RichTextEditor from '@/components/RichTextEditor';
import { MarketingFormView } from '@/components/marketing-form/MarketingFormView';
import {
  type FormBlock,
  type FormBlockType,
  type MarketingFormDefinition,
  createBlock,
  mergeTheme,
} from '@/lib/marketing-form-schema';

const APP_ORIGIN =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '')
    : (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

const PALETTE: { type: FormBlockType; label: string }[] = [
  { type: 'heading', label: 'Heading' },
  { type: 'rich_text', label: 'Rich text' },
  { type: 'first_name', label: 'First name' },
  { type: 'last_name', label: 'Last name' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
  { type: 'url', label: 'Website URL' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'address', label: 'Address' },
  { type: 'image', label: 'Image' },
  { type: 'file', label: 'File upload' },
  { type: 'radio', label: 'Radio' },
  { type: 'select', label: 'Dropdown' },
  { type: 'checkbox_group', label: 'Checkboxes' },
  { type: 'submit', label: 'Submit' },
  { type: 'button', label: 'Button' },
  { type: 'html', label: 'HTML' },
];

function blockSummary(block: FormBlock): string {
  switch (block.type) {
    case 'heading':
      return `H${block.level ?? 2}: ${(block.content || '').slice(0, 40) || '…'}`;
    case 'rich_text':
      return 'Rich text';
    case 'submit':
      return `Submit: ${block.buttonLabel || 'Submit'}`;
    case 'button':
      return `Button: ${block.buttonLabel || 'Button'}`;
    case 'image':
      return block.src ? `Image: ${block.src.slice(0, 30)}…` : 'Image';
    case 'html':
      return 'Custom HTML';
    default:
      return block.label || block.type.replace(/_/g, ' ');
  }
}

function SortableRow({
  block,
  selected,
  onSelect,
  onRemove,
}: {
  block: FormBlock;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-stretch gap-1 rounded-lg border bg-white shadow-sm ${
        selected ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        className="flex touch-none items-center px-1.5 text-gray-400 hover:text-gray-700"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 px-2 py-2.5 text-left text-sm"
        onClick={() => onSelect(block.id)}
      >
        <span className="font-medium capitalize text-gray-900">
          {block.type.replace(/_/g, ' ')}
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">{blockSummary(block)}</span>
      </button>
      <button
        type="button"
        className="px-2 text-gray-400 hover:text-red-600"
        title="Remove block"
        onClick={() => onRemove(block.id)}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function patchBlock(blocks: FormBlock[], id: string, patch: Partial<FormBlock>): FormBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
}

function BlockInspector({
  block,
  onChange,
}: {
  block: FormBlock;
  onChange: (patch: Partial<FormBlock>) => void;
}) {
  const optsText = (block.options || []).join('\n');

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Block type</label>
        <p className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5 capitalize text-gray-800">
          {block.type.replace(/_/g, ' ')}
        </p>
      </div>

      {(block.type === 'first_name' ||
        block.type === 'last_name' ||
        block.type === 'email' ||
        block.type === 'phone' ||
        block.type === 'url' ||
        block.type === 'number' ||
        block.type === 'date' ||
        block.type === 'address' ||
        block.type === 'file' ||
        block.type === 'radio' ||
        block.type === 'select' ||
        block.type === 'checkbox_group') && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Label</label>
            <input
              className="w-full rounded border border-gray-200 px-2 py-1.5"
              value={block.label ?? ''}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </div>
          {block.type !== 'date' && block.type !== 'file' && block.type !== 'radio' && block.type !== 'checkbox_group' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Placeholder</label>
              <input
                className="w-full rounded border border-gray-200 px-2 py-1.5"
                value={block.placeholder ?? ''}
                onChange={(e) => onChange({ placeholder: e.target.value })}
              />
            </div>
          ) : null}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!block.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            <span>Required</span>
          </label>
        </>
      )}

      {block.type === 'heading' && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Level</label>
            <select
              className="w-full rounded border border-gray-200 px-2 py-1.5"
              value={block.level ?? 2}
              onChange={(e) => onChange({ level: Number(e.target.value) as FormBlock['level'] })}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  H{n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Text</label>
            <input
              className="w-full rounded border border-gray-200 px-2 py-1.5"
              value={block.content ?? ''}
              onChange={(e) => onChange({ content: e.target.value })}
            />
          </div>
        </>
      )}

      {block.type === 'rich_text' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Content</label>
          <RichTextEditor
            content={block.content || '<p></p>'}
            onChange={(html: string) => onChange({ content: html })}
            minHeight={160}
          />
        </div>
      )}

      {block.type === 'html' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">HTML (sanitized on display)</label>
          <textarea
            className="h-40 w-full rounded border border-gray-200 px-2 py-1.5 font-mono text-xs"
            value={block.content ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
          />
        </div>
      )}

      {(block.type === 'radio' || block.type === 'select' || block.type === 'checkbox_group') && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Options (one per line)</label>
          <textarea
            className="h-32 w-full rounded border border-gray-200 px-2 py-1.5"
            value={optsText}
            onChange={(e) =>
              onChange({
                options: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
              })
            }
          />
        </div>
      )}

      {block.type === 'image' && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Image URL</label>
            <input
              className="w-full rounded border border-gray-200 px-2 py-1.5"
              value={block.src ?? ''}
              onChange={(e) => onChange({ src: e.target.value })}
              placeholder="https://"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Alt text</label>
            <input
              className="w-full rounded border border-gray-200 px-2 py-1.5"
              value={block.alt ?? ''}
              onChange={(e) => onChange({ alt: e.target.value })}
            />
          </div>
        </>
      )}

      {(block.type === 'submit' || block.type === 'button') && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Label</label>
            <input
              className="w-full rounded border border-gray-200 px-2 py-1.5"
              value={block.buttonLabel ?? ''}
              onChange={(e) => onChange({ buttonLabel: e.target.value })}
            />
          </div>
          {block.type === 'button' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Link (https)</label>
                <input
                  className="w-full rounded border border-gray-200 px-2 py-1.5"
                  value={block.href ?? ''}
                  onChange={(e) => onChange({ href: e.target.value })}
                  placeholder="https://"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Style</label>
                <select
                  className="w-full rounded border border-gray-200 px-2 py-1.5"
                  value={block.buttonVariant ?? 'secondary'}
                  onChange={(e) =>
                    onChange({
                      buttonVariant: e.target.value as FormBlock['buttonVariant'],
                    })
                  }
                >
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                  <option value="outline">Outline</option>
                  <option value="link">Link</option>
                </select>
              </div>
            </>
          )}
        </>
      )}

      {(block.type === 'first_name' ||
        block.type === 'last_name' ||
        block.type === 'email' ||
        block.type === 'phone' ||
        block.type === 'url' ||
        block.type === 'number' ||
        block.type === 'date' ||
        block.type === 'address' ||
        block.type === 'file') && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Hint (optional)</label>
          <input
            className="w-full rounded border border-gray-200 px-2 py-1.5"
            value={block.hint ?? ''}
            onChange={(e) => onChange({ hint: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

function ThemeInspector({
  theme,
  onChange,
}: {
  theme: ReturnType<typeof mergeTheme>;
  onChange: (t: MarketingFormDefinition['theme']) => void;
}) {
  const row = (key: keyof ReturnType<typeof mergeTheme>, label: string) => (
    <div key={key}>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      <input
        className="w-full rounded border border-gray-200 px-2 py-1.5"
        value={theme[key]}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {row('maxWidth', 'Max width (e.g. 520px)')}
      {row('primaryColor', 'Primary / button color')}
      {row('background', 'Page background')}
      {row('surface', 'Card background')}
      {row('fontFamily', 'Font stack (CSS)')}
      {row('borderRadius', 'Corner radius')}
      {row('labelColor', 'Label color')}
      {row('inputBorder', 'Field border color')}
      {row('mutedColor', 'Hint / muted text')}
    </div>
  );
}

export function FormBuilderEditor({
  formId,
  initialName,
  initialPublished,
  initialDefinition,
  embedToken,
}: {
  formId: string;
  initialName: string;
  initialPublished: boolean;
  initialDefinition: MarketingFormDefinition;
  embedToken: string;
}) {
  const [name, setName] = useState(initialName);
  const [published, setPublished] = useState(initialPublished);
  const [definition, setDefinition] = useState<MarketingFormDefinition>(initialDefinition);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialDefinition.blocks[0]?.id ?? null
  );
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selected = useMemo(
    () => definition.blocks.find((b) => b.id === selectedId) ?? null,
    [definition.blocks, selectedId]
  );

  const mergedTheme = useMemo(() => mergeTheme(definition.theme), [definition.theme]);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setDefinition((d) => {
        const ids = d.blocks.map((b) => b.id);
        const oldIndex = ids.indexOf(String(active.id));
        const newIndex = ids.indexOf(String(over.id));
        if (oldIndex < 0 || newIndex < 0) return d;
        return { ...d, blocks: arrayMove(d.blocks, oldIndex, newIndex) };
      });
    },
    []
  );

  const addBlock = useCallback((type: FormBlockType) => {
    const nb = createBlock(type);
    setDefinition((d) => ({ ...d, blocks: [...d.blocks, nb] }));
    setSelectedId(nb.id);
  }, []);

  const removeBlock = useCallback((id: string) => {
    setDefinition((d) => {
      const blocks = d.blocks.filter((b) => b.id !== id);
      return { ...d, blocks };
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const patchSelected = useCallback(
    (patch: Partial<FormBlock>) => {
      if (!selectedId) return;
      setDefinition((d) => ({ ...d, blocks: patchBlock(d.blocks, selectedId, patch) }));
    },
    [selectedId]
  );

  const patchTheme = useCallback((t: MarketingFormDefinition['theme']) => {
    setDefinition((d) => ({ ...d, theme: { ...d.theme, ...t } }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch(`/api/marketing/forms/${formId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        published,
        definition,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveMsg(j.error || 'Save failed');
      return;
    }
    setSaveMsg('Saved');
    setTimeout(() => setSaveMsg(null), 2000);
  }, [formId, name, published, definition]);

  const embedUrl = `${APP_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')}/embed/form/${embedToken}`;
  const iframeSnippet = `<iframe src="${embedUrl}" title="${name.replace(/"/g, '&quot;')}" style="width:100%;min-height:520px;border:0;border-radius:12px;" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(iframeSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <Link
            href="/dashboard/marketing/form-builder"
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} />
            Forms
          </Link>
          <input
            className="min-w-[12rem] flex-1 rounded border border-gray-200 px-3 py-1.5 text-base font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Published
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save
          </button>
          {saveMsg ? <span className="text-sm text-gray-600">{saveMsg}</span> : null}
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 pt-4 lg:grid-cols-[220px_1fr_300px]">
        <aside className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Blocks</h2>
          <p className="mb-2 text-xs text-gray-500">Click to add. Drag rows to reorder.</p>
          <div className="flex flex-col gap-1">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                onClick={() => addBlock(p.type)}
                className="flex items-center gap-2 rounded-md border border-gray-100 px-2 py-1.5 text-left text-sm text-gray-800 hover:border-brand-200 hover:bg-brand-50"
              >
                <Plus size={14} className="text-brand-600" />
                {p.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Form canvas</h2>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={definition.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
                  {definition.blocks.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-500">
                      Add blocks from the left panel.
                    </p>
                  ) : (
                    definition.blocks.map((b) => (
                      <SortableRow
                        key={b.id}
                        block={b}
                        selected={b.id === selectedId}
                        onSelect={setSelectedId}
                        onRemove={removeBlock}
                      />
                    ))
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Live preview</h2>
            <div className="max-h-[480px] overflow-y-auto rounded-lg border border-dashed border-gray-200 bg-gray-50 p-2">
              <MarketingFormView
                definition={definition}
                embedToken={embedToken}
                preview
                formTitle={name}
                onPreviewSubmit={() => setSaveMsg('Preview only — not submitted')}
              />
            </div>
          </div>
        </section>

        <aside className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Embed</h2>
            <p className="mb-2 text-xs text-gray-600">
              Paste this iframe on any site. Styling is controlled by the theme below so it stays on-brand.
            </p>
            <p className="mb-1 text-xs font-medium text-gray-500">Public URL</p>
            <code className="mb-2 block break-all rounded bg-gray-50 p-2 text-[11px] text-gray-800">{embedUrl}</code>
            <button
              type="button"
              onClick={() => void copyEmbed()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2 text-sm font-medium hover:bg-gray-50"
            >
              <Copy size={16} />
              {copied ? 'Copied' : 'Copy iframe HTML'}
            </button>
            <textarea
              readOnly
              className="mt-2 h-24 w-full resize-none rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px]"
              value={iframeSnippet}
            />
            {!published ? (
              <p className="mt-2 text-xs text-amber-700">Publish the form so the embed URL works for visitors.</p>
            ) : null}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Theme</h2>
            <ThemeInspector theme={mergedTheme} onChange={patchTheme} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Block settings</h2>
            {selected ? (
              <BlockInspector block={selected} onChange={patchSelected} />
            ) : (
              <p className="text-sm text-gray-500">Select a block on the canvas.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
