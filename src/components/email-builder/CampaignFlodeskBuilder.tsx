'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowLeft, ArrowUp, ArrowDown,
  AtSign, Bold,
  Check, ChevronDown, ChevronRight, Copy, Eye, Heart,
  Image as ImageIcon,
  Italic, Link2, List, ListOrdered, Loader2, Minus, Monitor,
  Paperclip, PenLine, Pipette, Plus, SeparatorHorizontal, Smartphone,
  Space, Strikethrough, Trash2, Type, Underline, X as XIcon,
  MousePointer2, Palette, Video, Share2, MapPin, Search,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
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

// ─── Social platform definitions ─────────────────────────────────────────────
const SOCIAL_PLATFORMS = [
  { id: 'facebook',  label: 'Facebook',    color: '#1877F2' },
  { id: 'instagram', label: 'Instagram',   color: '#E1306C' },
  { id: 'youtube',   label: 'YouTube',     color: '#FF0000' },
  { id: 'tiktok',    label: 'TikTok',      color: '#010101' },
  { id: 'pinterest', label: 'Pinterest',   color: '#E60023' },
  { id: 'linkedin',  label: 'LinkedIn',    color: '#0A66C2' },
  { id: 'twitter',   label: 'X / Twitter', color: '#000000' },
] as const;

// ─── Social SVG icons (monochrome, matched to Flodesk style) ─────────────────
function SocialIcon({ platform, size = 18, color = '#18181b' }: { platform: string; size?: number; color?: string }) {
  switch (platform) {
    case 'facebook': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    );
    case 'twitter': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
    case 'instagram': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.5" fill={color} stroke="none" />
      </svg>
    );
    case 'tiktok': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.83a8.18 8.18 0 0 0 4.77 1.53V6.92a4.85 4.85 0 0 1-1-.23z" />
      </svg>
    );
    case 'pinterest': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
      </svg>
    );
    case 'linkedin': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z" />
        <circle cx="4" cy="4" r="2" />
      </svg>
    );
    case 'youtube': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
        <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="white" />
      </svg>
    );
    default: return null;
  }
}

