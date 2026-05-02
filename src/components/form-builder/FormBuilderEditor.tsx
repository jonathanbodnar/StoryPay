'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Copy,
  Eye,
  FileText,
  Hash,
  Heading as HeadingIcon,
  Image as ImageIcon,
  Link2,
  ListChecks,
  ListFilter,
  Loader2,
  Mail,
  MapPin,
  MousePointerClick,
  Phone as PhoneIcon,
  Plus,
  Redo2,
  Save,
  Send,
  Settings,
  Trash2,
  Type,
  Undo2,
  Upload,
  User,
  UserRound,
  X as XIcon,
  Monitor,
  Smartphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import RichTextEditor from '@/components/RichTextEditor';
import { MarketingFormView } from '@/components/marketing-form/MarketingFormView';
import { useFormHistory } from '@/hooks/useFormHistory';
import {
  ALWAYS_REQUIRED_TYPES,
  BUTTON_PRESETS,
  FORM_BLOCK_PADDING_DEFAULTS,
  INPUT_BLOCK_TYPES,
  type ButtonPresetId,
  type FormBlock,
  type FormBlockStyle,
  type FormBlockType,
  type FormSettings,
  type MarketingFormDefinition,
  type PostSubmitConfig,
  createBlock,
  defaultPostSubmit,
  duplicateBlock,
  formatAddressValue,
  mergeTheme,
  resolvePostSubmit,
} from '@/lib/marketing-form-schema';
import { sanitizeFormHtml } from '@/lib/sanitize-form-html';
import { VenueMediaPickerModal } from '@/components/venue-media/VenueMediaPickerModal';
import {
  AlignSelector,
  ALL_FONT_OPTIONS,
  BuilderStyles,
  FlodeskColorPicker,
  FontSelector,
  FONT_WEIGHTS,
  SliderControl,
  loadGoogleFonts,
  type Align3,
} from '@/components/form-builder/builder-primitives';

const APP_ORIGIN =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '')
    : (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

type Viewport = 'mobile' | 'desktop';

type EditorSnapshot = {
  definition: MarketingFormDefinition;
  name: string;
  published: boolean;
};

type PaletteDrag = { kind: 'palette'; blockType: FormBlockType; label: string };

/** Tabs inside the form-level Settings modal (header → Settings button). */
type SettingsTab = 'settings' | 'theme' | 'inbox';

const BLOCK_TYPE_ICONS: Record<FormBlockType, LucideIcon> = {
  heading: HeadingIcon,
  rich_text: Type,
  first_name: User,
  last_name: UserRound,
  email: Mail,
  phone: PhoneIcon,
  url: Link2,
  number: Hash,
  date: Calendar,
  address: MapPin,
  image: ImageIcon,
  file: Upload,
  radio: CircleDot,
  select: ListFilter,
  checkbox_group: ListChecks,
  textarea: FileText,
  submit: Send,
  button: MousePointerClick,
  html: Code2,
};

type PaletteItem = { type: FormBlockType; label: string; desc: string };

const PALETTE: PaletteItem[] = [
  { type: 'heading',         label: 'Heading',          desc: 'Title or section header' },
  { type: 'rich_text',       label: 'Paragraph',        desc: 'Rich text block'          },
  { type: 'first_name',      label: 'First name',       desc: 'Given-name field'         },
  { type: 'last_name',       label: 'Last name',        desc: 'Family-name field'        },
  { type: 'email',           label: 'Email',            desc: 'Email address field'      },
  { type: 'phone',           label: 'Phone',            desc: 'Phone number field'       },
  { type: 'textarea',        label: 'Long answer',      desc: 'Multi-line message'       },
  { type: 'url',             label: 'Website URL',      desc: 'Website link field'       },
  { type: 'number',          label: 'Number',           desc: 'Numeric input'            },
  { type: 'date',            label: 'Date',             desc: 'Date picker field'        },
  { type: 'address',         label: 'Address',          desc: 'Multi-line address'       },
  { type: 'image',           label: 'Image',            desc: 'Photo or graphic'         },
  { type: 'file',            label: 'File upload',      desc: 'Attachment field'         },
  { type: 'radio',           label: 'Radio',            desc: 'Single choice'            },
  { type: 'select',          label: 'Dropdown',         desc: 'Single-choice menu'       },
  { type: 'checkbox_group',  label: 'Checkboxes',       desc: 'Multi-choice list'        },
  { type: 'submit',          label: 'Submit button',    desc: 'Form submit button'       },
  { type: 'button',          label: 'Custom button',    desc: 'Call-to-action link'      },
  { type: 'html',            label: 'HTML',             desc: 'Custom HTML block'        },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatSavedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function parseSizeToPx(fs: string | undefined, fallback = 22): number {
  if (!fs?.trim()) return fallback;
  const px = fs.match(/^(\d+(?:\.\d+)?)px$/i);
  if (px) return Math.min(96, Math.max(10, Math.round(Number(px[1]))));
  const rem = fs.match(/^(\d+(?:\.\d+)?)rem$/i);
  if (rem) return Math.min(96, Math.max(10, Math.round(Number(rem[1]) * 16)));
  return fallback;
}

function parseLineHeight(lh: string | undefined): number {
  if (!lh?.trim()) return 1.4;
  const n = Number.parseFloat(lh);
  if (Number.isFinite(n) && n > 0) return Math.min(2.5, Math.max(1, n));
  return 1.4;
}

function patchBlocks(blocks: FormBlock[], id: string, patch: Partial<FormBlock>): FormBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
}

function humanizeBlockType(type: FormBlockType): string {
  const item = PALETTE.find((p) => p.type === type);
  return item?.label ?? type.replace(/_/g, ' ');
}

/** Per-block label for the primary inspector sub-tab. The Block sub-tab is
 *  shared (background + padding) and labelled "Block" everywhere. */
function blockPrimaryTabLabel(type: FormBlockType): string {
  switch (type) {
    case 'heading':       return 'Heading';
    case 'rich_text':     return 'Content';
    case 'html':          return 'HTML';
    case 'image':         return 'Image';
    case 'submit':
    case 'button':        return 'Button';
    default:              return 'Field';
  }
}

// ─── Palette card (right-panel draggable) ────────────────────────────────────
function PaletteCard({ type, label, desc }: PaletteItem) {
  const Icon = BLOCK_TYPE_ICONS[type];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: 'palette', blockType: type, label } satisfies PaletteDrag,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab', touchAction: 'none' }}
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 hover:border-gray-300 transition-colors select-none"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
        <Icon size={15} className="text-gray-500" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 leading-tight">{label}</p>
        <p className="text-[11px] text-gray-400 truncate">{desc}</p>
      </div>
    </div>
  );
}

// ─── Sortable canvas block (whole block draggable for reorder) ───────────────
function SortableCanvasBlock({
  id,
  children,
}: {
  id: string;
  children: (isDragging: boolean) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        position: 'relative',
        zIndex: isDragging ? 50 : 'auto',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {children(isDragging)}
    </div>
  );
}

// ─── + Add Block circle (between rows on hover) ──────────────────────────────
function AddBlockBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="group/addbtn relative h-7 flex items-center justify-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white opacity-0 group-hover/addbtn:opacity-100 transition-all duration-150 hover:scale-110"
        style={{ border: '1.5px solid #1b1b1b', color: '#1b1b1b' }}
        title="Add block"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

