'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  AlignLeft, ArrowLeft, ArrowUp, ArrowDown,
  AtSign, Bold,
  Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, FileText,
  Image as ImageIcon,
  Italic, Link2, List, ListOrdered, Loader2, Lock, Minus, Monitor,
  Paperclip, PenLine, Pipette, Plus, Send, SeparatorHorizontal, Smartphone,
  Space, Strikethrough, Trash2, Type, Underline, Upload as UploadIcon, X as XIcon,
  MousePointer2, Palette, Redo2, Undo2, Video, Share2, MapPin, Search, Zap, ExternalLink,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type PointerActivationConstraint,
} from '@dnd-kit/core';

// Custom sensor — never activates when the pointer goes down on an <input>,
// <button>, <select>, or any element marked data-no-dnd. This lets native
// range inputs drag freely without dnd-kit intercepting the pointer stream.
class SmartPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (
        { nativeEvent }: { nativeEvent: PointerEvent },
        { activationConstraint }: { activationConstraint?: PointerActivationConstraint },
      ) => {
        const target = nativeEvent.target as HTMLElement | null;
        if (!target) return true;
        if (
          target.tagName === 'INPUT'    ||
          target.tagName === 'BUTTON'   ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT'   ||
          target.tagName === 'A'        ||
          target.closest?.('[data-no-dnd]')
        ) return false;
        void activationConstraint; // satisfy TS
        return true;
      },
    },
  ];
}
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { VenueMediaPickerModal } from '@/components/venue-media/VenueMediaPickerModal';
import RichTextEditor from '@/components/RichTextEditor';
import {
  type EmailBlock,
  type EmailBlockType,
  type MarketingEmailDefinition,
  type EmailTheme,
  createEmailBlock,
  mergeEmailTheme,
} from '@/lib/marketing-email-schema';
import { renderMarketingEmailHtml, type MergeFieldRecord } from '@/lib/marketing-email-render';
import { injectVenueDataIntoDefinition, SUPPORTED_SOCIAL_PLATFORMS } from '@/lib/marketing-email-injection';
import { useBrandColors } from '@/lib/use-brand-colors';
import { parseVideoUrl } from '@/lib/video-providers';

// ─── Block palette shown in the picker ───────────────────────────────────────
const PALETTE: { type: EmailBlockType; label: string; desc: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { type: 'heading', label: 'Heading',      desc: 'Title or section header',     Icon: Type },
  { type: 'text',    label: 'Text',         desc: 'Body copy or paragraphs',     Icon: AlignLeft },
  { type: 'button',  label: 'Button',       desc: 'Call-to-action link',         Icon: MousePointer2 },
  { type: 'image',   label: 'Image',        desc: 'Photo or graphic',            Icon: ImageIcon },
  { type: 'video',   label: 'Video',        desc: 'Video with outbound link',    Icon: Video },
  { type: 'social',  label: 'Social Links', desc: 'Facebook, Instagram & more',  Icon: Share2 },
  { type: 'address', label: 'Address',      desc: 'Your venue business address', Icon: MapPin },
  { type: 'divider', label: 'Divider',      desc: 'Horizontal rule',             Icon: SeparatorHorizontal },
  { type: 'spacer',  label: 'Spacer',       desc: 'Vertical whitespace',         Icon: Space },
];

// ─── Palette card — draggable from the right panel onto the canvas ────────────
function PaletteCard({ type, label, desc, Icon }: typeof PALETTE[number]) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `new:${type}`,
    data: { source: 'palette', blockType: type },
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

