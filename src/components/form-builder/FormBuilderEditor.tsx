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
  type ReactNode,
} from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Building2,
  Calendar,
  ChevronDown,
  CircleDot,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  Files,
  FileText,
  GripVertical,
  Hash,
  Heading,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  ListChecks,
  ListFilter,
  Loader2,
  Mail,
  MapPin,
  Minus,
  Monitor,
  MousePointerClick,
  Phone as PhoneIcon,
  Plus,
  Redo2,
  Save,
  Send,
  Settings,
  Smartphone,
  Sparkles,
  Undo2,
  Upload,
  User,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import RichTextEditor from '@/components/RichTextEditor';
import {
  MarketingFormView,
  type VenueContactInfo,
} from '@/components/marketing-form/MarketingFormView';
import { useFormHistory } from '@/hooks/useFormHistory';
import {
  type FormBlock,
  type FormBlockStyle,
  type FormBlockType,
  type MarketingFormDefinition,
  type PostSubmitConfig,
  createBlock,
  defaultPostSubmit,
  duplicateBlock,
  mergeTheme,
  resolvePostSubmit,
} from '@/lib/marketing-form-schema';
import { sanitizeFormHtml } from '@/lib/sanitize-form-html';

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

const BLOCK_TYPE_ICONS: Record<FormBlockType, LucideIcon> = {
  heading: Heading,
  rich_text: FileText,
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
  venue_contact: Building2,
  submit: Send,
  button: MousePointerClick,
  html: Code2,
};

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
  { type: 'venue_contact', label: 'Venue contact' },
  { type: 'submit', label: 'Submit' },
  { type: 'button', label: 'Button' },
  { type: 'html', label: 'HTML' },
];

const SETTINGS_SELECT =
  'w-full cursor-pointer appearance-none rounded border border-gray-200 bg-white py-2 pl-3 pr-9 text-[13px] text-gray-900 transition hover:border-gray-300 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200';

const SETTINGS_INPUT =
  'w-full rounded border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200';

function formatSavedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function parseSizeToPx(fs: string | undefined): number {
  if (!fs?.trim()) return 38;
  const px = fs.match(/^(\d+(?:\.\d+)?)px$/i);
  if (px) return Math.min(96, Math.max(12, Math.round(Number(px[1]))));
  const rem = fs.match(/^(\d+(?:\.\d+)?)rem$/i);
  if (rem) return Math.min(96, Math.max(12, Math.round(Number(rem[1]) * 16)));
  return 38;
}

function parseLineHeight(lh: string | undefined): number {
  if (!lh?.trim()) return 1.4;
  const n = Number.parseFloat(lh);
  if (Number.isFinite(n) && n > 0) return Math.min(2.5, Math.max(1, n));
  return 1.4;
}

function SettingsPanelTitle({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-6 text-center ${className}`}>
      <h3 className="text-[15px] font-medium tracking-tight text-gray-900">{children}</h3>
      <div className="mx-auto mt-3 h-px w-full max-w-[220px] bg-gray-200/90" />
    </div>
  );
}

function SettingsFieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-medium text-gray-500">{children}</span>;
}

function SettingsRow({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <SettingsFieldLabel>{label}</SettingsFieldLabel>
        {right !== undefined && right !== null ? (
          <span className="text-[13px] tabular-nums text-gray-900">{right}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SettingsSelectWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        strokeWidth={2}
        aria-hidden
      />
    </div>
  );
}

function patchBlock(blocks: FormBlock[], id: string, patch: Partial<FormBlock>): FormBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
}

function PaletteDraggable({
  type,
  label,
  onQuickAdd,
}: {
  type: FormBlockType;
  label: string;
  onQuickAdd: (t: FormBlockType) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { kind: 'palette', blockType: type, label } satisfies PaletteDrag,
  });
  const Icon = BLOCK_TYPE_ICONS[type];
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`group flex cursor-grab touch-none items-center gap-2 rounded-md border border-gray-200/80 bg-white px-2 py-2 text-[13px] text-gray-800 transition hover:border-gray-300 active:cursor-grabbing ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-[#fafafa] text-gray-600">
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        title={`Add ${label}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onQuickAdd(type)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-800 group-hover:opacity-100"
      >
        <Plus size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

function SortableCanvasRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex gap-1 ${isDragging ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        className="mt-1 flex h-8 w-7 shrink-0 touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function CanvasEmptyDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-empty' });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
        isOver ? 'border-brand-500 bg-brand-50/80 text-brand-900' : 'border-gray-200 bg-gray-50/50 text-gray-500'
      }`}
    >
      <Sparkles className="h-10 w-10 opacity-40" strokeWidth={1.25} aria-hidden />
      <div>
        <p className="text-[15px] font-semibold text-gray-800">Start your form</p>
        <p className="mt-1.5 max-w-[260px] text-[13px] leading-snug text-gray-500">
          Drag a module from Sections, click + on a row, or pick a block type to add your first field.
        </p>
      </div>
    </div>
  );
}

function CanvasTailDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-tail' });
  return (
    <div
      ref={setNodeRef}
      className={`mt-2 rounded-md border border-dashed px-2 py-2 text-center text-xs transition ${
        isOver ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-transparent text-gray-400'
      }`}
    >
      Drop to add at end
    </div>
  );
}