// ─── Centered block-picker modal (replaces left flyout) ──────────────────────
function BlockPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (type: FormBlockType) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[640px] max-w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Add a block</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
            aria-label="Close picker"
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {PALETTE.map(({ type, label, desc }) => {
            const Icon = BLOCK_TYPE_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => onSelect(type)}
                className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-center hover:border-gray-400 hover:bg-white transition-all group"
              >
                <Icon size={22} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
                <div>
                  <p className="text-xs font-semibold text-gray-900 leading-tight">{label}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Empty-canvas drop zone (only when blocks.length === 0) ──────────────────
function CanvasEmptyDrop({ onAddClick }: { onAddClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-empty' });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-24 text-center transition-colors ${
        isOver ? 'border-gray-900 bg-gray-50/80 text-gray-900' : 'border-gray-200 text-gray-300'
      }`}
    >
      <p className="text-sm">Your form is empty — click below to add your first block</p>
      <button
        type="button"
        onClick={onAddClick}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-500 hover:border-gray-400 hover:text-gray-800 transition-all"
      >
        <Plus size={15} /> Add block
      </button>
    </div>
  );
}

// ─── Reusable settings-row helpers ───────────────────────────────────────────
const INSPECTOR_INPUT =
  'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors';

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold text-gray-700 mb-1.5">{children}</p>;
}

function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="block text-[11px] text-gray-500 mb-2">{children}</p>;
}

function SettingsSelect({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        className={`${INSPECTOR_INPUT} appearance-none pr-9`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        strokeWidth={2}
        aria-hidden
      />
    </div>
  );
}

// ─── Block inspector ─────────────────────────────────────────────────────────
function BlockInspector({
  block,
  onChange,
  onRemove,
  onDuplicate,
  onDeselect,
  onRequestMediaPick,
}: {
  block: FormBlock;
  onChange: (patch: Partial<FormBlock>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onDeselect: () => void;
  onRequestMediaPick: (apply: (url: string) => void, mode?: 'image' | 'file' | 'all') => void;
}) {
  const optsText = (block.options || []).join('\n');
  const [spacingOpen, setSpacingOpen] = useState(true);

  // ─── Sub-tab state (matches the email builder's per-block inspector) ───────
  // Every block's inspector is split into two sub-tabs: a per-type "primary"
  // tab (Heading / Image / Field / etc.) and a shared "Block" tab that exposes
  // background + padding controls. Reset to 'primary' whenever the user
  // selects a different block — uses the prev-state pattern so we don't have
  // to drop into useEffect.
  const [subTab, setSubTab] = useState<'primary' | 'link' | 'block'>('primary');
  const [paddingOpen, setPaddingOpen] = useState(true);
  const [prevBlockId, setPrevBlockId] = useState(block.id);
  if (prevBlockId !== block.id) {
    setPrevBlockId(block.id);
    setSubTab('primary');
  }
  const primaryTabLabel = blockPrimaryTabLabel(block.type);
  // Image block exposes an additional "Link" sub-tab between Image and Block.
  const hasLinkTab = block.type === 'image';
  // Link sub-tab: URL or File pill (state lives outside conditional render so
  // it survives toggles between sub-tabs without being unmounted).
  const [imageLinkType, setImageLinkType] = useState<'url' | 'file'>(() => {
    const h = block.href ?? '';
    return /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip)(\?|$)/i.test(h) ? 'file' : 'url';
  });

  // Convenience helpers ── per-block patch into block.style
  const patchStyle = (patch: Partial<FormBlockStyle>) =>
    onChange({ style: { ...block.style, ...patch } });

  const labelFieldsBlock =
    block.type === 'first_name' ||
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
    block.type === 'checkbox_group' ||
    block.type === 'textarea';

  const hintFieldsBlock =
    block.type === 'first_name' ||
    block.type === 'last_name' ||
    block.type === 'email' ||
    block.type === 'phone' ||
    block.type === 'url' ||
    block.type === 'number' ||
    block.type === 'date' ||
    block.type === 'address' ||
    block.type === 'file' ||
    block.type === 'textarea';

  const placeholderFieldsBlock =
    block.type === 'first_name' ||
    block.type === 'last_name' ||
    block.type === 'email' ||
    block.type === 'phone' ||
    block.type === 'url' ||
    block.type === 'number' ||
    block.type === 'textarea';

  const widthFieldsBlock =
    block.type === 'first_name' ||
    block.type === 'last_name' ||
    block.type === 'email' ||
    block.type === 'phone' ||
    block.type === 'url' ||
    block.type === 'number' ||
    block.type === 'date' ||
    block.type === 'address' ||
    block.type === 'file' ||
    block.type === 'select' ||
    block.type === 'textarea';

  return (
    <div className="text-[13px] text-gray-900">
      {/* Block-type pill + Done */}
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          {humanizeBlockType(block.type)}
        </span>
        <button
          type="button"
          onClick={onDeselect}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          Done
        </button>
      </div>

      {/* Sub-tab bar — primary settings vs (optional) Link vs Block padding/bg */}
      <div className="-mx-5 mb-5 flex border-b border-gray-100 bg-gray-50/50 px-2">
        {(
          [
            { id: 'primary' as const, label: primaryTabLabel },
            ...(hasLinkTab ? [{ id: 'link' as const, label: 'Link' }] : []),
            { id: 'block' as const, label: 'Block' },
          ]
        ).map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`relative flex-1 py-3 text-sm font-semibold transition-colors ${
                active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
              {active && (
                <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {subTab === 'primary' && (
        <>

      {/* Heading-specific font controls */}
      {block.type === 'heading' && (
        <div className="space-y-5">
          <div>
            <SectionLabel>Heading level</SectionLabel>
            <div className="flex gap-1">
              {([1, 2, 3, 4, 5, 6] as const).map((l) => {
                const active = (block.level ?? 2) === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => onChange({ level: l })}
                    className={`flex h-8 items-center justify-center rounded-lg px-2.5 text-sm font-semibold transition-colors ${
                      active ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    H{l}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionLabel>Text</SectionLabel>
            <input
              className={INSPECTOR_INPUT}
              value={block.content ?? ''}
              onChange={(e) => onChange({ content: e.target.value })}
            />
          </div>

          <div>
            <SectionLabel>Font</SectionLabel>
            <FontSelector
              value={block.style?.fontFamily ?? ALL_FONT_OPTIONS[0]?.value ?? ''}
              onChange={(v) => patchStyle({ fontFamily: v })}
            />
          </div>

          <div>
            <SectionLabel>Weight</SectionLabel>
            <div className="flex gap-1 flex-wrap">
              {FONT_WEIGHTS.map((w) => {
                const active = (block.style?.fontWeight ?? '600') === w.value;
                return (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => patchStyle({ fontWeight: w.value })}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                      active ? 'bg-gray-100 text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionLabel>
              Font color <span className="font-normal text-gray-400 text-xs">{block.style?.color ?? '#111827'}</span>
            </SectionLabel>
            <FlodeskColorPicker
              value={block.style?.color ?? '#111827'}
              onChange={(v) => patchStyle({ color: v })}
            />
          </div>

          <AlignSelector
            value={(block.style?.textAlign ?? 'left') as Align3}
            onChange={(a) => patchStyle({ textAlign: a })}
          />

          <div>
            <SectionLabel>Case</SectionLabel>
            <div className="flex gap-0.5">
              {([
                { v: 'none' as const, label: 'Aa' },
                { v: 'uppercase' as const, label: 'AA' },
              ]).map((c) => {
                const active = (block.style?.textTransform ?? 'none') === c.v;
                return (
                  <button
                    key={c.v}
                    type="button"
                    onClick={() => patchStyle({ textTransform: c.v })}
                    className={`flex h-9 px-2.5 items-center justify-center rounded-lg text-sm transition-colors ${
                      active ? 'bg-gray-100 text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setSpacingOpen((o) => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Spacing</span>
              <ChevronDown
                size={14}
                className={`text-gray-400 transition-transform ${spacingOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {spacingOpen && (
              <div className="space-y-5">
                <SliderControl
                  label="Font size"
                  value={parseSizeToPx(block.style?.fontSize, 22)}
                  min={10}
                  max={72}
                  step={1}
                  display={`${parseSizeToPx(block.style?.fontSize, 22)}px`}
                  onChange={(v) => patchStyle({ fontSize: `${v}px` })}
                />
                <SliderControl
                  label="Line height"
                  value={parseLineHeight(block.style?.lineHeight)}
                  min={1}
                  max={2.5}
                  step={0.1}
                  display={parseLineHeight(block.style?.lineHeight).toFixed(1)}
                  onChange={(v) => patchStyle({ lineHeight: String(Math.round(v * 10) / 10) })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rich text */}
      {block.type === 'rich_text' && (
        <div className="space-y-5">
          <div>
            <SectionLabel>Content</SectionLabel>
            <div className="rounded-lg border border-gray-200 bg-white p-1">
              <RichTextEditor
                content={block.content || '<p></p>'}
                onChange={(html: string) => onChange({ content: html })}
                minHeight={160}
              />
            </div>
          </div>
          <AlignSelector
            value={(block.style?.textAlign ?? 'left') as Align3}
            onChange={(a) => patchStyle({ textAlign: a })}
          />
        </div>
      )}

      {/* HTML block */}
      {block.type === 'html' && (
        <div className="space-y-5">
          <div>
            <SectionLabel>HTML</SectionLabel>
            <textarea
              className="min-h-[160px] w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
              value={block.content ?? ''}
              onChange={(e) => onChange({ content: e.target.value })}
            />
            <p className="mt-1.5 text-[11px] text-gray-400">Sanitized when shown.</p>
          </div>
          <AlignSelector
            value={(block.style?.textAlign ?? 'left') as Align3}
            onChange={(a) => patchStyle({ textAlign: a })}
          />
        </div>
      )}

      {/* Image */}
      {block.type === 'image' && (
        <div className="space-y-5">
          {/* Media picker card */}
          {block.src?.trim() ? (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={block.src} alt={block.alt ?? ''} className="h-32 w-full object-cover" />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onRequestMediaPick((url) => onChange({ src: url }), 'image')}
                  className="flex-1 rounded-lg border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ src: '' })}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                  aria-label="Remove image"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onRequestMediaPick((url) => onChange({ src: url }), 'image')}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 px-4 py-8 transition-colors hover:border-gray-400 hover:bg-gray-50"
            >
              <Upload size={20} className="text-gray-500" />
              <p className="text-sm font-semibold text-gray-900">Choose an image</p>
              <p className="text-center text-xs text-gray-400">
                Pick from your media library<br />or upload a new one
              </p>
            </button>
          )}

          {/* Width slider */}
          <div className="border-t border-gray-100 pt-4">
            <SliderControl
              label="Width"
              value={block.imageWidth ?? 600}
              min={100}
              max={1200}
              step={10}
              display={`${block.imageWidth ?? 600}`}
              onChange={(v) => onChange({ imageWidth: v })}
            />
          </div>

          {/* Alt text */}
          <div className="border-t border-gray-100 pt-4">
            <SectionLabel>Alt text</SectionLabel>
            <input
              className={INSPECTOR_INPUT}
              value={block.alt ?? ''}
              onChange={(e) => onChange({ alt: e.target.value })}
              placeholder="Describe this image"
            />
            <p className="mt-1.5 text-[11px] text-gray-400">
              Read by screen readers and shown if the image fails to load.
            </p>
          </div>
        </div>
      )}

      {/* Submit & Button blocks */}
      {(block.type === 'submit' || block.type === 'button') && (() => {
        const currentPreset: ButtonPresetId = block.buttonStyle ?? 'filled-rounded';
        const presetMeta = BUTTON_PRESETS.find((p) => p.id === currentPreset) ?? BUTTON_PRESETS[1];
        const isFilled = presetMeta.filled;
        const fillColor = block.buttonBgColor ?? (isFilled ? '#1b1b1b' : 'transparent');
        const textColor = block.buttonTextColor ?? (isFilled ? '#ffffff' : '#1b1b1b');
        const borderColor = block.buttonBorderColor ?? '#1b1b1b';
        const borderWidth = block.buttonBorderWidth ?? (isFilled ? 0 : 2);

        function applyPreset(id: ButtonPresetId) {
          const preset = BUTTON_PRESETS.find((p) => p.id === id);
          if (!preset) return;
          if (preset.filled) {
            onChange({
              buttonStyle: id,
              buttonBgColor: '#1b1b1b',
              buttonTextColor: '#ffffff',
              buttonBorderColor: '#1b1b1b',
              buttonBorderWidth: 0,
            });
          } else {
            onChange({
              buttonStyle: id,
              buttonBgColor: 'transparent',
              buttonTextColor: '#1b1b1b',
              buttonBorderColor: '#1b1b1b',
              buttonBorderWidth: 2,
            });
          }
        }

        return (
          <div className="space-y-5">
            <div>
              <SectionLabel>Label</SectionLabel>
              <input
                className={INSPECTOR_INPUT}
                value={block.buttonLabel ?? ''}
                onChange={(e) => onChange({ buttonLabel: e.target.value })}
              />
            </div>

            {block.type === 'button' && (
              <div>
                <SectionLabel>Link (https)</SectionLabel>
                <input
                  className={INSPECTOR_INPUT}
                  value={block.href ?? ''}
                  onChange={(e) => onChange({ href: e.target.value })}
                  placeholder="https://"
                />
              </div>
            )}

            {/* Style preset grid: 4 filled + 4 outline */}
            <div className="border-t border-gray-100 pt-4">
              <p className="mb-3 text-sm font-semibold text-gray-900">Style</p>
              <div className="mb-2 grid grid-cols-4 gap-2">
                {BUTTON_PRESETS.slice(0, 4).map((p) => {
                  const active = currentPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className={`h-9 transition-all ${active ? 'ring-2 ring-blue-500 ring-offset-2' : 'hover:opacity-80'}`}
                      style={{ background: '#1b1b1b', borderRadius: p.radius }}
                      aria-label={p.id}
                    />
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {BUTTON_PRESETS.slice(4).map((p) => {
                  const active = currentPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className={`h-9 transition-all ${active ? 'ring-2 ring-blue-500 ring-offset-2' : 'hover:bg-gray-50'}`}
                      style={{ background: 'transparent', border: '1.5px solid #1b1b1b', borderRadius: p.radius }}
                      aria-label={p.id}
                    />
                  );
                })}
              </div>
            </div>

            {/* Colors */}
            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-sm font-semibold text-gray-900">
                Fill color <span className="ml-1 text-xs font-normal text-gray-400">{fillColor}</span>
              </p>
              <FlodeskColorPicker
                value={fillColor}
                onChange={(v) => onChange({ buttonBgColor: v })}
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-gray-900">
                Text color <span className="ml-1 text-xs font-normal text-gray-400">{textColor}</span>
              </p>
              <FlodeskColorPicker
                value={textColor}
                onChange={(v) => onChange({ buttonTextColor: v })}
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-gray-900">
                Border color <span className="ml-1 text-xs font-normal text-gray-400">{borderColor}</span>
              </p>
              <FlodeskColorPicker
                value={borderColor}
                onChange={(v) => onChange({ buttonBorderColor: v })}
              />
            </div>

            <SliderControl
              label="Border thickness"
              value={borderWidth}
              min={0}
              max={10}
              step={1}
              display={`${borderWidth}`}
              onChange={(v) => onChange({ buttonBorderWidth: v })}
            />

            {/* Sizing */}
            <div className="border-t border-gray-100 pt-4 space-y-4">
              <p className="text-sm font-semibold text-gray-700">Button sizing</p>
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-[13px] text-gray-700">Full width</span>
                <span className="relative inline-flex">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={!!block.buttonFullWidth}
                    onChange={(e) => onChange({ buttonFullWidth: e.target.checked })}
                  />
                  <span className="block h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-gray-900" />
                  <span className="pointer-events-none absolute left-0.5 top-0.5 block h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                </span>
              </label>
              <SliderControl
                label="Height"
                value={block.buttonHeight ?? 12}
                min={4}
                max={32}
                step={1}
                display={`${block.buttonHeight ?? 12}`}
                onChange={(v) => onChange({ buttonHeight: v })}
              />
            </div>

            {/* Position */}
            <div className="border-t border-gray-100 pt-4">
              <AlignSelector
                label="Position"
                value={(block.buttonAlign ?? (block.type === 'submit' ? 'center' : 'left')) as Align3}
                onChange={(a) => onChange({ buttonAlign: a })}
              />
            </div>
          </div>
        );
      })()}

      {/* Field-style blocks (inputs + multi-option) */}
      {labelFieldsBlock && (
        <div className="space-y-5">
          <div>
            <SectionLabel>Label</SectionLabel>
            <input
              className={INSPECTOR_INPUT}
              value={block.label ?? ''}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </div>

          {placeholderFieldsBlock && (
            <div>
              <SectionLabel>Placeholder</SectionLabel>
              <input
                className={INSPECTOR_INPUT}
                value={block.placeholder ?? ''}
                onChange={(e) => onChange({ placeholder: e.target.value })}
              />
            </div>
          )}

          {(block.type === 'radio' || block.type === 'select' || block.type === 'checkbox_group') && (
            <div>
              <SectionLabel>Options (one per line)</SectionLabel>
              <textarea
                className="min-h-[120px] w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
                value={optsText}
                onChange={(e) =>
                  onChange({
                    options: e.target.value
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          )}

          {block.type === 'checkbox_group' && (
            <div>
              <SectionLabel>Selection mode</SectionLabel>
              <SettingsSelect
                value={block.checkboxMode ?? 'multiple'}
                onChange={(v) => onChange({ checkboxMode: v as 'single' | 'multiple' })}
              >
                <option value="multiple">Multiple (checkboxes)</option>
                <option value="single">Single (radio style)</option>
              </SettingsSelect>
            </div>
          )}

          {block.type === 'textarea' && (
            <div>
              <SectionLabel>Box size</SectionLabel>
              <SettingsSelect
                value={block.textareaSize ?? 'medium'}
                onChange={(v) => onChange({ textareaSize: v as 'small' | 'medium' | 'large' })}
              >
                <option value="small">Small (3 rows)</option>
                <option value="medium">Medium (6 rows)</option>
                <option value="large">Large (10 rows)</option>
              </SettingsSelect>
            </div>
          )}

          {block.type === 'address' && (
            <div className="space-y-3">
              <SectionLabel>Address fields</SectionLabel>
              <p className="text-[11px] text-gray-400">
                Street, City, State, and ZIP / Postal code are always shown. Toggle the optional fields below.
              </p>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                  checked={!!block.addressShowLine2}
                  onChange={(e) => onChange({ addressShowLine2: e.target.checked })}
                />
                <span className="text-[13px] text-gray-700">Apt, suite, etc. (line 2)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                  checked={!!block.addressShowCountry}
                  onChange={(e) => onChange({ addressShowCountry: e.target.checked })}
                />
                <span className="text-[13px] text-gray-700">Country</span>
              </label>
            </div>
          )}

          {ALWAYS_REQUIRED_TYPES.includes(block.type) ? (
            <div className="flex items-center gap-2.5 text-[13px] text-gray-400">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-gray-400"
                checked
                disabled
                readOnly
              />
              <span>Required (always on)</span>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                checked={!!block.required}
                onChange={(e) => onChange({ required: e.target.checked })}
              />
              <span className="text-[13px] text-gray-700">Required</span>
            </label>
          )}

          {widthFieldsBlock && (
            <div>
              <SectionLabel>Width</SectionLabel>
              <SettingsSelect
                value={String(block.colSpan ?? 2)}
                onChange={(v) => onChange({ colSpan: Number(v) as 1 | 2 })}
              >
                <option value="2">Full width</option>
                <option value="1">Half width (2-col layout)</option>
              </SettingsSelect>
            </div>
          )}

          {hintFieldsBlock && (
            <div>
              <SectionLabel>Hint (optional)</SectionLabel>
              <input
                className={INSPECTOR_INPUT}
                value={block.hint ?? ''}
                onChange={(e) => onChange({ hint: e.target.value })}
              />
            </div>
          )}
        </div>
      )}

        </>
      )}

      {/* ── Link sub-tab (image only) ───────────────────────────────────── */}
      {subTab === 'link' && hasLinkTab && block.type === 'image' && (
        <div className="space-y-4">
          {/* URL / File pill */}
          <div className="flex bg-gray-100 p-1.5" style={{ borderRadius: 14 }}>
            {(['url', 'file'] as const).map((t) => {
              const active = imageLinkType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setImageLinkType(t)}
                  className="flex-1 px-4 py-2.5 text-[15px] transition-all"
                  style={{
                    borderRadius: 10,
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#111827' : '#9ca3af',
                    fontWeight: active ? 700 : 600,
                    boxShadow: active
                      ? '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.05)'
                      : 'none',
                  }}
                >
                  {t === 'url' ? 'URL' : 'File'}
                </button>
              );
            })}
          </div>

          {imageLinkType === 'url' && (
            <textarea
              rows={4}
              value={block.href ?? ''}
              onChange={(e) => onChange({ href: e.target.value })}
              placeholder="https://"
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 transition-colors focus:border-gray-400 focus:outline-none"
            />
          )}

          {imageLinkType === 'file' && (
            <div>
              {block.href?.trim() ? (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                  <FileText size={16} className="flex-shrink-0 text-gray-400" />
                  <a
                    href={block.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-sm font-medium text-gray-900 hover:text-blue-600"
                  >
                    {block.href.split('/').pop() || block.href}
                  </a>
                  <button
                    type="button"
                    onClick={() => onChange({ href: '' })}
                    className="text-gray-400 transition-colors hover:text-red-600"
                    aria-label="Remove file link"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onRequestMediaPick((url) => onChange({ href: url }), 'file')}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 px-4 py-8 transition-colors hover:border-gray-400"
                >
                  <Upload size={20} className="text-gray-500" />
                  <p className="text-sm font-semibold text-gray-900">Choose a file</p>
                  <p className="text-center text-xs text-gray-400">
                    PDF, Word, Excel, or other file<br />from your media library
                  </p>
                </button>
              )}
            </div>
          )}

          {/* Open behavior */}
          <div className="border-t border-gray-100 pt-4">
            <p className="mb-1 text-sm font-semibold text-gray-900">Link actions</p>
            <p className="mb-2 text-xs text-gray-500">When someone clicks this image:</p>
            <SettingsSelect
              value={block.linkOpenInNewTab === false ? 'self' : 'blank'}
              onChange={(v) => onChange({ linkOpenInNewTab: v === 'blank' })}
            >
              <option value="blank">Opens in a new tab</option>
              <option value="self">Opens in the same tab</option>
            </SettingsSelect>
          </div>
        </div>
      )}

      {/* ── Shared Block sub-tab (background + padding) ─────────────────── */}
      {subTab === 'block' && (() => {
        const d = FORM_BLOCK_PADDING_DEFAULTS[block.type] ?? { top: 0, bottom: 0, left: 0, right: 0 };
        return (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2">Background</p>
              <FlodeskColorPicker
                value={block.blockBgColor ?? 'transparent'}
                onChange={(v) => onChange({ blockBgColor: v })}
              />
            </div>
            <div className="border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => setPaddingOpen((o) => !o)}
                className="mb-3 flex w-full items-center justify-between"
              >
                <span className="text-sm font-semibold text-gray-700">Padding</span>
                <ChevronDown
                  size={14}
                  className={`text-gray-400 transition-transform ${paddingOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {paddingOpen && (
                <div className="space-y-5">
                  <SliderControl
                    label="Padding top"
                    value={block.paddingTop ?? d.top}
                    min={0}
                    max={120}
                    step={1}
                    display={`${block.paddingTop ?? d.top}`}
                    onChange={(v) => onChange({ paddingTop: v })}
                  />
                  <SliderControl
                    label="Padding bottom"
                    value={block.paddingBottom ?? d.bottom}
                    min={0}
                    max={120}
                    step={1}
                    display={`${block.paddingBottom ?? d.bottom}`}
                    onChange={(v) => onChange({ paddingBottom: v })}
                  />
                  <SliderControl
                    label="Padding left"
                    value={block.paddingLeft ?? d.left}
                    min={0}
                    max={120}
                    step={1}
                    display={`${block.paddingLeft ?? d.left}`}
                    onChange={(v) => onChange({ paddingLeft: v })}
                  />
                  <SliderControl
                    label="Padding right"
                    value={block.paddingRight ?? d.right}
                    min={0}
                    max={120}
                    step={1}
                    display={`${block.paddingRight ?? d.right}`}
                    onChange={(v) => onChange({ paddingRight: v })}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Bottom action row: Duplicate + Remove */}
      <div className="mt-6 border-t border-gray-100 pt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onDuplicate}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Copy size={12} /> Duplicate
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.confirm('Remove this block from the form?')) {
              onRemove();
            }
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={12} /> Remove
        </button>
      </div>
    </div>
  );
}

// ─── Theme inspector ─────────────────────────────────────────────────────────
function ThemeInspector({
  theme,
  onChange,
}: {
  theme: ReturnType<typeof mergeTheme>;
  onChange: (t: MarketingFormDefinition['theme']) => void;
}) {
  return (
    <div className="text-[13px] text-gray-900 space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Colors</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <div>
            <SmallLabel>Primary / button</SmallLabel>
            <FlodeskColorPicker
              value={theme.primaryColor}
              onChange={(v) => onChange({ primaryColor: v })}
            />
          </div>
          <div>
            <SmallLabel>Page background</SmallLabel>
            <FlodeskColorPicker
              value={theme.background}
              onChange={(v) => onChange({ background: v })}
            />
          </div>
          <div>
            <SmallLabel>Card background</SmallLabel>
            <FlodeskColorPicker value={theme.surface} onChange={(v) => onChange({ surface: v })} />
          </div>
          <div>
            <SmallLabel>Label color</SmallLabel>
            <FlodeskColorPicker
              value={theme.labelColor}
              onChange={(v) => onChange({ labelColor: v })}
            />
          </div>
          <div>
            <SmallLabel>Field border</SmallLabel>
            <FlodeskColorPicker
              value={theme.inputBorder}
              onChange={(v) => onChange({ inputBorder: v })}
            />
          </div>
          <div>
            <SmallLabel>Muted text</SmallLabel>
            <FlodeskColorPicker
              value={theme.mutedColor}
              onChange={(v) => onChange({ mutedColor: v })}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5 space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Typography</p>
        <div>
          <SmallLabel>Body font</SmallLabel>
          <FontSelector value={theme.fontFamily} onChange={(v) => onChange({ fontFamily: v })} />
        </div>
        <div>
          <SmallLabel>Heading font</SmallLabel>
          <FontSelector
            value={theme.headingFontFamily || theme.fontFamily}
            onChange={(v) => onChange({ headingFontFamily: v })}
          />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5 space-y-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Layout</p>
        <div>
          <SmallLabel>Max width</SmallLabel>
          <input
            className={INSPECTOR_INPUT}
            value={theme.maxWidth}
            onChange={(e) => onChange({ maxWidth: e.target.value })}
            placeholder="520px"
          />
        </div>
        <div>
          <SmallLabel>Corner radius</SmallLabel>
          <input
            className={INSPECTOR_INPUT}
            value={theme.borderRadius}
            onChange={(e) => onChange({ borderRadius: e.target.value })}
            placeholder="10px"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Submission settings (post-submit, notifications, pipeline routing) ─────
interface StageOption {
  stageId: string;
  stageName: string;
  pipelineName: string;
}

function FormSettingsPanel({
  settings,
  onChange,
}: {
  settings: FormSettings | undefined;
  onChange: (s: FormSettings) => void;
}) {
  const s: FormSettings = settings ?? {};
  const [stages, setStages] = useState<StageOption[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStagesLoading(true);
    fetch('/api/pipelines')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { pipelines?: Array<{ name: string; stages?: Array<{ id: string; name: string }> }> } | null) => {
        if (cancelled || !data?.pipelines) return;
        const opts: StageOption[] = [];
        for (const p of data.pipelines) {
          for (const st of p.stages ?? []) {
            opts.push({ stageId: st.id, stageName: st.name, pipelineName: p.name });
          }
        }
        setStages(opts);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="text-[13px] text-gray-900 space-y-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Submissions</p>

      <div>
        <SectionLabel>Notify emails</SectionLabel>
        <input
          className={INSPECTOR_INPUT}
          placeholder="you@example.com, team@example.com"
          value={s.notificationEmails ?? ''}
          onChange={(e) => onChange({ ...s, notificationEmails: e.target.value })}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
          Comma-separated. We&apos;ll email these addresses on every new submission.
        </p>
      </div>

      <div>
        <SectionLabel>Send leads to</SectionLabel>
        <SettingsSelect
          value={s.pipelineStageId ?? ''}
          onChange={(v) => onChange({ ...s, pipelineStageId: v || null })}
          disabled={stagesLoading}
        >
          <option value="">Don&apos;t add to pipeline</option>
          {stages.map((opt) => (
            <option key={opt.stageId} value={opt.stageId}>
              {opt.pipelineName} → {opt.stageName}
            </option>
          ))}
        </SettingsSelect>
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
          Submissions with an email are saved as contacts automatically. Select a stage to also create
          a lead.
        </p>
      </div>
    </div>
  );
}

function PostSubmitInspector({
  postSubmit,
  onChange,
  onPreviewThankYou,
}: {
  postSubmit: PostSubmitConfig | undefined;
  onChange: (p: PostSubmitConfig) => void;
  onPreviewThankYou?: () => void;
}) {
  const p = { ...defaultPostSubmit(), ...postSubmit };
  const mode = p.mode ?? 'default';

  return (
    <div className="text-[13px] text-gray-900 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">After submit</p>
        {onPreviewThankYou ? (
          <button
            type="button"
            onClick={onPreviewThankYou}
            className="text-[11px] font-medium text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-gray-900"
          >
            Preview
          </button>
        ) : null}
      </div>

      <div>
        <SectionLabel>Action</SectionLabel>
        <SettingsSelect
          value={mode}
          onChange={(v) => onChange({ ...p, mode: v as PostSubmitConfig['mode'] })}
        >
          <option value="default">Short thank-you message</option>
          <option value="inline_message">Custom message (same page)</option>
          <option value="redirect">Redirect to URL</option>
        </SettingsSelect>
      </div>

      {mode === 'inline_message' && (
        <div>
          <SectionLabel>Message (HTML)</SectionLabel>
          <textarea
            className="min-h-[140px] w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
            value={p.messageHtml ?? ''}
            onChange={(e) => onChange({ ...p, messageHtml: e.target.value })}
          />
        </div>
      )}
      {mode === 'redirect' && (
        <div>
          <SectionLabel>Redirect URL</SectionLabel>
          <input
            className={INSPECTOR_INPUT}
            value={p.redirectUrl ?? ''}
            onChange={(e) => onChange({ ...p, redirectUrl: e.target.value })}
            placeholder="https://…"
          />
        </div>
      )}
    </div>
  );
}

// ─── Submissions inbox panel ─────────────────────────────────────────────────
function SubmissionsInbox({
  submissions,
  loading,
  blocks,
}: {
  submissions: { id: string; payload: unknown; created_at: string }[];
  loading: boolean;
  blocks: FormBlock[];
}) {
  if (loading) {
    return (
      <div className="space-y-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-gray-200/80 bg-white p-3"
          >
            <div className="h-3 w-36 rounded bg-gray-200" />
            <div className="mt-1.5 h-3 w-28 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }
  if (submissions.length === 0) {
    return (
      <div className="text-[13px] text-gray-900">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Inbox</p>
        <p className="text-[13px] text-gray-400">No submissions yet.</p>
      </div>
    );
  }

  return (
    <div className="text-[13px] text-gray-900">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Inbox</p>
      <ul className="space-y-2">
        {submissions.map((s) => {
          const p =
            typeof s.payload === 'object' && s.payload !== null
              ? (s.payload as Record<string, unknown>)
              : {};
          const firstNameBlock = blocks.find((b) => b.type === 'first_name');
          const lastNameBlock = blocks.find((b) => b.type === 'last_name');
          const emailBlock = blocks.find((b) => b.type === 'email');
          const phoneBlock = blocks.find((b) => b.type === 'phone');
          const firstName = firstNameBlock ? String(p[firstNameBlock.id] ?? '') : '';
          const lastName = lastNameBlock ? String(p[lastNameBlock.id] ?? '') : '';
          const email = emailBlock ? String(p[emailBlock.id] ?? '') : '';
          const phone = phoneBlock ? String(p[phoneBlock.id] ?? '') : '';
          const fullName = [firstName, lastName].filter(Boolean).join(' ');
          const otherFields = blocks
            .filter(
              (b) =>
                INPUT_BLOCK_TYPES.includes(b.type) &&
                !['first_name', 'last_name', 'email', 'phone'].includes(b.type) &&
                p[b.id] !== undefined,
            )
            .map((b) => {
              const v = p[b.id];
              let value: string;
              if (Array.isArray(v)) {
                value = (v as string[]).join(', ');
              } else if (b.type === 'address') {
                value = formatAddressValue(v);
              } else if (typeof v === 'object' && v !== null) {
                value = '[file]';
              } else {
                value = String(v ?? '');
              }
              return { label: b.label || b.type, value };
            })
            .filter((f) => f.value);

          return (
            <li key={s.id} className="overflow-hidden rounded-xl border border-gray-200/80 bg-white">
              <div className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-gray-900">{fullName || '—'}</p>
                  {email && <p className="mt-0.5 truncate text-[12px] text-gray-500">{email}</p>}
                  {phone && <p className="mt-0.5 text-[12px] text-gray-400">{phone}</p>}
                </div>
                <p className="shrink-0 text-right text-[11px] text-gray-400">
                  {new Date(s.created_at).toLocaleDateString()}
                  <br />
                  {new Date(s.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              {otherFields.length > 0 && (
                <details className="border-t border-gray-100">
                  <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-medium text-gray-400 hover:text-gray-700">
                    {otherFields.length} more field{otherFields.length !== 1 ? 's' : ''}
                  </summary>
                  <div className="space-y-1 px-3 pb-3">
                    {otherFields.map((f, i) => (
                      <div key={i} className="flex gap-1.5 text-[11px]">
                        <span className="shrink-0 text-gray-400">{f.label}:</span>
                        <span className="break-all text-gray-700">{f.value}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Form-level Settings modal (Settings / Theme / Inbox) ───────────────────
// Triggered from the header's Settings button. Houses everything that's NOT
// per-block — submission routing, post-submit behavior, theme, submissions.
// The right rail is reserved for block palette / per-block inspector only.
function FormSettingsModal({
  initialTab,
  formName,
  onFormNameChange,
  settings,
  postSubmit,
  theme,
  blocks,
  submissions,
  submissionsLoading,
  onSettingsChange,
  onPostSubmitChange,
  onThemeChange,
  onPreviewThankYou,
  onDeleteForm,
  deletingForm,
  onClose,
}: {
  initialTab: SettingsTab;
  formName: string;
  onFormNameChange: (next: string) => void;
  settings: FormSettings | undefined;
  postSubmit: PostSubmitConfig | undefined;
  theme: ReturnType<typeof mergeTheme>;
  blocks: FormBlock[];
  submissions: { id: string; payload: unknown; created_at: string }[];
  submissionsLoading: boolean;
  onSettingsChange: (next: FormSettings) => void;
  onPostSubmitChange: (next: PostSubmitConfig) => void;
  onThemeChange: (next: MarketingFormDefinition['theme']) => void;
  onPreviewThankYou: () => void;
  onDeleteForm: () => void;
  deletingForm: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
            <Settings size={13} />
            <span>Form settings</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close settings"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex h-12 shrink-0 items-stretch border-b border-gray-100 bg-white">
          {(
            [
              ['settings', 'Settings'],
              ['theme', 'Theme'],
              ['inbox', 'Inbox'],
            ] as const
          ).map(([id, label]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`relative flex-1 px-1.5 text-center text-[12px] font-medium transition sm:text-[13px] ${
                  active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <span className="flex h-full items-center justify-center leading-tight">
                  {label}
                </span>
                {active && (
                  <span className="absolute bottom-0 left-1/2 h-[2px] w-12 -translate-x-1/2 rounded-full bg-gray-900" />
                )}
              </button>
            );
          })}
        </div>

        <div
          className="fb-scroll-pane flex-1 overflow-y-auto"
          style={{ overscrollBehavior: 'contain', minHeight: 0 }}
        >
          {tab === 'settings' && (
            <div className="space-y-7 p-5">
              <div className="space-y-2">
                <label
                  htmlFor="fb-form-name"
                  className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
                >
                  Form name
                </label>
                <input
                  id="fb-form-name"
                  value={formName}
                  placeholder="Untitled form"
                  onChange={(e) => onFormNameChange(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
                />
                <p className="text-[11px] text-gray-400">
                  Internal label only — visitors never see this.
                </p>
              </div>
              <div className="h-px w-full bg-gray-100" />
              <FormSettingsPanel settings={settings} onChange={onSettingsChange} />
              <div className="h-px w-full bg-gray-100" />
              <PostSubmitInspector
                postSubmit={postSubmit}
                onChange={onPostSubmitChange}
                onPreviewThankYou={onPreviewThankYou}
              />
              <div className="h-px w-full bg-gray-100" />
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-red-500">
                  Danger zone
                </p>
                <div className="flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50/50 p-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900">Delete this form</p>
                    <p className="mt-0.5 text-[12px] text-gray-600">
                      Permanently removes the form, its embed URL, and all its submissions. This
                      can&apos;t be undone.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onDeleteForm}
                    disabled={deletingForm}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingForm ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Delete form
                  </button>
                </div>
              </div>
            </div>
          )}
          {tab === 'theme' && (
            <div className="p-5">
              <ThemeInspector theme={theme} onChange={onThemeChange} />
            </div>
          )}
          {tab === 'inbox' && (
            <div className="p-5">
              <SubmissionsInbox
                submissions={submissions}
                loading={submissionsLoading}
                blocks={blocks}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Live preview modal (dark themed, device toggle, open in new tab) ────────
function PreviewModal({
  formTitle,
  published,
  definition,
  embedToken,
  onClose,
}: {
  embedUrl: string;
  formTitle: string;
  published: boolean;
  definition: MarketingFormDefinition;
  embedToken: string;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const frameWidth = device === 'mobile' ? 380 : 720;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(27, 27, 27, 0.7)' }}
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar — close + title on the left, centered device toggle */}
      <div
        className="relative flex items-center border-b border-white/10 px-5 py-3 text-white"
        style={{ backgroundColor: '#1b1b1b' }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close preview"
          >
            <XIcon size={18} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{formTitle || 'Untitled form'}</p>
            <p className="text-[11px] text-gray-400">
              Live preview · fill it out to test — submissions don&apos;t persist
            </p>
          </div>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-full bg-white/10 p-1">
            <button
              type="button"
              onClick={() => setDevice('desktop')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                device === 'desktop' ? 'bg-white text-gray-900' : 'text-gray-300 hover:text-white'
              }`}
            >
              <Monitor size={13} /> Desktop
            </button>
            <button
              type="button"
              onClick={() => setDevice('mobile')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                device === 'mobile' ? 'bg-white text-gray-900' : 'text-gray-300 hover:text-white'
              }`}
            >
              <Smartphone size={13} /> Mobile
            </button>
          </div>
        </div>
      </div>

      {!published && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-1.5 text-xs text-amber-800">
          Publish the form so the embed URL works for visitors.
        </div>
      )}

      {/* Form viewport — natural-height form rendered against its own theme
          background. The outer container scrolls if the form is taller than
          the modal, and shrinks to the form when it's shorter. */}
      <div className="flex flex-1 justify-center overflow-auto py-6">
        <div
          className="overflow-hidden rounded-2xl shadow-2xl transition-all"
          style={{ width: frameWidth, maxWidth: 'calc(100% - 48px)', alignSelf: 'flex-start' }}
        >
          <MarketingFormView
            definition={definition}
            embedToken={embedToken}
            formTitle={formTitle}
            preview
            livePreview
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main editor component ───────────────────────────────────────────────────
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
  const initialSnapshot: EditorSnapshot = useMemo(
    () => ({
      definition: initialDefinition,
      name: initialName,
      published: initialPublished,
    }),
    [initialDefinition, initialName, initialPublished],
  );

  const { present, set, undo, redo, canUndo, canRedo } = useFormHistory(initialSnapshot);
  const { definition, name, published } = present;

  const [selectedId, setSelectedId] = useState<string | null>(
    initialDefinition.blocks[0]?.id ?? null,
  );
  const viewportStorageKey = `storypay.formBuilder.viewport.${formId}`;
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [canvasHint, setCanvasHint] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(() => {
    if (typeof window === 'undefined') return 'desktop';
    try {
      const v = sessionStorage.getItem(viewportStorageKey);
      if (v === 'mobile' || v === 'desktop') return v;
    } catch {
      /* ignore */
    }
    return 'desktop';
  });
  const [embedOpen, setEmbedOpen] = useState(false);
  const [thankYouOpen, setThankYouOpen] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<'image' | 'file' | 'all'>('image');
  const mediaApplyRef = useRef<(url: string) => void>(() => {});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('settings');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pickerInsertIdx, setPickerInsertIdx] = useState<number | null>(null);
  const [activePaletteType, setActivePaletteType] = useState<FormBlockType | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const pointerYRef = useRef(0);

  const [submissions, setSubmissions] = useState<{ id: string; payload: unknown; created_at: string }[]>(
    [],
  );
  const [submissionsLoading, setSubmissionsLoading] = useState(false);

  const presentRef = useRef(present);
  presentRef.current = present;
  const lastPersistedJsonRef = useRef(JSON.stringify(present));
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazy-load Google Fonts so the picker reflects them in the canvas
  useEffect(() => {
    loadGoogleFonts();
  }, []);

  // Track pointer Y for before/after drop-side detection
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointerYRef.current = e.clientY;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Persist viewport choice
  useEffect(() => {
    try {
      sessionStorage.setItem(viewportStorageKey, viewport);
    } catch {
      /* ignore */
    }
  }, [viewport, viewportStorageKey]);

  // Auto-clear ephemeral canvas hint
  useEffect(() => {
    if (!canvasHint) return;
    const t = setTimeout(() => setCanvasHint(null), 3500);
    return () => clearTimeout(t);
  }, [canvasHint]);

  // Submissions — lazy-loaded when the Settings modal's Inbox tab is opened.
  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'inbox') return;
    let cancelled = false;
    setSubmissionsLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/marketing/forms/${formId}/submissions`);
        const j = (await res.json()) as {
          submissions?: { id: string; payload: unknown; created_at: string }[];
        };
        if (!cancelled && j.submissions) setSubmissions(j.submissions);
      } finally {
        if (!cancelled) setSubmissionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, settingsTab, formId]);

  // Make sure selected id is still valid after edits
  useEffect(() => {
    if (!selectedId) return;
    if (!definition.blocks.some((b) => b.id === selectedId)) {
      setSelectedId(definition.blocks[0]?.id ?? null);
    }
  }, [definition.blocks, selectedId]);

  // ⌘Z / ⌘⇧Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[contenteditable="true"],input,textarea,select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const persistForm = useCallback(
    async (source: 'manual' | 'autosave') => {
      if (source === 'manual') clearAutosaveTimer();
      const payload = presentRef.current;
      const json = JSON.stringify(payload);
      if (json === lastPersistedJsonRef.current) {
        if (source === 'manual') {
          setPersistError(null);
          setLastSavedAt(new Date());
        }
        return;
      }
      if (source === 'manual') setSaving(true);
      else setAutoSaving(true);
      setPersistError(null);
      try {
        const res = await fetch(`/api/marketing/forms/${formId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: payload.name,
            published: payload.published,
            definition: payload.definition,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setPersistError(j.error || 'Save failed');
          return;
        }
        if (JSON.stringify(presentRef.current) !== json) return;
        lastPersistedJsonRef.current = json;
        setLastSavedAt(new Date());
      } catch (e) {
        if (source === 'manual') {
          setPersistError(e instanceof Error ? e.message : 'Save failed — check connection');
        }
      } finally {
        if (source === 'manual') setSaving(false);
        else setAutoSaving(false);
      }
    },
    [formId, clearAutosaveTimer],
  );

  // Autosave 3s after last edit
  useEffect(() => {
    const json = JSON.stringify(present);
    if (json === lastPersistedJsonRef.current) return;
    clearAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistForm('autosave');
    }, 3000);
    return () => clearAutosaveTimer();
  }, [present, clearAutosaveTimer, persistForm]);

  // Esc closes modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pickerInsertIdx !== null) {
        e.preventDefault();
        setPickerInsertIdx(null);
        return;
      }
      if (previewOpen) {
        e.preventDefault();
        setPreviewOpen(false);
        return;
      }
      if (settingsOpen) {
        e.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (embedOpen) {
        e.preventDefault();
        setEmbedOpen(false);
        return;
      }
      if (thankYouOpen) {
        e.preventDefault();
        setThankYouOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerInsertIdx, previewOpen, settingsOpen, embedOpen, thankYouOpen]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selected = useMemo(
    () => definition.blocks.find((b) => b.id === selectedId) ?? null,
    [definition.blocks, selectedId],
  );

  const mergedTheme = useMemo(() => mergeTheme(definition.theme), [definition.theme]);

  const setSnapshot = useCallback(
    (fn: (s: EditorSnapshot) => EditorSnapshot) => {
      set(fn);
    },
    [set],
  );

  const patchDefinition = useCallback(
    (fn: (d: MarketingFormDefinition) => MarketingFormDefinition) => {
      setSnapshot((s) => ({ ...s, definition: fn(s.definition) }));
    },
    [setSnapshot],
  );

  const patchPostSubmit = useCallback(
    (next: PostSubmitConfig) => patchDefinition((d) => ({ ...d, postSubmit: next })),
    [patchDefinition],
  );
  const patchSettings = useCallback(
    (next: FormSettings) => patchDefinition((d) => ({ ...d, settings: next })),
    [patchDefinition],
  );
  const patchName = useCallback(
    (next: string) => setSnapshot((s) => ({ ...s, name: next })),
    [setSnapshot],
  );

  const [deletingForm, setDeletingForm] = useState(false);
  const handleDeleteForm = useCallback(async () => {
    if (deletingForm) return;
    if (typeof window === 'undefined') return;
    const ok = window.confirm(
      'Delete this form? This permanently removes the form, its embed URL, and all submissions. This cannot be undone.',
    );
    if (!ok) return;
    setDeletingForm(true);
    try {
      // Cancel any pending autosave so we don't try to save a deleted form.
      clearAutosaveTimer();
      const res = await fetch(`/api/marketing/forms/${formId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error || 'Failed to delete form. Please try again.');
        setDeletingForm(false);
        return;
      }
      // Hard navigation back to the list — avoids any stale local state from
      // this page trying to save against the now-deleted form.
      window.location.assign('/dashboard/marketing/form-builder');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Failed to delete form.');
      setDeletingForm(false);
    }
  }, [deletingForm, formId, clearAutosaveTimer]);

  const addBlockAt = useCallback(
    (idx: number, type: FormBlockType) => {
      const nb = createBlock(type);
      patchDefinition((d) => {
        const blocks = [...d.blocks];
        const safeIdx = Math.max(0, Math.min(idx, blocks.length));
        blocks.splice(safeIdx, 0, nb);
        return { ...d, blocks };
      });
      setSelectedId(nb.id);
      setPickerInsertIdx(null);
    },
    [patchDefinition],
  );

  const removeBlock = useCallback(
    (id: string) => {
      patchDefinition((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [patchDefinition],
  );

  const duplicateOne = useCallback(
    (id: string) => {
      const block = definition.blocks.find((b) => b.id === id);
      if (!block) return;
      const clone = duplicateBlock(block);
      patchDefinition((d) => {
        const idx = d.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return d;
        const next = [...d.blocks];
        next.splice(idx + 1, 0, clone);
        return { ...d, blocks: next };
      });
      setSelectedId(clone.id);
    },
    [definition.blocks, patchDefinition],
  );

  const handleRequestMediaPick = useCallback(
    (apply: (url: string) => void, mode: 'image' | 'file' | 'all' = 'image') => {
      mediaApplyRef.current = apply;
      setMediaPickerMode(mode);
      setMediaPickerOpen(true);
    },
    [],
  );

  const patchSelected = useCallback(
    (patch: Partial<FormBlock>) => {
      if (!selectedId) return;
      patchDefinition((d) => ({ ...d, blocks: patchBlocks(d.blocks, selectedId, patch) }));
    },
    [selectedId, patchDefinition],
  );

  const patchTheme = useCallback(
    (t: MarketingFormDefinition['theme']) => {
      patchDefinition((d) => ({ ...d, theme: { ...d.theme, ...t } }));
    },
    [patchDefinition],
  );

  // ─── Drag handlers ─────────────────────────────────────────────────────────
  const onDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setDropTarget(null);
    if (id.startsWith('palette:')) {
      const type = event.active.data.current?.blockType as FormBlockType | undefined;
      if (type) setActivePaletteType(type);
    } else {
      setActivePaletteType(null);
    }
  }, []);

  const onDragOver = useCallback((event: DragOverEvent) => {
    const activeId = String(event.active.id);
    const isPalette = activeId.startsWith('palette:');
    if (!event.over) {
      setDropTarget(null);
      return;
    }
    const overId = String(event.over.id);
    // Empty-canvas placeholder gets a single, neutral target.
    if (overId === 'canvas-empty') {
      setDropTarget({ id: 'canvas-empty', pos: 'before' });
      return;
    }
    // For palette drags, pick before/after by pointer half so blocks can land
    // anywhere — including the very last position.
    if (isPalette) {
      const rect = event.over.rect;
      const midY = rect.top + rect.height / 2;
      const pos: 'before' | 'after' = pointerYRef.current >= midY ? 'after' : 'before';
      setDropTarget((prev) => (prev?.id === overId && prev.pos === pos ? prev : { id: overId, pos }));
    } else {
      // Sortable reordering — just track which block is hovered.
      setDropTarget((prev) => (prev?.id === overId && prev.pos === 'before' ? prev : { id: overId, pos: 'before' }));
    }
  }, []);

  const onDragCancel = useCallback((_event: DragCancelEvent) => {
    setActivePaletteType(null);
    setDropTarget(null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const target = dropTarget;
      const wasPalette = activePaletteType !== null;
      setActivePaletteType(null);
      setDropTarget(null);
      if (!over) return;

      const activeId = String(active.id);

      // ── Palette drop ─────────────────────────────────────────────────────
      if (activeId.startsWith('palette:')) {
        const type = active.data.current?.blockType as FormBlockType | undefined;
        if (!type) return;
        if (target?.id === 'canvas-empty') {
          addBlockAt(0, type);
          return;
        }
        if (target) {
          // Build the new block once so we can both insert it and select it
          // immediately — matches the email builder's "click-on-the-block-you-just-dropped"
          // selection feel.
          const newBlock = createBlock(type);
          patchDefinition((d) => {
            const blocks = [...d.blocks];
            const overIdx = blocks.findIndex((b) => b.id === target.id);
            if (overIdx < 0) {
              blocks.push(newBlock);
            } else {
              const insertIdx = target.pos === 'after' ? overIdx + 1 : overIdx;
              blocks.splice(insertIdx, 0, newBlock);
            }
            return { ...d, blocks };
          });
          setSelectedId(newBlock.id);
          return;
        }
        // Fall through: append at end.
        addBlockAt(definition.blocks.length, type);
        return;
      }

      // ── Reorder existing block ───────────────────────────────────────────
      if (wasPalette) return;
      if (active.id === over.id) return;
      patchDefinition((d) => {
        const oldIdx = d.blocks.findIndex((b) => b.id === activeId);
        const newIdx = d.blocks.findIndex((b) => b.id === String(over.id));
        if (oldIdx < 0 || newIdx < 0) return d;
        return { ...d, blocks: arrayMove(d.blocks, oldIdx, newIdx) };
      });
    },
    [dropTarget, activePaletteType, definition.blocks.length, addBlockAt, patchDefinition],
  );

  // ─── Embed iframe snippet & copy ───────────────────────────────────────────
  const embedUrl = `${
    APP_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')
  }/embed/form/${embedToken}`;
  const iframeSnippet = `<iframe src="${embedUrl}" title="${name.replace(
    /"/g,
    '&quot;',
  )}" style="width:100%;min-height:520px;border:0;border-radius:12px;" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(iframeSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // ─── Canvas helpers ────────────────────────────────────────────────────────
  const builderOpts = useMemo(
    () => ({
      selectedId,
      onSelectBlock: setSelectedId,
      onPatchBlock: (id: string, patch: Partial<FormBlock>) => {
        patchDefinition((d) => ({ ...d, blocks: patchBlocks(d.blocks, id, patch) }));
      },
    }),
    [selectedId, patchDefinition],
  );

  const dropIndicator = (label: string) => (
    <div className="pointer-events-none px-0 py-1" aria-hidden>
      <div className="flex items-center gap-2" style={{ borderTop: '2px solid #1b1b1b' }}>
        <span
          className="text-[10px] font-semibold text-white rounded px-1.5 py-0.5"
          style={{ background: '#1b1b1b', lineHeight: 1.4, whiteSpace: 'nowrap' }}
        >
          {label}
        </span>
      </div>
    </div>
  );

  const wrapBlock = useCallback(
    (block: FormBlock, node: ReactNode) => {
      const blocks = definition.blocks;
      const idx = blocks.findIndex((b) => b.id === block.id);
      const isDropTargetBlock = dropTarget?.id === block.id && activePaletteType !== null;
      const showTopIndicator = isDropTargetBlock && dropTarget?.pos === 'before';
      const showBottomIndicator = isDropTargetBlock && dropTarget?.pos === 'after';
      const dragLabel =
        PALETTE.find((p) => p.type === activePaletteType)?.label ?? activePaletteType ?? 'Block';

      return (
        <SortableCanvasBlock id={block.id}>
          {() => (
            <div>
              {showTopIndicator && dropIndicator(dragLabel)}
              <div className="relative group/block">{node}</div>
              <AddBlockBtn onClick={() => setPickerInsertIdx(idx + 1)} />
              {showBottomIndicator && dropIndicator(dragLabel)}
            </div>
          )}
        </SortableCanvasBlock>
      );
    },
    [definition.blocks, dropTarget, activePaletteType],
  );

  const emptySlot = useMemo(
    () => <CanvasEmptyDrop onAddClick={() => setPickerInsertIdx(0)} />,
    [],
  );

  const viewportMax = viewport === 'mobile' ? 380 : 720;

  const resolvedThankYou = useMemo(() => resolvePostSubmit(definition), [definition]);

  const saveStatusLine = saving || autoSaving
    ? 'Saving…'
    : persistError
      ? persistError
      : canvasHint
        ? canvasHint
        : lastSavedAt
          ? `Saved · ${formatSavedTime(lastSavedAt)}`
          : '';

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="-mt-6 lg:-mt-[68px] -mb-10 flex flex-col bg-white"
      style={{ minHeight: '100vh' }}
    >
      <BuilderStyles />

      {/* ─── Top header — fixed across viewport ──────────────────────────── */}
      <header
        className="flex items-center bg-white px-6 py-3"
        style={
          {
            position: 'fixed',
            top: 0,
            left: 'var(--sidebar-w, 216px)',
            right: 0,
            zIndex: 20,
            boxShadow: '0 1px 18px rgba(0,0,0,0.05)',
            transition: 'left 200ms ease-out',
          } as CSSProperties
        }
      >
        {/* Left: back link only — the form title lives in the Settings modal
            and on the canvas itself, no need to duplicate it here. */}
        <div className="flex flex-shrink-0 items-center">
          <Link
            href="/dashboard/marketing/form-builder"
            className="flex flex-shrink-0 items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-800"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back</span>
          </Link>
        </div>

        {/* Right: save + preview + save + publish */}
        <div className="flex items-center gap-3 flex-shrink-0 ml-auto justify-end">
          <div className="hidden md:flex items-center gap-1.5">
            {(saving || autoSaving) && <Loader2 size={12} className="animate-spin text-gray-300" />}
            {!saving && !autoSaving && lastSavedAt && (
              <span className="text-[11px] text-gray-300">Saved</span>
            )}
            {persistError && <span className="text-[11px] text-red-400">Error</span>}
          </div>

          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            <Eye size={14} />
            <span className="hidden sm:inline">Preview</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSettingsTab('settings');
              setSettingsOpen(true);
            }}
            className="hidden lg:flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setEmbedOpen(true)}
            className="hidden lg:flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            <Code2 size={14} />
            <span>Embed</span>
          </button>

          <button
            type="button"
            onClick={() => void persistForm('manual')}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-900 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} strokeWidth={2} />}
            Save
          </button>

          <button
            type="button"
            onClick={() => setSnapshot((s) => ({ ...s, published: !s.published }))}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
              published
                ? 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                : 'border border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {published ? 'Published' : 'Publish'}
          </button>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        {/* ─── Body — fixed below header so canvas + panel scroll independently ── */}
        <div
          style={{
            position: 'fixed',
            top: 52,
            left: 'var(--sidebar-w, 216px)',
            right: 0,
            bottom: 0,
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          {/* ── Canvas ─────────────────────────────────────────────────────── */}
          <div
            className="fb-scroll-pane flex-1 overflow-y-auto"
            style={
              {
                background: '#ffffff',
                paddingTop: 36,
                paddingBottom: 60,
                paddingLeft: 40,
                paddingRight: 80,
                overscrollBehavior: 'contain',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                minHeight: 0,
              } as CSSProperties
            }
            onClick={() => setSelectedId(null)}
          >
            {/* Desktop / Mobile toggle */}
            <div className="flex items-center justify-center gap-1 mb-4">
              <button
                type="button"
                title="Desktop view"
                onClick={() => setViewport('desktop')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  viewport === 'desktop'
                    ? 'bg-gray-100 text-gray-800'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Monitor size={14} /> Desktop
              </button>
              <button
                type="button"
                title="Mobile view"
                onClick={() => setViewport('mobile')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  viewport === 'mobile'
                    ? 'bg-gray-100 text-gray-800'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Smartphone size={14} /> Mobile
              </button>
            </div>

            {/* Form card — clicking the empty form area (outside any block)
                clears the selection so the right rail returns to the block
                palette. Blocks themselves stopPropagation in their wrappers. */}
            <div
              className="mx-auto"
              style={{
                maxWidth: viewportMax,
                background: '#ffffff',
                transition: 'max-width 0.3s ease',
              }}
              onClick={() => setSelectedId(null)}
            >
              {definition.blocks.length === 0 ? (
                emptySlot
              ) : (
                <SortableContext
                  items={definition.blocks.map((b) => b.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <AddBlockBtn onClick={() => setPickerInsertIdx(0)} />
                  <MarketingFormView
                    definition={definition}
                    embedToken={embedToken}
                    preview
                    flatCanvas
                    formTitle={name}
                    builder={builderOpts}
                    wrapBlock={wrapBlock}
                    emptyCanvasSlot={null}
                    onPreviewSubmit={() => setCanvasHint('Preview only — not submitted')}
                  />
                  {/* Tail "drop at end" indicator — appears when dragging palette
                      but no block is hovered. */}
                  {activePaletteType !== null && dropTarget === null && (
                    <div className="pointer-events-none py-1">
                      <div style={{ borderTop: '2px solid #1b1b1b' }}>
                        <span
                          className="text-[10px] font-semibold text-white rounded px-1.5 py-0.5"
                          style={{ background: '#1b1b1b', lineHeight: 1.4 }}
                        >
                          {PALETTE.find((p) => p.type === activePaletteType)?.label} — drop to add at end
                        </span>
                      </div>
                    </div>
                  )}
                </SortableContext>
              )}
            </div>

            <DragOverlay dropAnimation={null}>
              {activePaletteType
                ? (() => {
                    const item = PALETTE.find((p) => p.type === activePaletteType);
                    if (!item) return null;
                    const Icon = BLOCK_TYPE_ICONS[item.type];
                    return (
                      <div
                        className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-xl opacity-90 pointer-events-none"
                        style={{ width: 220 }}
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                          <Icon size={15} className="text-gray-500" />
                        </div>
                        <p className="text-sm font-medium text-gray-800">{item.label}</p>
                      </div>
                    );
                  })()
                : null}
            </DragOverlay>
          </div>

          {/* ── Right Panel ────────────────────────────────────────────────── */}
          {/* Form-level configuration (post-submit, theme, inbox) lives in the
              header Settings modal; the right rail is only ever the block
              palette or the active block's inspector. */}
          <aside
            className="w-80 flex-shrink-0 flex flex-col overflow-hidden"
            style={{ background: '#f4f4f5', padding: '12px 0 12px 32px', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div aria-hidden style={{
              position: 'absolute', top: 0, left: 0, bottom: 0, width: 32,
              background: 'linear-gradient(to right, #ffffff 0%, transparent 100%)',
              pointerEvents: 'none', zIndex: 5,
            }} />
            <div
              className="fb-scroll-pane flex-1 overflow-y-auto"
              style={
                {
                  background: '#ffffff',
                  borderTopLeftRadius: 12,
                  borderBottomLeftRadius: 12,
                  overscrollBehavior: 'contain',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  minHeight: 0,
                } as CSSProperties
              }
            >
              {selected ? (
                <div className="p-5">
                  <BlockInspector
                    block={selected}
                    onChange={patchSelected}
                    onRemove={() => removeBlock(selected.id)}
                    onDuplicate={() => duplicateOne(selected.id)}
                    onDeselect={() => setSelectedId(null)}
                    onRequestMediaPick={handleRequestMediaPick}
                  />
                </div>
              ) : (
                <div className="p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Blocks
                  </p>
                  <p className="mb-4 text-[11px] text-gray-400">
                    Drag a block onto the canvas, or click a block on the canvas to edit it.
                  </p>
                  <div className="flex flex-col gap-2">
                    {PALETTE.map((item) => (
                      <PaletteCard key={item.type} {...item} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Undo/Redo + saved status */}
            <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3 flex items-center gap-3 bg-white">
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 disabled:opacity-30 transition-colors"
              >
                <Undo2 size={14} /> Undo
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 disabled:opacity-30 transition-colors"
              >
                <Redo2 size={14} /> Redo
              </button>
              <span className="ml-auto text-[12px] text-gray-400 truncate max-w-[10rem]">
                {saveStatusLine}
              </span>
            </div>
          </aside>
        </div>
      </DndContext>

      {/* ─── Modals ─────────────────────────────────────────────────────── */}

      {/* Block picker (centered grid) */}
      {pickerInsertIdx !== null && (
        <BlockPickerModal
          onSelect={(type) => addBlockAt(pickerInsertIdx, type)}
          onClose={() => setPickerInsertIdx(null)}
        />
      )}

      {/* Live preview */}
      {previewOpen && (
        <PreviewModal
          embedUrl={embedUrl}
          formTitle={name}
          published={published}
          definition={definition}
          embedToken={embedToken}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* Form-level Settings (Settings / Theme / Inbox) */}
      {settingsOpen && (
        <FormSettingsModal
          initialTab={settingsTab}
          formName={name}
          onFormNameChange={patchName}
          settings={definition.settings}
          postSubmit={definition.postSubmit}
          theme={mergedTheme}
          blocks={definition.blocks}
          submissions={submissions}
          submissionsLoading={submissionsLoading}
          onSettingsChange={patchSettings}
          onPostSubmitChange={patchPostSubmit}
          onThemeChange={patchTheme}
          onPreviewThankYou={() => setThankYouOpen(true)}
          onDeleteForm={handleDeleteForm}
          deletingForm={deletingForm}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Embed snippet */}
      {embedOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setEmbedOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">Embed this form</h2>
              <button
                type="button"
                onClick={() => setEmbedOpen(false)}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                aria-label="Close embed"
              >
                <XIcon size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Paste this iframe on your site. Styling follows your theme below.
            </p>
            <p className="mt-4 text-xs font-medium text-gray-500">Public URL</p>
            <code className="mt-1 block break-all rounded-lg bg-gray-50 p-2 text-[11px] text-gray-800 border border-gray-100">
              {embedUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyEmbed()}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 text-sm font-medium hover:bg-gray-50"
            >
              <Copy size={16} />
              {copied ? 'Copied iframe HTML' : 'Copy iframe HTML'}
            </button>
            <textarea
              readOnly
              className="mt-3 h-28 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-2 font-mono text-[11px]"
              value={iframeSnippet}
            />
            {!published && (
              <p className="mt-3 text-xs text-amber-700">
                Publish the form so the embed URL works for visitors.
              </p>
            )}
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setEmbedOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Thank-you preview */}
      {thankYouOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setThankYouOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">Thank-you preview</h2>
              <button
                type="button"
                onClick={() => setThankYouOpen(false)}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                aria-label="Close preview"
              >
                <XIcon size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              This is what visitors see after a successful submit (unless you redirect).
            </p>
            <div className="mt-4 rounded-xl border border-green-100 bg-green-50 p-4 text-sm text-green-900">
              {resolvedThankYou.mode === 'redirect' ? (
                <p>Visitors leave to: {resolvedThankYou.redirectUrl || '(set a URL)'}</p>
              ) : (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(resolvedThankYou.messageHtml) }}
                />
              )}
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setThankYouOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Media picker */}
      <VenueMediaPickerModal
        open={mediaPickerOpen}
        onOpenChange={setMediaPickerOpen}
        mode={mediaPickerMode}
        onSelect={(url) => {
          mediaApplyRef.current(url);
          setMediaPickerOpen(false);
        }}
      />

      {/* Hint chip — shows when interacting with preview submit while in preview mode */}
      {canvasHint && (
        <div
          className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-full bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white shadow-lg"
          role="status"
        >
          {canvasHint}
        </div>
      )}

      {/* Hidden ChevronRight import keeps tree-shaker happy when breadcrumbs are
          suppressed; safe to leave unused in some viewports. */}
      <ChevronRight size={0} className="hidden" aria-hidden />
    </div>
  );
}
