'use client';

// Shared visual primitives for the Flodesk-style form builder.
// Mirrors the email-builder primitives 1:1 so both editors look identical.
// (Kept as a separate copy to avoid touching the email builder file.)

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Pipette } from 'lucide-react';
import { useBrandColors } from '@/lib/use-brand-colors';

// ─── Type ────────────────────────────────────────────────────────────────────
export type Align3 = 'left' | 'center' | 'right';

// ─── Color palette (matches email builder) ───────────────────────────────────
export const COLOR_PALETTE: string[] = [
  '#fce8e0','#f8d9d0','#f4c8b8','#eda898','#e38474','#d86a58','#c45040','#a83428','#8a1e14','#6e0a02',
  '#f7ebe1','#eedad0','#e3c4b0','#d4ac92','#c49474','#b07c5c','#9a6448','#824c34','#6a3820','#520800',
  '#f6efde','#ede2c4','#e1d2a4','#cfba80','#b8a062','#a08648','#876e34','#6e5824','#564218','#3e2c0c',
  '#e8efe2','#d4e0c8','#bccfac','#9bb88c','#7ba070','#5e8856','#456f3f','#33572d','#23401e','#162b11',
  '#e1eef0','#cae0e2','#aac9cd','#8ab1b8','#6c97a0','#557b85','#3e616a','#2c4a52','#1d343c','#101e26',
  '#e2e7ee','#cbd2dc','#aab4c2','#8896a8','#697a90','#4f6178','#3a4960','#2a3548','#1b2434','#0c1320',
  '#ebe5ee','#d8cee0','#bfb1ce','#a392ba','#857398','#6a5b80','#524668','#3e3552','#2c253c','#1a1525',
  '#f2eaea','#e3d4d4','#cfb6b6','#b89696','#9d7777','#825c5c','#664444','#4d2f2f','#371d1d','#220c0c',
  '#ffffff','#f4f4f4','#dcdcdc','#bdbdbd','#9e9e9e','#7e7e7e','#5f5f5f','#3f3f3f','#1f1f1f','#000000',
];

// ─── Font lists (matches email builder) ──────────────────────────────────────
export const GOOGLE_FONT_LIST = [
  'Inter','Open Sans','Roboto','Lato','Montserrat','Poppins','Nunito','Raleway',
  'Oswald','Work Sans','Source Sans 3','Quicksand','Josefin Sans',
  'Playfair Display','Merriweather','Libre Baskerville','Crimson Text',
  'DM Sans','Plus Jakarta Sans','Manrope','Figtree','Outfit',
];