// ─── Social SVG icons — Flodesk-style minimalist glyphs ──────────────────────
// Filled letterforms (f, in, P, d, X, @) for letter glyphs; stroked outlines
// (Instagram camera, Globe, YouTube) for shape glyphs. ALL paths are kept in
// lockstep with `socialIconSvg()` in `marketing-email-render.ts` so the editor
// canvas, preview iframe, and recipient inbox render pixel-for-pixel match.
function SocialIcon({ platform, size = 18, color = '#18181b' }: { platform: string; size?: number; color?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24' as const };
  switch (platform) {
    // Lowercase "f" letterform with hooked top + crossbar (Lucide-derived).
    case 'facebook': return (
      <svg {...common} fill={color}>
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    );

    // Modern "X" (Twitter rebrand) — angular thick X.
    case 'twitter': return (
      <svg {...common} fill={color}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );

    // Camera silhouette: rounded square + lens circle + viewfinder dot.
    case 'instagram': return (
      <svg {...common} fill="none">
        <rect x="3" y="3" width="18" height="18" rx="5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="4" stroke={color} strokeWidth="2" />
        <circle cx="17.5" cy="6.5" r="1.1" fill={color} />
      </svg>
    );

    // "d" with a small flag — TikTok mark, simplified to a single solid silhouette.
    case 'tiktok': return (
      <svg {...common} fill={color}>
        <path d="M14 2h2.6c.2 1.2.8 2.3 1.7 3.1.9.8 2 1.3 3.2 1.4v3a8 8 0 0 1-4.5-1.5v6.4c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6c.4 0 .7 0 1 .1v3.1c-.3-.1-.6-.1-1-.1a2.9 2.9 0 1 0 2.9 2.9V2z" />
      </svg>
    );

    // Pinterest "P" — canonical Pinterest brand mark (bowl + stem with curl
    // at the base). Native path is in a 384×512 viewBox; we scale + translate
    // it so the glyph occupies roughly 14×18 inside our 24×24 viewBox with
    // the standard ~3-unit visual padding the other social glyphs use.
    case 'pinterest': return (
      <svg {...common} fill={color}>
        <g transform="translate(5, 3) scale(0.0352)">
          <path d="M204 6.5C101.4 6.5 0 74.9 0 185.6 0 256 39.6 296 63.6 296c9.9 0 15.6-27.6 15.6-35.4 0-9.3-23.7-29.1-23.7-67.8 0-80.4 61.2-137.4 140.4-137.4 68.1 0 118.5 38.7 118.5 109.8 0 53.1-21.3 152.7-90.3 152.7-24.9 0-46.2-18-46.2-43.8 0-37.8 26.4-74.4 26.4-113.4 0-66.2-93.9-54.2-93.9 25.8 0 16.8 2.1 35.4 9.6 50.7-13.8 59.4-42 147.9-42 209.1 0 18.9 2.7 37.5 4.5 56.4 3.4 3.8 1.7 3.4 6.9 1.5 50.4-69 48.6-82.5 71.4-172.8 12.3 23.4 44.1 36 69.3 36 106.2 0 153.9-103.5 153.9-196.8C384 71.3 298.2 6.5 204 6.5z" />
        </g>
      </svg>
    );

    // Canonical LinkedIn "in" brand mark — bold lowercase "in" with rounded
    // i-dot. Native path is in a 448×512 viewBox; we scale + translate it so
    // the glyph occupies ~16×18 inside our 24×24 viewBox with the standard
    // ~3-unit visual padding the other social glyphs use.
    case 'linkedin': return (
      <svg {...common} fill={color}>
        <g transform="translate(4, 3) scale(0.0352)">
          <path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z" />
        </g>
      </svg>
    );

    // Stroked rounded rectangle with a filled play triangle inside.
    case 'youtube': return (
      <svg {...common} fill="none">
        <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 9.4l5.5 2.6-5.5 2.6z" fill={color} />
      </svg>
    );

    // Globe — circle + horizontal equator + curved meridian.
    case 'website': return (
      <svg {...common} fill="none">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
        <line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <path d="M12 3a14 14 0 0 1 4 9 14 14 0 0 1-4 9 14 14 0 0 1-4-9 14 14 0 0 1 4-9z" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );

    default: return null;
  }
}

// ─── Shared alignment selector — Flodesk-style (used by every block) ─────────
// Two horizontal lines per icon (one long, one short), positioned to match
// the active alignment. Active state gets a soft gray rounded-square pill;
// inactive state is just the icon. One source of truth so every module's
// alignment buttons look identical.
type Align3 = 'left' | 'center' | 'right';

function AlignIcon({ align, active }: { align: Align3; active: boolean }) {
  const stroke = active ? '#1f2937' : '#9ca3af';
  const sw = active ? 2.2 : 1.8;
  // viewBox 24×16 — two horizontal lines, top long (16 wide), bottom short (10 wide)
  // The x positions slide based on `align` so the lines visually flush left/center/right.
  const longW = 16;
  const shortW = 10;
  const longX = align === 'left' ? 4 : align === 'right' ? 24 - 4 - longW : (24 - longW) / 2;
  const shortX = align === 'left' ? 4 : align === 'right' ? 24 - 4 - shortW : (24 - shortW) / 2;
  return (
    <svg width="22" height="14" viewBox="0 0 24 16" aria-hidden="true">
      <line x1={longX} y1="5" x2={longX + longW} y2="5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <line x1={shortX} y1="11" x2={shortX + shortW} y2="11" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
    </svg>
  );
}

function AlignSelector({
  value,
  onChange,
  label = 'Align',
}: {
  value: Align3;
  onChange: (a: Align3) => void;
  label?: string;
}) {
  return (
    <div>
      {label ? <p className="text-sm font-semibold text-gray-900 mb-2">{label}</p> : null}
      <div className="flex items-center gap-1.5">
        {(['left', 'center', 'right'] as const).map((a) => {
          const active = value === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => onChange(a)}
              aria-pressed={active}
              aria-label={`Align ${a}`}
              className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
                active ? 'bg-gray-100' : 'hover:bg-gray-50'
              }`}
            >
              <AlignIcon align={a} active={active} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Venue address type (passed from server page) ─────────────────────────────
type VenueAddress = {
  name: string;
  location_full?: string | null;
  location_city?: string | null;
  location_state?: string | null;
};

// ─── Venue social-network links (managed in branding settings) ────────────────
type VenueSocial = { platform: string; url: string };

// ─── Types ────────────────────────────────────────────────────────────────────
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function moveArr<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const a = [...arr];
  const [item] = a.splice(from, 1);
  a.splice(to, 0, item);
  return a;
}

function stripTags(s: string) { return s.replace(/<[^>]+>/g, '').trim(); }

// ─── Google Fonts ─────────────────────────────────────────────────────────────
const GOOGLE_FONT_LIST = [
  'Inter','Open Sans','Roboto','Lato','Montserrat','Poppins','Nunito','Raleway',
  'Oswald','Work Sans','Source Sans 3','Quicksand','Josefin Sans',
  'Playfair Display','Merriweather','Libre Baskerville','Crimson Text',
  'DM Sans','Plus Jakarta Sans','Manrope','Figtree','Outfit',
];
const SYSTEM_FONT_LIST = [
  { label:'Helvetica Neue', value:"'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label:'Georgia',        value:"Georgia, 'Times New Roman', serif" },
  { label:'Arial',          value:'Arial, Helvetica, sans-serif' },
  { label:'Verdana',        value:'Verdana, Geneva, sans-serif' },
  { label:'Courier New',    value:"'Courier New', Courier, monospace" },
];
const ALL_FONT_OPTIONS = [
  ...SYSTEM_FONT_LIST,
  ...GOOGLE_FONT_LIST.map(f => ({ label: f, value: f })),
];
const FONT_WEIGHTS = [
  { label:'Light',    value:'300' },
  { label:'Regular',  value:'400' },
  { label:'Medium',   value:'500' },
  { label:'Semibold', value:'600' },
  { label:'Bold',     value:'700' },
];

function loadGoogleFonts() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('sp-google-fonts')) return;
  const families = GOOGLE_FONT_LIST.map(f => `family=${f.replace(/ /g,'+')}:wght@300;400;500;600;700`).join('&');
  const link = document.createElement('link');
  link.id = 'sp-google-fonts';
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);
}

// ─── Flodesk-style color picker ───────────────────────────────────────────────
const COLOR_PALETTE: string[] = [
  // pinks / nudes
  '#fce8e0','#f8d9d0','#f4c8b8','#eda898','#e38474','#d86a58','#c45040','#a83428','#8a1e14','#6e0a02',
  // warm earth
  '#f7ebe1','#eedad0','#e3c4b0','#d4ac92','#c49474','#b07c5c','#9a6448','#824c34','#6a3820','#520800',
  // reds / roses
  '#ffe0e0','#ffb8b8','#ff8888','#ff5050','#f01818','#d40000','#b80000','#9a0000','#7c0000','#600000',
  // oranges
  '#fff3e0','#ffd8a0','#ffba60','#ff9c28','#f07c08','#d46000','#b84800','#9a3000','#7c1c00','#600800',
  // yellows
  '#fffde0','#fff4a0','#ffe860','#ffd820','#f4c000','#d8a400','#bc8800','#9e6e00','#805400','#623c00',
  // greens
  '#e8f8e8','#c0ecc0','#90dc90','#60cc60','#38b838','#20a020','#0e8a0e','#007200','#005a00','#004400',
  // teals / cyans
  '#e0f8f6','#b4ecea','#78dcda','#40ccca','#18b8b4','#00a09c','#008884','#00706c','#005858','#004040',
  // blues
  '#e0eeff','#b4d4ff','#7ab4ff','#3c94ff','#1074f0','#0058d4','#0040ba','#002c9a','#001c7e','#000c62',
  // purples
  '#f0e0ff','#dab8ff','#bc88ff','#9e58ff','#8030f0','#6810d4','#5000ba','#3c009a','#28007e','#160062',
  // pinks / magentas
  '#ffe0f4','#ffb0e0','#ff78c8','#ff40b0','#f01898','#d40080','#b80068','#9a0050','#7c003a','#600028',
  // grays + black/white
  '#000000','#1a1a1a','#333333','#4d4d4d','#666666','#808080','#999999','#b3b3b3','#cccccc','#ffffff',
];

function FlodeskColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Computed each frame so the popover follows the trigger as the page scrolls
  // (any container, including the inspector sidebar) and clamps to viewport
  // bounds — never gets cut off, no scrolling required to see it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { colors: brandColors, addColor, removeColor } = useBrandColors();

  useEffect(() => { setHex(value); }, [value]);

  // Close on outside click. Check both the trigger and the portaled popover
  // because the popover lives outside `ref`'s subtree.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Track the trigger position every frame while open so the floating popover
  // stays anchored as the user scrolls/resizes/moves anything around it.
  useEffect(() => {
    if (!open) return;
    const PICKER_W = 320;
    let raf = 0;

    function update() {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const popH = popRef.current?.offsetHeight ?? 460;
      const margin = 8;

      // Prefer below the trigger; flip above if there's no room.
      const spaceBelow = window.innerHeight - trigger.bottom - margin;
      const spaceAbove = trigger.top - margin;
      let top: number;
      if (spaceBelow >= popH + margin || spaceBelow >= spaceAbove) {
        top = trigger.bottom + margin;
      } else {
        top = trigger.top - popH - margin;
      }
      // Clamp into viewport (account for popover height too)
      top = Math.max(margin, Math.min(top, window.innerHeight - popH - margin));

      // Center on the trigger horizontally, then clamp to viewport
      let left = trigger.left + trigger.width / 2 - PICKER_W / 2;
      left = Math.max(margin, Math.min(left, window.innerWidth - PICKER_W - margin));

      setPos({ top, left });
    }

    function tick() {
      update();
      raf = requestAnimationFrame(tick);
    }
    tick();

    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  function applyHex(raw: string) {
    const v = raw.startsWith('#') ? raw : `#${raw}`;
    setHex(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
  }

  async function eyeDrop() {
    if (!('EyeDropper' in window)) return;
    try {
      // @ts-ignore
      const { sRGBHex } = await new window.EyeDropper().open();
      applyHex(sRGBHex);
      setOpen(false);
    } catch {}
  }

  const isTransparent = !value || value === 'transparent';
  const normalizedCurrent = hex.toLowerCase();
  const currentSaved = brandColors.includes(normalizedCurrent);

  return (
    <div ref={ref} className="relative">
      {/* Swatch trigger — transparent shows as a diagonal red slash */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-12 h-12 rounded-full border border-gray-200 transition-transform hover:scale-105 focus:outline-none overflow-hidden"
        style={{
          background: isTransparent
            ? 'linear-gradient(to top right, transparent calc(50% - 1.2px), #ef4444 calc(50% - 1.2px), #ef4444 calc(50% + 1.2px), transparent calc(50% + 1.2px))'
            : value,
        }}
      />

      {open && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            zIndex: 9999,
            width: 320,
            visibility: pos ? 'visible' : 'hidden',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
            {/* Color grid */}
            <div className="grid grid-cols-10 gap-1.5 mb-4">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onMouseDown={() => { applyHex(c); onChange(c); }}
                  className="w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400"
                  style={{ background: c, border: c === '#ffffff' ? '1px solid #e5e5e5' : 'none' }}
                />
              ))}
            </div>

            {/* Brand colors section */}
            {brandColors.length > 0 ? (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Brand colors</p>
                  {!currentSaved && /^#[0-9a-fA-F]{6}$/.test(hex) && (
                    <button
                      type="button"
                      onMouseDown={() => addColor(hex)}
                      className="text-[11px] text-gray-500 hover:text-gray-800 underline"
                    >
                      Save current
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-10 gap-1.5">
                  {brandColors.map(c => (
                    <BrandSwatch
                      key={c}
                      color={c}
                      onPick={() => { applyHex(c); onChange(c); }}
                      onRemove={() => removeColor(c)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onMouseDown={() => { if (/^#[0-9a-fA-F]{6}$/.test(hex)) addColor(hex); }}
                className="block w-full text-center text-[13px] text-gray-500 underline mb-4 hover:text-gray-800"
              >
                Add your brand colors
              </button>
            )}

            {/* Hex input + eyedropper */}
            <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2">
              <div className="w-5 h-5 rounded-full flex-shrink-0 border border-gray-200" style={{ background: hex }} />
              <input
                className="flex-1 text-sm font-mono uppercase text-gray-800 focus:outline-none bg-transparent"
                value={hex.replace('#','').toUpperCase()}
                maxLength={6}
                onChange={e => applyHex(e.target.value)}
                onBlur={e => applyHex(e.target.value)}
              />
              <button type="button" onClick={eyeDrop} className="text-gray-400 hover:text-gray-700 transition-colors" title="Pick color from screen">
                <Pipette size={15} />
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Single saved-brand-color swatch with a hover-revealed remove button.
function BrandSwatch({ color, onPick, onRemove }: { color: string; onPick: () => void; onRemove: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        title={color}
        onMouseDown={onPick}
        className="w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400"
        style={{ background: color, border: color === '#ffffff' ? '1px solid #e5e5e5' : 'none' }}
      />
      {hover && (
        <button
          type="button"
          onMouseDown={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove"
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center hover:bg-gray-50"
        >
          <XIcon size={9} className="text-gray-500" />
        </button>
      )}
    </div>
  );
}

// ─── Searchable font selector ─────────────────────────────────────────────────
function FontSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = ALL_FONT_OPTIONS.filter(f =>
    f.label.toLowerCase().includes(query.toLowerCase()),
  );
  const current = ALL_FONT_OPTIONS.find(f => f.value === value) ?? { label: value, value };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        className="w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 hover:bg-white hover:border-gray-400 transition-colors focus:outline-none"
        style={{ fontFamily: value }}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown size={13} className="text-gray-400 flex-shrink-0 ml-1" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded-lg">
              <Search size={12} className="text-gray-400" />
              <input
                autoFocus
                className="flex-1 text-sm bg-transparent focus:outline-none text-gray-700 placeholder:text-gray-400"
                placeholder="Search fonts…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.map(f => (
              <button
                key={f.value}
                type="button"
                onMouseDown={() => { onChange(f.value); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-gray-50 ${value === f.value ? 'bg-gray-100 font-medium' : ''}`}
                style={{ fontFamily: f.value }}
              >
                {f.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400">No fonts found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Individual block canvas renderers ───────────────────────────────────────
// ─── Floating format toolbar (appears on text selection inside canvas) ────────
function FloatingFormatBar() {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [newTab, setNewTab] = useState(true);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiVariation, setAiVariation] = useState(0);
  const [insideLink, setInsideLink] = useState(false);
  const savedRange = useRef<Range | null>(null);
  const editingAnchor = useRef<HTMLAnchorElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkModeRef = useRef(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { linkModeRef.current = linkMode; }, [linkMode]);

  useEffect(() => {
    function update() {
      if (linkModeRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { setPos(null); setAiVariation(0); setInsideLink(false); return; }

      const anchor = sel.anchorNode;
      const el: Element | null = anchor
        ? (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as Element)
        : null;
      const editable = el?.closest?.('[data-email-editable]') as HTMLElement | null;
      if (!editable) { setPos(null); setInsideLink(false); return; }

      // Detect if cursor/selection is inside an existing <a>
      const existingA = el?.closest('a') as HTMLAnchorElement | null;
      setInsideLink(!!existingA);

      const selText = sel.toString().trim();

      // Show toolbar if text is selected OR cursor is inside a link
      if (!selText && !existingA) { setPos(null); setAiVariation(0); return; }

      const blockRect = editable.getBoundingClientRect();
      if (selText) {
        const selRect = sel.getRangeAt(0).getBoundingClientRect();
        setPos({ top: selRect.top - 64, left: blockRect.left + blockRect.width / 2 });
      } else if (existingA) {
        // Cursor is inside a link but nothing selected — position toolbar above the link
        const linkRect = existingA.getBoundingClientRect();
        setPos({ top: linkRect.top - 64, left: linkRect.left + linkRect.width / 2 });
      }
    }
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  if (!mounted) return null;
  if (!pos && !linkMode) return null;

  // Focus the contentEditable, restore the saved selection, run execCommand, then sync state
  function exec(cmd: string, val?: string) {
    const sel = window.getSelection();
    // Save range before any focus change
    const savedSel = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    const node = savedSel?.commonAncestorContainer ?? sel?.anchorNode;
    const editable: HTMLElement | null = node
      ? (node.nodeType === Node.TEXT_NODE
          ? (node as Text).parentElement?.closest('[data-email-editable]') as HTMLElement ?? null
          : (node as HTMLElement).closest?.('[data-email-editable]') as HTMLElement ?? null)
      : null;
    // Ensure focus is on the contentEditable (required for execCommand to act on it)
    if (editable && document.activeElement !== editable) {
      editable.focus();
      if (savedSel && sel) { sel.removeAllRanges(); sel.addRange(savedSel); }
    }
    document.execCommand(cmd, false, val);
    if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openLinkMode(e: React.MouseEvent) {
    e.preventDefault();
    const sel = window.getSelection();
    editingAnchor.current = null;

    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();

      // Detect if the cursor/selection is inside an existing <a> — if so, edit it
      const node = sel.anchorNode;
      const el = node?.nodeType === Node.TEXT_NODE
        ? (node as Text).parentElement
        : node as Element | null;
      const existingA = el?.closest('a') as HTMLAnchorElement | null;

      if (existingA) {
        editingAnchor.current = existingA;
        setLinkUrl(existingA.getAttribute('href') ?? '');
        setNewTab(existingA.target === '_blank');
      } else {
        setLinkUrl('');
      }
    }

    setLinkMode(true);
    setTimeout(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    }, 40);
  }

  function removeLink() {
    if (!editingAnchor.current) { cancelLink(); return; }
    const a = editingAnchor.current;
    const parent = a.parentNode;
    if (parent) {
      // Unwrap: move all child nodes out of the anchor, then remove it
      while (a.firstChild) parent.insertBefore(a.firstChild, a);
      parent.removeChild(a);
      const editable = (parent instanceof Element ? parent : (parent as Node).parentElement)
        ?.closest('[data-email-editable]') as HTMLElement | null;
      editable?.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editingAnchor.current = null;
    savedRange.current = null;
    setLinkMode(false);
    setLinkUrl('');
    setPos(null);
  }

  function applyLink() {
    const url = linkUrl.trim();
    // Empty URL while editing existing link → remove the link
    if (!url && editingAnchor.current) { removeLink(); return; }
    if (!url) { cancelLink(); return; }
    const fullUrl = url.startsWith('http') || url.startsWith('mailto:') ? url : `https://${url}`;

    // ── Edit existing anchor ──────────────────────────────────────────────────
    if (editingAnchor.current) {
      const a = editingAnchor.current;
      a.href = fullUrl;
      if (newTab) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else {
        a.removeAttribute('target');
        a.removeAttribute('rel');
      }
      const editable = a.closest('[data-email-editable]') as HTMLElement | null;
      if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
      editingAnchor.current = null;
      savedRange.current = null;
      setLinkMode(false);
      setLinkUrl('');
      setPos(null);
      return;
    }

    // ── Create new anchor from selection ──────────────────────────────────────
    if (!savedRange.current) { cancelLink(); return; }

    const rangeNode = savedRange.current.commonAncestorContainer;
    const editable = (rangeNode.nodeType === Node.TEXT_NODE
      ? (rangeNode as Text).parentElement
      : rangeNode as HTMLElement)?.closest('[data-email-editable]') as HTMLElement | null;

    try {
      const a = document.createElement('a');
      a.href = fullUrl;
      a.style.color = '#3b82f6';
      a.style.textDecoration = 'underline';
      a.style.cursor = 'pointer';
      if (newTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }

      try {
        savedRange.current.surroundContents(a);
      } catch {
        const fragment = savedRange.current.extractContents();
        a.appendChild(fragment);
        savedRange.current.insertNode(a);
      }

      if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      // silent — range may have been invalidated
    }

    savedRange.current = null;
    setLinkMode(false);
    setLinkUrl('');
    setPos(null);
  }

  function cancelLink() {
    savedRange.current = null;
    editingAnchor.current = null;
    setLinkMode(false);
    setLinkUrl('');
  }

  function insertList(ordered: boolean) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0).cloneRange();

    const anchorNode = range.commonAncestorContainer;
    const editable = (anchorNode.nodeType === Node.TEXT_NODE
      ? (anchorNode as Text).parentElement
      : anchorNode as HTMLElement
    )?.closest('[data-email-editable]') as HTMLElement | null;
    if (!editable) return;

    const desiredTag = ordered ? 'OL' : 'UL';

    // ── If cursor is already inside a list, toggle / convert ─────────────────
    const startEl = range.startContainer.nodeType === Node.TEXT_NODE
      ? (range.startContainer as Text).parentElement
      : range.startContainer as HTMLElement;
    const existingList = startEl?.closest('ol, ul') as HTMLElement | null;

    if (existingList && editable.contains(existingList)) {
      const parent = existingList.parentNode;
      if (!parent) return;

      if (existingList.tagName === desiredTag) {
        // SAME type — toggle OFF: unwrap each <li> back into a <p>
        const items = Array.from(existingList.children).filter(
          (c): c is HTMLElement => c.tagName === 'LI',
        );
        items.forEach(li => {
          const p = document.createElement('p');
          p.style.margin = '0 0 0.5em 0';
          p.innerHTML = li.innerHTML.trim() || '<br>';
          parent.insertBefore(p, existingList);
        });
        parent.removeChild(existingList);

        // Place cursor in the first unwrapped paragraph
        const firstP = parent.firstChild;
        if (firstP instanceof HTMLElement) {
          const r = document.createRange();
          r.selectNodeContents(firstP);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      } else {
        // OPPOSITE type — convert ol ↔ ul, keep same items
        const newList = document.createElement(desiredTag.toLowerCase());
        newList.style.cssText = `padding-left: 1.5em; margin: 0.5em 0; list-style-type: ${ordered ? 'decimal' : 'disc'}; list-style-position: outside;`;
        newList.innerHTML = existingList.innerHTML;
        parent.replaceChild(newList, existingList);

        const lastLi = newList.lastElementChild as HTMLElement | null;
        if (lastLi) {
          const r = document.createRange();
          r.selectNodeContents(lastLi);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }

    // ── Otherwise, create a new list from selected paragraph(s) ──────────────

    // Walk up from `node` to find the direct child of `editable` that contains it
    function directBlockChild(node: Node): HTMLElement | null {
      let cur: Node | null = node;
      while (cur && cur.parentNode !== editable) cur = cur.parentNode;
      if (!cur || cur === editable) return null;
      return cur instanceof HTMLElement ? cur : null;
    }

    const startBlock = directBlockChild(range.startContainer);
    const endBlock = directBlockChild(range.endContainer);

    const blocksToReplace: HTMLElement[] = [];
    if (startBlock) {
      let cur: Node | null = startBlock;
      while (cur) {
        if (cur instanceof HTMLElement) blocksToReplace.push(cur);
        if (cur === endBlock || !endBlock) break;
        cur = cur.nextSibling;
      }
    }

    const list = document.createElement(desiredTag.toLowerCase());
    list.style.cssText = `padding-left: 1.5em; margin: 0.5em 0; list-style-type: ${ordered ? 'decimal' : 'disc'}; list-style-position: outside;`;

    if (blocksToReplace.length > 0) {
      blocksToReplace.forEach(block => {
        const li = document.createElement('li');
        li.style.marginBottom = '0.25em';
        li.innerHTML = block.innerHTML.trim() || '<br>';
        list.appendChild(li);
      });

      const insertionPoint = blocksToReplace[0];
      editable.insertBefore(list, insertionPoint);
      blocksToReplace.forEach(el => {
        if (el.parentNode === editable) editable.removeChild(el);
      });
    } else {
      const selectedText = range.toString();
      const li = document.createElement('li');
      li.style.marginBottom = '0.25em';
      if (selectedText) {
        range.deleteContents();
        li.textContent = selectedText;
      } else {
        li.innerHTML = '<br>';
      }
      list.appendChild(li);
      range.insertNode(list);
    }

    const lastLi = list.lastElementChild as HTMLElement | null;
    if (lastLi) {
      const r = document.createRange();
      r.selectNodeContents(lastLi);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    editable.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertMerge(tag: string) {
    exec('insertText', tag);
    setMergeOpen(false);
  }

  async function refineWithAI(e: React.MouseEvent) {
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    // Save the current range so we can replace it after the API call
    const range = sel.getRangeAt(0).cloneRange();
    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/refine-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selectedText, variation: aiVariation }),
      });
      const data = await res.json();
      if (data.refined) {
        // Restore selection and replace with refined text
        const sel2 = window.getSelection();
        if (sel2) { sel2.removeAllRanges(); sel2.addRange(range); }
        document.execCommand('insertText', false, data.refined);
        // Sync to block state
        const editable = range.commonAncestorContainer.parentElement?.closest('[data-email-editable]');
        if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
        setAiVariation(v => v + 1);
      }
    } catch {
      // silent fail
    } finally {
      setAiLoading(false);
    }
  }

  const BTN = 'flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors';
  const SEP = 'w-px h-5 bg-gray-200 mx-1 flex-shrink-0';

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        transform: 'translateX(-50%)',
        zIndex: 300,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {linkMode ? (
        /* ── Link URL input ── */
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ minWidth: 340, border: '1.5px solid #d1d5db' }}>
          <div className="flex items-center px-4 py-3" style={{ borderBottom: '2px solid #3b82f6' }}>
            <Link2 size={14} className="text-blue-400 flex-shrink-0 mr-3" />
            <input
              ref={linkInputRef}
              type="url"
              className="flex-1 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none bg-transparent"
              placeholder="Type or paste a link and hit ENTER"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                if (e.key === 'Escape') cancelLink();
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); cancelLink(); }}
              className="ml-3 p-0.5 text-gray-400 hover:text-gray-700 flex-shrink-0 transition-colors"
              title="Cancel"
            >
              <XIcon size={15} />
            </button>
            <div className="w-px h-4 bg-gray-200 mx-2 flex-shrink-0" />
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); applyLink(); }}
              className="text-gray-400 hover:text-blue-500 flex-shrink-0 transition-colors"
              title="Apply link"
            >
              <Zap size={15} />
            </button>
          </div>
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ffb-newtab"
                checked={newTab}
                onChange={e => setNewTab(e.target.checked)}
                className="rounded accent-blue-500 cursor-pointer"
              />
              <label htmlFor="ffb-newtab" className="text-xs text-gray-500 cursor-pointer select-none">
                Open in new tab
              </label>
            </div>
            {insideLink && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); removeLink(); }}
                className="text-xs text-red-500 hover:text-red-600 font-medium transition-colors"
                title="Remove link"
              >
                Remove link
              </button>
            )}
          </div>
        </div>
      ) : (
        /* ── Normal toolbar ── */
        <div className="flex items-center rounded-2xl bg-white border border-gray-100 shadow-2xl px-2 py-1.5 gap-0.5">
          <button
            type="button"
            className={`${BTN} ${aiLoading ? 'opacity-50 cursor-not-allowed' : 'hover:text-violet-600'}`}
            title="AI refine — fix grammar, spelling &amp; style (click again for a new variation)"
            onMouseDown={aiLoading ? (e) => e.preventDefault() : refineWithAI}
          >
            {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <PenLine size={16} />}
          </button>
          <div className={SEP} />
          <button type="button" className={BTN} title="Bold"          onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}><Bold size={16} /></button>
          <button type="button" className={BTN} title="Italic"        onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}><Italic size={16} /></button>
          <button type="button" className={BTN} title="Underline"     onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}><Underline size={16} /></button>
          <button type="button" className={BTN} title="Strikethrough" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }}><Strikethrough size={16} /></button>
          <div className={SEP} />
          <button type="button" className={BTN} title="Numbered list" onMouseDown={(e) => { e.preventDefault(); insertList(true); }}><ListOrdered size={16} /></button>
          <button type="button" className={BTN} title="Bullet list"   onMouseDown={(e) => { e.preventDefault(); insertList(false); }}><List size={16} /></button>
          <div className={SEP} />
          <button
            type="button"
            className={`${BTN} ${insideLink ? 'text-blue-500' : ''}`}
            title={insideLink ? 'Edit link' : 'Insert link'}
            onMouseDown={openLinkMode}
          >
            <Link2 size={16} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─── Per-block default padding ───────────────────────────────────────────────
// Each block falls back to these values when block-level padding isn't set.
const BLOCK_PADDING_DEFAULTS: Record<string, { top: number; bottom: number; left: number; right: number }> = {
  heading: { top: 8, bottom: 8, left: 24, right: 24 },
  text:    { top: 8, bottom: 8, left: 24, right: 24 },
  button:  { top: 10, bottom: 10, left: 0, right: 0 },
  image:   { top: 8, bottom: 8, left: 24, right: 24 },
  video:   { top: 16, bottom: 16, left: 24, right: 24 },
  social:  { top: 20, bottom: 20, left: 24, right: 24 },
  address: { top: 16, bottom: 16, left: 24, right: 24 },
  divider: { top: 12, bottom: 12, left: 24, right: 24 },
  spacer:  { top: 0,  bottom: 0,  left: 0,  right: 0  },
  html:    { top: 8, bottom: 8, left: 24, right: 24 },
  columns: { top: 8, bottom: 8, left: 16, right: 16 },
};

function blockPaddingStyle(block: EmailBlock): React.CSSProperties {
  const d = BLOCK_PADDING_DEFAULTS[block.type] ?? { top: 8, bottom: 8, left: 24, right: 24 };
  return {
    paddingTop: `${block.paddingTop ?? d.top}px`,
    paddingBottom: `${block.paddingBottom ?? d.bottom}px`,
    paddingLeft: `${block.paddingLeft ?? d.left}px`,
    paddingRight: `${block.paddingRight ?? d.right}px`,
    background:
      block.blockBgColor && block.blockBgColor !== 'transparent' ? block.blockBgColor : undefined,
  };
}

