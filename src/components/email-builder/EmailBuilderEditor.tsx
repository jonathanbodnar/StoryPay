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
import { ArrowLeft, GripVertical, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import RichTextEditor from '@/components/RichTextEditor';
import {
  type EmailBlock,
  type EmailBlockType,
  type MarketingEmailDefinition,
  createEmailBlock,
  mergeEmailTheme,
  type EmailTheme,
} from '@/lib/marketing-email-schema';
import { renderMarketingEmailHtml } from '@/lib/marketing-email-render';

const PREVIEW_VARS = {
  first_name: 'Alex',
  last_name: 'Rivera',
  email: 'alex@example.com',
  venue_name: 'Your venue',
  unsubscribe_url: '#unsubscribe-preview',
};

const PALETTE: { type: EmailBlockType; label: string }[] = [
  { type: 'heading', label: 'Heading' },
  { type: 'text', label: 'Text' },
  { type: 'button', label: 'Button' },
  { type: 'image', label: 'Image' },
  { type: 'divider', label: 'Divider' },
  { type: 'spacer', label: 'Spacer' },
  { type: 'html', label: 'HTML' },
  { type: 'columns', label: 'Two columns' },
];

const NEST_TYPES: EmailBlockType[] = ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'html'];

function findBlock(blocks: EmailBlock[], id: string): EmailBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.type === 'columns') {
      const L = findBlock(b.left ?? [], id);
      if (L) return L;
      const R = findBlock(b.right ?? [], id);
      if (R) return R;
    }
  }
  return null;
}

function patchBlockAny(blocks: EmailBlock[], id: string, patch: Partial<EmailBlock>): EmailBlock[] {
  return blocks.map((b) => {
    if (b.id === id) return { ...b, ...patch } as EmailBlock;
    if (b.type === 'columns') {
      return {
        ...b,
        left: patchBlockAny(b.left ?? [], id, patch),
        right: patchBlockAny(b.right ?? [], id, patch),
      };
    }
    return b;
  });
}

function removeBlockAny(blocks: EmailBlock[], id: string): EmailBlock[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) => {
      if (b.type === 'columns') {
        return { ...b, left: removeBlockAny(b.left ?? [], id), right: removeBlockAny(b.right ?? [], id) };
      }
      return b;
    });
}

function insertInColumn(blocks: EmailBlock[], columnId: string, side: 'left' | 'right', block: EmailBlock): EmailBlock[] {
  return blocks.map((b) => {
    if (b.id === columnId && b.type === 'columns') {
      const key = side;
      return { ...b, [key]: [...(b[key] ?? []), block] };
    }
    if (b.type === 'columns') {
      return {
        ...b,
        left: insertInColumn(b.left ?? [], columnId, side, block),
        right: insertInColumn(b.right ?? [], columnId, side, block),
      };
    }
    return b;
  });
}

function removeChildFromColumn(
  blocks: EmailBlock[],
  columnId: string,
  side: 'left' | 'right',
  childId: string,
): EmailBlock[] {
  return blocks.map((b) => {
    if (b.id === columnId && b.type === 'columns') {
      const key = side;
      return { ...b, [key]: (b[key] ?? []).filter((x) => x.id !== childId) };
    }
    if (b.type === 'columns') {
      return {
        ...b,
        left: removeChildFromColumn(b.left ?? [], columnId, side, childId),
        right: removeChildFromColumn(b.right ?? [], columnId, side, childId),
      };
    }
    return b;
  });
}

function blockSummary(b: EmailBlock): string {
  switch (b.type) {
    case 'heading':
      return (b.content || '').replace(/<[^>]+>/g, '').slice(0, 48) || '…';
    case 'text':
    case 'html':
      return 'Rich / HTML';
    case 'button':
      return b.buttonLabel || 'Button';
    case 'image':
      return b.src ? b.src.slice(0, 40) : 'No URL';
    case 'columns':
      return `${(b.left ?? []).length} left · ${(b.right ?? []).length} right`;
    default:
      return b.type;
  }
}