/** Horizontal insertion line shown while dragging over a drop target. */
function DropInsertionMarker({ showLabel }: { showLabel?: boolean }) {
  return (
    <div className="pointer-events-none relative z-[5] -mx-1 mb-3" aria-hidden>
      {showLabel ? (
        <div className="mb-1.5 flex justify-center">
          <span className="rounded-full border border-white/20 bg-brand-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
            Drop here
          </span>
        </div>
      ) : null}
      <div className="h-[5px] rounded-full border border-brand-700/40 bg-brand-600 animate-pulse" />
    </div>
  );
}

function useFormBuilderScrollbar() {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      setScrolling(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setScrolling(false), 750);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);
  return {
    ref,
    className: `sp-form-scrollbar ${scrolling ? 'sp-form-scrollbar--scrolling' : ''}`,
  };
}

function BlockStyleFields({
  style,
  onChange,
  googleFontNames,
}: {
  style: FormBlockStyle | undefined;
  onChange: (next: FormBlockStyle) => void;
  googleFontNames: string[];
}) {
  const s = style ?? {};
  const [spacingOpen, setSpacingOpen] = useState(false);

  const fontFamily = s.fontFamily?.trim() ?? '';
  const sizePx = parseSizeToPx(s.fontSize);
  const weight = s.fontWeight ?? '';
  const hex =
    s.color?.startsWith('#') && (s.color.length === 4 || s.color.length === 7) ? s.color : '#000000';
  const align = s.textAlign ?? 'left';
  const isUpper = s.textTransform === 'uppercase';
  const lh = parseLineHeight(s.lineHeight);

  const inCatalog =
    !fontFamily ||
    googleFontNames.length === 0 ||
    googleFontNames.includes(fontFamily);
  const familySelectValue = fontFamily && !inCatalog ? '__custom' : fontFamily;

  const segBtn = (active: boolean) =>
    `flex h-9 flex-1 items-center justify-center rounded-md border text-gray-600 transition ${
      active ? 'border-gray-200 bg-gray-100 text-gray-900' : 'border-transparent bg-transparent hover:bg-gray-50'
    }`;

  return (
    <div>
      <SettingsPanelTitle>Font</SettingsPanelTitle>

      {googleFontNames.length === 0 ? (
        <div className="mb-5 grid grid-cols-2 gap-2">
          <div>
            <SettingsFieldLabel>Family</SettingsFieldLabel>
            <div className="mt-1.5">
              <input
                className={SETTINGS_INPUT}
                placeholder="e.g. Montserrat"
                value={fontFamily}
                onChange={(e) => onChange({ ...s, fontFamily: e.target.value.trim() || undefined })}
              />
            </div>
          </div>
          <div>
            <SettingsFieldLabel>Weight</SettingsFieldLabel>
            <div className="mt-1.5">
              <SettingsSelectWrap>
                <select
                  className={SETTINGS_SELECT}
                  value={weight}
                  onChange={(e) => onChange({ ...s, fontWeight: e.target.value || undefined })}
                >
                  <option value="">Default</option>
                  <option value="400">Regular</option>
                  <option value="500">Medium</option>
                  <option value="600">Semibold</option>
                  <option value="700">Bold</option>
                </select>
              </SettingsSelectWrap>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2">
            <div>
              <SettingsFieldLabel>Family</SettingsFieldLabel>
              <div className="mt-1.5">
                <SettingsSelectWrap>
                  <select
                    className={SETTINGS_SELECT}
                    value={familySelectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') onChange({ ...s, fontFamily: undefined });
                      else if (v === '__custom') onChange({ ...s, fontFamily: 'Montserrat' });
                      else onChange({ ...s, fontFamily: v });
                    }}
                  >
                    <option value="">Theme default</option>
                    {googleFontNames.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                    <option value="__custom">Custom…</option>
                  </select>
                </SettingsSelectWrap>
              </div>
            </div>
            <div>
              <SettingsFieldLabel>Weight</SettingsFieldLabel>
              <div className="mt-1.5">
                <SettingsSelectWrap>
                  <select
                    className={SETTINGS_SELECT}
                    value={weight}
                    onChange={(e) => onChange({ ...s, fontWeight: e.target.value || undefined })}
                  >
                    <option value="">Default</option>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                  </select>
                </SettingsSelectWrap>
              </div>
            </div>
          </div>

          {!inCatalog && (
            <SettingsRow label="Custom name">
              <input
                className={SETTINGS_INPUT}
                placeholder="e.g. Montserrat"
                value={fontFamily}
                onChange={(e) => onChange({ ...s, fontFamily: e.target.value.trim() || undefined })}
              />
            </SettingsRow>
          )}
        </>
      )}

      <SettingsRow label="Size" right={String(sizePx)}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            onClick={() =>
              onChange({ ...s, fontSize: `${Math.max(12, sizePx - 1)}px` })
            }
          >
            <Minus className="h-4 w-4" strokeWidth={2} />
          </button>
          <input
            type="range"
            min={12}
            max={96}
            value={sizePx}
            onChange={(e) => onChange({ ...s, fontSize: `${e.target.value}px` })}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900"
          />
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            onClick={() =>
              onChange({ ...s, fontSize: `${Math.min(96, sizePx + 1)}px` })
            }
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </SettingsRow>

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <SettingsFieldLabel>Font color</SettingsFieldLabel>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] uppercase text-gray-900">{hex}</span>
            <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-gray-200">
              <input
                type="color"
                className="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer p-0"
                value={hex}
                onChange={(e) => onChange({ ...s, color: e.target.value })}
              />
            </label>
          </div>
        </div>
      </div>

      <SettingsRow label="Alignment">
        <div className="flex gap-1 rounded-lg border border-gray-100 bg-gray-50/80 p-0.5">
          {(
            [
              ['left', AlignLeft],
              ['center', AlignCenter],
              ['right', AlignRight],
            ] as const
          ).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              className={segBtn(align === key)}
              onClick={() => onChange({ ...s, textAlign: key })}
              title={key}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsRow label="Case">
        <div className="flex gap-1 rounded-lg border border-gray-100 bg-gray-50/80 p-0.5">
          <button
            type="button"
            className={segBtn(!isUpper)}
            onClick={() => onChange({ ...s, textTransform: 'none' })}
          >
            <span className="text-[13px] font-medium">Aa</span>
          </button>
          <button
            type="button"
            className={segBtn(isUpper)}
            onClick={() => onChange({ ...s, textTransform: 'uppercase' })}
          >
            <span className="text-[12px] font-semibold tracking-wide">AA</span>
          </button>
        </div>
      </SettingsRow>

      <div className="mb-2 mt-4 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => setSpacingOpen((o) => !o)}
          className="flex w-full items-center justify-between py-1 text-left"
        >
          <SettingsFieldLabel>Spacing</SettingsFieldLabel>
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition ${spacingOpen ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </button>
        {spacingOpen ? (
          <div className="mt-3 pl-0">
            <SettingsRow label="Line height" right={lh.toFixed(2)}>
              <input
                type="range"
                min={100}
                max={250}
                value={Math.round(lh * 100)}
                onChange={(e) =>
                  onChange({
                    ...s,
                    lineHeight: String(Number(e.target.value) / 100),
                  })
                }
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900"
              />
            </SettingsRow>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function humanizeBlockType(type: FormBlockType): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function BlockInspector({
  block,
  onChange,
  onRemove,
  onDuplicate,
  googleFontNames,
}: {
  block: FormBlock;
  onChange: (patch: Partial<FormBlock>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  googleFontNames: string[];
}) {
  const optsText = (block.options || []).join('\n');

  return (
    <div className="text-[13px] text-gray-900">
      {block.type !== 'heading' ? (
        <SettingsPanelTitle className="mb-5">{humanizeBlockType(block.type)}</SettingsPanelTitle>
      ) : null}

      {block.type === 'venue_contact' ? (
        <p className="mb-5 text-[12px] leading-relaxed text-gray-500">
          Shows your venue name, email, phone, and address from{' '}
          <Link href="/dashboard/settings/branding" className="text-gray-900 underline underline-offset-2 hover:text-gray-700">
            Settings → Branding
          </Link>
          . Add this block again if you removed it.
        </p>
      ) : null}

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
          <SettingsRow label="Label">
            <input
              className={SETTINGS_INPUT}
              value={block.label ?? ''}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </SettingsRow>
          {block.type !== 'date' &&
          block.type !== 'file' &&
          block.type !== 'radio' &&
          block.type !== 'checkbox_group' ? (
            <SettingsRow label="Placeholder">
              <input
                className={SETTINGS_INPUT}
                value={block.placeholder ?? ''}
                onChange={(e) => onChange({ placeholder: e.target.value })}
              />
            </SettingsRow>
          ) : null}
          <label className="mb-5 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
              checked={!!block.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            <span className="text-[13px] text-gray-700">Required</span>
          </label>
        </>
      )}

      {block.type === 'heading' && (
        <>
          <SettingsRow label="Heading level">
            <SettingsSelectWrap>
              <select
                className={SETTINGS_SELECT}
                value={block.level ?? 2}
                onChange={(e) => onChange({ level: Number(e.target.value) as FormBlock['level'] })}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    H{n}
                  </option>
                ))}
              </select>
            </SettingsSelectWrap>
          </SettingsRow>
          <SettingsRow label="Text">
            <input
              className={SETTINGS_INPUT}
              value={block.content ?? ''}
              onChange={(e) => onChange({ content: e.target.value })}
            />
          </SettingsRow>
          <BlockStyleFields
            style={block.style}
            googleFontNames={googleFontNames}
            onChange={(st) => onChange({ style: { ...block.style, ...st } })}
          />
        </>
      )}

      {block.type === 'rich_text' && (
        <SettingsRow label="Content">
          <div className="rounded-md border border-gray-200 bg-white p-1">
            <RichTextEditor
              content={block.content || '<p></p>'}
              onChange={(html: string) => onChange({ content: html })}
              minHeight={160}
            />
          </div>
        </SettingsRow>
      )}

      {block.type === 'html' && (
        <SettingsRow label="HTML (sanitized when shown)">
          <textarea
            className="min-h-[160px] w-full rounded border border-gray-200 bg-white px-3 py-2 font-mono text-[12px] text-gray-900 focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200"
            value={block.content ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
          />
        </SettingsRow>
      )}

      {(block.type === 'radio' || block.type === 'select' || block.type === 'checkbox_group') && (
        <SettingsRow label="Options (one per line)">
          <textarea
            className="min-h-[120px] w-full rounded border border-gray-200 bg-white px-3 py-2 text-[13px] focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200"
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
        </SettingsRow>
      )}

      {block.type === 'image' && (
        <>
          <SettingsRow label="Image URL">
            <input
              className={SETTINGS_INPUT}
              value={block.src ?? ''}
              onChange={(e) => onChange({ src: e.target.value })}
              placeholder="https://"
            />
          </SettingsRow>
          <SettingsRow label="Alt text">
            <input
              className={SETTINGS_INPUT}
              value={block.alt ?? ''}
              onChange={(e) => onChange({ alt: e.target.value })}
            />
          </SettingsRow>
        </>
      )}

      {(block.type === 'submit' || block.type === 'button') && (
        <>
          <SettingsRow label="Label">
            <input
              className={SETTINGS_INPUT}
              value={block.buttonLabel ?? ''}
              onChange={(e) => onChange({ buttonLabel: e.target.value })}
            />
          </SettingsRow>
          {block.type === 'button' && (
            <>
              <SettingsRow label="Link (https)">
                <input
                  className={SETTINGS_INPUT}
                  value={block.href ?? ''}
                  onChange={(e) => onChange({ href: e.target.value })}
                  placeholder="https://"
                />
              </SettingsRow>
              <SettingsRow label="Style">
                <SettingsSelectWrap>
                  <select
                    className={SETTINGS_SELECT}
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
                </SettingsSelectWrap>
              </SettingsRow>
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
        <SettingsRow label="Hint (optional)">
          <input
            className={SETTINGS_INPUT}
            value={block.hint ?? ''}
            onChange={(e) => onChange({ hint: e.target.value })}
          />
        </SettingsRow>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-5">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-800 transition hover:bg-gray-50"
          onClick={onDuplicate}
        >
          <Files size={14} strokeWidth={2} aria-hidden />
          Duplicate
        </button>
        <button
          type="button"
          className="text-[13px] font-medium text-red-600 underline-offset-2 transition hover:text-red-700 hover:underline"
          onClick={() => {
            if (typeof window !== 'undefined' && window.confirm('Remove this block from the form?')) {
              onRemove();
            }
          }}
        >
          Remove block
        </button>
      </div>
    </div>
  );
}

function ThemeInspector({
  theme,
  onChange,
  fontDatalistId,
}: {
  theme: ReturnType<typeof mergeTheme>;
  onChange: (t: MarketingFormDefinition['theme']) => void;
  fontDatalistId: string;
}) {
  const T = theme;
  const row = (key: keyof ReturnType<typeof mergeTheme>, label: string) => (
    <SettingsRow key={String(key)} label={label}>
      {key === 'fontFamily' ? (
        <input
          className={`${SETTINGS_INPUT} font-mono text-[12px]`}
          value={T[key]}
          onChange={(e) => onChange({ [key]: e.target.value })}
          list={fontDatalistId}
        />
      ) : (
        <input
          className={SETTINGS_INPUT}
          value={T[key]}
          onChange={(e) => onChange({ [key]: e.target.value })}
        />
      )}
    </SettingsRow>
  );

  return (
    <div className="text-[13px] text-gray-900">
      <SettingsPanelTitle>Theme</SettingsPanelTitle>
      {row('maxWidth', 'Max width')}
      {row('primaryColor', 'Primary / button')}
      {row('background', 'Page background')}
      {row('surface', 'Card background')}
      {row('fontFamily', 'Font stack')}
      {row('borderRadius', 'Corner radius')}
      {row('labelColor', 'Label color')}
      {row('inputBorder', 'Field border')}
      {row('mutedColor', 'Muted text')}
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
    <div className="text-[13px] text-gray-900">
      <div className="mb-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-medium tracking-tight text-gray-900">After submit</h3>
          {onPreviewThankYou ? (
            <button
              type="button"
              onClick={onPreviewThankYou}
              className="shrink-0 text-[12px] font-medium text-gray-500 underline decoration-gray-300 underline-offset-2 transition hover:text-gray-900"
            >
              Preview thanks
            </button>
          ) : null}
        </div>
        <div className="mt-3 h-px w-full bg-gray-200/90" />
      </div>
      <SettingsRow label="After submit">
        <SettingsSelectWrap>
          <select
            className={SETTINGS_SELECT}
            value={mode}
            onChange={(e) => {
              const m = e.target.value as PostSubmitConfig['mode'];
              onChange({ ...p, mode: m });
            }}
          >
            <option value="default">Short thank-you message</option>
            <option value="inline_message">Custom message (same page)</option>
            <option value="redirect">Redirect to URL</option>
          </select>
        </SettingsSelectWrap>
      </SettingsRow>
      {mode === 'inline_message' ? (
        <SettingsRow label="Message (HTML)">
          <textarea
            className="min-h-[140px] w-full rounded border border-gray-200 bg-white px-3 py-2 font-mono text-[12px] focus:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200"
            value={p.messageHtml ?? ''}
            onChange={(e) => onChange({ ...p, messageHtml: e.target.value })}
          />
        </SettingsRow>
      ) : null}
      {mode === 'redirect' ? (
        <SettingsRow label="Redirect URL">
          <input
            className={SETTINGS_INPUT}
            value={p.redirectUrl ?? ''}
            onChange={(e) => onChange({ ...p, redirectUrl: e.target.value })}
            placeholder="https://…"
          />
        </SettingsRow>
      ) : null}
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
  const initialSnapshot: EditorSnapshot = useMemo(
    () => ({
      definition: initialDefinition,
      name: initialName,
      published: initialPublished,
    }),
    [initialDefinition, initialName, initialPublished]
  );

  const { present, set, undo, redo, reset, canUndo, canRedo } = useFormHistory(initialSnapshot);

  const { definition, name, published } = present;

  const [selectedId, setSelectedId] = useState<string | null>(
    initialDefinition.blocks[0]?.id ?? null
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
  const [rightTab, setRightTab] = useState<
    'block' | 'settings' | 'theme' | 'submissions' | 'versions'
  >('block');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<PaletteDrag | null>(null);
  const [dropOverId, setDropOverId] = useState<string | null>(null);
  const [canvasDragId, setCanvasDragId] = useState<string | null>(null);
  const [venueContact, setVenueContact] = useState<VenueContactInfo | null>(null);
  const [googleFontNames, setGoogleFontNames] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<{ id: string; payload: unknown; created_at: string }[]>(
    []
  );
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [revisions, setRevisions] = useState<
    { id: string; createdAt: string; definition: MarketingFormDefinition }[]
  >([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);

  const presentRef = useRef(present);
  presentRef.current = present;
  const lastPersistedJsonRef = useRef(JSON.stringify(present));
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modulesScroll = useFormBuilderScrollbar();
  const canvasScroll = useFormBuilderScrollbar();
  const settingsScroll = useFormBuilderScrollbar();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/fonts/google');
        const j = (await res.json()) as { families?: string[] };
        if (!cancelled && Array.isArray(j.families)) setGoogleFontNames(j.families);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venues/me');
        if (!res.ok) return;
        const v = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        const city = typeof v.brand_city === 'string' ? v.brand_city : '';
        const state = typeof v.brand_state === 'string' ? v.brand_state : '';
        const zip = typeof v.brand_zip === 'string' ? v.brand_zip : '';
        const line2 = [city, state, zip].filter(Boolean).join(', ');
        const addrParts = [typeof v.brand_address === 'string' ? v.brand_address : '', line2].filter(
          Boolean
        );
        setVenueContact({
          venueName: typeof v.name === 'string' ? v.name : null,
          email: typeof v.brand_email === 'string' ? v.brand_email : null,
          phone: typeof v.brand_phone === 'string' ? v.brand_phone : null,
          addressLine: addrParts.length ? addrParts.join('\n') : null,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(viewportStorageKey, viewport);
    } catch {
      /* ignore */
    }
  }, [viewport, viewportStorageKey]);

  useEffect(() => {
    if (!canvasHint) return;
    const t = setTimeout(() => setCanvasHint(null), 3500);
    return () => clearTimeout(t);
  }, [canvasHint]);

  useEffect(() => {
    if (rightTab !== 'submissions') return;
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
  }, [rightTab, formId]);

  useEffect(() => {
    if (rightTab !== 'versions') return;
    let cancelled = false;
    setRevisionsLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/marketing/forms/${formId}/revisions`);
        const j = (await res.json()) as {
          revisions?: { id: string; createdAt: string; definition: MarketingFormDefinition }[];
        };
        if (!cancelled && j.revisions) setRevisions(j.revisions);
      } finally {
        if (!cancelled) setRevisionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rightTab, formId]);

  useEffect(() => {
    if (!selectedId) return;
    if (!definition.blocks.some((b) => b.id === selectedId)) {
      setSelectedId(definition.blocks[0]?.id ?? null);
    }
  }, [definition.blocks, selectedId]);

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
        if (source === 'manual') setPersistError(null);
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
      } finally {
        if (source === 'manual') setSaving(false);
        else setAutoSaving(false);
      }
    },
    [formId, clearAutosaveTimer]
  );

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewOpen) {
        e.preventDefault();
        setPreviewOpen(false);
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
  }, [previewOpen, embedOpen, thankYouOpen]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selected = useMemo(
    () => definition.blocks.find((b) => b.id === selectedId) ?? null,
    [definition.blocks, selectedId]
  );

  const mergedTheme = useMemo(() => mergeTheme(definition.theme), [definition.theme]);

  const setSnapshot = useCallback(
    (fn: (s: EditorSnapshot) => EditorSnapshot) => {
      set(fn);
    },
    [set]
  );

  const patchDefinition = useCallback(
    (fn: (d: MarketingFormDefinition) => MarketingFormDefinition) => {
      setSnapshot((s) => ({ ...s, definition: fn(s.definition) }));
    },
    [setSnapshot]
  );

  const patchPostSubmit = useCallback(
    (next: PostSubmitConfig) => {
      patchDefinition((d) => ({ ...d, postSubmit: next }));
    },
    [patchDefinition]
  );

  const addBlock = useCallback(
    (type: FormBlockType) => {
      const nb = createBlock(type);
      patchDefinition((d) => ({ ...d, blocks: [...d.blocks, nb] }));
      setSelectedId(nb.id);
    },
    [patchDefinition]
  );

  const removeBlock = useCallback(
    (id: string) => {
      patchDefinition((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [patchDefinition]
  );

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    const block = definition.blocks.find((b) => b.id === selectedId);
    if (!block) return;
    const clone = duplicateBlock(block);
    patchDefinition((d) => {
      const idx = d.blocks.findIndex((b) => b.id === selectedId);
      if (idx < 0) return d;
      const next = [...d.blocks];
      next.splice(idx + 1, 0, clone);
      return { ...d, blocks: next };
    });
    setSelectedId(clone.id);
  }, [selectedId, definition.blocks, patchDefinition]);

  const patchSelected = useCallback(
    (patch: Partial<FormBlock>) => {
      if (!selectedId) return;
      patchDefinition((d) => ({ ...d, blocks: patchBlock(d.blocks, selectedId, patch) }));
    },
    [selectedId, patchDefinition]
  );

  const patchTheme = useCallback(
    (t: MarketingFormDefinition['theme']) => {
      patchDefinition((d) => ({ ...d, theme: { ...d.theme, ...t } }));
    },
    [patchDefinition]
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setDropOverId(null);
    if (id.startsWith('palette:')) {
      setCanvasDragId(null);
      const type = event.active.data.current?.blockType as FormBlockType;
      const label = (event.active.data.current?.label as string) ?? String(type);
      setActiveDrag({ kind: 'palette', blockType: type, label });
    } else {
      setCanvasDragId(id);
      setActiveDrag(null);
    }
  }, []);

  const onDragOver = useCallback((event: DragOverEvent) => {
    setDropOverId(event.over?.id != null ? String(event.over.id) : null);
  }, []);

  const onDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveDrag(null);
    setDropOverId(null);
    setCanvasDragId(null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveDrag(null);
      setDropOverId(null);
      setCanvasDragId(null);
      if (!over) return;

      const activeId = String(active.id);
      const overId = String(over.id);
      const isPalette = activeId.startsWith('palette:');

      if (isPalette) {
        const type = active.data.current?.blockType as FormBlockType | undefined;
        if (!type) return;
        const nb = createBlock(type);
        patchDefinition((d) => {
          const blocks = [...d.blocks];
          if (overId === 'canvas-empty' || overId === 'canvas-tail') {
            blocks.push(nb);
          } else {
            const idx = blocks.findIndex((b) => b.id === overId);
            if (idx >= 0) blocks.splice(idx, 0, nb);
            else blocks.push(nb);
          }
          return { ...d, blocks };
        });
        setSelectedId(nb.id);
        return;
      }

      if (activeId === overId) return;

      patchDefinition((d) => {
        const blocks = [...d.blocks];
        const oldIndex = blocks.findIndex((b) => b.id === activeId);
        if (oldIndex < 0) return d;

        if (overId === 'canvas-tail') {
          const [moved] = blocks.splice(oldIndex, 1);
          if (moved) blocks.push(moved);
          return { ...d, blocks };
        }

        const newIndex = blocks.findIndex((b) => b.id === overId);
        if (newIndex < 0) return d;
        return { ...d, blocks: arrayMove(blocks, oldIndex, newIndex) };
      });
    },
    [patchDefinition]
  );

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

  const builderOpts = useMemo(
    () => ({
      selectedId,
      onSelectBlock: setSelectedId,
      onPatchBlock: (id: string, patch: Partial<FormBlock>) => {
        patchDefinition((d) => ({ ...d, blocks: patchBlock(d.blocks, id, patch) }));
      },
    }),
    [selectedId, patchDefinition]
  );

  const wrapBlock = useCallback(
    (block: FormBlock, node: ReactNode) => {
      const showLineBefore =
        dropOverId === block.id && (canvasDragId == null || canvasDragId !== block.id);
      return (
        <>
          {showLineBefore ? <DropInsertionMarker showLabel={activeDrag != null} /> : null}
          <SortableCanvasRow id={block.id}>{node}</SortableCanvasRow>
        </>
      );
    },
    [dropOverId, canvasDragId, activeDrag]
  );

  const emptySlot = useMemo(() => <CanvasEmptyDrop />, []);

  const viewportMax = viewport === 'mobile' ? 390 : 1200;

  const resolvedThankYou = useMemo(
    () => resolvePostSubmit(definition),
    [definition]
  );

  return (
    <div className="flex min-h-0 w-full min-w-0 max-w-none flex-1 flex-col overflow-x-hidden bg-white">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-gray-500 sm:gap-3">
            <Link
              href="/dashboard/marketing/form-builder"
              className="inline-flex shrink-0 items-center gap-1.5 font-medium transition hover:text-gray-900"
            >
              <ArrowLeft size={15} strokeWidth={2} />
              <span className="hidden sm:inline">Lead Capture Forms</span>
            </Link>
            <span className="text-gray-300" aria-hidden>
              ›
            </span>
            <input
              className="min-w-0 max-w-[11rem] border-0 border-b border-transparent bg-transparent py-0.5 text-[12px] font-semibold text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none sm:max-w-xs md:max-w-md"
              value={name}
              placeholder="Untitled"
              onChange={(e) => setSnapshot((s) => ({ ...s, name: e.target.value }))}
              aria-label="Form name"
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[13px] font-medium text-gray-800 transition hover:bg-gray-50"
            >
              <Eye size={15} strokeWidth={2} />
              <span className="hidden sm:inline">Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setRightTab('settings')}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[13px] font-medium text-gray-800 transition hover:bg-gray-50"
            >
              <Settings size={15} strokeWidth={2} />
              <span className="hidden sm:inline">Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setEmbedOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[13px] font-medium text-gray-800 transition hover:bg-gray-50"
            >
              <Code2 size={15} strokeWidth={2} />
              <span className="hidden sm:inline">Embed</span>
            </button>
            <button
              type="button"
              onClick={() => void persistForm('manual')}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] font-medium text-gray-900 transition hover:bg-gray-50 disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} strokeWidth={2} />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setSnapshot((s) => ({ ...s, published: !s.published }))}
              className={`rounded-md px-3 py-2 text-[13px] font-medium transition ${
                published
                  ? 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                  : 'border border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
              }`}
            >
              {published ? 'Published' : 'Publish'}
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden lg:h-[calc(100dvh-9rem)] lg:max-h-[calc(100dvh-9rem)] lg:flex-row lg:items-stretch">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragCancel={onDragCancel}
            onDragEnd={onDragEnd}
          >
            <aside className="flex min-h-0 max-h-[min(44vh,22rem)] w-full shrink-0 flex-col border-b border-gray-200 bg-white lg:max-h-none lg:min-h-0 lg:w-[280px] lg:shrink-0 lg:overflow-hidden lg:border-b-0 lg:border-r">
              <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 px-4">
                <LayoutTemplate size={16} className="shrink-0 text-gray-400" strokeWidth={1.75} />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                  Sections
                </h2>
              </div>
              <div
                ref={modulesScroll.ref}
                className={`min-h-0 grow overflow-y-auto overscroll-contain px-3 pb-4 pt-2 ${modulesScroll.className}`}
              >
                <p className="mb-2 px-1 text-[12px] leading-snug text-gray-400">
                  Drag modules to the canvas or use + to add.
                </p>
                <div className="flex flex-col gap-1.5">
                  {PALETTE.map((p) => (
                    <PaletteDraggable
                      key={p.type}
                      type={p.type}
                      label={p.label}
                      onQuickAdd={addBlock}
                    />
                  ))}
                </div>
              </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-white lg:min-h-0">
              <div className="flex h-14 shrink-0 items-center justify-center border-b border-gray-100 bg-white px-4">
                <div className="inline-flex rounded-full border border-gray-200 bg-white p-0.5">
                  {(
                    [
                      ['desktop', 'Desktop', Monitor] as const,
                      ['mobile', 'Mobile', Smartphone] as const,
                    ]
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setViewport(id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition sm:px-4 ${
                        viewport === id
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <Icon size={14} strokeWidth={2} className="opacity-80" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div
                ref={canvasScroll.ref}
                className={`min-h-0 grow overflow-y-auto overscroll-contain bg-white px-4 py-4 sm:px-6 ${canvasScroll.className}`}
              >
                <SortableContext
                  items={definition.blocks.map((b) => b.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div
                    className="mx-auto w-full transition-[max-width] duration-300 ease-out"
                    style={{ maxWidth: viewportMax }}
                  >
                    <div className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
                      <MarketingFormView
                        definition={definition}
                        embedToken={embedToken}
                        preview
                        flatCanvas
                        formTitle={name}
                        venueContact={venueContact}
                        builder={builderOpts}
                        wrapBlock={wrapBlock}
                        emptyCanvasSlot={emptySlot}
                        onPreviewSubmit={() => setCanvasHint('Preview only — not submitted')}
                      />
                      {definition.blocks.length > 0 ? (
                        <>
                          {dropOverId === 'canvas-tail' ? (
                            <DropInsertionMarker showLabel={activeDrag != null} />
                          ) : null}
                          <CanvasTailDrop />
                        </>
                      ) : null}
                    </div>
                  </div>
                </SortableContext>

                <DragOverlay dropAnimation={null}>
                  {activeDrag ? (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px]">
                      {(() => {
                        const Ic = BLOCK_TYPE_ICONS[activeDrag.blockType];
                        return <Ic size={16} strokeWidth={1.75} className="shrink-0 text-gray-600" aria-hidden />;
                      })()}
                      <span>{activeDrag.label}</span>
                    </div>
                  ) : null}
                </DragOverlay>
              </div>
            </div>

            <aside className="flex min-h-[min(50vh,28rem)] w-full shrink-0 flex-col border-t border-gray-200 bg-[#f9f9f9] lg:min-h-0 lg:w-[320px] lg:shrink-0 lg:overflow-hidden lg:border-l lg:border-t-0">
          <div className="flex h-14 shrink-0 items-stretch border-b border-gray-100 bg-white px-1">
            <div className="flex min-h-0 w-full items-stretch px-1">
              {(
                [
                  ['block', 'Design'],
                  ['settings', 'Settings'],
                  ['theme', 'Theme'],
                  ['submissions', 'Inbox'],
                  ['versions', 'History'],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRightTab(id)}
                  className={`relative min-w-0 flex-1 px-1.5 text-center text-[12px] font-medium transition sm:text-[13px] ${
                    rightTab === id
                      ? 'border-b-2 border-gray-900 text-gray-900'
                      : 'border-b-2 border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <span className="flex h-full items-center justify-center leading-tight">{lab}</span>
                </button>
              ))}
            </div>
          </div>

          <datalist id="storypay-form-gfonts">
            {googleFontNames.map((f) => (
              <option key={f} value={f} />
            ))}
            {googleFontNames.map((f) => (
              <option key={`${f}-stack`} value={`${f}, system-ui, sans-serif`} />
            ))}
          </datalist>

          <div
            ref={settingsScroll.ref}
            className={`min-h-0 grow overflow-y-auto overscroll-contain px-5 py-5 ${settingsScroll.className}`}
          >
            {rightTab === 'block' ? (
              <div>
                {selected ? (
                  <BlockInspector
                    block={selected}
                    onChange={patchSelected}
                    onRemove={() => selectedId && removeBlock(selectedId)}
                    onDuplicate={duplicateSelected}
                    googleFontNames={googleFontNames}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 px-2 py-10 text-center">
                    <MousePointerClick className="h-9 w-9 text-gray-300" strokeWidth={1.25} aria-hidden />
                    <div>
                      <p className="text-[14px] font-medium text-gray-700">Nothing selected</p>
                      <p className="mt-2 max-w-[240px] text-[13px] leading-snug text-gray-400">
                        Click a block on the canvas to edit labels, styling, and field options.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {rightTab === 'settings' ? (
              <PostSubmitInspector
                postSubmit={definition.postSubmit}
                onChange={patchPostSubmit}
                onPreviewThankYou={() => setThankYouOpen(true)}
              />
            ) : null}

            {rightTab === 'theme' ? (
              <ThemeInspector theme={mergedTheme} onChange={patchTheme} fontDatalistId="storypay-form-gfonts" />
            ) : null}

            {rightTab === 'submissions' ? (
              <div className="text-[13px] text-gray-900">
                <SettingsPanelTitle>Inbox</SettingsPanelTitle>
                {submissionsLoading ? (
                  <div className="space-y-3" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="animate-pulse rounded-lg border border-gray-200/80 bg-white p-3"
                      >
                        <div className="h-3 w-36 rounded bg-gray-200" />
                        <div className="mt-3 h-20 rounded bg-gray-100" />
                      </div>
                    ))}
                  </div>
                ) : submissions.length === 0 ? (
                  <p className="text-[13px] text-gray-400">No submissions yet.</p>
                ) : (
                  <ul className="max-h-[min(50vh,480px)] space-y-2 overflow-y-auto">
                    {submissions.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-lg border border-gray-200/80 bg-white p-3"
                      >
                        <p className="text-[12px] font-medium text-gray-700">
                          {new Date(s.created_at).toLocaleString()}
                        </p>
                        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-500">
                          {JSON.stringify(s.payload, null, 2)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {rightTab === 'versions' ? (
              <div className="text-[13px] text-gray-900">
                <SettingsPanelTitle>Versions</SettingsPanelTitle>
                <p className="mb-4 text-[12px] leading-relaxed text-gray-500">
                  Saved when you click Save. Restore replaces the editor — save again to publish.
                </p>
                {revisionsLoading ? (
                  <div className="space-y-2" aria-hidden>
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex animate-pulse items-center justify-between gap-2 rounded-lg border border-gray-200/80 bg-white px-3 py-2.5"
                      >
                        <div className="h-3 w-44 rounded bg-gray-200" />
                        <div className="h-7 w-16 shrink-0 rounded bg-gray-100" />
                      </div>
                    ))}
                  </div>
                ) : revisions.length === 0 ? (
                  <p className="text-[13px] text-gray-400">No versions yet.</p>
                ) : (
                  <ul className="max-h-[min(50vh,480px)] space-y-2 overflow-y-auto">
                    {revisions.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/80 bg-white px-3 py-2.5"
                      >
                        <span className="text-[12px] text-gray-700">
                          {new Date(r.createdAt).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
                          onClick={() => {
                            if (
                              typeof window !== 'undefined' &&
                              window.confirm('Replace the canvas with this version?')
                            ) {
                              reset({
                                ...present,
                                definition: r.definition,
                              });
                              setSelectedId(r.definition.blocks[0]?.id ?? null);
                              setRightTab('block');
                            }
                          }}
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-gray-200/90 bg-white px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div>
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    onClick={undo}
                    disabled={!canUndo}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-600 hover:text-gray-900 disabled:opacity-30"
                  >
                    <Undo2 size={15} strokeWidth={1.75} /> Undo
                  </button>
                  <button
                    type="button"
                    onClick={redo}
                    disabled={!canRedo}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-600 hover:text-gray-900 disabled:opacity-30"
                  >
                    <Redo2 size={15} strokeWidth={1.75} /> Redo
                  </button>
                </div>
                <p className="mt-1.5 hidden text-[11px] text-gray-400 sm:block">
                  ⌘Z undo · ⌘⇧Z redo
                </p>
              </div>
              <span className="text-right text-[12px] text-gray-500 sm:max-w-[min(100%,14rem)] sm:shrink-0">
                {saving || autoSaving
                  ? 'Saving…'
                  : persistError
                    ? persistError
                    : canvasHint
                      ? canvasHint
                      : lastSavedAt
                        ? `Saved · ${formatSavedTime(lastSavedAt)}`
                        : ''}
              </span>
            </div>
          </div>
        </aside>
          </DndContext>
        </div>
      </div>

      {previewOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="form-preview-title"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="form-preview-title" className="text-lg font-semibold text-gray-900">
                  Form preview
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  How visitors see your form (theme, labels, and fields). Submit is disabled.
                </p>
                <a
                  href={embedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  <ExternalLink size={14} strokeWidth={2} aria-hidden />
                  Open in new tab
                </a>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <div className="mt-6 rounded-xl border border-gray-100 bg-[#f3f4f6] p-4 sm:p-6">
              <MarketingFormView
                definition={definition}
                embedToken={embedToken}
                preview
                formTitle={name}
                venueContact={venueContact}
                onPreviewSubmit={() => setCanvasHint('Preview only — not submitted')}
              />
            </div>
          </div>
        </div>
      ) : null}

      {embedOpen ? (
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
            <h2 className="text-lg font-semibold text-gray-900">Embed this form</h2>
            <p className="mt-2 text-sm text-gray-600">
              Paste this iframe on your site. Styling follows your theme below.
            </p>
            <p className="mt-4 text-xs font-medium text-gray-500">Public URL</p>
            <code className="mt-1 block break-all rounded bg-gray-50 p-2 text-[11px] text-gray-800">{embedUrl}</code>
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
              className="mt-3 h-28 w-full resize-none rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px]"
              value={iframeSnippet}
            />
            {!published ? (
              <p className="mt-3 text-xs text-amber-700">Publish the form so the embed URL works for visitors.</p>
            ) : null}
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setEmbedOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {thankYouOpen ? (
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
            <h2 className="text-lg font-semibold text-gray-900">Thank you preview</h2>
            <p className="mt-2 text-sm text-gray-600">
              This is what visitors see after a successful submit (unless you redirect).
            </p>
            <div className="mt-4 rounded-lg border border-green-100 bg-green-50 p-4 text-sm text-green-900">
              {resolvedThankYou.mode === 'redirect' ? (
                <p>Visitors leave to: {resolvedThankYou.redirectUrl || '(set a URL)'}</p>
              ) : (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeFormHtml(resolvedThankYou.messageHtml),
                  }}
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
      ) : null}
    </div>
  );
}
