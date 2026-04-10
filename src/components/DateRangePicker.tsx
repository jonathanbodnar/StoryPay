'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  label: string;
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(str: string) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOf(unit: 'day' | 'week' | 'month' | 'quarter' | 'year', d = new Date()): Date {
  const r = new Date(d);
  if (unit === 'day') { r.setHours(0,0,0,0); return r; }
  if (unit === 'week') { r.setDate(r.getDate() - r.getDay()); r.setHours(0,0,0,0); return r; }
  if (unit === 'month') { r.setDate(1); r.setHours(0,0,0,0); return r; }
  if (unit === 'quarter') {
    const q = Math.floor(r.getMonth() / 3);
    r.setMonth(q * 3, 1); r.setHours(0,0,0,0); return r;
  }
  if (unit === 'year') { r.setMonth(0, 1); r.setHours(0,0,0,0); return r; }
  return r;
}

export const PRESETS: { label: string; getRange: () => { from: string; to: string } }[] = [
  { label: 'Today',         getRange: () => { const d = toDateStr(new Date()); return { from: d, to: d }; } },
  { label: 'Last 7 days',   getRange: () => { const t = new Date(); const f = new Date(t); f.setDate(t.getDate()-6); return { from: toDateStr(f), to: toDateStr(t) }; } },
  { label: 'Last 14 days',  getRange: () => { const t = new Date(); const f = new Date(t); f.setDate(t.getDate()-13); return { from: toDateStr(f), to: toDateStr(t) }; } },
  { label: 'Last 30 days',  getRange: () => { const t = new Date(); const f = new Date(t); f.setDate(t.getDate()-29); return { from: toDateStr(f), to: toDateStr(t) }; } },
  { label: 'Last 90 days',  getRange: () => { const t = new Date(); const f = new Date(t); f.setDate(t.getDate()-89); return { from: toDateStr(f), to: toDateStr(t) }; } },
  { label: 'This month',    getRange: () => ({ from: toDateStr(startOf('month')), to: toDateStr(new Date()) }) },
  { label: 'Last month',    getRange: () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth()-1, 1); const e = new Date(n.getFullYear(), n.getMonth(), 0); return { from: toDateStr(s), to: toDateStr(e) }; } },
  { label: 'This quarter',  getRange: () => ({ from: toDateStr(startOf('quarter')), to: toDateStr(new Date()) }) },
  { label: 'Year to date',  getRange: () => ({ from: toDateStr(startOf('year')), to: toDateStr(new Date()) }) },
  { label: 'Last 12 months',getRange: () => { const t = new Date(); const f = new Date(t); f.setFullYear(t.getFullYear()-1); f.setDate(f.getDate()+1); return { from: toDateStr(f), to: toDateStr(t) }; } },
  { label: 'Last year',     getRange: () => { const y = new Date().getFullYear()-1; return { from: `${y}-01-01`, to: `${y}-12-31` }; } },
  { label: 'All time',      getRange: () => ({ from: '2020-01-01', to: toDateStr(new Date()) }) },
];