function SortableRow({
  block,
  selected,
  onSelect,
  onRemove,
}: {
  block: EmailBlock;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
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
        title="Drag"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>
      <button type="button" className="min-w-0 flex-1 px-2 py-2.5 text-left text-sm" onClick={() => onSelect(block.id)}>
        <span className="font-medium capitalize text-gray-900">{block.type.replace(/_/g, ' ')}</span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">{blockSummary(block)}</span>
      </button>
      <button
        type="button"
        className="px-2 text-gray-400 hover:text-red-600"
        title="Remove"
        onClick={() => onRemove(block.id)}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function ThemeFields({ theme, onChange }: { theme: ReturnType<typeof mergeEmailTheme>; onChange: (t: Partial<EmailTheme>) => void }) {
  const row = (label: string, key: keyof EmailTheme, value: string) => (
    <div key={key}>
      <label className="mb-1 block text-xs font-medium text-gray-500">{label}</label>
      <input
        className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="grid gap-3 text-sm">
      {row('Page background', 'pageBg', theme.pageBg)}
      {row('Card background', 'cardBg', theme.cardBg)}
      {row('Text color', 'textColor', theme.textColor)}
      {row('Muted color', 'mutedColor', theme.mutedColor)}
      {row('Button background', 'buttonBg', theme.buttonBg)}
      {row('Button text', 'buttonText', theme.buttonText)}
      {row('Max width', 'maxWidth', theme.maxWidth)}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">Font stack</label>
        <input
          className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
          value={theme.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        />
      </div>
    </div>
  );
}

function BlockInspector({
  block,
  onChange,
  onAddToColumn,
  onRemoveNested,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
  onAddToColumn: (columnId: string, side: 'left' | 'right', type: EmailBlockType) => void;
  onRemoveNested: (columnId: string, side: 'left' | 'right', childId: string) => void;
}) {
  const alignPick = (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500">Align</label>
      <select
        className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
        value={block.align ?? 'left'}
        onChange={(e) => onChange({ align: e.target.value as EmailBlock['align'] })}
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
    </div>
  );

  if (block.type === 'columns') {
    const colSection = (side: 'left' | 'right', label: string) => (
      <div key={side} className="rounded border border-gray-100 bg-gray-50 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700">{label}</span>
          <select
            className="max-w-[140px] rounded border border-gray-200 px-1 py-0.5 text-xs"
            defaultValue=""
            onChange={(e) => {
              const t = e.target.value as EmailBlockType;
              e.target.value = '';
              if (t) onAddToColumn(block.id, side, t);
            }}
          >
            <option value="">+ Add…</option>
            {NEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <ul className="space-y-1">
          {(block[side] ?? []).map((ch) => (
            <li key={ch.id} className="flex items-center justify-between gap-1 rounded bg-white px-2 py-1 text-xs">
              <span className="truncate capitalize">{ch.type}</span>
              <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => onRemoveNested(block.id, side, ch.id)}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-600">Two-column row for email clients. Add blocks to each side.</p>
        {colSection('left', 'Left column')}
        {colSection('right', 'Right column')}
      </div>
    );
  }

  if (block.type === 'heading') {
    return (
      <div className="space-y-3 text-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Text (plain)</label>
          <input
            className="w-full rounded border border-gray-200 px-2 py-1.5"
            value={(block.content || '').replace(/<[^>]+>/g, '')}
            onChange={(e) => onChange({ content: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Level</label>
          <select
            className="w-full rounded border border-gray-200 px-2 py-1.5"
            value={block.level ?? 2}
            onChange={(e) => onChange({ level: Number(e.target.value) as 1 | 2 | 3 })}
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
        </div>
        {alignPick}
      </div>
    );
  }

  if (block.type === 'text' || block.type === 'html') {
    return (
      <div className="space-y-3 text-sm">
        {alignPick}
        <RichTextEditor content={block.content ?? ''} onChange={(html) => onChange({ content: html })} minHeight={180} />
      </div>
    );
  }

  if (block.type === 'button') {
    return (
      <div className="space-y-3 text-sm">
        {alignPick}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Label</label>
          <input
            className="w-full rounded border border-gray-200 px-2 py-1.5"
            value={block.buttonLabel ?? ''}
            onChange={(e) => onChange({ buttonLabel: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Link URL</label>
          <input
            className="w-full rounded border border-gray-200 px-2 py-1.5"
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value })}
          />
        </div>
      </div>
    );
  }

  if (block.type === 'image') {
    return (
      <div className="space-y-3 text-sm">
        {alignPick}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Image URL</label>
          <input
            className="w-full rounded border border-gray-200 px-2 py-1.5"
            value={block.src ?? ''}
            onChange={(e) => onChange({ src: e.target.value })}
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
      </div>
    );
  }

  if (block.type === 'spacer') {
    return (
      <div className="text-sm">
        <label className="mb-1 block text-xs font-medium text-gray-500">Height (px)</label>
        <input
          type="number"
          min={4}
          max={120}
          className="w-full rounded border border-gray-200 px-2 py-1.5"
          value={block.spacerHeight ?? 24}
          onChange={(e) => onChange({ spacerHeight: Number(e.target.value) || 16 })}
        />
      </div>
    );
  }

  if (block.type === 'divider') {
    return <p className="text-xs text-gray-500">Horizontal rule — no settings.</p>;
  }

  return null;
}

export function EmailBuilderEditor({
  templateId,
  initialName,
  initialSubject,
  initialPreheader,
  initialDefinition,
}: {
  templateId: string;
  initialName: string;
  initialSubject: string;
  initialPreheader: string;
  initialDefinition: MarketingEmailDefinition;
}) {
  const [name, setName] = useState(initialName);
  const [subject, setSubject] = useState(initialSubject);
  const [preheader, setPreheader] = useState(initialPreheader);
  const [definition, setDefinition] = useState<MarketingEmailDefinition>(initialDefinition);
  const [selectedId, setSelectedId] = useState<string | null>(initialDefinition.blocks[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return findBlock(definition.blocks, selectedId);
  }, [definition.blocks, selectedId]);

  const mergedTheme = useMemo(() => mergeEmailTheme(definition.theme), [definition.theme]);

  const previewHtml = useMemo(() => {
    const def: MarketingEmailDefinition = {
      ...definition,
      theme: definition.theme,
    };
    return renderMarketingEmailHtml(def, PREVIEW_VARS);
  }, [definition]);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDefinition((d) => {
      const ids = d.blocks.map((b) => b.id);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return d;
      return { ...d, blocks: arrayMove(d.blocks, oldIndex, newIndex) };
    });
  }, []);

  const addBlock = useCallback((type: EmailBlockType) => {
    const nb = createEmailBlock(type);
    setDefinition((d) => ({ ...d, blocks: [...d.blocks, nb] }));
    setSelectedId(nb.id);
  }, []);

  const removeBlock = useCallback((id: string) => {
    setDefinition((d) => ({ ...d, blocks: removeBlockAny(d.blocks, id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const patchSelected = useCallback(
    (patch: Partial<EmailBlock>) => {
      if (!selectedId) return;
      setDefinition((d) => ({ ...d, blocks: patchBlockAny(d.blocks, selectedId, patch) }));
    },
    [selectedId],
  );

  const addToColumn = useCallback((columnId: string, side: 'left' | 'right', type: EmailBlockType) => {
    const nb = createEmailBlock(type);
    setDefinition((d) => ({ ...d, blocks: insertInColumn(d.blocks, columnId, side, nb) }));
    setSelectedId(nb.id);
  }, []);

  const removeNested = useCallback((columnId: string, side: 'left' | 'right', childId: string) => {
    setDefinition((d) => ({ ...d, blocks: removeChildFromColumn(d.blocks, columnId, side, childId) }));
    setSelectedId((cur) => (cur === childId ? columnId : cur));
  }, []);

  const patchTheme = useCallback((t: Partial<EmailTheme>) => {
    setDefinition((d) => ({ ...d, theme: { ...d.theme, ...t } }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch(`/api/marketing/email-templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, subject, preheader, definition }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveMsg(j.error || 'Save failed');
      return;
    }
    setSaveMsg('Saved');
    setTimeout(() => setSaveMsg(null), 2000);
  }, [templateId, name, subject, preheader, definition]);

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <Link
            href="/dashboard/marketing/email/templates"
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} />
            Templates
          </Link>
          <input
            className="min-w-[10rem] flex-1 rounded border border-gray-200 px-3 py-1.5 text-base font-semibold"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
          />
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

      <div className="mx-auto grid max-w-7xl gap-4 px-4 pt-4 lg:grid-cols-[200px_1fr_320px]">
        <aside className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Blocks</h2>
          <p className="mb-2 text-xs text-gray-500">Click to add. Drag to reorder the main stack.</p>
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
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Layout</h2>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={definition.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                <div className="flex max-h-[42vh] flex-col gap-2 overflow-y-auto pr-1">
                  {definition.blocks.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500">Add blocks from the left.</p>
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
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Preview</h2>
            <p className="mb-2 text-xs text-gray-500">Sample merge fields. Unsubscribe is a placeholder in preview.</p>
            <iframe title="Email preview" className="h-[min(480px,55vh)] w-full rounded-lg border border-gray-200 bg-white" srcDoc={previewHtml} sandbox="allow-same-origin" />
          </div>
        </section>

        <aside className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Send settings</h2>
            <div className="mb-3 space-y-2 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Subject</label>
                <input
                  className="w-full rounded border border-gray-200 px-2 py-1.5"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Preheader</label>
                <input
                  className="w-full rounded border border-gray-200 px-2 py-1.5"
                  value={preheader}
                  onChange={(e) => setPreheader(e.target.value)}
                />
              </div>
              <p className="text-[11px] leading-snug text-gray-500">
                Merge tags: <code className="text-gray-700">{'{{first_name}}'}</code>,{' '}
                <code className="text-gray-700">{'{{last_name}}'}</code>, <code className="text-gray-700">{'{{venue_name}}'}</code>,{' '}
                <code className="text-gray-700">{'{{unsubscribe_url}}'}</code>
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Theme</h2>
            <ThemeFields theme={mergedTheme} onChange={patchTheme} />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Block</h2>
            {selected ? (
              <BlockInspector
                block={selected}
                onChange={patchSelected}
                onAddToColumn={addToColumn}
                onRemoveNested={removeNested}
              />
            ) : (
              <p className="text-sm text-gray-500">Select a block in the layout list.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