function HeadingCanvas({ block, theme, onPatch }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; onPatch?: (p: Partial<EmailBlock>) => void }) {
  const sizes: Record<number, string> = { 1: '28px', 2: '22px', 3: '18px' };
  const size = sizes[block.level ?? 2] ?? '22px';
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current && ref.current) {
      ref.current.textContent = stripTags(block.content || '') || 'Heading text';
      mounted.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      data-email-editable={onPatch ? 'true' : undefined}
      contentEditable={!!onPatch}
      suppressContentEditableWarning
      onInput={() => { if (ref.current && onPatch) onPatch({ content: ref.current.textContent ?? '' }); }}
      style={{
        ...blockPaddingStyle(block),
        textAlign: block.align ?? 'left',
        fontFamily: block.fontFamily ?? theme.fontFamily,
        fontSize: block.fontSize ?? size,
        fontWeight: block.fontWeight ?? 700,
        color: block.color ?? theme.textColor,
        lineHeight: block.lineHeight ?? 1.25,
        letterSpacing: block.letterSpacing != null ? `${block.letterSpacing}px` : undefined,
        textTransform: (block.textTransform && block.textTransform !== 'none') ? block.textTransform : undefined,
        wordBreak: 'break-word',
        outline: 'none',
        cursor: onPatch ? 'text' : 'default',
      }}
    />
  );
}

function TextCanvas({ block, theme, onPatch }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; onPatch?: (p: Partial<EmailBlock>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current && ref.current) {
      ref.current.innerHTML = block.content || '<p>Your message here.</p>';
      mounted.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      data-email-editable={onPatch ? 'true' : undefined}
      contentEditable={!!onPatch}
      suppressContentEditableWarning
      onInput={() => { if (ref.current && onPatch) onPatch({ content: ref.current.innerHTML }); }}
      style={{
        ...blockPaddingStyle(block),
        textAlign: block.align ?? 'left',
        fontFamily: block.fontFamily ?? theme.fontFamily,
        fontSize: block.fontSize ?? '16px',
        fontWeight: block.fontWeight ?? 400,
        lineHeight: block.lineHeight ?? 1.6,
        letterSpacing: block.letterSpacing != null ? `${block.letterSpacing}px` : undefined,
        textTransform: (block.textTransform && block.textTransform !== 'none') ? block.textTransform : undefined,
        color: block.color ?? theme.textColor,
        outline: 'none',
        cursor: onPatch ? 'text' : 'default',
      }}
    />
  );
}