function MiniCalendar({
  month, year, selecting, selectedFrom, selectedTo, hovered,
  onSelect, onHover, onMonthChange,
}: {
  month: number; year: number;
  selecting: 'from' | 'to';
  selectedFrom: string | null; selectedTo: string | null; hovered: string | null;
  onSelect: (d: string) => void;
  onHover: (d: string | null) => void;
  onMonthChange: (m: number, y: number) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const today = toDateStr(new Date());

  function isInRange(d: string) {
    const lo = selectedFrom;
    const hi = selectedTo || hovered;
    if (!lo || !hi) return false;
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
    return d > a && d < b;
  }
  function isEdge(d: string) {
    return d === selectedFrom || d === selectedTo;
  }
  function isStart(d: string) {
    if (!selectedFrom || !selectedTo) return d === selectedFrom;
    return selectedFrom <= selectedTo ? d === selectedFrom : d === selectedTo;
  }
  function isEnd(d: string) {
    if (!selectedFrom || !selectedTo) return false;
    const hi = selectedTo || hovered;
    if (!hi) return false;
    return selectedFrom <= hi ? d === hi : d === selectedFrom;
  }

  const prevMonth = () => { const nm = month === 0 ? 11 : month - 1; const ny = month === 0 ? year - 1 : year; onMonthChange(nm, ny); };
  const nextMonth = () => { const nm = month === 11 ? 0 : month + 1; const ny = month === 11 ? year + 1 : year; onMonthChange(nm, ny); };

  return (
    <div className="select-none w-64">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 transition-colors">
          <ChevronLeft size={14} className="text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-gray-900">{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 transition-colors">
          <ChevronRight size={14} className="text-gray-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const inRange = isInRange(d);
          const edge = isEdge(d);
          const start = isStart(d);
          const end = isEnd(d);
          const isToday = d === today;
          return (
            <button
              key={d}
              onClick={() => onSelect(d)}
              onMouseEnter={() => onHover(d)}
              onMouseLeave={() => onHover(null)}
              className={[
                'relative h-8 text-xs font-medium transition-colors focus:outline-none',
                inRange ? 'bg-brand-900/8 text-gray-900' : '',
                start ? 'rounded-l-full' : '',
                end ? 'rounded-r-full' : '',
                (!start && !end && !inRange) ? 'rounded-full hover:bg-gray-100' : '',
                edge ? 'text-white' : isToday ? 'font-bold text-brand-900' : 'text-gray-700',
              ].join(' ')}
              style={edge ? { backgroundColor: '#1b1b1b', borderRadius: start && end ? '9999px' : start ? '9999px 0 0 9999px' : '0 9999px 9999px 0' } : {}}
            >
              {parseInt(d.split('-')[2], 10)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState<'from' | 'to'>('from');
  const [tempFrom, setTempFrom] = useState<string | null>(null);
  const [tempTo, setTempTo] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [activePreset, setActivePreset] = useState<string>(value.label);
  const ref = useRef<HTMLDivElement>(null);

  // Close on resize (position would be stale)
  useEffect(() => {
    if (!open) return;
    function onResize() { setOpen(false); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  function handlePreset(preset: typeof PRESETS[0]) {
    const range = preset.getRange();
    setActivePreset(preset.label);
    setTempFrom(range.from);
    setTempTo(range.to);
    onChange({ ...range, label: preset.label });
    setOpen(false);
  }

  function handleCalSelect(d: string) {
    if (selecting === 'from') {
      setTempFrom(d);
      setTempTo(null);
      setSelecting('to');
      setActivePreset('Custom range');
    } else {
      let from = tempFrom!;
      let to = d;
      if (from > to) { [from, to] = [to, from]; }
      setTempFrom(from);
      setTempTo(to);
      setSelecting('from');
      setActivePreset('Custom range');
    }
  }

  function applyCustom() {
    if (!tempFrom || !tempTo) return;
    let from = tempFrom, to = tempTo;
    if (from > to) [from, to] = [to, from];
    onChange({ from, to, label: 'Custom range' });
    setOpen(false);
  }

  const displayFrom = tempFrom || value.from;
  const displayTo = tempTo || value.to;

  const formatDisplay = (d: string) => {
    const [y, m, day] = d.split('-');
    return `${parseInt(m, 10)}/${parseInt(day, 10)}/${y}`;
  };

  const [btnRect, setBtnRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function openPicker() {
    if (btnRef.current) setBtnRect(btnRef.current.getBoundingClientRect());
    setTempFrom(value.from);
    setTempTo(value.to);
    setSelecting('from');
    setOpen(true);
  }

  // Shared calendar inner content
  const calendarInner = (
    <>
      {/* Desktop presets sidebar */}
      <div className="hidden sm:block w-44 border-r border-gray-100 py-2 flex-shrink-0">
        <p className="px-4 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Presets</p>
        {PRESETS.map(p => (
          <button key={p.label} onClick={() => handlePreset(p)}
            className={['w-full text-left px-4 py-1.5 text-xs transition-colors', activePreset === p.label ? 'font-semibold text-gray-900 bg-gray-100' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'].join(' ')}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Calendar panel */}
      <div className="flex-1 p-4 flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">
            {selecting === 'from' ? 'Select start date' : 'Select end date'}
          </p>
          <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Mobile quick presets */}
        <div className="sm:hidden flex flex-wrap gap-2">
          {['Last 7 days','Last 30 days','This month','Last 3 months','Year to date','All time'].map(label => {
            const preset = PRESETS.find(p => p.label === label);
            if (!preset) return null;
            return (
              <button key={label} type="button" onClick={() => handlePreset(preset)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${activePreset === label ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600'}`}>
                {label}
              </button>
            );
          })}
        </div>

        {/* From / To selectors */}
        <div className="flex items-center gap-2">
          <button onClick={() => setSelecting('from')}
            className={['flex-1 px-3 py-2 text-xs rounded-lg border text-center transition-colors', selecting === 'from' ? 'border-gray-900 bg-gray-900/5 font-semibold text-gray-900' : 'border-gray-200 text-gray-500'].join(' ')}>
            {displayFrom ? formatDisplay(displayFrom) : 'Start date'}
          </button>
          <span className="text-gray-300 flex-shrink-0 text-xs">→</span>
          <button onClick={() => setSelecting('to')}
            className={['flex-1 px-3 py-2 text-xs rounded-lg border text-center transition-colors', selecting === 'to' ? 'border-gray-900 bg-gray-900/5 font-semibold text-gray-900' : 'border-gray-200 text-gray-500'].join(' ')}>
            {displayTo ? formatDisplay(displayTo) : 'End date'}
          </button>
        </div>

        <MiniCalendar month={calMonth} year={calYear} selecting={selecting}
          selectedFrom={tempFrom} selectedTo={tempTo} hovered={selecting === 'to' ? hovered : null}
          onSelect={handleCalSelect} onHover={setHovered}
          onMonthChange={(m, y) => { setCalMonth(m); setCalYear(y); }} />

        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button onClick={() => setOpen(false)}
            className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={applyCustom} disabled={!tempFrom || !tempTo}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition-colors"
            style={{ backgroundColor: '#1b1b1b' }}>
            Apply
          </button>
        </div>
      </div>
    </>
  );

  // Mobile: bottom sheet. Desktop: fixed dropdown below button.
  const isMobileScreen = typeof window !== 'undefined' && window.innerWidth < 640;

  const desktopStyle: React.CSSProperties = btnRect ? {
    position: 'fixed',
    top: btnRect.bottom + 8,
    right: Math.max(8, window.innerWidth - btnRect.right),
    width: Math.min(580, window.innerWidth - 16),
    zIndex: 9999,
  } : { position: 'fixed', top: 80, right: 16, width: 560, zIndex: 9999 };

  const panel = open ? (
    isMobileScreen ? (
      // Full-width bottom sheet on mobile
      <div className="flex flex-col bg-white rounded-t-2xl shadow-2xl overflow-y-auto"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>
        <div className="flex flex-col">{calendarInner}</div>
      </div>
    ) : (
      <div className="flex rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
        style={desktopStyle}
        onClick={e => e.stopPropagation()}>
        {calendarInner}
      </div>
    )
  ) : null;

  return (
    <>
      <div ref={ref} className="relative">
        <button
          ref={btnRef}
          onClick={openPicker}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:border-gray-300 hover:shadow"
        >
          <Calendar size={14} className="text-gray-400" />
          <span>{value.label === 'Custom range' ? `${formatDisplay(value.from)} – ${formatDisplay(value.to)}` : value.label}</span>
          <ChevronDown size={13} className="text-gray-400" />
        </button>
      </div>
      {open && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop — close on tap outside */}
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          {panel}
        </>,
        document.body
      )}
    </>
  );
}