// ─── Venue address type (passed from server page) ─────────────────────────────
type VenueAddress = {
  name: string;
  location_full?: string | null;
  location_city?: string | null;
  location_state?: string | null;
};

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

  useEffect(() => { setHex(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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

  return (
    <div ref={ref} className="relative">
      {/* Swatch trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-12 h-12 rounded-full border border-gray-200 transition-transform hover:scale-105 focus:outline-none"
        style={{ background: value }}
      />

      {open && createPortal(
        <div
          style={{
            position: 'fixed',
            top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 8,
            left: Math.max(8, (ref.current?.getBoundingClientRect().left ?? 0) - 140),
            zIndex: 500,
            width: 320,
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-5">
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

            {/* Brand colors */}
            <p className="text-center text-[13px] text-gray-500 underline cursor-pointer mb-4 hover:text-gray-800">
              Add your brand colors
            </p>

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
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    function update() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) { setPos(null); return; }
      const anchor = sel.anchorNode;
      const el: Element | null = anchor
        ? (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as Element)
        : null;
      const editable = el?.closest?.('[data-email-editable]') as HTMLElement | null;
      if (!editable) { setPos(null); return; }
      // Center on the block element, position above it
      const blockRect = editable.getBoundingClientRect();
      const selRect = sel.getRangeAt(0).getBoundingClientRect();
      setPos({ top: selRect.top - 58, left: blockRect.left + blockRect.width / 2 });
    }
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  if (!pos || !mounted) return null;

  function exec(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
  }
  function insertLink() {
    const url = prompt('Enter URL (include https://)');
    if (url) exec('createLink', url);
  }
  function insertMerge() {
    const tags = ['{{first_name}}', '{{venue_name}}', '{{unsubscribe_url}}'];
    const chosen = prompt(`Pick a merge tag:\n${tags.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
    const idx = parseInt(chosen ?? '0') - 1;
    if (tags[idx]) exec('insertText', tags[idx]);
  }

  const BTN = 'flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors';
  const SEP = 'w-px h-5 bg-gray-200 mx-1 flex-shrink-0';

  return createPortal(
    <div
      style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)', zIndex: 300 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center rounded-2xl bg-white border border-gray-100 shadow-2xl px-2 py-1.5 gap-0.5">
        <button type="button" className={BTN} title="Format" onMouseDown={(e) => e.preventDefault()}>
          <PenLine size={16} />
        </button>
        <div className={SEP} />
        <button type="button" className={BTN} title="Bold" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}><Bold size={16} /></button>
        <button type="button" className={BTN} title="Italic" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}><Italic size={16} /></button>
        <button type="button" className={BTN} title="Underline" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}><Underline size={16} /></button>
        <button type="button" className={BTN} title="Strikethrough" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }}><Strikethrough size={16} /></button>
        <div className={SEP} />
        <button type="button" className={BTN} title="Numbered list" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }}><ListOrdered size={16} /></button>
        <button type="button" className={BTN} title="Bullet list" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}><List size={16} /></button>
        <div className={SEP} />
        <button type="button" className={BTN} title="Insert link" onMouseDown={(e) => { e.preventDefault(); insertLink(); }}><Link2 size={16} /></button>
        <button type="button" className={BTN} title="Attachment" onMouseDown={(e) => e.preventDefault()}><Paperclip size={16} /></button>
        <button type="button" className={BTN} title="Merge tag" onMouseDown={(e) => { e.preventDefault(); insertMerge(); }}><AtSign size={16} /></button>
      </div>
    </div>,
    document.body,
  );
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
        padding: '8px 24px',
        textAlign: block.align ?? 'left',
        fontFamily: block.fontFamily ?? theme.fontFamily,
        fontSize: size,
        fontWeight: block.fontWeight ?? 700,
        color: block.color ?? theme.textColor,
        lineHeight: 1.25,
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
        padding: '8px 24px',
        textAlign: block.align ?? 'left',
        fontFamily: block.fontFamily ?? theme.fontFamily,
        fontSize: block.fontSize ?? '16px',
        fontWeight: block.fontWeight ?? 400,
        lineHeight: 1.6,
        color: block.color ?? theme.textColor,
        outline: 'none',
        cursor: onPatch ? 'text' : 'default',
      }}
    />
  );
}

function ButtonCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const label = (block.buttonLabel?.trim() || 'Click here').toUpperCase();
  return (
    <div style={{ padding: '20px 24px', textAlign: block.align ?? 'center' }}>
      <span style={{
        display: 'inline-block',
        background: 'transparent',
        color: theme.textColor,
        border: `1.5px solid ${theme.textColor}`,
        padding: '13px 36px',
        borderRadius: '2px',
        fontWeight: 400,
        fontSize: '13px',
        letterSpacing: '0.12em',
        fontFamily: theme.fontFamily,
        cursor: 'default',
      }}>
        {label}
      </span>
    </div>
  );
}

function ImageCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  if (!block.src?.trim()) {
    return (
      <div style={{ padding: '16px 24px', textAlign: 'center' }}>
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
  return (
    <div style={{ padding: '8px 24px', textAlign: block.align ?? 'center' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.src} alt={block.alt ?? ''} style={{ maxWidth: '100%', height: 'auto', display: 'inline-block', borderRadius: '4px' }} />
    </div>
  );
}

function DividerCanvas() {
  return (
    <div style={{ padding: '12px 24px' }}>
      <hr style={{ border: 'none', borderTop: '1px solid #e8e8e8', margin: 0 }} />
    </div>
  );
}

function SpacerCanvas({ block }: { block: EmailBlock }) {
  const h = block.spacerHeight ?? 24;
  return (
    <div style={{ height: `${h}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: '11px', color: '#d1d5db', userSelect: 'none' }}>{h}px</span>
    </div>
  );
}

function VideoCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const hasThumbnail = !!block.src?.trim();
  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', background: '#18181b', cursor: 'default' }}>
        {hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.src} alt="Video thumbnail" style={{ width: '100%', display: 'block', maxHeight: '300px', objectFit: 'cover', opacity: 0.85 }} />
        ) : (
          <div style={{ height: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <Video size={32} color="#6b7280" />
            <span style={{ fontSize: '13px', color: '#6b7280' }}>Add thumbnail in panel →</span>
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: '58px', height: '58px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}>
            <div style={{ width: 0, height: 0, borderTop: '11px solid transparent', borderBottom: '11px solid transparent', borderLeft: '20px solid #18181b', marginLeft: '5px' }} />
          </div>
        </div>
      </div>
      {block.content?.trim() && (
        <p style={{ margin: '10px 0 0', fontSize: '13px', color: theme.mutedColor, textAlign: 'center', fontFamily: theme.fontFamily }}>
          {block.content}
        </p>
      )}
    </div>
  );
}

function SocialCanvas({ block, theme }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme> }) {
  const links = (block.socialLinks ?? []).filter(l => l.url?.trim());
  if (links.length === 0) {
    return (
      <div style={{ padding: '20px 24px', textAlign: 'center', color: theme.mutedColor, fontSize: '13px', fontFamily: theme.fontFamily }}>
        Add your social links in the panel →
      </div>
    );
  }
  return (
    <div style={{ padding: '20px 24px', display: 'flex', gap: '18px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
      {links.map((link) => (
        <span key={link.platform} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: 0.75 }}>
          <SocialIcon platform={link.platform} size={20} color={theme.textColor} />
        </span>
      ))}
    </div>
  );
}

function AddressCanvas({ venueAddress, theme }: { venueAddress?: VenueAddress; theme: ReturnType<typeof mergeEmailTheme> }) {
  const name = venueAddress?.name ?? 'Your Venue';
  const address = venueAddress?.location_full?.trim()
    ?? (venueAddress?.location_city && venueAddress?.location_state
      ? `${venueAddress.location_city}, ${venueAddress.location_state}`
      : null);
  return (
    <div style={{ padding: '16px 24px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 3px', fontSize: '13px', fontWeight: 600, color: theme.textColor, fontFamily: theme.fontFamily }}>
        {name}
      </p>
      <p style={{ margin: 0, fontSize: '12px', color: theme.mutedColor, fontFamily: theme.fontFamily }}>
        {address ?? 'Address pulled from your venue settings'}
      </p>
    </div>
  );
}