function ButtonCanvas({ block, theme, onPatch }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; onPatch?: (p: Partial<EmailBlock>) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const mounted = useRef(false);
  const fallback = 'Click here';

  // Initialize/sync label text without obliterating the editor caret while typing
  useEffect(() => {
    if (!ref.current) return;
    const desired = (block.buttonLabel ?? '') || fallback;
    if (!mounted.current) {
      ref.current.textContent = desired;
      mounted.current = true;
      return;
    }
    if (ref.current.textContent !== desired && document.activeElement !== ref.current) {
      ref.current.textContent = desired;
    }
  }, [block.buttonLabel]);

  const presetRadius = BUTTON_PRESETS.find(p => p.id === block.buttonStyle)?.radius ?? 2;
  const isFilled = (block.buttonStyle ?? 'outline-rect').startsWith('filled');
  const bg = block.buttonBgColor ?? (isFilled ? '#000000' : 'transparent');
  const fg = block.color ?? (isFilled ? '#ffffff' : '#000000');
  const borderW = block.buttonBorderWidth ?? (isFilled ? 0 : 2);
  const borderColor = block.buttonBorderColor ?? '#000000';

  const padX = block.buttonWidth ?? 30;
  const padY = block.buttonHeight ?? 15;

  const editable = !!onPatch;

  return (
    <div
      style={{
        ...blockPaddingStyle(block),
        textAlign: block.align ?? 'center',
      }}
    >
      <span
        ref={ref}
        data-email-editable={editable ? 'true' : undefined}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={() => { if (ref.current && onPatch) onPatch({ buttonLabel: ref.current.textContent ?? '' }); }}
        onMouseDown={(e) => { if (editable) e.stopPropagation(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        onPaste={(e) => {
          if (!editable) return;
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
        style={{
          display: 'inline-block',
          background: bg,
          color: fg,
          border: borderW > 0 ? `${borderW}px solid ${borderColor}` : 'none',
          padding: `${padY}px ${padX}px`,
          borderRadius: `${presetRadius}px`,
          fontWeight: block.fontWeight ?? 400,
          fontSize: block.fontSize ?? '14px',
          letterSpacing: `${block.letterSpacing ?? 1.8}px`,
          lineHeight: block.lineHeight ?? 1,
          textTransform: (block.textTransform && block.textTransform !== 'none') ? block.textTransform : undefined,
          fontFamily: block.fontFamily ?? theme.fontFamily,
          outline: 'none',
          cursor: editable ? 'text' : 'default',
          minWidth: '4ch',
          whiteSpace: 'nowrap',
        }}
      />
    </div>
  );
}

function ImageCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const cols = Math.max(1, Math.min(4, block.imageGridColumns ?? 1));
  // Slot 0 = block.src; remaining slots = imageGridImages entries.
  const slots: { src: string; alt: string }[] = [
    { src: block.src ?? '', alt: block.alt ?? '' },
    ...((block.imageGridImages ?? []).map(g => ({ src: g.src ?? '', alt: g.alt ?? '' }))),
  ];
  const totalCount = Math.max(slots.length, cols); // ensure at least one row
  const totalWidth = block.imageWidth ?? 600;

  // No images at all → empty state.
  const noImages = slots.every((s) => !s.src.trim());
  if (noImages && cols === 1) {
    return (
      <div style={{ ...blockPaddingStyle(block), textAlign: 'center' }}>
        <div style={{
          border: `2px dashed ${theme.mutedColor}`,
          borderRadius: '8px',
          padding: '32px',
          color: theme.mutedColor,
          fontSize: '14px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}>
          <ImageIcon size={28} />
          <span>Add image URL in the panel →</span>
        </div>
      </div>
    );
  }

  const align = block.align ?? 'center';
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const gridGap = Math.max(0, Math.min(64, block.imageGridGap ?? 16));
  const isStack = cols === 1 && totalCount > 1;

  return (
    <div style={{ ...blockPaddingStyle(block), display: 'flex', justifyContent: justify }}>
      <div
        style={{
          width: '100%',
          maxWidth: `${totalWidth}px`,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          rowGap: (cols > 1 || isStack) ? `${gridGap}px` : '0',
          columnGap: cols > 1 ? `${gridGap}px` : '0',
        }}
      >
        {Array.from({ length: totalCount }).map((_, i) => {
          const slot = slots[i] ?? { src: '', alt: '' };
          if (slot.src) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={slot.src}
                alt={slot.alt}
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  borderRadius: '4px',
                  aspectRatio: cols > 1 ? '1 / 1' : undefined,
                  objectFit: cols > 1 ? 'cover' : undefined,
                }}
              />
            );
          }
          return (
            <div
              key={i}
              style={{
                border: `2px dashed ${theme.mutedColor}`,
                borderRadius: '8px',
                aspectRatio: cols > 1 ? '1 / 1' : '4 / 3',
                color: theme.mutedColor,
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f9fafb',
              }}
            >
              <ImageIcon size={20} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DividerCanvas({ block }: { block: EmailBlock }) {
  const lineStyle  = (block.dividerStyle ?? 'solid') as 'solid' | 'dashed' | 'dotted';
  const lineColor  = block.dividerColor ?? '#D7D7D7';
  const thickness  = Math.max(1, Math.min(20, block.dividerThickness ?? 1));
  const lineWidth  = Math.max(20, Math.min(600, block.dividerWidth ?? 300));
  const align      = block.align ?? 'center';
  const justify    = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  return (
    <div style={{ ...blockPaddingStyle(block), display: 'flex', justifyContent: justify }}>
      <hr
        style={{
          border: 'none',
          borderTop: `${thickness}px ${lineStyle} ${lineColor}`,
          width: `${lineWidth}px`,
          maxWidth: '100%',
          margin: 0,
        }}
      />
    </div>
  );
}

function SpacerCanvas({ block }: { block: EmailBlock }) {
  const h = block.spacerHeight ?? 24;
  return (
    <div
      style={{
        ...blockPaddingStyle(block),
        height: `${h}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: '11px', color: '#d1d5db', userSelect: 'none' }}>{h}px</span>
    </div>
  );
}

// Returns true if the given hex color is dark enough that white text reads
// better on top of it. Used to flip the title color automatically when the
// surrounding block background is dark (matching the screenshot's behavior).
function isDarkColor(input?: string): boolean {
  if (!input || input === 'transparent') return false;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.5;
}

// YouTube-style 16:9 video preview. Auto-derives a thumbnail from the URL
// when possible (YouTube/Loom). Click to "play" inside the canvas opens the
// video link in a new tab — matches the production email behaviour.
function VideoCanvas({ block, theme, onPatch }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; onPatch?: (p: Partial<EmailBlock>) => void }) {
  const titleRef = useRef<HTMLDivElement>(null);
  const titleMounted = useRef(false);

  useEffect(() => {
    if (!titleMounted.current && titleRef.current) {
      titleRef.current.textContent = block.content?.trim() || '';
      titleMounted.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = parseVideoUrl(block.href ?? '');
  const userThumb = block.src?.trim();
  const thumbnail = userThumb || parsed?.thumbnail;
  const showTitle = block.videoShowTitle !== false;

  const overlayColor = block.videoOverlayColor ?? '#000000';
  const overlayOpacity = Math.max(0, Math.min(100, block.videoOverlayOpacity ?? 0)) / 100;

  // Auto-contrast the title color to the surrounding block bg so the
  // default "looks right" out of the box (white over dark, dark over light).
  const titleColor = isDarkColor(block.blockBgColor) ? '#ffffff' : theme.textColor;

  return (
    <div style={blockPaddingStyle(block)}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#0f0f0f', // YouTube-style near-black backdrop
          borderRadius: '10px',
          overflow: 'hidden',
          // Editor canvas is for editing — never open the watch URL on click here.
          // The clickable link is added only in the rendered email + live preview iframe.
          cursor: 'default',
        }}
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt={parsed?.label ? `${parsed.label} video thumbnail` : 'Video thumbnail'}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}

        {/* Overlay tint */}
        {overlayOpacity > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: overlayColor,
              opacity: overlayOpacity,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Empty-state hint anchored near the bottom of the frame so it sits
             clearly BELOW the centered play button instead of behind it. */}
        {!thumbnail && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: '14%',
              textAlign: 'center',
              color: '#9ca3af',
              fontFamily: theme.fontFamily,
              fontSize: '13px',
              padding: '0 16px',
              pointerEvents: 'none',
            }}
          >
            Add a YouTube, Vimeo or Loom URL →
          </div>
        )}

        {/* YouTube-style play button (white circle, dark triangle) */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '68px',
            height: '48px',
            borderRadius: '14px',
            background: thumbnail ? 'rgba(33, 33, 33, 0.85)' : 'rgba(255,255,255,0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderTop: '10px solid transparent',
              borderBottom: '10px solid transparent',
              borderLeft: thumbnail ? '16px solid #ffffff' : '16px solid #0f0f0f',
              marginLeft: '4px',
            }}
          />
        </div>
      </div>

      {showTitle && (
        <div
          ref={titleRef}
          data-email-editable={onPatch ? 'true' : undefined}
          contentEditable={!!onPatch}
          suppressContentEditableWarning
          onMouseDown={(e) => e.stopPropagation()}
          onInput={() => { if (titleRef.current && onPatch) onPatch({ content: titleRef.current.textContent ?? '' }); }}
          style={{
            margin: '14px 0 0',
            fontSize: '15px',
            color: titleColor,
            textAlign: 'center',
            fontFamily: theme.fontFamily,
            outline: 'none',
            wordBreak: 'break-word',
            minHeight: '1.4em',
            cursor: onPatch ? 'text' : 'default',
          }}
          // YouTube-style placeholder when empty — rendered via :empty:before
          // in CSS; we attach a data attribute the global stylesheet can hook.
          data-placeholder="Write a title for your video here"
          className="sp-video-title"
        />
      )}
    </div>
  );
}

// Pixel sizes for the three social-icon size tokens. Kept in lockstep with
// the email render path (`marketing-email-render.ts`) so the editor preview
// matches the recipient's inbox 1:1. The "outline" (no chip) style uses a
// slightly larger glyph because there's no surrounding chip eating into the
// visible area.
const SOCIAL_SIZES = {
  sm: { outer: 28, withChip: 18, noChip: 22 },
  md: { outer: 36, withChip: 22, noChip: 28 },
  lg: { outer: 48, withChip: 30, noChip: 38 },
} as const;

function SocialCanvas({ block, theme, venueSocials }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; venueSocials?: VenueSocial[] }) {
  // Live canvas mirrors what we'll inject at render time: drop empty URLs,
  // drop unsupported / legacy platforms, and drop anything the user hid via
  // the inspector's per-block eye toggle.
  const hidden = new Set(block.socialHiddenPlatforms ?? []);
  const links = (venueSocials ?? []).filter(
    (l) => l.url?.trim() && SUPPORTED_SOCIAL_PLATFORMS.has(l.platform) && !hidden.has(l.platform),
  );
  const align = block.align ?? 'center';
  const style = block.socialIconStyle ?? 'outline';
  const sizeKey = block.socialIconSize ?? 'md';
  const spacing = block.socialIconSpacing ?? 10;
  const color = block.color ?? theme.textColor;
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  if (links.length === 0) {
    return (
      <div style={{ ...blockPaddingStyle(block), textAlign: 'center', color: theme.mutedColor, fontSize: '13px', fontFamily: theme.fontFamily }}>
        Add social network links in your <span style={{ fontWeight: 600, color: theme.textColor }}>Branding settings</span> to populate this block.
      </div>
    );
  }

  const dims = SOCIAL_SIZES[sizeKey];
  const outer = dims.outer;
  const inner = style === 'outline' ? dims.noChip : dims.withChip;

  return (
    <div style={{ ...blockPaddingStyle(block), display: 'flex', gap: `${spacing}px`, justifyContent: justify, alignItems: 'center', flexWrap: 'wrap' }}>
      {links.map((link) => {
        const wrapperStyle: React.CSSProperties = {
          width: outer,
          height: outer,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          boxSizing: 'border-box',
        };
        if (style === 'filled-circle') {
          wrapperStyle.backgroundColor = color;
        } else if (style === 'circle-outline') {
          wrapperStyle.border = `1.5px solid ${color}`;
        }
        const iconColor = style === 'filled-circle'
          ? (isDark(color) ? '#ffffff' : '#000000')
          : color;
        return (
          <span key={link.platform} style={wrapperStyle}>
            <SocialIcon platform={link.platform} size={inner} color={iconColor} />
          </span>
        );
      })}
    </div>
  );
}

// Decide whether the icon glyph inside a filled chip should render light or
// dark based on the chip background — keeps icons visible on any color.
function isDark(hex: string): boolean {
  const m = hex.replace('#', '');
  if (m.length !== 6) return true;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma < 0.55;
}

function AddressCanvas({ block, venueAddress, theme }: { block: EmailBlock; venueAddress?: VenueAddress; theme: ReturnType<typeof mergeEmailTheme> }) {
  const name = venueAddress?.name ?? 'Your Venue';
  const address = venueAddress?.location_full?.trim()
    ?? (venueAddress?.location_city && venueAddress?.location_state
      ? `${venueAddress.location_city}, ${venueAddress.location_state}`
      : null);
  const ff = block.fontFamily ?? theme.fontFamily;
  const fw = block.fontWeight ?? '400';
  const fs = block.fontSize ?? '12px';
  const color = block.color ?? theme.mutedColor;
  const align = block.align ?? 'center';
  const lh = block.lineHeight ?? 1.6;
  const ls = block.letterSpacing ?? 0;
  const tt = block.textTransform && block.textTransform !== 'none' ? block.textTransform : undefined;
  return (
    <div style={{ ...blockPaddingStyle(block), textAlign: align }}>
      <p style={{
        margin: '0 0 3px',
        fontSize: fs,
        fontWeight: 600,
        color,
        fontFamily: ff,
        lineHeight: lh,
        letterSpacing: `${ls}px`,
        textTransform: tt,
      }}>
        {name}
      </p>
      <p style={{
        margin: 0,
        fontSize: fs,
        fontWeight: fw,
        color,
        fontFamily: ff,
        lineHeight: lh,
        letterSpacing: `${ls}px`,
        textTransform: tt,
      }}>
        {address ?? 'Address pulled from your branding settings'}
      </p>
    </div>
  );
}

function BlockCanvas({ block, theme, venueAddress, venueSocials, onPatch }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; venueAddress?: VenueAddress; venueSocials?: VenueSocial[]; onPatch?: (p: Partial<EmailBlock>) => void }) {
  switch (block.type) {
    case 'heading': return <HeadingCanvas block={block} theme={theme} onPatch={onPatch} />;
    case 'text':    return <TextCanvas block={block} theme={theme} onPatch={onPatch} />;
    case 'button':  return <ButtonCanvas block={block} theme={theme} onPatch={onPatch} />;
    case 'image':   return <ImageCanvas block={block} theme={theme} />;
    case 'video':   return <VideoCanvas block={block} theme={theme} onPatch={onPatch} />;
    case 'social':  return <SocialCanvas block={block} theme={theme} venueSocials={venueSocials} />;
    case 'address': return <AddressCanvas block={block} venueAddress={venueAddress} theme={theme} />;
    case 'divider': return <DividerCanvas block={block} />;
    case 'spacer':  return <SpacerCanvas block={block} />;
    default:        return <div style={{ padding: '12px 24px', color: '#9ca3af', fontSize: '13px' }}>[{block.type}]</div>;
  }
}

// ─── Block Picker Modal ───────────────────────────────────────────────────────
function BlockPickerModal({ onSelect, onClose }: { onSelect: (type: EmailBlockType) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[480px] max-w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Add a block</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <Minus size={18} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PALETTE.map(({ type, label, desc, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => onSelect(type)}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-center hover:border-gray-400 hover:bg-white transition-all group"
            >
              <Icon size={22} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
              <div>
                <p className="text-xs font-semibold text-gray-900">{label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Add Block Button (no lines — just the + circle on hover) ────────────────
function AddBlockBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="group/addbtn relative h-7 flex items-center justify-center">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white opacity-0 group-hover/addbtn:opacity-100 transition-all duration-150 hover:scale-110"
        style={{ border: '1.5px solid #1b1b1b', color: '#1b1b1b' }}
        title="Add block"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

// ─── Sortable block wrapper — whole block is draggable ───────────────────────
function SortableBlock({
  id,
  children,
}: {
  id: string;
  children: (isDragging: boolean) => React.ReactNode;
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

// ─── Slider control (Flodesk style) ──────────────────────────────────────────
function SliderControl({
  label, value, min, max, step, display, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  display?: string;
  onChange: (v: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const snap  = (raw: number) => parseFloat((Math.round(raw / step) * step).toFixed(4));

  // Sync the uncontrolled input when value changes from outside (e.g. +/- buttons)
  useEffect(() => {
    if (inputRef.current && Number(inputRef.current.value) !== value) {
      inputRef.current.value = String(value);
    }
  }, [value]);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm text-gray-400">{display ?? value}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(clamp(snap(value - step)))}
          className="text-sm text-gray-400 hover:text-gray-700 w-4 flex-shrink-0 select-none leading-none"
        >−</button>

        {/*
          Uncontrolled input — browser owns the drag position so re-renders
          never interrupt mid-drag. onInput fires live; useEffect syncs when
          value changes externally (e.g. from +/- buttons).
        */}
        <input
          ref={inputRef}
          type="range"
          className="sp-slider flex-1"
          min={min} max={max} step={step}
          defaultValue={value}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          style={{ display: 'block' }}
        />

        <button
          type="button"
          onClick={() => onChange(clamp(snap(value + step)))}
          className="text-sm text-gray-400 hover:text-gray-700 w-4 flex-shrink-0 select-none leading-none"
        >+</button>
      </div>
    </div>
  );
}

// ─── Flodesk-style Button Inspector ──────────────────────────────────────────
const BUTTON_PRESETS: Array<{ id: NonNullable<EmailBlock['buttonStyle']>; filled: boolean; radius: number }> = [
  { id: 'filled-rect',       filled: true,  radius: 0   },
  { id: 'filled-rounded',    filled: true,  radius: 4   },
  { id: 'filled-rounded-lg', filled: true,  radius: 10  },
  { id: 'filled-pill',       filled: true,  radius: 999 },
  { id: 'outline-rect',      filled: false, radius: 0   },
  { id: 'outline-rounded',   filled: false, radius: 4   },
  { id: 'outline-rounded-lg',filled: false, radius: 10  },
  { id: 'outline-pill',      filled: false, radius: 999 },
];

interface SavedButtonStyle {
  id: string;
  preset: NonNullable<EmailBlock['buttonStyle']>;
  bg: string;
  fg: string;
  borderColor: string;
  borderWidth: number;
}

function ButtonInspector({
  block,
  theme: _theme,
  onChange,
  onMediaPick,
}: {
  block: EmailBlock;
  theme: ReturnType<typeof mergeEmailTheme>;
  onChange: (patch: Partial<EmailBlock>) => void;
  onMediaPick: (apply: (url: string) => void, mode?: 'image' | 'file' | 'all') => void;
}) {
  void _theme;
  const [tab, setTab] = useState<'button' | 'font' | 'link' | 'block'>('button');
  const [borderOpen, setBorderOpen] = useState(true);
  const [spacingOpen, setSpacingOpen] = useState(true);
  const [paddingOpen, setPaddingOpen] = useState(true);
  const [linkType, setLinkType] = useState<'url' | 'file'>(() => {
    const href = (block.href ?? '').toLowerCase();
    return /\.(pdf|docx?|xlsx?|pptx?|csv|txt)(\?|#|$)/i.test(href) ? 'file' : 'url';
  });
  const [savedStyles, setSavedStyles] = useState<SavedButtonStyle[]>([]);
  const [savedStylesOpen, setSavedStylesOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('sp_saved_button_styles');
      if (raw) setSavedStyles(JSON.parse(raw) as SavedButtonStyle[]);
    } catch { /* ignore */ }
  }, []);

  function persistSavedStyles(next: SavedButtonStyle[]) {
    setSavedStyles(next);
    try { localStorage.setItem('sp_saved_button_styles', JSON.stringify(next)); } catch { /* ignore */ }
  }

  function saveCurrentStyle() {
    const style: SavedButtonStyle = {
      id: crypto.randomUUID(),
      preset: block.buttonStyle ?? 'outline-rect',
      bg: block.buttonBgColor ?? 'transparent',
      fg: block.color ?? '#000000',
      borderColor: block.buttonBorderColor ?? '#000000',
      borderWidth: block.buttonBorderWidth ?? 2,
    };
    persistSavedStyles([...savedStyles, style]);
  }

  function deleteSavedStyle(id: string) {
    persistSavedStyles(savedStyles.filter(s => s.id !== id));
  }

  function applySavedStyle(s: SavedButtonStyle) {
    onChange({
      buttonStyle: s.preset,
      buttonBgColor: s.bg,
      color: s.fg,
      buttonBorderColor: s.borderColor,
      buttonBorderWidth: s.borderWidth,
    });
  }

  function applyPreset(presetId: NonNullable<EmailBlock['buttonStyle']>) {
    const preset = BUTTON_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    if (preset.filled) {
      onChange({
        buttonStyle: presetId,
        buttonBgColor: '#000000',
        color: '#ffffff',
        buttonBorderColor: '#000000',
        buttonBorderWidth: 0,
      });
    } else {
      onChange({
        buttonStyle: presetId,
        buttonBgColor: 'transparent',
        color: '#000000',
        buttonBorderColor: '#000000',
        buttonBorderWidth: 2,
      });
    }
  }

  const TAB_BTN = (id: typeof tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${tab === id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
    >
      {label}
      {tab === id && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />}
    </button>
  );

  return (
    <div>
      {/* Tabs */}
      <div className="flex border-b border-gray-100 -mx-5 mb-5 px-2 bg-gray-50/50">
        {TAB_BTN('button', 'Button')}
        {TAB_BTN('font', 'Font')}
        {TAB_BTN('link', 'Link')}
        {TAB_BTN('block', 'Block')}
      </div>

      {/* ─── BUTTON TAB ─── */}
      {tab === 'button' && (
        <div className="space-y-6">
          {/* Saved styles trigger */}
          <div>
            <button
              type="button"
              onClick={() => setSavedStylesOpen(true)}
              className="w-full flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                Saved styles
              </span>
              <span className="flex items-center gap-2 text-xs font-medium text-gray-400">
                {savedStyles.length > 0 ? `${savedStyles.length} saved` : 'None yet'}
                <ChevronRight size={14} className="text-gray-400" />
              </span>
            </button>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <p className="text-sm font-semibold text-gray-900 mb-3">Style</p>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {BUTTON_PRESETS.slice(0, 4).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`h-9 transition-all ${block.buttonStyle === p.id ? 'ring-2 ring-blue-500' : 'hover:opacity-80'}`}
                  style={{
                    background: '#e5e7eb',
                    borderRadius: p.radius,
                  }}
                />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {BUTTON_PRESETS.slice(4).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`h-9 transition-all ${block.buttonStyle === p.id ? 'ring-2 ring-blue-500' : 'hover:bg-gray-50'}`}
                  style={{
                    background: 'transparent',
                    border: '1.5px solid #d1d5db',
                    borderRadius: p.radius,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Border color */}
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">
              Border color <span className="text-xs font-normal text-gray-400 ml-1">{block.buttonBorderColor ?? '#000000'}</span>
            </p>
            <FlodeskColorPicker
              value={block.buttonBorderColor ?? '#000000'}
              onChange={(v) => onChange({ buttonBorderColor: v })}
            />
          </div>

          {/* Position */}
          <AlignSelector
            label="Position"
            value={(block.align ?? 'center') as Align3}
            onChange={(p) => onChange({ align: p })}
          />

          {/* Border and sizing */}
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setBorderOpen(o => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Border and sizing</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${borderOpen ? 'rotate-180' : ''}`} />
            </button>
            {borderOpen && (
              <div className="space-y-5">
                <SliderControl
                  label="Border thickness"
                  value={block.buttonBorderWidth ?? 2}
                  min={0} max={10} step={1}
                  display={`${block.buttonBorderWidth ?? 2}`}
                  onChange={(v) => onChange({ buttonBorderWidth: v })}
                />
                <SliderControl
                  label="Width"
                  value={block.buttonWidth ?? 30}
                  min={0} max={100} step={1}
                  display={`${block.buttonWidth ?? 30}`}
                  onChange={(v) => onChange({ buttonWidth: v })}
                />
                <SliderControl
                  label="Height"
                  value={block.buttonHeight ?? 15}
                  min={0} max={60} step={1}
                  display={`${block.buttonHeight ?? 15}`}
                  onChange={(v) => onChange({ buttonHeight: v })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── FONT TAB ─── */}
      {tab === 'font' && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">Font</p>
            <FontSelector value={block.fontFamily ?? 'Helvetica, Arial, sans-serif'} onChange={(v) => onChange({ fontFamily: v })} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1.5">Weight</p>
            <div className="flex gap-1 flex-wrap">
              {FONT_WEIGHTS.map(w => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => onChange({ fontWeight: w.value })}
                  className={`flex h-8 items-center justify-center rounded-lg px-3 text-xs transition-colors ${(block.fontWeight ?? '400') === w.value ? 'bg-gray-100 text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <SliderControl
            label="Size"
            value={parseInt(block.fontSize ?? '14') || 14}
            min={8} max={48} step={1}
            display={`${parseInt(block.fontSize ?? '14') || 14}`}
            onChange={(v) => onChange({ fontSize: `${v}px` })}
          />
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">
              Font color <span className="text-xs font-normal text-gray-400 ml-1">{block.color ?? '#000000'}</span>
            </p>
            <FlodeskColorPicker value={block.color ?? '#000000'} onChange={(v) => onChange({ color: v })} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1.5">Case</p>
            <div className="flex gap-1">
              {([
                { v: 'none' as const,       label: '-'  },
                { v: 'lowercase' as const,  label: 'aa' },
                { v: 'capitalize' as const, label: 'Aa' },
                { v: 'uppercase' as const,  label: 'AA' },
              ]).map(c => (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => onChange({ textTransform: c.v })}
                  className={`flex h-9 px-2.5 items-center justify-center rounded-lg text-sm transition-colors ${(block.textTransform ?? 'none') === c.v ? 'bg-gray-100 text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setSpacingOpen(o => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Spacing</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${spacingOpen ? 'rotate-180' : ''}`} />
            </button>
            {spacingOpen && (
              <div className="space-y-5">
                <SliderControl
                  label="Line height"
                  value={block.lineHeight ?? 1}
                  min={0.8} max={3} step={0.1}
                  display={(block.lineHeight ?? 1).toFixed(1)}
                  onChange={(v) => onChange({ lineHeight: Math.round(v * 10) / 10 })}
                />
                <SliderControl
                  label="Letter spacing"
                  value={block.letterSpacing ?? 1.8}
                  min={-2} max={10} step={0.1}
                  display={(block.letterSpacing ?? 1.8).toFixed(1)}
                  onChange={(v) => onChange({ letterSpacing: Math.round(v * 10) / 10 })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── LINK TAB ─── */}
      {tab === 'link' && (
        <div className="space-y-4">
          {/* Pill toggle — Flodesk-style rounded rectangle with prominent active state */}
          <div
            className="flex bg-gray-100 p-1.5"
            style={{ borderRadius: '14px' }}
          >
            {(['url', 'file'] as const).map(t => {
              const active = linkType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLinkType(t)}
                  className="flex-1 px-4 py-2.5 text-[15px] transition-all"
                  style={{
                    borderRadius: '10px',
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#111827' : '#9ca3af',
                    fontWeight: active ? 700 : 600,
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.05)' : 'none',
                  }}
                >
                  {t === 'url' ? 'URL' : 'File'}
                </button>
              );
            })}
          </div>
          {linkType === 'url' && (
            <textarea
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 placeholder:text-gray-300 focus:border-gray-400 focus:outline-none transition-colors resize-none"
              rows={6}
              value={block.href ?? ''}
              onChange={(e) => onChange({ href: e.target.value })}
              placeholder="https://"
            />
          )}
          {linkType === 'file' && (
            <div className="space-y-2">
              {block.href ? (
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <FileText size={14} className="text-gray-500 flex-shrink-0" />
                  <span className="flex-1 truncate text-xs text-gray-700">{block.href}</span>
                  <button
                    type="button"
                    onClick={() => onChange({ href: '' })}
                    className="text-[11px] font-semibold text-gray-400 hover:text-gray-700"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  onMediaPick((url) => onChange({ href: url }), 'file')
                }
                className="w-full rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-white transition-colors"
              >
                {block.href ? 'Choose a different file' : 'Choose a file from media library'}
              </button>
              <p className="text-[11px] text-gray-400 leading-snug">
                Link to a PDF, Word doc, Excel sheet, PowerPoint, or any document in your media library.
              </p>
            </div>
          )}
          <p className="text-[11px] text-gray-400 leading-snug pt-1 border-t border-gray-100">
            Tip: click the button on the canvas to edit its label inline.
          </p>
        </div>
      )}

      {/* ─── BLOCK TAB ─── */}
      {tab === 'block' && (
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
              onClick={() => setPaddingOpen(o => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Padding</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${paddingOpen ? 'rotate-180' : ''}`} />
            </button>
            {paddingOpen && (
              <div className="space-y-5">
                <SliderControl
                  label="Padding top"
                  value={block.paddingTop ?? 10}
                  min={0} max={80} step={1}
                  display={`${block.paddingTop ?? 10}`}
                  onChange={(v) => onChange({ paddingTop: v })}
                />
                <SliderControl
                  label="Padding bottom"
                  value={block.paddingBottom ?? 10}
                  min={0} max={80} step={1}
                  display={`${block.paddingBottom ?? 10}`}
                  onChange={(v) => onChange({ paddingBottom: v })}
                />
                <SliderControl
                  label="Padding left"
                  value={block.paddingLeft ?? 0}
                  min={0} max={80} step={1}
                  display={`${block.paddingLeft ?? 0}`}
                  onChange={(v) => onChange({ paddingLeft: v })}
                />
                <SliderControl
                  label="Padding right"
                  value={block.paddingRight ?? 0}
                  min={0} max={80} step={1}
                  display={`${block.paddingRight ?? 0}`}
                  onChange={(v) => onChange({ paddingRight: v })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {savedStylesOpen && (
        <SavedStylesModal
          styles={savedStyles}
          currentBlock={block}
          onClose={() => setSavedStylesOpen(false)}
          onApply={(s) => { applySavedStyle(s); setSavedStylesOpen(false); }}
          onDelete={deleteSavedStyle}
          onSaveCurrent={saveCurrentStyle}
        />
      )}
    </div>
  );
}

function SavedStylesModal({
  styles,
  currentBlock,
  onClose,
  onApply,
  onDelete,
  onSaveCurrent,
}: {
  styles: SavedButtonStyle[];
  currentBlock: EmailBlock;
  onClose: () => void;
  onApply: (s: SavedButtonStyle) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: () => void;
}) {
  // Quick visual test: is the current button's settings already saved?
  const currentSig = `${currentBlock.buttonStyle ?? 'outline-rect'}|${currentBlock.buttonBgColor ?? ''}|${currentBlock.color ?? ''}|${currentBlock.buttonBorderColor ?? ''}|${currentBlock.buttonBorderWidth ?? 0}`;
  const alreadySaved = styles.some(
    (s) => `${s.preset}|${s.bg}|${s.fg}|${s.borderColor}|${s.borderWidth}` === currentSig,
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>

        <h2 className="text-xl font-bold text-gray-900 mb-1.5">Saved styles</h2>
        <p className="text-sm text-gray-400 mb-5 leading-snug pr-8">
          Save your button settings as a style you can easily reuse
        </p>

        {styles.length > 0 ? (
          <div className="grid grid-cols-5 gap-2.5 mb-6">
            {styles.map((s) => {
              const radius = BUTTON_PRESETS.find((p) => p.id === s.preset)?.radius ?? 0;
              const isFilled = s.preset.startsWith('filled') || (s.bg !== 'transparent' && s.bg !== '#ffffff' && s.bg !== '');
              const tileBg = s.bg === 'transparent' ? '#ffffff' : s.bg;
              return (
                <div key={s.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onApply(s)}
                    className="flex h-14 w-full items-center justify-center text-base font-semibold transition-transform hover:scale-105"
                    style={{
                      background: tileBg,
                      color: s.fg,
                      border: isFilled
                        ? (s.borderWidth ? `${s.borderWidth}px solid ${s.borderColor}` : 'none')
                        : `${s.borderWidth || 2}px solid ${s.borderColor}`,
                      borderRadius: `${radius}px`,
                    }}
                    aria-label="Apply saved style"
                  >
                    Aa
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm opacity-0 group-hover:opacity-100 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-opacity"
                    aria-label="Delete saved style"
                    title="Delete"
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mb-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
            <p className="text-xs text-gray-400 leading-snug">
              No saved styles yet. Click the button below to save the current button's look.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onSaveCurrent}
          disabled={alreadySaved}
          className="w-full rounded-2xl border border-gray-300 bg-white py-3.5 text-base font-bold text-gray-900 hover:border-gray-900 hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white"
        >
          {alreadySaved ? 'Already saved' : 'Save this button style'}
        </button>
      </div>
    </div>
  );
}

// ─── Video Inspector — Flodesk-style: URL + Overlay + Block ──────────────────
function VideoInspector({
  block,
  onChange,
  onMediaPick,
  subTab,
  setSubTab,
  renderSubTabBar,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
  onMediaPick: (apply: (url: string) => void, mode?: 'image' | 'file' | 'all') => void;
  subTab: 'primary' | 'block';
  setSubTab: (v: 'primary' | 'block') => void;
  renderSubTabBar: (primaryLabel: string) => React.ReactNode;
}) {
  void setSubTab; // tab state is owned by parent; we read but don't switch
  const [overlayOpen, setOverlayOpen] = useState(true);
  const [linkOpen, setLinkOpen] = useState(true);
  const [paddingOpen, setPaddingOpen] = useState(true);

  const parsed = parseVideoUrl(block.href ?? '');
  const overlayColor = block.videoOverlayColor ?? '#000000';
  const overlayOpacity = block.videoOverlayOpacity ?? 0;
  const showTitle = block.videoShowTitle !== false;
  const dPad = BLOCK_PADDING_DEFAULTS.video;

  return (
    <div>
      {renderSubTabBar('Video')}

      {/* ─── VIDEO TAB ─────────────────────────────────────────────────── */}
      {subTab === 'primary' && (
        <div className="space-y-5">
          {/* Video URL */}
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">Video URL</p>
            <p className="text-xs text-gray-400 mb-2">Paste your YouTube, Vimeo or Loom URL</p>
            <textarea
              rows={3}
              value={block.href ?? ''}
              onChange={(e) => onChange({ href: e.target.value })}
              placeholder="https://"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors resize-none"
            />
            {parsed && (
              <p className="mt-1.5 text-[11px] text-emerald-600 flex items-center gap-1">
                <Check size={11} />
                {parsed.label} link detected{parsed.thumbnail ? ' — thumbnail auto-loaded' : ''}
              </p>
            )}
          </div>

          {/* Optional custom thumbnail (only for providers we can't auto-fetch) */}
          {parsed && !parsed.thumbnail && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-semibold text-gray-900 mb-1">Thumbnail</p>
              <p className="text-xs text-gray-400 mb-2">Vimeo and other custom hosts don&apos;t expose public thumbnails — pick one from your media library.</p>
              {block.src ? (
                <div className="space-y-2">
                  <div className="rounded-xl overflow-hidden border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={block.src} alt="Thumbnail" className="block w-full h-auto" style={{ aspectRatio: '16 / 9', objectFit: 'cover' }} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onMediaPick((url) => onChange({ src: url }), 'image')}
                      className="flex-1 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange({ src: '' })}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onMediaPick((url) => onChange({ src: url }), 'image')}
                  className="w-full rounded-lg border border-dashed border-gray-300 py-3 text-xs font-medium text-gray-600 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  Choose thumbnail from media library
                </button>
              )}
            </div>
          )}

          {/* Overlay effects */}
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setOverlayOpen((o) => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-900">Overlay effects</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${overlayOpen ? 'rotate-180' : ''}`} />
            </button>
            {overlayOpen && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-1.5">
                    Color <span className="font-normal text-gray-400 text-xs font-mono uppercase">{overlayColor}</span>
                  </p>
                  <FlodeskColorPicker
                    value={overlayColor}
                    onChange={(v) => onChange({ videoOverlayColor: v })}
                  />
                </div>
                <SliderControl
                  label="Opacity"
                  value={overlayOpacity}
                  min={0} max={100} step={1}
                  display={`${overlayOpacity}`}
                  onChange={(v) => onChange({ videoOverlayOpacity: v })}
                />
              </div>
            )}
          </div>

          {/* Link actions — informational, since we always open externally */}
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setLinkOpen((o) => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-900">Link actions</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${linkOpen ? 'rotate-180' : ''}`} />
            </button>
            {linkOpen && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                <p className="text-xs text-gray-500 mb-1">When a subscriber clicks this video:</p>
                <p className="text-sm text-gray-800 font-medium flex items-center gap-1.5">
                  <Link2 size={13} className="text-gray-500" />
                  Opens the video link in a new tab
                </p>
                <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
                  Email clients can&apos;t embed playable video reliably, so we render a thumbnail with a play button. Clicking it opens the original {parsed?.label ?? 'video'} URL in the recipient&apos;s browser.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── BLOCK TAB ─────────────────────────────────────────────────── */}
      {subTab === 'block' && (
        <div className="space-y-5">
          {/* Show title toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Show title</span>
            <button
              type="button"
              onClick={() => onChange({ videoShowTitle: !showTitle })}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${showTitle ? 'bg-blue-500' : 'bg-gray-200'}`}
              aria-pressed={showTitle}
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${showTitle ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">
              Background <span className="font-normal text-gray-400 text-xs font-mono uppercase">{block.blockBgColor ?? 'transparent'}</span>
            </p>
            <FlodeskColorPicker
              value={block.blockBgColor ?? 'transparent'}
              onChange={(v) => onChange({ blockBgColor: v })}
            />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setPaddingOpen((o) => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-900">Padding</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${paddingOpen ? 'rotate-180' : ''}`} />
            </button>
            {paddingOpen && (
              <div className="space-y-5">
                <SliderControl
                  label="Padding top"
                  value={block.paddingTop ?? dPad.top}
                  min={0} max={120} step={1}
                  display={`${block.paddingTop ?? dPad.top}`}
                  onChange={(v) => onChange({ paddingTop: v })}
                />
                <SliderControl
                  label="Padding bottom"
                  value={block.paddingBottom ?? dPad.bottom}
                  min={0} max={120} step={1}
                  display={`${block.paddingBottom ?? dPad.bottom}`}
                  onChange={(v) => onChange({ paddingBottom: v })}
                />
                <SliderControl
                  label="Padding left"
                  value={block.paddingLeft ?? dPad.left}
                  min={0} max={120} step={1}
                  display={`${block.paddingLeft ?? dPad.left}`}
                  onChange={(v) => onChange({ paddingLeft: v })}
                />
                <SliderControl
                  label="Padding right"
                  value={block.paddingRight ?? dPad.right}
                  min={0} max={120} step={1}
                  display={`${block.paddingRight ?? dPad.right}`}
                  onChange={(v) => onChange({ paddingRight: v })}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Spacer Inspector — Flodesk-style: Background + Height ───────────────────
function SpacerInspector({
  block,
  onChange,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
}) {
  const height = block.spacerHeight ?? 24;

  return (
    <div>
      {/* Single header tab indicator */}
      <div className="flex border-b border-gray-100 -mx-5 mb-5 px-2 bg-gray-50/50 justify-center">
        <button type="button" className="py-3 px-6 text-sm font-semibold text-gray-900 relative">
          Block
          <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-2">Background</p>
          <FlodeskColorPicker
            value={block.blockBgColor ?? 'transparent'}
            onChange={(v) => onChange({ blockBgColor: v })}
          />
        </div>

        <div>
          <SliderControl
            label="Height"
            value={height}
            min={4} max={200} step={1}
            display={`${height}`}
            onChange={(v) => onChange({ spacerHeight: v })}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Divider Inspector — Flodesk-style line settings ─────────────────────────
function DividerInspector({
  block,
  onChange,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
}) {
  const [styleOpen, setStyleOpen]   = useState(false);
  const [sizingOpen, setSizingOpen] = useState(true);
  const [paddingOpen, setPaddingOpen] = useState(true);

  const lineStyle  = (block.dividerStyle ?? 'solid') as 'solid' | 'dashed' | 'dotted';
  const lineColor  = block.dividerColor ?? '#D7D7D7';
  const thickness  = block.dividerThickness ?? 1;
  const lineWidth  = block.dividerWidth ?? 300;
  const align      = block.align ?? 'center';
  const padTop     = block.paddingTop ?? 10;
  const padBottom  = block.paddingBottom ?? 10;

  const STYLE_OPTIONS: { id: 'solid' | 'dashed' | 'dotted'; render: React.ReactNode }[] = [
    { id: 'solid',  render: <div style={{ width: '100%', borderTop: '2px solid #111827' }} /> },
    { id: 'dashed', render: <div style={{ width: '100%', borderTop: '2px dashed #111827' }} /> },
    { id: 'dotted', render: <div style={{ width: '100%', borderTop: '2px dotted #111827' }} /> },
  ];

  return (
    <div>
      {/* Single header tab indicator */}
      <div className="flex border-b border-gray-100 -mx-5 mb-5 px-2 bg-gray-50/50 justify-center">
        <button type="button" className="py-3 px-6 text-sm font-semibold text-gray-900 relative">
          Block
          <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />
        </button>
      </div>

      <div className="space-y-5">
        {/* Line style dropdown */}
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-2">Line style</p>
          <button
            type="button"
            onClick={() => setStyleOpen(o => !o)}
            className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 bg-white hover:border-gray-400 transition-colors ${styleOpen ? 'border-blue-500 ring-1 ring-blue-200' : 'border-gray-200'}`}
          >
            <div className="flex-1 mr-3">
              {STYLE_OPTIONS.find(s => s.id === lineStyle)?.render}
            </div>
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${styleOpen ? 'rotate-180' : ''}`} />
          </button>
          {styleOpen && (
            <div className="mt-1.5 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              {STYLE_OPTIONS.map(o => {
                const active = o.id === lineStyle;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { onChange({ dividerStyle: o.id }); setStyleOpen(false); }}
                    className={`w-full flex items-center px-4 py-4 transition-colors ${active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex-1">{o.render}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Color */}
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <p className="text-sm font-semibold text-gray-900">Color</p>
            <span className="text-xs text-gray-400 font-mono uppercase">{lineColor.replace('#', '#')}</span>
          </div>
          <FlodeskColorPicker
            value={lineColor}
            onChange={(v) => onChange({ dividerColor: v })}
          />
        </div>

        {/* Position */}
        <AlignSelector
          label="Position"
          value={align as Align3}
          onChange={(a) => onChange({ align: a })}
        />

        {/* Thickness & width */}
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={() => setSizingOpen(o => !o)}
            className="flex items-center justify-between w-full mb-3"
          >
            <span className="text-sm font-semibold text-gray-700">Thickness &amp; width</span>
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${sizingOpen ? 'rotate-180' : ''}`} />
          </button>
          {sizingOpen && (
            <div className="space-y-4">
              <SliderControl
                label="Thickness"
                value={thickness}
                min={1} max={20} step={1}
                display={`${thickness}`}
                onChange={(v) => onChange({ dividerThickness: v })}
              />
              <SliderControl
                label="Width"
                value={lineWidth}
                min={20} max={600} step={10}
                display={`${lineWidth}`}
                onChange={(v) => onChange({ dividerWidth: v })}
              />
            </div>
          )}
        </div>

        {/* Padding */}
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={() => setPaddingOpen(o => !o)}
            className="flex items-center justify-between w-full mb-3"
          >
            <span className="text-sm font-semibold text-gray-700">Padding</span>
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${paddingOpen ? 'rotate-180' : ''}`} />
          </button>
          {paddingOpen && (
            <div className="space-y-4">
              <SliderControl
                label="Padding top"
                value={padTop}
                min={0} max={120} step={2}
                display={`${padTop}`}
                onChange={(v) => onChange({ paddingTop: v })}
              />
              <SliderControl
                label="Padding bottom"
                value={padBottom}
                min={0} max={120} step={2}
                display={`${padBottom}`}
                onChange={(v) => onChange({ paddingBottom: v })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Image Inspector — Image / Link / Block tabs (uses the shared media modal) ─
function ImageInspector({
  block,
  onChange,
  onMediaPick,
}: {
  block: EmailBlock;
  onChange: (patch: Partial<EmailBlock>) => void;
  onMediaPick: (apply: (url: string) => void, mode?: 'image' | 'file' | 'all') => void;
}) {
  const [tab, setTab] = useState<'image' | 'link' | 'block'>('image');
  const [linkType, setLinkType] = useState<'url' | 'file'>(
    block.href?.match(/\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip)(\?|$)/i) ? 'file' : 'url'
  );

  // Collapsible sections.
  const [accessOpen, setAccessOpen]     = useState(false);
  const [gridOpen, setGridOpen]         = useState(true);
  const [positionOpen, setPositionOpen] = useState(true);
  const [paddingOpen, setPaddingOpen]   = useState(true);

  // Grid + image count helpers.
  const cols = Math.max(1, Math.min(4, block.imageGridColumns ?? 1));
  const totalImages = 1 + (block.imageGridImages?.length ?? 0);

  function setColumns(n: 1 | 2 | 3 | 4) {
    const currentTotal = totalImages;
    let nextExtras = block.imageGridImages ?? [];
    if (currentTotal < n) {
      nextExtras = [...nextExtras, ...Array.from({ length: n - currentTotal }, () => ({ src: '', alt: '' }))];
    }
    onChange({ imageGridColumns: n, imageGridImages: nextExtras });
  }

  function setTotal(n: number) {
    const target = Math.max(1, Math.min(12, n));
    const extras = block.imageGridImages ?? [];
    if (target - 1 < extras.length) {
      onChange({ imageGridImages: extras.slice(0, target - 1) });
    } else if (target - 1 > extras.length) {
      const add = target - 1 - extras.length;
      onChange({ imageGridImages: [...extras, ...Array.from({ length: add }, () => ({ src: '', alt: '' }))] });
    }
  }

  // Per-slot read/write helpers.
  function getSlot(i: number): { src: string; alt: string } {
    if (i === 0) return { src: block.src ?? '', alt: block.alt ?? '' };
    const e = (block.imageGridImages ?? [])[i - 1];
    return { src: e?.src ?? '', alt: e?.alt ?? '' };
  }
  function patchSlot(i: number, patch: Partial<{ src: string; alt: string }>) {
    if (i === 0) {
      const next: Partial<EmailBlock> = {};
      if ('src' in patch) next.src = patch.src;
      if ('alt' in patch) next.alt = patch.alt;
      onChange(next);
    } else {
      const list = [...(block.imageGridImages ?? [])];
      const j = i - 1;
      list[j] = { ...(list[j] ?? {}), ...patch };
      onChange({ imageGridImages: list });
    }
  }

  // Open the shared media library modal for a specific slot.
  function pickForSlot(i: number) {
    onMediaPick((url) => patchSlot(i, { src: url }), 'image');
  }

  // Tab button helper.
  const TAB_BTN = (id: typeof tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${tab === id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
    >
      {label}
      {tab === id && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />}
    </button>
  );

  const totalWidth = block.imageWidth ?? 600;

  return (
    <div>
      {/* Tabs */}
      <div className="flex border-b border-gray-100 -mx-5 mb-5 px-2 bg-gray-50/50">
        {TAB_BTN('image', 'Image')}
        {TAB_BTN('link',  'Link')}
        {TAB_BTN('block', 'Block')}
      </div>

      {/* ─── IMAGE TAB ─── */}
      {tab === 'image' && (
        <div className="space-y-5">
          {/* Per-slot media picker — same modal flow used everywhere else */}
          {Array.from({ length: totalImages }).map((_, i) => {
            const slot = getSlot(i);
            const labelIdx = totalImages > 1 ? `Image ${i + 1}` : 'Image';
            return (
              <div key={i}>
                {totalImages > 1 && <p className="text-xs font-semibold text-gray-700 mb-1.5">{labelIdx}</p>}
                {slot.src ? (
                  <div className="space-y-2">
                    <div className="relative rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={slot.src} alt={slot.alt} className="w-full h-32 object-cover" />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => pickForSlot(i)}
                        className="flex-1 rounded-lg border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => patchSlot(i, { src: '' })}
                        className="rounded-lg border border-gray-200 bg-white py-2 px-3 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
                        aria-label="Remove image"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => pickForSlot(i)}
                    className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 py-8 px-4 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                  >
                    <UploadIcon size={20} className="text-gray-500" />
                    <p className="text-sm font-semibold text-gray-900">Choose an image</p>
                    <p className="text-xs text-gray-400 text-center">Pick from your media library<br />or upload a new one</p>
                  </button>
                )}
              </div>
            );
          })}

          {/* Width slider */}
          <div className="border-t border-gray-100 pt-4">
            <SliderControl
              label="Width"
              value={totalWidth}
              min={100}
              max={600}
              step={10}
              display={`${totalWidth}`}
              onChange={(v) => onChange({ imageWidth: v })}
            />
          </div>

          {/* Accessibility */}
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setAccessOpen(o => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Accessibility</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${accessOpen ? 'rotate-180' : ''}`} />
            </button>
            {accessOpen && (
              <div className="space-y-3">
                {Array.from({ length: totalImages }).map((_, i) => {
                  const slot = getSlot(i);
                  return (
                    <div key={i}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Alt text {totalImages > 1 ? `(image ${i + 1})` : ''}
                      </label>
                      <input
                        type="text"
                        value={slot.alt}
                        onChange={(e) => patchSlot(i, { alt: e.target.value })}
                        placeholder="Describe this image"
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
                      />
                    </div>
                  );
                })}
                <p className="text-[11px] text-gray-400 leading-snug">
                  Alt text is read by screen readers and shown if the image fails to load.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── LINK TAB ─── */}
      {tab === 'link' && (
        <div className="space-y-4">
          {/* URL / File pill — same style as button */}
          <div
            className="flex bg-gray-100 p-1.5"
            style={{ borderRadius: '14px' }}
          >
            {(['url', 'file'] as const).map(t => {
              const active = linkType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLinkType(t)}
                  className="flex-1 px-4 py-2.5 text-[15px] transition-all"
                  style={{
                    borderRadius: '10px',
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#111827' : '#9ca3af',
                    fontWeight: active ? 700 : 600,
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.05)' : 'none',
                  }}
                >
                  {t === 'url' ? 'URL' : 'File'}
                </button>
              );
            })}
          </div>

          {linkType === 'url' && (
            <textarea
              rows={4}
              value={block.href ?? ''}
              onChange={(e) => onChange({ href: e.target.value })}
              placeholder="https://"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none transition-colors resize-none"
            />
          )}

          {linkType === 'file' && (
            <div>
              {block.href?.trim() ? (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 flex items-center gap-2">
                  <FileText size={16} className="text-gray-400 flex-shrink-0" />
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
                    className="text-gray-400 hover:text-red-600 transition-colors"
                    aria-label="Remove file link"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onMediaPick((url) => onChange({ href: url }), 'file')}
                  className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 py-8 px-4 hover:border-gray-400 transition-colors"
                >
                  <UploadIcon size={20} className="text-gray-500" />
                  <p className="text-sm font-semibold text-gray-900">Choose a file</p>
                  <p className="text-xs text-gray-400 text-center">PDF, Word, Excel, or other file<br />from your media library</p>
                </button>
              )}
            </div>
          )}

          {/* Open behavior */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-900 mb-1">Link actions</p>
            <p className="text-xs text-gray-500 mb-2">When a subscriber clicks this link:</p>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700">
              Opens in a new tab
            </div>
          </div>
        </div>
      )}

      {/* ─── BLOCK TAB ─── */}
      {tab === 'block' && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">Background</p>
            <FlodeskColorPicker
              value={block.blockBgColor ?? 'transparent'}
              onChange={(v) => onChange({ blockBgColor: v })}
            />
          </div>

          {/* Grid & aspect ratio */}
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setGridOpen(o => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Grid &amp; aspect ratio</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${gridOpen ? 'rotate-180' : ''}`} />
            </button>
            {gridOpen && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">
                    Grid layout <span className="font-normal text-gray-400 ml-1 uppercase text-[10px] tracking-wider">{cols} COLUMN{cols > 1 ? 'S' : ''}</span>
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {([1, 2, 3, 4] as const).map(n => {
                      const active = cols === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setColumns(n)}
                          className={`aspect-square rounded-lg border-2 flex items-center justify-center transition-colors ${active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-400 bg-white'}`}
                        >
                          <div className="flex gap-0.5">
                            {Array.from({ length: n }).map((_, i) => (
                              <div
                                key={i}
                                className={`rounded-sm border ${active ? 'border-blue-500' : 'border-gray-400'}`}
                                style={{ width: '6px', height: '14px' }}
                              />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <SliderControl
                  label="Number of images"
                  value={totalImages}
                  min={1} max={12} step={1}
                  display={`${totalImages}`}
                  onChange={(v) => setTotal(v)}
                />
                <SliderControl
                  label="Spacing"
                  value={block.imageGridGap ?? 16}
                  min={0} max={48} step={2}
                  display={`${block.imageGridGap ?? 16}`}
                  onChange={(v) => onChange({ imageGridGap: v })}
                />
              </div>
            )}
          </div>

          {/* Position */}
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setPositionOpen(o => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Position</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${positionOpen ? 'rotate-180' : ''}`} />
            </button>
            {positionOpen && (
              <AlignSelector
                label=""
                value={(block.align ?? 'center') as Align3}
                onChange={(a) => onChange({ align: a })}
              />
            )}
          </div>

          {/* Padding */}
          <div className="border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setPaddingOpen(o => !o)}
              className="flex items-center justify-between w-full mb-3"
            >
              <span className="text-sm font-semibold text-gray-700">Padding</span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform ${paddingOpen ? 'rotate-180' : ''}`} />
            </button>
            {paddingOpen && (
              <div className="space-y-5">
                <SliderControl
                  label="Padding top"
                  value={block.paddingTop ?? 8}
                  min={0} max={120} step={1}
                  display={`${block.paddingTop ?? 8}`}
                  onChange={(v) => onChange({ paddingTop: v })}
                />
                <SliderControl
                  label="Padding bottom"
                  value={block.paddingBottom ?? 8}
                  min={0} max={120} step={1}
                  display={`${block.paddingBottom ?? 8}`}
                  onChange={(v) => onChange({ paddingBottom: v })}
                />
                <SliderControl
                  label="Padding left"
                  value={block.paddingLeft ?? 24}
                  min={0} max={120} step={1}
                  display={`${block.paddingLeft ?? 24}`}
                  onChange={(v) => onChange({ paddingLeft: v })}
                />
                <SliderControl
                  label="Padding right"
                  value={block.paddingRight ?? 24}
                  min={0} max={120} step={1}
                  display={`${block.paddingRight ?? 24}`}
                  onChange={(v) => onChange({ paddingRight: v })}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Right Panel — Block Inspector ───────────────────────────────────────────
function BlockInspectorPanel({
  block,
  theme,
  onChange,
  onMediaPick,
  venueSocials,
}: {
  block: EmailBlock;
  theme: ReturnType<typeof mergeEmailTheme>;
  onChange: (patch: Partial<EmailBlock>) => void;
  onMediaPick: (apply: (url: string) => void, mode?: 'image' | 'file' | 'all') => void;
  venueSocials?: VenueSocial[];
}) {
  const LABEL = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
  const INPUT = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors';
  const [spacingOpen, setSpacingOpen] = useState(true);
  const [paddingOpen, setPaddingOpen] = useState(true);
  // Sub-tab for non-button block types: primary settings vs Block (padding/bg).
  // Reset to primary tab whenever a different block is selected (using prev-state pattern
  // to avoid calling setState inside an effect).
  const [subTab, setSubTab] = useState<'primary' | 'block'>('primary');
  // Address block has 3 tabs (Font / Address / Block) — separate state so it isn't
  // forced through the 2-tab `subTab` state shape.
  const [addressTab, setAddressTab] = useState<'font' | 'address' | 'block'>('address');
  // Social block has 3 tabs (Icons / Links / Block). Same pattern as address.
  const [socialTab, setSocialTab] = useState<'icons' | 'links' | 'block'>('icons');
  const [prevBlockId, setPrevBlockId] = useState(block.id);
  if (prevBlockId !== block.id) {
    setPrevBlockId(block.id);
    setSubTab('primary');
    setAddressTab('address');
    setSocialTab('icons');
  }

  // Reusable Block-tab content (background + padding sliders).
  const renderBlockTab = () => {
    const d = BLOCK_PADDING_DEFAULTS[block.type] ?? { top: 8, bottom: 8, left: 24, right: 24 };
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
            onClick={() => setPaddingOpen(o => !o)}
            className="flex items-center justify-between w-full mb-3"
          >
            <span className="text-sm font-semibold text-gray-700">Padding</span>
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${paddingOpen ? 'rotate-180' : ''}`} />
          </button>
          {paddingOpen && (
            <div className="space-y-5">
              <SliderControl
                label="Padding top"
                value={block.paddingTop ?? d.top}
                min={0} max={120} step={1}
                display={`${block.paddingTop ?? d.top}`}
                onChange={(v) => onChange({ paddingTop: v })}
              />
              <SliderControl
                label="Padding bottom"
                value={block.paddingBottom ?? d.bottom}
                min={0} max={120} step={1}
                display={`${block.paddingBottom ?? d.bottom}`}
                onChange={(v) => onChange({ paddingBottom: v })}
              />
              <SliderControl
                label="Padding left"
                value={block.paddingLeft ?? d.left}
                min={0} max={120} step={1}
                display={`${block.paddingLeft ?? d.left}`}
                onChange={(v) => onChange({ paddingLeft: v })}
              />
              <SliderControl
                label="Padding right"
                value={block.paddingRight ?? d.right}
                min={0} max={120} step={1}
                display={`${block.paddingRight ?? d.right}`}
                onChange={(v) => onChange({ paddingRight: v })}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  // Reusable tab bar — primary tab label varies per block type.
  const renderSubTabBar = (primaryLabel: string) => (
    <div className="flex border-b border-gray-100 -mx-5 mb-5 px-2 bg-gray-50/50">
      {([
        { id: 'primary' as const, label: primaryLabel },
        { id: 'block' as const,   label: 'Block' },
      ]).map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => setSubTab(t.id)}
          className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${subTab === t.id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
        >
          {t.label}
          {subTab === t.id && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />}
        </button>
      ))}
    </div>
  );

  const AlignRow = () => (
    <AlignSelector
      value={(block.align ?? 'left') as Align3}
      onChange={(a) => onChange({ align: a })}
    />
  );

  const CaseRow = () => (
    <div>
      <p className="text-sm font-semibold text-gray-700 mb-1.5">Case</p>
      <div className="flex gap-0.5">
        {([
          { v: 'none' as const,       label: '-'  },
          { v: 'lowercase' as const,  label: 'aa' },
          { v: 'capitalize' as const, label: 'Aa' },
          { v: 'uppercase' as const,  label: 'AA' },
        ]).map(c => (
          <button
            key={c.v}
            type="button"
            onClick={() => onChange({ textTransform: c.v })}
            className={`flex h-9 px-2.5 items-center justify-center rounded-lg text-sm transition-colors ${(block.textTransform ?? 'none') === c.v ? 'bg-gray-100 text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );

  const SpacingSection = ({ defaultFontSize }: { defaultFontSize: number }) => (
    <div className="border-t border-gray-100 pt-4">
      <button
        type="button"
        onClick={() => setSpacingOpen(o => !o)}
        className="flex items-center justify-between w-full mb-3"
      >
        <span className="text-sm font-semibold text-gray-700">Spacing</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${spacingOpen ? 'rotate-180' : ''}`} />
      </button>
      {spacingOpen && (
        <div className="space-y-5">
          <SliderControl
            label="Font size"
            value={parseInt(block.fontSize ?? `${defaultFontSize}px`) || defaultFontSize}
            min={10} max={72} step={1}
            display={`${parseInt(block.fontSize ?? `${defaultFontSize}px`) || defaultFontSize}`}
            onChange={(v) => onChange({ fontSize: `${v}px` })}
          />
          <SliderControl
            label="Line height"
            value={block.lineHeight ?? 1.6}
            min={1} max={3} step={0.1}
            display={(block.lineHeight ?? 1.6).toFixed(1)}
            onChange={(v) => onChange({ lineHeight: Math.round(v * 10) / 10 })}
          />
          <SliderControl
            label="Letter spacing"
            value={block.letterSpacing ?? 0}
            min={-2} max={10} step={0.5}
            display={String(block.letterSpacing ?? 0)}
            onChange={(v) => onChange({ letterSpacing: v })}
          />
        </div>
      )}
    </div>
  );

  const WeightRow = ({ defaultWeight }: { defaultWeight: string }) => (
    <div>
      <p className="text-sm font-semibold text-gray-700 mb-1.5">Weight</p>
      <div className="flex gap-1 flex-wrap">
        {FONT_WEIGHTS.map(w => (
          <button
            key={w.value}
            type="button"
            onClick={() => onChange({ fontWeight: w.value })}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${(block.fontWeight ?? defaultWeight) === w.value ? 'bg-gray-100 text-gray-700 font-semibold' : 'text-gray-400 hover:text-gray-600'}`}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );

  // The button has its own multi-tab inspector — no wrapper needed.
  if (block.type === 'button') {
    return <ButtonInspector block={block} theme={theme} onChange={onChange} onMediaPick={onMediaPick} />;
  }

  if (block.type === 'heading') {
    const sizes: Record<number, string> = { 1: '28px', 2: '22px', 3: '18px' };
    const defaultSize = parseInt(sizes[block.level ?? 2] ?? '22px');
    return (
      <div>
        {renderSubTabBar('Font')}
        {subTab === 'primary' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">Font</p>
              <FontSelector value={block.fontFamily ?? theme.fontFamily} onChange={(v) => onChange({ fontFamily: v })} />
            </div>
            {WeightRow({ defaultWeight: '700' })}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">Font color <span className="font-normal text-gray-400 text-xs">{block.color ?? theme.textColor}</span></p>
              <FlodeskColorPicker value={block.color ?? theme.textColor} onChange={(v) => onChange({ color: v })} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">Size</p>
              <div className="flex gap-1">
                {([1, 2, 3] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => onChange({ level: l, fontSize: sizes[l] })}
                    className={`flex h-8 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors ${(block.level ?? 2) === l ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    H{l}
                  </button>
                ))}
              </div>
            </div>
            {AlignRow()}
            {CaseRow()}
            {SpacingSection({ defaultFontSize: defaultSize })}
          </div>
        )}
        {subTab === 'block' && renderBlockTab()}
      </div>
    );
  }

  if (block.type === 'text') {
    return (
      <div>
        {renderSubTabBar('Font')}
        {subTab === 'primary' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">Font</p>
              <FontSelector value={block.fontFamily ?? theme.fontFamily} onChange={(v) => onChange({ fontFamily: v })} />
            </div>
            {WeightRow({ defaultWeight: '400' })}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">Font color <span className="font-normal text-gray-400 text-xs">{block.color ?? theme.textColor}</span></p>
              <FlodeskColorPicker value={block.color ?? theme.textColor} onChange={(v) => onChange({ color: v })} />
            </div>
            {AlignRow()}
            {CaseRow()}
            {SpacingSection({ defaultFontSize: 16 })}
          </div>
        )}
        {subTab === 'block' && renderBlockTab()}
      </div>
    );
  }

  if (block.type === 'image') {
    return <ImageInspector block={block} onChange={onChange} onMediaPick={onMediaPick} />;
  }

  if (block.type === 'divider') {
    return <DividerInspector block={block} onChange={onChange} />;
  }

  if (block.type === 'spacer') {
    return <SpacerInspector block={block} onChange={onChange} />;
  }

  if (block.type === 'video') {
    return <VideoInspector block={block} onChange={onChange} onMediaPick={onMediaPick} subTab={subTab} setSubTab={setSubTab} renderSubTabBar={renderSubTabBar} />;
  }

  if (block.type === 'social') {
    const SOCIAL_TAB = (id: typeof socialTab, label: string) => (
      <button
        key={id}
        type="button"
        onClick={() => setSocialTab(id)}
        className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${socialTab === id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
      >
        {label}
        {socialTab === id && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />}
      </button>
    );

    const iconStyle = block.socialIconStyle ?? 'outline';
    const sizeKey = block.socialIconSize ?? 'md';
    const spacing = block.socialIconSpacing ?? 10;
    const color = block.color ?? '#000000';
    const align = block.align ?? 'center';
    // Inspector mirrors the renderer: only show platforms that the renderer
    // would actually ship — supported platform + has a URL. Legacy / retired
    // platforms (rows persisted from before a platform was removed) are
    // dropped here, same as the renderer drops them.
    const linkedSocials = (venueSocials ?? []).filter(
      (s) => s.url?.trim() && SUPPORTED_SOCIAL_PLATFORMS.has(s.platform),
    );
    const hiddenSet = new Set(block.socialHiddenPlatforms ?? []);
    const visibleCount = linkedSocials.filter((s) => !hiddenSet.has(s.platform)).length;
    const totalCount = linkedSocials.length;
    const togglePlatform = (platform: string) => {
      const next = hiddenSet.has(platform)
        ? (block.socialHiddenPlatforms ?? []).filter((p) => p !== platform)
        : [...(block.socialHiddenPlatforms ?? []), platform];
      onChange({ socialHiddenPlatforms: next });
    };

    // ── Style swatch (icon-only; tooltip identifies the option) ──
    // All three swatches share identical chip + glyph dimensions so the user
    // sees a uniform row of equal-sized icons that differ only in chip
    // styling (none / filled / outlined).
    const StyleSwatch = ({ kind, label }: { kind: NonNullable<EmailBlock['socialIconStyle']>; label: string }) => {
      const active = iconStyle === kind;
      const chip: React.CSSProperties = {
        width: 32,
        height: 32,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      };
      if (kind === 'filled-circle') chip.backgroundColor = color;
      else if (kind === 'circle-outline') chip.border = `1.5px solid ${color}`;
      const inner = kind === 'filled-circle' ? (isDark(color) ? '#ffffff' : '#000000') : color;
      return (
        <button
          type="button"
          onClick={() => onChange({ socialIconStyle: kind })}
          title={label}
          aria-label={label}
          className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
        >
          <span style={chip}>
            <SocialIcon platform="instagram" size={18} color={inner} />
          </span>
        </button>
      );
    };

    const SizeChip = ({ k, label }: { k: NonNullable<EmailBlock['socialIconSize']>; label: string }) => {
      const active = sizeKey === k;
      return (
        <button
          type="button"
          onClick={() => onChange({ socialIconSize: k })}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          {label}
        </button>
      );
    };

    return (
      <div>
        {/* 3-tab bar: Icons / Links / Block */}
        <div className="flex border-b border-gray-100 -mx-5 mb-5 px-2 bg-gray-50/50">
          {SOCIAL_TAB('icons', 'Icons')}
          {SOCIAL_TAB('links', 'Links')}
          {SOCIAL_TAB('block', 'Block')}
        </div>

        {/* ─── ICONS TAB ─── */}
        {socialTab === 'icons' && (
          <div className="space-y-5">
            <div>
              <p className={LABEL}>Style</p>
              <div className="flex items-center gap-2">
                <StyleSwatch kind="outline" label="Outline" />
                <StyleSwatch kind="filled-circle" label="Filled" />
                <StyleSwatch kind="circle-outline" label="Solid" />
              </div>
            </div>

            <div>
              <p className={LABEL}>Color</p>
              <FlodeskColorPicker
                value={color}
                onChange={(v) => onChange({ color: v })}
              />
            </div>

            <div>
              <p className={LABEL}>Size</p>
              <div className="flex items-center gap-2">
                <SizeChip k="sm" label="S" />
                <SizeChip k="md" label="M" />
                <SizeChip k="lg" label="L" />
              </div>
            </div>

            <AlignSelector value={align} onChange={(v) => onChange({ align: v })} label="Position" />

            <div>
              <SliderControl
                label="Spacing"
                value={spacing}
                min={0} max={40} step={1}
                display={`${spacing}`}
                onChange={(v) => onChange({ socialIconSpacing: v })}
              />
            </div>
          </div>
        )}

        {/* ─── LINKS TAB ─── */}
        {socialTab === 'links' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 pt-4 pb-3 text-center">
              <Share2 size={22} className="mx-auto text-gray-500" />
              <p className="mt-2 text-[15px] font-semibold text-gray-900 leading-snug">
                Manage your social network links
              </p>
              <p className="mt-1 text-[12px] text-gray-500 leading-snug max-w-[260px] mx-auto">
                Edit once in Branding — every Social Links block in every email reads from the same list.
              </p>
              <a
                href="/dashboard/settings/branding#social-networks"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                <ExternalLink size={12} />
                Manage in branding
              </a>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className={LABEL}>
                  {totalCount === 0
                    ? '0 links active'
                    : `${visibleCount} of ${totalCount} visible`}
                </p>
                {totalCount > 0 && hiddenSet.size > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange({ socialHiddenPlatforms: [] })}
                    className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Show all
                  </button>
                )}
              </div>
              {totalCount === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-xs text-gray-500">
                  No social links configured yet. Add at least one in branding settings to make this block visible to recipients.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {linkedSocials.map((s) => {
                    const isHidden = hiddenSet.has(s.platform);
                    return (
                      <div
                        key={s.platform}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${
                          isHidden
                            ? 'border-gray-200 bg-gray-50'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <SocialIcon
                          platform={s.platform}
                          size={14}
                          color={isHidden ? '#9ca3af' : '#374151'}
                        />
                        <span
                          className={`text-xs font-semibold capitalize w-20 flex-shrink-0 ${
                            isHidden ? 'text-gray-400 line-through' : 'text-gray-700'
                          }`}
                        >
                          {s.platform}
                        </span>
                        <span
                          className={`text-xs truncate flex-1 ${
                            isHidden ? 'text-gray-300 line-through' : 'text-gray-500'
                          }`}
                          title={s.url}
                        >
                          {s.url}
                        </span>
                        <button
                          type="button"
                          onClick={() => togglePlatform(s.platform)}
                          title={isHidden ? `Show ${s.platform}` : `Hide ${s.platform}`}
                          aria-label={isHidden ? `Show ${s.platform}` : `Hide ${s.platform}`}
                          aria-pressed={!isHidden}
                          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
                            isHidden
                              ? 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'
                              : 'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-2 text-[11px] text-gray-400 leading-snug">
                Hide a platform with the eye icon to suppress it for this email only — your branding registry stays untouched.
              </p>
            </div>
          </div>
        )}

        {/* ─── BLOCK TAB (padding/bg) ─── */}
        {socialTab === 'block' && renderBlockTab()}
      </div>
    );
  }

  if (block.type === 'address') {
    const ADDRESS_TAB = (id: typeof addressTab, label: string) => (
      <button
        key={id}
        type="button"
        onClick={() => setAddressTab(id)}
        className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${addressTab === id ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
      >
        {label}
        {addressTab === id && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-12 bg-gray-900 rounded-full" />}
      </button>
    );

    return (
      <div>
        {/* 3-tab bar */}
        <div className="flex border-b border-gray-100 -mx-5 mb-5 px-2 bg-gray-50/50">
          {ADDRESS_TAB('font', 'Font')}
          {ADDRESS_TAB('address', 'Address')}
          {ADDRESS_TAB('block', 'Block')}
        </div>

        {/* ─── FONT TAB ─── */}
        {addressTab === 'font' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">Font</p>
              <FontSelector value={block.fontFamily ?? theme.fontFamily} onChange={(v) => onChange({ fontFamily: v })} />
            </div>
            {WeightRow({ defaultWeight: '400' })}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1.5">
                Font color <span className="font-normal text-gray-400 text-xs font-mono uppercase">{block.color ?? theme.mutedColor}</span>
              </p>
              <FlodeskColorPicker value={block.color ?? theme.mutedColor} onChange={(v) => onChange({ color: v })} />
            </div>
            <div>
              <SliderControl
                label="Size"
                value={parseInt(block.fontSize ?? '12px') || 12}
                min={8} max={32} step={1}
                display={`${parseInt(block.fontSize ?? '12px') || 12}`}
                onChange={(v) => onChange({ fontSize: `${v}px` })}
              />
            </div>
            {AlignRow()}
            {CaseRow()}
            {SpacingSection({ defaultFontSize: 12 })}
          </div>
        )}

        {/* ─── ADDRESS TAB ─── */}
        {addressTab === 'address' && (
          <div className="flex flex-col items-center text-center px-3 pt-3">
            <MapPin size={24} className="text-gray-700 mb-2" strokeWidth={1.5} />
            <p className="text-[15px] font-semibold text-gray-900 mb-1.5 leading-snug">
              We&apos;ve got your address on file.
            </p>
            <p className="text-[12px] text-gray-500 leading-snug max-w-[320px] mb-4">
              You are required by law to include your current address in the footer of all promotional emails.
            </p>
            <a
              href="/dashboard/settings/branding"
              target="_blank"
              rel="noopener noreferrer"
              style={{ backgroundColor: '#1b1b1b' }}
              className="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            >
              Manage my address
            </a>
            <p className="mt-4 text-[11px] text-gray-400 leading-snug max-w-[320px]">
              The address shown is pulled from your branding settings — it can&apos;t be edited directly here.
            </p>
          </div>
        )}

        {/* ─── BLOCK TAB ─── */}
        {addressTab === 'block' && renderBlockTab()}
      </div>
    );
  }

  return null;
}

// ─── Right Panel — Theme ──────────────────────────────────────────────────────
function ThemePanel({ theme, onChange }: {
  theme: Required<EmailTheme>;
  onChange: (patch: Partial<EmailTheme>) => void;
}) {
  const LABEL = 'block text-[11px] text-gray-500 mb-2';
  const INPUT = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors';

  return (
    <div className="space-y-5">
      {/* Color swatches — 2×2 grid, no shadows */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <div>
          <p className={LABEL}>Backdrop color</p>
          <FlodeskColorPicker value={theme.pageBg} onChange={(v) => onChange({ pageBg: v })} />
        </div>
        <div>
          <p className={LABEL}>Canvas color</p>
          <FlodeskColorPicker value={theme.cardBg} onChange={(v) => onChange({ cardBg: v })} />
        </div>
        <div>
          <p className={LABEL}>Font color</p>
          <FlodeskColorPicker value={theme.textColor} onChange={(v) => onChange({ textColor: v })} />
        </div>
        <div>
          <p className={LABEL}>Link color</p>
          <FlodeskColorPicker value={theme.buttonText} onChange={(v) => onChange({ buttonText: v })} />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1.5">Global font family</label>
          <FontSelector value={theme.fontFamily} onChange={(v) => onChange({ fontFamily: v })} />
        </div>
      </div>
    </div>
  );
}

// ─── Live Preview Modal ──────────────────────────────────────────────────────
function PreviewModal({
  definition,
  subject,
  preheader,
  venueAddress,
  venueSocials,
  campaignId,
  onClose,
  onForceSave,
}: {
  definition: MarketingEmailDefinition;
  subject: string;
  preheader: string;
  venueAddress?: VenueAddress;
  venueSocials?: VenueSocial[];
  campaignId: string;
  onClose: () => void;
  onForceSave: () => Promise<void>;
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [testEmail, setTestEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ kind: 'idle' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build merge vars from venue address — these substitute into {{venue_name}} etc.
  const previewVars: MergeFieldRecord = {
    first_name: 'Alex',
    last_name: 'Preview',
    email: 'preview@example.com',
    venue_name: venueAddress?.name ?? 'Your venue',
    venue_full_address:
      venueAddress?.location_full?.trim()
      || [venueAddress?.location_city, venueAddress?.location_state].filter(Boolean).join(', ')
      || '',
    venue_city: venueAddress?.location_city ?? '',
    venue_state: venueAddress?.location_state ?? '',
    unsubscribe_url: '#unsubscribe-preview',
    resubscribe_url: '#resubscribe-preview',
    preferences_url: '#preferences-preview',
    wedding_date: '',
    wedding_date_nice: 'June 14, 2026',
    wedding_month: 'June',
    guest_count: '120',
  };

  // Re-render iframe srcDoc whenever the definition changes. We inflate the
  // definition with the venue's brand_socials first so the preview matches what
  // the recipient will see.
  const srcDoc = (() => {
    const inflated = injectVenueDataIntoDefinition(definition, venueSocials ?? []);
    const html = renderMarketingEmailHtml(inflated, previewVars);
    return html.replace(
      '<head>',
      '<head><base target="_blank" />',
    );
  })();

  async function handleSendTest() {
    setSendStatus({ kind: 'idle' });
    const trimmed = testEmail.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setSendStatus({ kind: 'error', msg: 'Enter a valid email address' });
      return;
    }
    setSending(true);
    try {
      // Persist the latest unsaved state so the test send reflects it
      await onForceSave();
      const res = await fetch(`/api/marketing/campaigns/${campaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: trimmed }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setSendStatus({ kind: 'error', msg: j.error ?? 'Failed to send test' });
      } else {
        setSendStatus({ kind: 'ok', msg: `Test sent to ${trimmed}` });
      }
    } catch (e) {
      setSendStatus({ kind: 'error', msg: e instanceof Error ? e.message : 'Failed to send test' });
    } finally {
      setSending(false);
    }
  }

  const frameWidth = device === 'mobile' ? 380 : 720;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(27, 27, 27, 0.7)' }}
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3 text-white"
        style={{ backgroundColor: '#1b1b1b' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close preview"
          >
            <XIcon size={18} />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{subject || 'No subject'}</p>
            {preheader ? (
              <p className="text-[11px] text-gray-400 truncate">{preheader}</p>
            ) : (
              <p className="text-[11px] text-gray-400">Live preview · links and videos work</p>
            )}
          </div>
        </div>

        {/* Device toggle */}
        <div className="flex items-center gap-1 rounded-full bg-white/10 p-1">
          <button
            type="button"
            onClick={() => setDevice('desktop')}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${device === 'desktop' ? 'bg-white text-gray-900' : 'text-gray-300 hover:text-white'}`}
          >
            <Monitor size={13} />
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevice('mobile')}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${device === 'mobile' ? 'bg-white text-gray-900' : 'text-gray-300 hover:text-white'}`}
          >
            <Smartphone size={13} />
            Mobile
          </button>
        </div>

        {/* Test send */}
        <form
          onSubmit={(e) => { e.preventDefault(); void handleSendTest(); }}
          className="flex items-center gap-2"
        >
          <div className="relative flex items-center">
            <AtSign size={14} className="absolute left-2.5 text-gray-400" />
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@email.com"
              className="rounded-lg bg-white/10 pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-gray-400 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-white/30 transition-colors w-52"
              disabled={sending}
            />
          </div>
          <button
            type="submit"
            disabled={sending || !testEmail.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {sending ? 'Sending…' : 'Send test'}
          </button>
        </form>
      </div>

      {/* Status line */}
      {sendStatus.kind !== 'idle' && (
        <div className={`px-5 py-1.5 text-xs ${sendStatus.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border-b border-emerald-100' : 'bg-red-50 text-red-700 border-b border-red-100'}`}>
          {sendStatus.msg}
        </div>
      )}

      {/* Iframe canvas */}
      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div
          className="bg-white rounded-2xl shadow-2xl overflow-hidden transition-all"
          style={{ width: frameWidth, maxWidth: '100%' }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            title="Email preview"
            className="block w-full"
            style={{ height: '80vh', border: 'none' }}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CampaignFlodeskBuilder({
  campaignId,
  templateId,
  initialName,
  initialSubject,
  initialPreheader,
  initialDefinition,
  venueAddress,
  venueSocials,
}: {
  campaignId: string;
  templateId: string;
  initialName: string;
  initialSubject: string;
  initialPreheader: string;
  initialDefinition: MarketingEmailDefinition;
  venueAddress?: VenueAddress;
  venueSocials?: VenueSocial[];
}) {
  const [name, setName]           = useState(initialName);
  const [subject, setSubject]     = useState(initialSubject);
  const [preheader, setPreheader] = useState(initialPreheader);
  const [def, setDef]             = useState<MarketingEmailDefinition>(initialDefinition);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerIdx, setPickerIdx]   = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<'image' | 'file' | 'all'>('image');
  const [viewMode, setViewMode]     = useState<'desktop' | 'mobile'>('desktop');
  const [previewOpen, setPreviewOpen] = useState(false);
  const mediaApplyRef = useRef<(url: string) => void>(() => {});
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load Google Fonts once on mount
  useEffect(() => { loadGoogleFonts(); }, []);

  // ── Undo / Redo history ──────────────────────────────────────────────────
  const historyRef = useRef<MarketingEmailDefinition[]>([initialDefinition]);
  const historyIdx = useRef(0);

  const theme = mergeEmailTheme(def.theme);

  // dnd-kit sensors — require 5px drag before activating (prevents mis-fires on click)
  const sensors = useSensors(useSensor(SmartPointerSensor, { activationConstraint: { distance: 5 } }));
  const [activePaletteType, setActivePaletteType] = useState<EmailBlockType | null>(null);
  // Drop target tracks both the hovered block AND which side ('before'/'after')
  // so a palette block can land at any slot — including the very last position.
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const pointerYRef = useRef(0);

  // Track real-time pointer Y so we can decide whether the cursor sits in the
  // upper or lower half of the hovered block (drives before/after insertion).
  useEffect(() => {
    const onMove = (e: PointerEvent) => { pointerYRef.current = e.clientY; };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith('new:')) setActivePaletteType(id.replace('new:', '') as EmailBlockType);
    else setActivePaletteType(null);
    setDropTarget(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const activeId = String(event.active.id);
    if (!activeId.startsWith('new:') || !event.over) {
      setDropTarget(null);
      return;
    }
    const overId = String(event.over.id);
    const rect = event.over.rect; // ClientRect of the hovered block
    const midY = rect.top + rect.height / 2;
    const pos: 'before' | 'after' = pointerYRef.current >= midY ? 'after' : 'before';
    setDropTarget((prev) => (prev?.id === overId && prev.pos === pos ? prev : { id: overId, pos }));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const target = dropTarget;
    setActivePaletteType(null);
    setDropTarget(null);

    const activeId = String(active.id);

    // Drop from palette
    if (activeId.startsWith('new:')) {
      const blockType = activeId.replace('new:', '') as EmailBlockType;
      const newBlock = createEmailBlock(blockType);
      if (over && target) {
        const overIdx = def.blocks.findIndex((b) => b.id === target.id);
        if (overIdx >= 0) {
          const insertIdx = target.pos === 'after' ? overIdx + 1 : overIdx;
          const next = [...def.blocks];
          next.splice(insertIdx, 0, newBlock);
          updateDef({ ...def, blocks: next });
        } else {
          updateDef({ ...def, blocks: [...def.blocks, newBlock] });
        }
      } else {
        updateDef({ ...def, blocks: [...def.blocks, newBlock] });
      }
      setSelectedId(newBlock.id);
      return;
    }

    // Reorder existing blocks
    if (over && active.id !== over.id) {
      const oldIdx = def.blocks.findIndex((b) => b.id === active.id);
      const newIdx = def.blocks.findIndex((b) => b.id === over.id);
      if (oldIdx !== -1 && newIdx !== -1) {
        updateDef({ ...def, blocks: arrayMove(def.blocks, oldIdx, newIdx) });
      }
    }
  }

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const save = useCallback(async (
    n: string,
    sub: string,
    pre: string,
    d: MarketingEmailDefinition,
  ) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/marketing/email-templates/${templateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, subject: sub, preheader: pre, definition: d }),
      });
      setSaveStatus(res.ok ? 'saved' : 'error');
      if (res.ok) setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
    }
  }, [templateId]);

  const scheduleSave = useCallback((
    n: string, sub: string, pre: string, d: MarketingEmailDefinition,
  ) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('idle');
    saveTimerRef.current = setTimeout(() => void save(n, sub, pre, d), 1500);
  }, [save]);

  // Also save campaign name/subject via PATCH to campaign route
  const saveCampaignMeta = useCallback(async (n: string, sub: string) => {
    await fetch(`/api/marketing/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_draft', name: n, subject: sub }),
    });
  }, [campaignId]);

  // ── Block mutations ────────────────────────────────────────────────────────
  function updateDef(next: MarketingEmailDefinition) {
    // Push to history, discarding any forward entries
    historyRef.current = historyRef.current.slice(0, historyIdx.current + 1);
    historyRef.current.push(next);
    historyIdx.current = historyRef.current.length - 1;
    setDef(next);
    scheduleSave(name, subject, preheader, next);
  }

  function undo() {
    if (historyIdx.current <= 0) return;
    historyIdx.current--;
    const prev = historyRef.current[historyIdx.current];
    setDef(prev);
    scheduleSave(name, subject, preheader, prev);
  }

  function redo() {
    if (historyIdx.current >= historyRef.current.length - 1) return;
    historyIdx.current++;
    const next = historyRef.current[historyIdx.current];
    setDef(next);
    scheduleSave(name, subject, preheader, next);
  }

  function addBlockAt(idx: number, type: EmailBlockType) {
    const nb = createEmailBlock(type);
    const blocks = [...def.blocks];
    blocks.splice(idx, 0, nb);
    const next = { ...def, blocks };
    updateDef(next);
    setSelectedId(nb.id);
    setPickerIdx(null);
  }

  function removeBlock(id: string) {
    const next = { ...def, blocks: def.blocks.filter((b) => b.id !== id) };
    updateDef(next);
    if (selectedId === id) setSelectedId(null);
  }

  function duplicateBlock(id: string) {
    const idx = def.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const copy = { ...def.blocks[idx], id: crypto.randomUUID() };
    const blocks = [...def.blocks];
    blocks.splice(idx + 1, 0, copy);
    updateDef({ ...def, blocks });
    setSelectedId(copy.id);
  }

  function moveBlock(id: string, dir: 'up' | 'down') {
    const idx = def.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const next = moveArr(def.blocks, idx, dir === 'up' ? idx - 1 : idx + 1);
    updateDef({ ...def, blocks: next });
  }

  function patchBlock(id: string, patch: Partial<EmailBlock>) {
    const blocks = def.blocks.map((b) => b.id === id ? { ...b, ...patch } as EmailBlock : b);
    updateDef({ ...def, blocks });
  }

  function patchTheme(patch: Partial<EmailTheme>) {
    const next = { ...def, theme: { ...def.theme, ...patch } };
    updateDef(next);
  }

  const selectedBlock = def.blocks.find((b) => b.id === selectedId) ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────
  const saveLabel = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved' ? 'Saved'
    : saveStatus === 'error' ? 'Save failed'
    : null;

  return (
    // Pull out of main's vertical padding; horizontal is handled by the fixed header
    <div className="-mt-6 lg:-mt-[68px] -mb-10 flex flex-col bg-white"
      style={{ minHeight: '100vh' }}
    >
      {/* Global styles for this builder */}
      <style>{`
        .fb-scroll-pane::-webkit-scrollbar { display: none; }
        /* Links inside the canvas editor */
        [data-email-editable] a {
          color: #3b82f6;
          text-decoration: underline;
          cursor: pointer;
        }
        /* Override Tailwind preflight so list markers actually render */
        [data-email-editable] ol,
        [data-email-editable] ul {
          padding-left: 1.5em !important;
          margin: 0.5em 0 !important;
          list-style-position: outside !important;
        }
        [data-email-editable] ol { list-style-type: decimal !important; }
        [data-email-editable] ul { list-style-type: disc !important; }
        [data-email-editable] li {
          display: list-item !important;
          margin-bottom: 0.25em !important;
        }
        .sp-slider {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 2px;
          background: #e5e7eb; border-radius: 2px;
          outline: none; cursor: grab;
        }
        .sp-slider:active { cursor: grabbing; }
        .sp-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 26px; height: 26px; border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.07);
          cursor: grab;
        }
        .sp-slider::-moz-range-thumb {
          width: 26px; height: 26px; border-radius: 50%;
          background: #ffffff; border: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.07);
          cursor: grab;
        }
        /* Inline placeholder for the video title contentEditable.
           Inherits the title's text color and softens it so it reads
           correctly on both light and dark block backgrounds. */
        .sp-video-title:empty:before {
          content: attr(data-placeholder);
          color: currentColor;
          opacity: 0.55;
          pointer-events: none;
        }
      `}</style>
      {/* ── Top Bar — fixed, spans from sidebar right edge to viewport right edge ── */}
      <header
        className="flex items-center bg-white px-6 py-3"
        style={{
          position: 'fixed',
          top: 0,
          left: 'var(--sidebar-w, 216px)',
          right: 0,
          zIndex: 20,
          boxShadow: '0 1px 18px rgba(0,0,0,0.05)',
          transition: 'left 200ms ease-out',
        }}
      >
        {/* Left: back */}
        <div className="flex items-center flex-shrink-0 w-48">
          <Link
            href="/dashboard/marketing/email/campaigns"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
          </Link>
        </div>

        {/* Center: step breadcrumbs — centered relative to the live canvas
            (header spans sidebar→viewport-right; right panel = 320px (w-80), so
            shift left by half its width to center on the canvas itself) */}
        <div
          className="hidden sm:flex items-center gap-2 text-[11px] tracking-widest font-medium uppercase"
          style={{ position: 'absolute', left: 'calc(50% - 160px)', transform: 'translateX(-50%)' }}
        >
          <span className="text-gray-300">Choose Template</span>
          <span className="text-gray-200">›</span>
          <span className="text-gray-700 border-b border-gray-700 pb-0.5">Design Email</span>
          <span className="text-gray-200">›</span>
          <Link href={`/dashboard/marketing/email/campaigns/${campaignId}`} className="text-gray-300 hover:text-gray-600 transition-colors">Choose Audience</Link>
          <span className="text-gray-200">›</span>
          <Link href={`/dashboard/marketing/email/campaigns/${campaignId}`} className="text-gray-300 hover:text-gray-600 transition-colors">Send</Link>
        </div>

        {/* Right: save status, preview, next */}
        <div className="flex items-center gap-3 flex-shrink-0 w-48 justify-end ml-auto">
          {/* Save indicator */}
          <div className="flex items-center gap-1.5">
            {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin text-gray-300" />}
            {saveStatus === 'saved'  && <span className="text-[11px] text-gray-300">Saved</span>}
            {saveStatus === 'error'  && <span className="text-[11px] text-red-400">Error</span>}
          </div>

          {/* Preview */}
          <button type="button" onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors">
            <Eye size={14} />
            <span>Preview</span>
          </button>

          {/* Next */}
          <Link
            href={`/dashboard/marketing/email/campaigns/${campaignId}`}
            onClick={() => void save(name, subject, preheader, def)}
            className="flex items-center gap-0.5 text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors"
          >
            Next <ChevronRight size={14} />
          </Link>
        </div>
      </header>

      {/* ── Content — fixed below the header so both panes can scroll independently ── */}
      {/* DndContext wraps BOTH canvas and right panel so palette cards can drag onto canvas */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={() => { setActivePaletteType(null); setDropTarget(null); }}>
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

        {/* ── Canvas ───────────────────────────────────────────────────────── */}
        <div
          className="fb-scroll-pane flex-1 overflow-y-auto"
          style={{
            background: '#ffffff',
            paddingTop: '36px', paddingBottom: '60px', paddingLeft: '40px', paddingRight: '80px',
            overscrollBehavior: 'contain',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            minHeight: 0,          // critical: flex children default min-height:auto which blocks scroll
          } as React.CSSProperties}
          onClick={() => setSelectedId(null)}
        >
          {/* Desktop / Mobile toggle — centered above email card */}
          <div className="flex items-center justify-center gap-1 mb-4">
            <button
              type="button" title="Desktop view"
              onClick={() => setViewMode('desktop')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewMode === 'desktop' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <Monitor size={14} /> Desktop
            </button>
            <button
              type="button" title="Mobile view"
              onClick={() => setViewMode('mobile')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${viewMode === 'mobile' ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <Smartphone size={14} /> Mobile
            </button>
          </div>

          {/* Email card — completely flush, white on white */}
            <div
              className="mx-auto"
              style={{ maxWidth: viewMode === 'mobile' ? '375px' : theme.maxWidth, background: theme.cardBg, transition: 'max-width 0.3s ease' }}
              onClick={(e) => e.stopPropagation()}
            >
              {def.blocks.length === 0 ? (
                <div className="py-24 text-center">
                  <p className="mb-5 text-sm text-gray-300">Your email is empty — click below to add your first block</p>
                  <button
                    type="button"
                    onClick={() => setPickerIdx(0)}
                    className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-500 hover:border-gray-400 hover:text-gray-800 transition-all"
                  >
                    <Plus size={15} /> Add block
                  </button>
                </div>
              ) : (
                <SortableContext items={def.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                  {/* Top add button */}
                  <AddBlockBtn onClick={() => setPickerIdx(0)} />

                  {def.blocks.map((block, idx) => {
                    const isSelected = block.id === selectedId;
                    const isDropTarget = dropTarget?.id === block.id && activePaletteType !== null;
                    const showTopIndicator = isDropTarget && dropTarget?.pos === 'before';
                    const showBottomIndicator = isDropTarget && dropTarget?.pos === 'after';
                    const indicator = (
                      <div className="pointer-events-none px-0 py-1">
                        <div
                          className="flex items-center gap-2"
                          style={{ borderTop: '2px solid #1b1b1b', margin: '0 0' }}
                        >
                          <span
                            className="text-[10px] font-semibold text-white rounded px-1.5 py-0.5"
                            style={{ background: '#1b1b1b', lineHeight: 1.4, whiteSpace: 'nowrap' }}
                          >
                            {PALETTE.find(p => p.type === activePaletteType)?.label ?? activePaletteType}
                          </span>
                        </div>
                      </div>
                    );
                    return (
                      <SortableBlock key={block.id} id={block.id}>
                        {(isDragging) => (
                          <div>
                            {showTopIndicator && indicator}
                            <div
                              className="relative group/block"
                              onClick={(e) => { e.stopPropagation(); if (!isDragging) setSelectedId(block.id); }}
                            >
                              {/* Block content */}
                              <div
                                className="relative"
                                style={{
                                  transition: 'outline 0.1s ease, box-shadow 0.2s ease',
                                  outline: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                  outlineOffset: '-1px',
                                  boxShadow: isSelected ? '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)' : 'none',
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected && !isDragging) {
                                    (e.currentTarget as HTMLDivElement).style.outline = '1px solid #3b82f6';
                                    (e.currentTarget as HTMLDivElement).style.boxShadow = '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!isSelected) {
                                    (e.currentTarget as HTMLDivElement).style.outline = '1px solid transparent';
                                    (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                                  }
                                }}
                              >
                                <BlockCanvas block={block} theme={theme} venueAddress={venueAddress} venueSocials={venueSocials} onPatch={(p) => patchBlock(block.id, p)} />
                              </div>

                              {/* Floating side toolbar — pill, right edge, visible on select or hover */}
                              <div
                                className={`absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 z-10 transition-opacity duration-150 ${isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex flex-col items-center gap-1 bg-white rounded-2xl shadow-lg border border-gray-100 px-1.5 py-2">
                                  <button
                                    type="button" title="Move up"
                                    disabled={idx === 0}
                                    onClick={() => moveBlock(block.id, 'up')}
                                    className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                                  >
                                    <ArrowUp size={15} />
                                  </button>
                                  <button
                                    type="button" title="Move down"
                                    disabled={idx === def.blocks.length - 1}
                                    onClick={() => moveBlock(block.id, 'down')}
                                    className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                                  >
                                    <ArrowDown size={15} />
                                  </button>
                                  <div className="w-5 h-px bg-gray-100 my-0.5" />
                                  <button
                                    type="button" title="Duplicate"
                                    onClick={() => duplicateBlock(block.id)}
                                    className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
                                  >
                                    <Copy size={15} />
                                  </button>
                                  <div className="w-5 h-px bg-gray-100 my-0.5" />
                                  <button
                                    type="button" title="Delete block"
                                    onClick={() => removeBlock(block.id)}
                                    className="flex h-8 w-8 items-center justify-center rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Add button after this block */}
                            <AddBlockBtn onClick={() => setPickerIdx(idx + 1)} />
                            {showBottomIndicator && indicator}
                          </div>
                        )}
                      </SortableBlock>
                    );
                  })}
                  {/* Drop-at-end indicator — shown when dragging a palette block but no
                      block is being hovered (e.g. cursor below the canvas). Hover-half
                      detection on the last block already covers most "append" cases. */}
                  {activePaletteType !== null && dropTarget === null && def.blocks.length > 0 && (
                    <div className="pointer-events-none py-1">
                      <div style={{ borderTop: '2px solid #1b1b1b' }}>
                        <span className="text-[10px] font-semibold text-white rounded px-1.5 py-0.5" style={{ background: '#1b1b1b', lineHeight: 1.4 }}>
                          {PALETTE.find(p => p.type === activePaletteType)?.label} — drop to add at end
                        </span>
                      </div>
                    </div>
                  )}
                </SortableContext>
              )}
            </div>
          {/* Required compliance footer — preview of what's appended to every email */}
          <div className="mx-auto mt-6" style={{ maxWidth: viewMode === 'mobile' ? '375px' : theme.maxWidth }}>
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 px-6 py-5 text-center">
              <p className="text-[12px] font-semibold text-gray-500 mb-1">{'{{venue_name}}'}</p>
              <p className="text-[11px] text-gray-400">
                <span className="underline">Unsubscribe</span>
                <span className="mx-1.5">·</span>
                <span className="underline">Manage preferences</span>
              </p>
            </div>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-gray-300">
              <Lock size={10} className="flex-shrink-0" />
              Required for legal compliance — this footer cannot be removed.
            </p>
          </div>
        </div>

        {/* ── Right Panel ──────────────────────────────────────────────────── */}
        <aside
          className="w-80 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ background: '#f4f4f5', position: 'relative' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div aria-hidden style={{
            position: 'absolute', top: 0, left: 0, bottom: 0, width: 6,
            background: 'linear-gradient(to right, rgba(0,0,0,0.08) 0%, transparent 100%)',
            pointerEvents: 'none', zIndex: 10,
          }} />
          <div
            className="fb-scroll-pane flex-1 overflow-y-auto"
            style={{
              overscrollBehavior: 'contain',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              minHeight: 0,
            } as React.CSSProperties}
          >
          {selectedBlock ? (
            <div className="p-5">
              {/* Block type label */}
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                    {selectedBlock.type}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                >
                  Done
                </button>
              </div>

              <BlockInspectorPanel
                block={selectedBlock}
                theme={theme}
                venueSocials={venueSocials}
                onChange={(patch) => patchBlock(selectedBlock.id, patch)}
                onMediaPick={(apply, mode = 'image') => {
                  mediaApplyRef.current = apply;
                  setMediaPickerMode(mode);
                  setMediaPickerOpen(true);
                }}
              />

              <div className="mt-6 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => removeBlock(selectedBlock.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={12} /> Remove block
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Blocks</p>
              <p className="mb-4 text-[11px] text-gray-400">Drag a block onto the canvas, or click a block on the canvas to edit it.</p>
              <div className="flex flex-col gap-2">
                {PALETTE.map((item) => (
                  <PaletteCard key={item.type} {...item} />
                ))}
              </div>
            </div>
          )}
          </div>

          {/* ── Undo / Redo / Save bar ──────────────────────────────────────── */}
          <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-white">
            <button
              type="button"
              onClick={undo}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 disabled:opacity-30 transition-colors"
            >
              <Undo2 size={14} /> Undo
            </button>
            <button
              type="button"
              onClick={redo}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 disabled:opacity-30 transition-colors"
            >
              <Redo2 size={14} /> Redo
            </button>
            <span className="ml-auto text-sm text-gray-400">
              {saveStatus === 'saving' && 'Saving…'}
              {saveStatus === 'saved'  && 'Saved'}
              {saveStatus === 'error'  && 'Error'}
            </span>
          </div>
        </aside>

        {/* Drag overlay — ghost shown while dragging from palette */}
        <DragOverlay dropAnimation={null}>
          {activePaletteType ? (() => {
            const p = PALETTE.find(x => x.type === activePaletteType);
            if (!p) return null;
            return (
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-xl opacity-90 pointer-events-none" style={{ width: 220 }}>
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                  <p.Icon size={15} className="text-gray-500" />
                </div>
                <p className="text-sm font-medium text-gray-800">{p.label}</p>
              </div>
            );
          })() : null}
        </DragOverlay>
      </div>
      </DndContext>

      {/* Floating format toolbar — appears on text selection */}
      <FloatingFormatBar />

      {/* Block picker modal */}
      {pickerIdx !== null && (
        <BlockPickerModal
          onSelect={(type) => addBlockAt(pickerIdx, type)}
          onClose={() => setPickerIdx(null)}
        />
      )}

      {/* Media picker */}
      <VenueMediaPickerModal
        open={mediaPickerOpen}
        onOpenChange={setMediaPickerOpen}
        mode={mediaPickerMode}
        title={
          mediaPickerMode === 'file'
            ? 'Choose a file'
            : mediaPickerMode === 'all'
            ? 'Media library'
            : 'Choose an image'
        }
        onSelect={(url) => {
          mediaApplyRef.current(url);
          setMediaPickerOpen(false);
        }}
      />

      {/* Live preview modal — renders the actual email HTML in an iframe */}
      {previewOpen && (
        <PreviewModal
          definition={def}
          subject={subject}
          preheader={preheader}
          venueAddress={venueAddress}
          venueSocials={venueSocials}
          campaignId={campaignId}
          onClose={() => setPreviewOpen(false)}
          onForceSave={async () => {
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current);
              saveTimerRef.current = null;
            }
            await save(name, subject, preheader, def);
          }}
        />
      )}
    </div>
  );
}