export const SYSTEM_FONT_LIST = [
  { label: 'Helvetica Neue', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Georgia',        value: "Georgia, 'Times New Roman', serif" },
  { label: 'Arial',          value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana',        value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier New',    value: "'Courier New', Courier, monospace" },
];

export const ALL_FONT_OPTIONS = [
  ...SYSTEM_FONT_LIST,
  ...GOOGLE_FONT_LIST.map((f) => ({ label: f, value: f })),
];

export const FONT_WEIGHTS = [
  { label: 'Light',    value: '300' },
  { label: 'Regular',  value: '400' },
  { label: 'Medium',   value: '500' },
  { label: 'Semibold', value: '600' },
  { label: 'Bold',     value: '700' },
];

// Lazy-load Google Fonts <link> once per page.
export function loadGoogleFonts() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('sp-google-fonts')) return;
  const families = GOOGLE_FONT_LIST.map(
    (f) => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700`,
  ).join('&');
  const link = document.createElement('link');
  link.id = 'sp-google-fonts';
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);
}

// ─── Slider CSS (used by SliderControl) ──────────────────────────────────────
// Inject once per page; safe to render multiple times (id-guarded).
export function BuilderStyles() {
  return (
    <style>{`
      .fb-scroll-pane::-webkit-scrollbar { display: none; }
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
    `}</style>
  );
}

// ─── Alignment selector ──────────────────────────────────────────────────────
function AlignIcon({ align, active }: { align: Align3; active: boolean }) {
  const stroke = active ? '#1f2937' : '#9ca3af';
  const sw = active ? 2.2 : 1.8;
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

export function AlignSelector({
  value,
  onChange,
  label = 'Align',
}: {
  value: Align3;
  onChange: (a: Align3) => void;
  label?: string | null;
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

// ─── Flodesk color picker (with brand-color palette + eye dropper) ───────────
function BrandSwatch({
  color,
  onPick,
  onRemove,
}: {
  color: string;
  onPick: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onMouseDown={onPick}
        title={color}
        className="w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400"
        style={{ background: color, border: color === '#ffffff' ? '1px solid #e5e5e5' : 'none' }}
      />
      {hover && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove brand color"
          title="Remove from brand colors"
          className="absolute -top-1 -right-1 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white bg-gray-900 text-white shadow-sm hover:bg-red-600"
          style={{ fontSize: 8, lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function FlodeskColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { colors: brandColors, addColor, removeColor } = useBrandColors();

  useEffect(() => {
    setHex(value);
  }, [value]);

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

  // Track trigger position so the floating popover stays glued under it
  // even as the surrounding panel scrolls / resizes.
  useEffect(() => {
    if (!open) return;
    const PICKER_W = 320;
    let raf = 0;

    function update() {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const popH = popRef.current?.offsetHeight ?? 460;
      const margin = 8;
      const spaceBelow = window.innerHeight - trigger.bottom - margin;
      const spaceAbove = trigger.top - margin;
      let top: number;
      if (spaceBelow >= popH + margin || spaceBelow >= spaceAbove) {
        top = trigger.bottom + margin;
      } else {
        top = trigger.top - popH - margin;
      }
      top = Math.max(margin, Math.min(top, window.innerHeight - popH - margin));
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
    if (typeof window === 'undefined' || !('EyeDropper' in window)) return;
    try {
      // @ts-expect-error - EyeDropper is not in lib.dom.d.ts yet
      const { sRGBHex } = await new window.EyeDropper().open();
      applyHex(sRGBHex);
      setOpen(false);
    } catch {
      /* user cancelled */
    }
  }

  const isTransparent = !value || value === 'transparent';
  const normalizedCurrent = hex.toLowerCase();
  const currentSaved = brandColors.includes(normalizedCurrent);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-12 h-12 rounded-full border border-gray-200 transition-transform hover:scale-105 focus:outline-none overflow-hidden"
        style={{
          background: isTransparent
            ? 'linear-gradient(to top right, transparent calc(50% - 1.2px), #ef4444 calc(50% - 1.2px), #ef4444 calc(50% + 1.2px), transparent calc(50% + 1.2px))'
            : value,
        }}
      />

      {open && typeof document !== 'undefined' && createPortal(
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
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-10 gap-1.5 mb-4">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onMouseDown={() => {
                    applyHex(c);
                    onChange(c);
                  }}
                  className="w-6 h-6 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400"
                  style={{ background: c, border: c === '#ffffff' ? '1px solid #e5e5e5' : 'none' }}
                />
              ))}
            </div>

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
                  {brandColors.map((c) => (
                    <BrandSwatch
                      key={c}
                      color={c}
                      onPick={() => {
                        applyHex(c);
                        onChange(c);
                      }}
                      onRemove={() => removeColor(c)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onMouseDown={() => {
                  if (/^#[0-9a-fA-F]{6}$/.test(hex)) addColor(hex);
                }}
                className="block w-full text-center text-[13px] text-gray-500 underline mb-4 hover:text-gray-800"
              >
                Add your brand colors
              </button>
            )}

            <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2">
              <div
                className="w-5 h-5 rounded-full flex-shrink-0 border border-gray-200"
                style={{ background: hex }}
              />
              <input
                className="flex-1 text-sm font-mono uppercase text-gray-800 focus:outline-none bg-transparent"
                value={hex.replace('#', '').toUpperCase()}
                maxLength={6}
                onChange={(e) => applyHex(e.target.value)}
                onBlur={(e) => applyHex(e.target.value)}
              />
              <button
                type="button"
                onClick={eyeDrop}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                title="Pick color from screen"
              >
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

// ─── Font selector ───────────────────────────────────────────────────────────
export function FontSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Display label for the current font
  const current =
    ALL_FONT_OPTIONS.find((o) => o.value === value || o.label === value) ?? ALL_FONT_OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 hover:bg-white transition-colors"
        style={{ fontFamily: current.value }}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-2xl py-1">
          {ALL_FONT_OPTIONS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                onChange(f.value);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-100 ${
                f.value === value ? 'bg-gray-50 text-gray-900' : 'text-gray-700'
              }`}
              style={{ fontFamily: f.value }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Slider control (minus / range / plus) ───────────────────────────────────
export function SliderControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (v: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const snap = (raw: number) => parseFloat((Math.round(raw / step) * step).toFixed(4));

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
        >
          −
        </button>
        <input
          ref={inputRef}
          type="range"
          className="sp-slider flex-1"
          min={min}
          max={max}
          step={step}
          defaultValue={value}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          style={{ display: 'block' }}
        />
        <button
          type="button"
          onClick={() => onChange(clamp(snap(value + step)))}
          className="text-sm text-gray-400 hover:text-gray-700 w-4 flex-shrink-0 select-none leading-none"
        >
          +
        </button>
      </div>
    </div>
  );
}