function BlockCanvas({ block, theme, venueAddress, onPatch }: { block: EmailBlock; theme: ReturnType<typeof mergeEmailTheme>; venueAddress?: VenueAddress; onPatch?: (p: Partial<EmailBlock>) => void }) {
  switch (block.type) {
    case 'heading': return <HeadingCanvas block={block} theme={theme} onPatch={onPatch} />;
    case 'text':    return <TextCanvas block={block} theme={theme} onPatch={onPatch} />;
    case 'button':  return <ButtonCanvas block={block} theme={theme} />;
    case 'image':   return <ImageCanvas block={block} theme={theme} />;
    case 'video':   return <VideoCanvas block={block} theme={theme} />;
    case 'social':  return <SocialCanvas block={block} theme={theme} />;
    case 'address': return <AddressCanvas venueAddress={venueAddress} theme={theme} />;
    case 'divider': return <DividerCanvas />;
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
    <div className="group/addbtn relative h-7 px-6">
      <div className="flex items-center w-full h-full opacity-0 group-hover/addbtn:opacity-100 transition-opacity duration-150">
        {/* left rule */}
        <div className="flex-1 h-px" style={{ background: '#818cf8' }} />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white mx-1.5 transition-transform duration-150 hover:scale-110"
          style={{ border: '1.5px solid #818cf8', color: '#818cf8' }}
          title="Add block"
        >
          <Plus size={12} />
        </button>
        {/* right rule */}
        <div className="flex-1 h-px" style={{ background: '#818cf8' }} />
      </div>
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

// ─── Right Panel — Block Inspector ───────────────────────────────────────────
function BlockInspectorPanel({
  block,
  theme,
  onChange,
  onMediaPick,
}: {
  block: EmailBlock;
  theme: ReturnType<typeof mergeEmailTheme>;
  onChange: (patch: Partial<EmailBlock>) => void;
  onMediaPick: (apply: (url: string) => void) => void;
}) {
  const LABEL = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
  const INPUT = 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors';

  const AlignRow = () => (
    <div>
      <label className={LABEL}>Alignment</label>
      <div className="flex gap-1">
        {(['left', 'center', 'right'] as const).map((a) => {
          const icons = { left: <AlignLeft size={14} />, center: <AlignCenter size={14} />, right: <AlignRight size={14} /> };
          return (
            <button
              key={a}
              type="button"
              onClick={() => onChange({ align: a })}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${block.align === a ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
            >
              {icons[a]}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (block.type === 'heading') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3.5 py-3">
          <p className="text-xs font-medium text-gray-600 mb-0.5">Click the block to edit</p>
          <p className="text-[11px] text-gray-400">Type directly on the canvas</p>
        </div>
        <div>
          <label className={LABEL}>Font family</label>
          <FontSelector
            value={block.fontFamily ?? theme.fontFamily}
            onChange={(v) => onChange({ fontFamily: v })}
          />
        </div>
        <div>
          <label className={LABEL}>Weight</label>
          <div className="flex gap-1.5 flex-wrap">
            {FONT_WEIGHTS.map(w => (
              <button
                key={w.value}
                type="button"
                onClick={() => onChange({ fontWeight: w.value })}
                className={`px-3 py-1 rounded-lg text-xs border transition-colors ${(block.fontWeight ?? '700') === w.value ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={LABEL}>Color</label>
          <FlodeskColorPicker
            value={block.color ?? theme.textColor}
            onChange={(v) => onChange({ color: v })}
          />
        </div>
        <div>
          <label className={LABEL}>Size</label>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onChange({ level: l })}
                className={`flex h-8 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors ${block.level === l ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
              >
                H{l}
              </button>
            ))}
          </div>
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'text') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3.5 py-3">
          <p className="text-xs font-medium text-gray-600 mb-0.5">Click the block to edit</p>
          <p className="text-[11px] text-gray-400">Select text to see the formatting toolbar</p>
        </div>
        <div>
          <label className={LABEL}>Font family</label>
          <FontSelector
            value={block.fontFamily ?? theme.fontFamily}
            onChange={(v) => onChange({ fontFamily: v })}
          />
        </div>
        <div>
          <label className={LABEL}>Weight</label>
          <div className="flex gap-1.5 flex-wrap">
            {FONT_WEIGHTS.map(w => (
              <button
                key={w.value}
                type="button"
                onClick={() => onChange({ fontWeight: w.value })}
                className={`px-3 py-1 rounded-lg text-xs border transition-colors ${(block.fontWeight ?? '400') === w.value ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={LABEL}>Color</label>
          <FlodeskColorPicker
            value={block.color ?? theme.textColor}
            onChange={(v) => onChange({ color: v })}
          />
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'button') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Button label</label>
          <input
            type="text"
            className={INPUT}
            value={block.buttonLabel ?? ''}
            onChange={(e) => onChange({ buttonLabel: e.target.value })}
            placeholder="Click here"
          />
        </div>
        <div>
          <label className={LABEL}>Link URL</label>
          <input
            type="url"
            className={INPUT}
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="https://"
          />
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'image') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Image URL</label>
          <input
            type="url"
            className={INPUT}
            value={block.src ?? ''}
            onChange={(e) => onChange({ src: e.target.value })}
            placeholder="https://..."
          />
          <button
            type="button"
            onClick={() => onMediaPick((url) => onChange({ src: url }))}
            className="mt-1.5 w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Choose from Media Library
          </button>
        </div>
        <div>
          <label className={LABEL}>Alt text</label>
          <input
            type="text"
            className={INPUT}
            value={block.alt ?? ''}
            onChange={(e) => onChange({ alt: e.target.value })}
            placeholder="Describe the image"
          />
        </div>
        <div>
          <label className={LABEL}>Link URL (optional)</label>
          <input
            type="url"
            className={INPUT}
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="https://"
          />
        </div>
        <AlignRow />
      </div>
    );
  }

  if (block.type === 'divider') {
    return <p className="text-xs text-gray-400">Horizontal rule — no extra settings needed.</p>;
  }

  if (block.type === 'spacer') {
    return (
      <div>
        <label className={LABEL}>Height (px)</label>
        <input
          type="range"
          min={8}
          max={120}
          className="w-full accent-gray-900"
          value={block.spacerHeight ?? 24}
          onChange={(e) => onChange({ spacerHeight: Number(e.target.value) })}
        />
        <p className="mt-1 text-center text-xs text-gray-500">{block.spacerHeight ?? 24} px</p>
      </div>
    );
  }

  if (block.type === 'video') {
    return (
      <div className="space-y-4">
        <div>
          <label className={LABEL}>Video URL (opens in new tab)</label>
          <input
            type="url"
            className={INPUT}
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="https://youtube.com/watch?v=..."
          />
          <p className="mt-1 text-[11px] text-gray-400">Clicking the thumbnail opens this link</p>
        </div>
        <div>
          <label className={LABEL}>Thumbnail Image</label>
          <input
            type="url"
            className={INPUT}
            value={block.src ?? ''}
            onChange={(e) => onChange({ src: e.target.value })}
            placeholder="https://..."
          />
          <button
            type="button"
            onClick={() => onMediaPick((url) => onChange({ src: url }))}
            className="mt-1.5 w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Choose from Media Library
          </button>
        </div>
        <div>
          <label className={LABEL}>Caption (optional)</label>
          <input
            type="text"
            className={INPUT}
            value={block.content ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder="Watch our latest video"
          />
        </div>
      </div>
    );
  }

  if (block.type === 'social') {
    const links = block.socialLinks ?? [];
    const isEnabled = (platform: string) => links.some(l => l.platform === platform);
    const getUrl    = (platform: string) => links.find(l => l.platform === platform)?.url ?? '';
    const toggle    = (platform: string) => {
      if (isEnabled(platform)) {
        onChange({ socialLinks: links.filter(l => l.platform !== platform) });
      } else {
        onChange({ socialLinks: [...links, { platform, url: '' }] });
      }
    };
    const setUrl = (platform: string, url: string) => {
      onChange({ socialLinks: links.map(l => l.platform === platform ? { ...l, url } : l) });
    };
    return (
      <div className="space-y-3">
        {SOCIAL_PLATFORMS.map(({ id, label, color }) => {
          const enabled = isEnabled(id);
          return (
            <div key={id}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-3.5 w-3.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs font-semibold text-gray-700">{label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-gray-900' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              {enabled && (
                <input
                  type="url"
                  className={INPUT}
                  value={getUrl(id)}
                  onChange={(e) => setUrl(id, e.target.value)}
                  placeholder={`https://${id}.com/yourpage`}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === 'address') {
    return (
      <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
        <p className="text-xs font-semibold text-gray-700 mb-1">Auto-filled from venue settings</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Your business name and address are pulled automatically. To update them, go to{' '}
          <strong>Listing → Directory</strong> and update your location fields.
        </p>
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

// ─── Main Component ───────────────────────────────────────────────────────────
export function CampaignFlodeskBuilder({
  campaignId,
  templateId,
  initialName,
  initialSubject,
  initialPreheader,
  initialDefinition,
  venueAddress,
}: {
  campaignId: string;
  templateId: string;
  initialName: string;
  initialSubject: string;
  initialPreheader: string;
  initialDefinition: MarketingEmailDefinition;
  venueAddress?: VenueAddress;
}) {
  const [name, setName]           = useState(initialName);
  const [subject, setSubject]     = useState(initialSubject);
  const [preheader, setPreheader] = useState(initialPreheader);
  const [def, setDef]             = useState<MarketingEmailDefinition>(initialDefinition);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerIdx, setPickerIdx]   = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [viewMode, setViewMode]     = useState<'desktop' | 'mobile'>('desktop');
  const [previewOpen, setPreviewOpen] = useState(false);
  const mediaApplyRef = useRef<(url: string) => void>(() => {});
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load Google Fonts once on mount
  useEffect(() => { loadGoogleFonts(); }, []);

  const theme = mergeEmailTheme(def.theme);

  // dnd-kit sensors — require 5px drag before activating (prevents mis-fires on click)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
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
        {/* Left: back link + editable name */}
        <div className="flex items-center gap-3 flex-shrink-0 w-48">
          <Link
            href="/dashboard/marketing/email/campaigns"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} />
          </Link>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm font-medium text-gray-800 placeholder:text-gray-300 focus:outline-none"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              scheduleSave(e.target.value, subject, preheader, def);
              void saveCampaignMeta(e.target.value, subject);
            }}
            placeholder="Untitled email"
          />
        </div>

        {/* Center: step breadcrumbs like Flodesk */}
        <div className="hidden sm:flex items-center gap-2 mx-auto text-[11px] tracking-widest font-medium uppercase">
          <span className="text-gray-300">Choose Template</span>
          <span className="text-gray-200">›</span>
          <span className="text-gray-700 border-b border-gray-700 pb-0.5">Design Email</span>
          <span className="text-gray-200">›</span>
          <Link href={`/dashboard/marketing/email/campaigns/${campaignId}`} className="text-gray-300 hover:text-gray-600 transition-colors">Choose Audience</Link>
          <span className="text-gray-200">›</span>
          <Link href={`/dashboard/marketing/email/campaigns/${campaignId}`} className="text-gray-300 hover:text-gray-600 transition-colors">Send</Link>
        </div>

        {/* Right: save status, preview, next */}
        <div className="flex items-center gap-3 flex-shrink-0 w-48 justify-end">
          {/* Save indicator */}
          <div className="flex items-center gap-1.5">
            {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin text-gray-300" />}
            {saveStatus === 'saved'  && <span className="text-[11px] text-gray-300">Saved</span>}
            {saveStatus === 'error'  && <span className="text-[11px] text-red-400">Error</span>}
          </div>

          {/* Preview */}
          <button type="button" onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors">
            <Eye size={14} />
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

      {/* Spacer so content isn't hidden behind the fixed header */}
      <div className="h-[52px] flex-shrink-0" />

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 52px)' }}>

        {/* ── Canvas ───────────────────────────────────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: '#ffffff', paddingTop: '36px', paddingBottom: '60px', paddingLeft: '40px', paddingRight: '80px' }}
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

          {/* Subject hint */}
          <div className="mx-auto mb-5 flex items-center gap-2" style={{ maxWidth: viewMode === 'mobile' ? '375px' : theme.maxWidth }}>
            <span className="text-[11px] text-gray-300 font-medium flex-shrink-0 uppercase tracking-wide">Subject</span>
            <input
              className="flex-1 bg-transparent px-2 py-1 text-sm text-gray-400 focus:text-gray-700 focus:outline-none transition-colors"
              value={subject}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                setSubject(e.target.value);
                scheduleSave(name, e.target.value, preheader, def);
              }}
              placeholder="Your email subject line"
            />
          </div>

          {/* Email card — completely flush, white on white */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                    return (
                      <SortableBlock key={block.id} id={block.id}>
                        {(isDragging) => (
                          <div>
                            <div
                              className="relative group/block"
                              onClick={(e) => { e.stopPropagation(); if (!isDragging) setSelectedId(block.id); }}
                            >
                              {/* Block content */}
                              <div
                                className="relative"
                                style={{
                                  transition: 'box-shadow 0.25s ease, outline 0.12s ease',
                                  outline: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                                  outlineOffset: '-2px',
                                  boxShadow: isSelected ? 'none' : undefined,
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected && !isDragging) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.05)';
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                                }}
                              >
                                <BlockCanvas block={block} theme={theme} venueAddress={venueAddress} onPatch={(p) => patchBlock(block.id, p)} />
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
                                    type="button" title="Save as template block"
                                    onClick={() => {
                                      const saved = JSON.parse(localStorage.getItem('sp_saved_blocks') ?? '[]');
                                      saved.push({ ...block, id: crypto.randomUUID(), savedAt: new Date().toISOString() });
                                      localStorage.setItem('sp_saved_blocks', JSON.stringify(saved));
                                      alert('Block saved as a template! You can reuse it from the block picker.');
                                    }}
                                    className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-rose-50 hover:text-rose-500 transition-all"
                                  >
                                    <Heart size={15} />
                                  </button>
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
                          </div>
                        )}
                      </SortableBlock>
                    );
                  })}
                </SortableContext>
              )}
            </div>
          </DndContext>

          {/* Merge field hint */}
          <p className="mx-auto mt-6 text-center text-[11px] text-gray-300" style={{ maxWidth: viewMode === 'mobile' ? '375px' : theme.maxWidth }}>
            {'{{first_name}}'} · {'{{venue_name}}'} · {'{{unsubscribe_url}}'}
          </p>
        </div>

        {/* ── Right Panel ──────────────────────────────────────────────────── */}
        <aside
          className="w-72 flex-shrink-0 overflow-y-auto bg-white"
          style={{ boxShadow: '-12px 0 32px -8px rgba(0,0,0,0.07)' }}
          onClick={(e) => e.stopPropagation()}
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
                onChange={(patch) => patchBlock(selectedBlock.id, patch)}
                onMediaPick={(apply) => {
                  mediaApplyRef.current = apply;
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
            <div className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Palette size={15} className="text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900">Global style</h3>
              </div>

              {/* Preheader */}
              <div className="mb-5">
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Preheader text
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
                  value={preheader}
                  onChange={(e) => {
                    setPreheader(e.target.value);
                    scheduleSave(name, subject, e.target.value, def);
                  }}
                  placeholder="Preview text after subject line"
                />
                <p className="mt-1 text-[10px] text-gray-400">Shown in inbox preview after the subject</p>
              </div>

              <ThemePanel theme={theme} onChange={patchTheme} />

              <p className="mt-5 text-[11px] text-gray-400 text-center">
                Click any block on the canvas to edit it
              </p>
            </div>
          )}
        </aside>
      </div>

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
        onSelect={(url) => {
          mediaApplyRef.current(url);
          setMediaPickerOpen(false);
        }}
      />

      {/* Preview modal */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-8 overflow-y-auto"
          style={{ scrollbarWidth: 'none' }}
          onClick={() => setPreviewOpen(false)}
        >
          <style>{`.preview-scroll::-webkit-scrollbar{display:none}`}</style>
          <div
            className="relative w-full bg-white rounded-2xl shadow-2xl overflow-hidden my-auto"
            style={{ maxWidth: '680px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-gray-900">Preview</span>
                <span className="text-xs text-gray-400 truncate max-w-[340px]">{subject || 'No subject'}</span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Full email body — no clipping, scrolls via the backdrop */}
            <div
              style={{
                background: theme.pageBg === '#ffffff' ? '#f7f7f5' : theme.pageBg,
                padding: '28px 24px 36px',
              }}
            >
              <div
                style={{
                  maxWidth: '600px',
                  margin: '0 auto',
                  background: theme.cardBg,
                  fontFamily: theme.fontFamily,
                  color: theme.textColor,
                }}
              >
                {def.blocks.length === 0 ? (
                  <div style={{ padding: '64px 24px', textAlign: 'center', color: theme.mutedColor, fontSize: '14px' }}>
                    Nothing to preview yet — add blocks to your email
                  </div>
                ) : (
                  def.blocks.map((block) => (
                    <BlockCanvas key={block.id} block={block} theme={theme} venueAddress={venueAddress} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
