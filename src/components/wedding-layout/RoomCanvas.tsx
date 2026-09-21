'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Plus, Trash2, RotateCw, Download, Printer, Square, Circle, RectangleHorizontal, Armchair, Info, X,
} from 'lucide-react';
import {
  ROOM_WIDTH, ROOM_HEIGHT, DECOR_KINDS, DECOR_META, sanitizeLayout, TABLE_SHAPES,
  CHAIR_MIN, CHAIR_MAX, CHAIR_DEFAULT, CHAIR_PITCH, CHAIR_CELL, CHAIR_GLYPH, CHAIR_FILL, CHAIR_STROKE, chairCountOf, fitPartyLines,
  type WeddingLayout, type LayoutElement, type DecorKind, type TableShape,
} from '@/lib/wedding-layout';

export type TableLite = { id: string; name: string; capacity: number };

/** A guest party seated at a table. `partySize` is people, the row is one name. */
export type GuestLite = {
  id: string;
  name: string;
  partySize: number;
  rsvpStatus: string;
  mealChoice?: string | null;
  group?: string | null;
};

export interface RoomCanvasProps {
  initialLayout: WeddingLayout;
  tables: TableLite[];
  /** seated headcount (sum of party_size) keyed by table id */
  seatedByTable: Record<string, number>;
  /**
   * Who is seated at each table, keyed by table id. Optional: surfaces without
   * guest data simply don't offer the "who's here" view and fall back to counts.
   */
  guestsByTable?: Record<string, GuestLite[]>;
  readOnly?: boolean;
  /** Persist. On a rev conflict, return { conflict:true, layout } with the latest. */
  onSave?: (layout: WeddingLayout) => Promise<{ ok: boolean; conflict?: boolean; layout?: WeddingLayout }>;
  /**
   * Where to send someone who needs to create tables. Tables are the source of
   * truth for seating and are created in the seating list, not here, so when
   * that list is empty we point the user there instead of offering a blank
   * table that could never hold guests. Omitted on surfaces with no seating tab
   * (venue planner, admin contact panel) — the hint still shows, without a CTA.
   */
  onManageTables?: () => void;
  /**
   * Reports unsaved-edit state so the host can guard navigation that would
   * unmount this canvas (switching tabs, collapsing a card) and silently
   * discard the user's floor plan.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `el_${Math.random().toString(36).slice(2, 10)}`;

const SHAPE_LABEL: Record<TableShape, string> = {
  round: 'Round',
  square: 'Square',
  rect: 'Long / farm table',
};

/** Default size for a newly placed table, by shape. */
function tableDims(shape: TableShape): { w: number; h: number } {
  return shape === 'rect' ? { w: 170, h: 70 } : { w: 90, h: 90 };
}

function ShapeIcon({ shape, className }: { shape: TableShape; className?: string }) {
  if (shape === 'round') return <Circle className={className} />;
  if (shape === 'square') return <Square className={className} />;
  return <RectangleHorizontal className={className} />;
}

/** Trim text to fit a pixel width, ellipsising if needed. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

const RSVP_TONE: Record<string, { label: string; cls: string }> = {
  attending: { label: 'Attending', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending: { label: 'Awaiting RSVP', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  declined: { label: 'Not attending', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export default function RoomCanvas({ initialLayout, tables, seatedByTable, guestsByTable, readOnly, onSave, onManageTables, onDirtyChange }: RoomCanvasProps) {
  const [rev, setRev] = useState(initialLayout.rev);
  const [elements, setElements] = useState<LayoutElement[]>(initialLayout.elements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  /** Shape used for the next table placed from the palette. */
  const [newShape, setNewShape] = useState<TableShape>('round');
  /** View = look around (tap a table to see guests); Edit = today's drag/resize. */
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  /** Table element whose guest panel is open. */
  const [panelElId, setPanelElId] = useState<string | null>(null);
  /** Table element being hovered (desktop only — hover doesn't fire on touch). */
  const [hoverElId, setHoverElId] = useState<string | null>(null);
  /** Include guest names in the PNG / printed floor plan. */
  const [includeNames, setIncludeNames] = useState(true);

  // Report unsaved-edit state upward through a ref so a changing callback
  // identity can't re-trigger the effect.
  const dirtyCbRef = useRef(onDirtyChange);
  useEffect(() => { dirtyCbRef.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { dirtyCbRef.current?.(dirty); }, [dirty]);
  // Clear the host's flag on unmount, so a discarded layout can't leave a stale
  // "unsaved" state that prompts the next time a canvas opens.
  useEffect(() => () => { dirtyCbRef.current?.(false); }, []);

  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | null
    | { id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);

  // Editing works on both desktop and touch devices via Pointer Events.
  const editable = !readOnly && Boolean(onSave);
  /** Only Edit mode mutates the layout; View mode is for looking around. */
  const editing = editable && mode === 'edit';

  /** Guest parties per table, sorted by group then name for a stable read. */
  const sortedGuestsByTable = useMemo(() => {
    if (!guestsByTable) return null;
    const out: Record<string, GuestLite[]> = {};
    for (const [tid, list] of Object.entries(guestsByTable)) {
      out[tid] = [...list].sort(
        (a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name),
      );
    }
    return out;
  }, [guestsByTable]);

  const partiesAt = useCallback(
    (tableId: string | null | undefined): GuestLite[] =>
      (tableId && sortedGuestsByTable ? sortedGuestsByTable[tableId] ?? [] : []),
    [sortedGuestsByTable],
  );

  /** Only offer the named print / guest panel when we actually have guests. */
  const hasGuestData = Boolean(
    sortedGuestsByTable && Object.values(sortedGuestsByTable).some((l) => l.length > 0),
  );

  const tableById = useMemo(() => {
    const m: Record<string, TableLite> = {};
    for (const t of tables) m[t.id] = t;
    return m;
  }, [tables]);

  const placedTableIds = useMemo(
    () => new Set(elements.filter((e) => e.kind === 'table' && e.tableId).map((e) => e.tableId as string)),
    [elements],
  );
  const unplacedTables = tables.filter((t) => !placedTableIds.has(t.id));
  /** Tables live in the seating list; with none, the blank-table button is a trap. */
  const hasTables = tables.length > 0;

  const selected = elements.find((e) => e.id === selectedId) ?? null;

  // Hover preview (desktop) and the open guest panel, both resolved from state.
  const hoverEl = hoverElId ? elements.find((e) => e.id === hoverElId) ?? null : null;
  const hoverParties = hoverEl ? partiesAt(hoverEl.tableId) : [];
  const hoverTable = hoverEl?.tableId ? tableById[hoverEl.tableId] : undefined;

  const panelEl = panelElId ? elements.find((e) => e.id === panelElId) ?? null : null;
  const panelParties = panelEl ? partiesAt(panelEl.tableId) : [];
  const panelTable = panelEl?.tableId ? tableById[panelEl.tableId] : undefined;
  const panelSeated = panelEl?.tableId ? seatedByTable[panelEl.tableId] ?? 0 : 0;

  const mutate = useCallback((fn: (els: LayoutElement[]) => LayoutElement[]) => {
    setElements((prev) => fn(prev));
    setDirty(true);
  }, []);

  function addTable(table?: TableLite) {
    const dims = tableDims(newShape);
    const el: LayoutElement = {
      id: uid(), kind: 'table', shape: newShape,
      x: snap(60 + (elements.length % 6) * 30), y: snap(60 + (elements.length % 4) * 30),
      ...dims, rotation: 0, tableId: table?.id ?? null,
    };
    mutate((els) => [...els, el]);
    setSelectedId(el.id);
  }

  function addDecor(kind: DecorKind) {
    const meta = DECOR_META[kind];
    const el: LayoutElement = {
      id: uid(), kind, x: snap(80), y: snap(80), w: meta.w, h: meta.h, rotation: 0,
      text: kind === 'label' ? 'Label' : null,
      count: kind === 'chairs' ? CHAIR_DEFAULT : null,
    };
    mutate((els) => [...els, el]);
    setSelectedId(el.id);
  }

  function update(id: string, patch: Partial<LayoutElement>) {
    mutate((els) => els.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  function remove(id: string) {
    mutate((els) => els.filter((e) => e.id !== id));
    setSelectedId(null);
  }
  /** Grow/shrink a chair row while keeping every chair the same size. */
  function setChairCount(el: LayoutElement, next: number) {
    const n = Math.min(CHAIR_MAX, Math.max(CHAIR_MIN, Math.round(next)));
    update(el.id, { count: n, w: n * CHAIR_PITCH });
  }

  // ── pointer drag / resize ────────────────────────────────────────────────
  function beginDrag(e: React.PointerEvent, el: LayoutElement, mode: 'move' | 'resize') {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(el.id);
    dragRef.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
    stageRef.current?.setPointerCapture(e.pointerId);
  }

  function onStageMove(e: React.PointerEvent) {
    const d = dragRef.current;
    const stage = stageRef.current;
    if (!d || !stage) return;
    const rect = stage.getBoundingClientRect();
    const kx = ROOM_WIDTH / rect.width;
    const ky = ROOM_HEIGHT / rect.height;
    const dx = (e.clientX - d.sx) * kx;
    const dy = (e.clientY - d.sy) * ky;
    if (d.mode === 'move') {
      const el = elements.find((x) => x.id === d.id);
      const w = el?.w ?? 0;
      const h = el?.h ?? 0;
      update(d.id, {
        x: clamp(snap(d.ox + dx), 0, ROOM_WIDTH - w),
        y: clamp(snap(d.oy + dy), 0, ROOM_HEIGHT - h),
      });
    } else {
      update(d.id, {
        w: clamp(snap(d.ow + dx), 30, ROOM_WIDTH - d.ox),
        h: clamp(snap(d.oh + dy), 30, ROOM_HEIGHT - d.oy),
      });
    }
  }
  function onStageUp(e: React.PointerEvent) {
    if (dragRef.current) {
      dragRef.current = null;
      stageRef.current?.releasePointerCapture?.(e.pointerId);
    }
  }

  async function save() {
    if (!onSave) return;
    setSaving(true);
    setFlash('');
    try {
      const res = await onSave({ rev, elements });
      if (res.conflict && res.layout) {
        const fresh = sanitizeLayout(res.layout);
        setRev(fresh.rev);
        setElements(fresh.elements);
        setDirty(false);
        setSelectedId(null);
        setFlash('This layout was updated elsewhere, so we reloaded the latest. Please reapply your changes.');
      } else if (res.ok && res.layout) {
        setRev(res.layout.rev);
        setDirty(false);
        setFlash('Layout saved.');
      } else {
        setFlash('Could not save. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  // ── export (dependency-free canvas render) ───────────────────────────────
  const renderToCanvas = useCallback((): HTMLCanvasElement => {
    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = ROOM_WIDTH * scale;
    cv.height = ROOM_HEIGHT * scale;
    const ctx = cv.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, ROOM_WIDTH - 2, ROOM_HEIGHT - 2);

    for (const el of elements) {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((el.rotation * Math.PI) / 180);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (el.kind === 'table') {
        const t = el.tableId ? tableById[el.tableId] : undefined;
        const seated = el.tableId ? seatedByTable[el.tableId] ?? 0 : 0;
        const over = t ? seated > t.capacity : false;
        const parties = includeNames ? partiesAt(el.tableId) : [];
        ctx.fillStyle = '#f9fafb';
        ctx.strokeStyle = over ? '#dc2626' : '#9ca3af';
        ctx.lineWidth = 2;
        if (el.shape === 'round') {
          ctx.beginPath();
          ctx.ellipse(0, 0, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          roundRect(ctx, -el.w / 2, -el.h / 2, el.w, el.h, 8);
          ctx.fill();
          ctx.stroke();
        }

        if (!t) {
          ctx.fillStyle = '#111827';
          ctx.font = '600 14px sans-serif';
          ctx.fillText('Table', 0, 0);
        } else if (parties.length === 0) {
          ctx.fillStyle = '#111827';
          ctx.font = '600 14px sans-serif';
          ctx.fillText(t.name, 0, -6);
          ctx.fillStyle = over ? '#dc2626' : '#6b7280';
          ctx.font = '12px sans-serif';
          ctx.fillText(`${seated}/${t.capacity}`, 0, 12);
        } else {
          // Named plan: table name + headcount, then one line per party. Sizes
          // and clipping are derived from the shape so names stay inside it.
          const isRound = el.shape === 'round';
          const maxW = el.w * (isRound ? 0.7 : 0.88);
          const avail = el.h * (isRound ? 0.64 : 0.8);
          const fs = clamp(Math.min(el.h / 6.5, el.w / 9), 7, 12);
          const lh = fs * 1.22;
          const headFs = Math.min(fs + 1, 13);

          const names = parties.map((p) => (p.partySize > 1 ? `${p.name} (${p.partySize})` : p.name));
          const maxLines = Math.max(1, Math.floor(avail / lh) - 1);
          const shown = fitPartyLines(names, maxLines);

          const total = (shown.length + 1) * lh;
          let ty = -total / 2 + lh / 2;
          ctx.font = `600 ${headFs}px sans-serif`;
          ctx.fillStyle = over ? '#dc2626' : '#111827';
          ctx.fillText(fitText(ctx, `${t.name}  ${seated}/${t.capacity}`, maxW), 0, ty);
          ty += lh;
          ctx.font = `${fs}px sans-serif`;
          ctx.fillStyle = '#374151';
          for (const line of shown) {
            ctx.fillText(fitText(ctx, line, maxW), 0, ty);
            ty += lh;
          }
        }
      } else if (el.kind === 'label') {
        ctx.fillStyle = '#374151';
        ctx.font = '600 14px sans-serif';
        ctx.fillText(el.text || 'Label', 0, 0);
      } else if (el.kind === 'chairs') {
        // Mirrors <ChairRow>: scale the row as one unit, then draw each chair
        // from the shared CHAIR_GLYPH parts.
        const n = chairCountOf(el);
        const vbW = n * CHAIR_CELL;
        const s = Math.min(el.w / vbW, el.h / CHAIR_CELL);
        const originX = -(vbW * s) / 2;
        const originY = -(CHAIR_CELL * s) / 2;
        ctx.fillStyle = CHAIR_FILL;
        ctx.strokeStyle = CHAIR_STROKE;
        ctx.lineWidth = Math.max(0.5, s);
        for (let i = 0; i < n; i++) {
          const cellX = originX + i * CHAIR_CELL * s;
          for (const p of CHAIR_GLYPH) {
            roundRect(ctx, cellX + p.x * s, originY + p.y * s, p.w * s, p.h * s, p.r * s);
            ctx.fill();
            ctx.stroke();
          }
        }
      } else {
        ctx.fillStyle = '#f3f4f6';
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1.5;
        roundRect(ctx, -el.w / 2, -el.h / 2, el.w, el.h, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#4b5563';
        ctx.font = '600 13px sans-serif';
        ctx.fillText(DECOR_META[el.kind as DecorKind].label, 0, 0);
      }
      ctx.restore();
    }
    return cv;
  }, [elements, tableById, seatedByTable, includeNames, partiesAt]);

  function downloadPng() {
    const cv = renderToCanvas();
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'room-layout.png';
    a.click();
  }
  function print() {
    const cv = renderToCanvas();
    const url = cv.toDataURL('image/png');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<html><head><title>Room layout</title></head><body style="margin:0;display:flex;justify-content:center;padding:16px"><img src="${url}" style="max-width:100%"/></body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {flash && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{flash}</div>
      )}

      {/* View / Edit — the canvas opens in View so anyone can see who is seated
          where; drag, resize and delete live behind the toggle. */}
      {editable && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 text-sm">
            <button
              type="button"
              onClick={() => { setMode('view'); setSelectedId(null); }}
              aria-pressed={mode === 'view'}
              className={`rounded-lg px-3 py-1.5 font-medium ${mode === 'view' ? 'bg-[#1b1b1b] text-white' : 'text-gray-600 hover:text-gray-900'}`}
            >
              View
            </button>
            <button
              type="button"
              onClick={() => { setMode('edit'); setPanelElId(null); }}
              aria-pressed={mode === 'edit'}
              className={`rounded-lg px-3 py-1.5 font-medium ${mode === 'edit' ? 'bg-[#1b1b1b] text-white' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Edit
            </button>
          </div>
          <span className="text-xs text-gray-400">
            {mode === 'view' ? 'Tap a table to see who is seated there.' : 'Drag to move · corner handle to resize.'}
          </span>
        </div>
      )}

      {/* Tables are created in the seating list (that's the source of truth for
          who sits where). With none yet, offer the way there rather than a
          blank table that could never hold guests. */}
      {editable && !hasTables && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="text-xs text-gray-600">
            No tables yet. Tables are created in the seating list — add them there, then place them
            here so each one shows its name and headcount.
          </span>
          {onManageTables && (
            <button
              type="button"
              // The host owns this navigation and guards unsaved edits (a second
              // confirm here would double-prompt).
              onClick={onManageTables}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:border-gray-400"
            >
              Go to seating list
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {hasTables && (<>
          {/* Shape applied to the next table placed — so you can vary round /
              square / long tables without placing one and re-shaping it. */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">New table:</span>
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5">
              {TABLE_SHAPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNewShape(s)}
                  title={`Place ${SHAPE_LABEL[s].toLowerCase()} tables`}
                  aria-pressed={newShape === s}
                  className={`rounded-md p-1.5 transition-colors ${
                    newShape === s ? 'bg-[#1b1b1b] text-white' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <ShapeIcon shape={s} className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>
          <span className="mx-1 h-4 w-px bg-gray-200" />
          {unplacedTables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-gray-500">Place table:</span>
              {unplacedTables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => addTable(t)}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => addTable()} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400">
            <Plus className="h-3.5 w-3.5" /> Blank table
          </button>
          <span className="mx-1 h-4 w-px bg-gray-200" />
          </>)}
          {DECOR_KINDS.map((k) => (
            <button
              key={k}
              onClick={() => addDecor(k)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:border-gray-400"
            >
              {k === 'chairs' ? <Armchair className="h-3.5 w-3.5" /> : '+'} {DECOR_META[k].label}
            </button>
          ))}
        </div>
      )}

      {/* Selected element toolbar */}
      {editing && selected && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          {selected.kind === 'table' && (
            <div className="flex items-center gap-1">
              <ShapeBtn active={selected.shape === 'round'} onClick={() => update(selected.id, { shape: 'round' })} title="Round"><ShapeIcon shape="round" className="h-4 w-4" /></ShapeBtn>
              <ShapeBtn active={selected.shape === 'square'} onClick={() => update(selected.id, { shape: 'square', w: Math.max(selected.w, selected.h), h: Math.max(selected.w, selected.h) })} title="Square"><ShapeIcon shape="square" className="h-4 w-4" /></ShapeBtn>
              <ShapeBtn active={selected.shape === 'rect'} onClick={() => update(selected.id, { shape: 'rect', w: Math.max(selected.w, 160) })} title="Long / farm table"><ShapeIcon shape="rect" className="h-4 w-4" /></ShapeBtn>
              <span className="mx-1 h-4 w-px bg-gray-200" />
              <select
                value={selected.tableId ?? ''}
                onChange={(e) => update(selected.id, { tableId: e.target.value || null })}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
              >
                <option value="">Unlinked</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id} disabled={placedTableIds.has(t.id) && selected.tableId !== t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {selected.kind === 'label' && (
            <input
              value={selected.text ?? ''}
              onChange={(e) => update(selected.id, { text: e.target.value })}
              placeholder="Text"
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
            />
          )}
          {selected.kind === 'chairs' && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-gray-500">Chairs</span>
              <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setChairCount(selected, chairCountOf(selected) - 1)}
                  disabled={chairCountOf(selected) <= CHAIR_MIN}
                  title="Remove a chair"
                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  −
                </button>
                <span className="min-w-[1.75rem] text-center text-xs font-semibold tabular-nums text-gray-800">
                  {chairCountOf(selected)}
                </span>
                <button
                  type="button"
                  onClick={() => setChairCount(selected, chairCountOf(selected) + 1)}
                  disabled={chairCountOf(selected) >= CHAIR_MAX}
                  title="Add a chair"
                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          )}
          <button onClick={() => update(selected.id, { rotation: (selected.rotation + 15) % 360 })} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:border-gray-400">
            <RotateCw className="h-3.5 w-3.5" /> Rotate
          </button>
          <button onClick={() => remove(selected.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-red-600 hover:border-red-300">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}

      {/* Stage (wrapper is not clipped, so the hover preview can overflow it) */}
      <div className="relative">
      <div
        ref={stageRef}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerDown={() => setSelectedId(null)}
        className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-white"
        style={{ aspectRatio: `${ROOM_WIDTH} / ${ROOM_HEIGHT}`, touchAction: 'none', backgroundImage: 'radial-gradient(circle, #f1f1f0 1px, transparent 1px)', backgroundSize: '4% 5.7%' }}
      >
        {elements.map((el) => {
          const left = (el.x / ROOM_WIDTH) * 100;
          const top = (el.y / ROOM_HEIGHT) * 100;
          const width = (el.w / ROOM_WIDTH) * 100;
          const height = (el.h / ROOM_HEIGHT) * 100;
          const isSel = el.id === selectedId;
          const t = el.kind === 'table' && el.tableId ? tableById[el.tableId] : undefined;
          const seated = el.kind === 'table' && el.tableId ? seatedByTable[el.tableId] ?? 0 : 0;
          const over = t ? seated > t.capacity : false;

          return (
            <div
              key={el.id}
              onPointerDown={(e) => beginDrag(e, el, 'move')}
              // View mode: a table is a thing you inspect, not drag.
              onClick={!editing && el.kind === 'table'
                ? (e) => { e.stopPropagation(); setPanelElId(el.id); }
                : undefined}
              onMouseEnter={!editing && el.kind === 'table' && partiesAt(el.tableId).length > 0
                ? () => setHoverElId(el.id)
                : undefined}
              onMouseLeave={!editing && el.kind === 'table' ? () => setHoverElId(null) : undefined}
              className={`absolute flex select-none flex-col items-center justify-center text-center ${
                editing ? 'cursor-move' : el.kind === 'table' && partiesAt(el.tableId).length > 0 ? 'cursor-pointer' : ''
              } ${isSel ? 'z-10' : ''}`}
              style={{
                left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
                transform: `rotate(${el.rotation}deg)`,
              }}
            >
              <div
                className={`flex h-full w-full flex-col items-center justify-center overflow-hidden border text-center ${
                  el.kind === 'table'
                    ? `${el.shape === 'round' ? 'rounded-full' : 'rounded-lg'} ${over ? 'border-red-400 bg-red-50' : 'border-gray-400 bg-gray-50'}`
                    : el.kind === 'label' || el.kind === 'chairs'
                      ? 'border-transparent bg-transparent'
                      : 'rounded-lg border-gray-300 bg-gray-100/80'
                } ${isSel ? 'ring-2 ring-[#1b1b1b] ring-offset-1' : ''}`}
              >
                {el.kind === 'table' ? (
                  <>
                    <span className="px-1 text-[11px] font-semibold leading-tight text-gray-900 truncate w-full">{t ? t.name : 'Table'}</span>
                    {t && <span className={`text-[10px] leading-tight ${over ? 'text-red-600' : 'text-gray-500'}`}>{seated}/{t.capacity}</span>}
                  </>
                ) : el.kind === 'label' ? (
                  <span className="px-1 text-[11px] font-semibold text-gray-700">{el.text || 'Label'}</span>
                ) : el.kind === 'chairs' ? (
                  <ChairRow count={chairCountOf(el)} />
                ) : (
                  <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{DECOR_META[el.kind as DecorKind].label}</span>
                )}
              </div>

              {/* Chair rows are sized by their count, so no resize handle. */}
              {editing && isSel && el.kind !== 'chairs' && (
                <span
                  onPointerDown={(e) => beginDrag(e, el, 'resize')}
                  className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm border border-white bg-[#1b1b1b]"
                />
              )}
            </div>
          );
        })}

        {elements.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            {editing ? 'Place your tables, add a row of chairs, and drop in a dance floor to start.' : 'No room layout yet.'}
          </div>
        )}
      </div>

      {/* Desktop hover preview of who's at the table. Hover never fires on
          touch, so this is a convenience on top of tapping to open the panel. */}
      {!editing && hoverEl && hoverParties.length > 0 && panelElId !== hoverEl.id && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{
            left: `${((hoverEl.x + hoverEl.w / 2) / ROOM_WIDTH) * 100}%`,
            top: `${(hoverEl.y / ROOM_HEIGHT) * 100}%`,
          }}
        >
          <div className="mb-1 max-w-[230px] rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg">
            <p className="truncate text-[11px] font-semibold text-gray-900">
              {hoverTable ? hoverTable.name : 'Table'}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {hoverParties.slice(0, 4).map((p) => (
                <li key={p.id} className="truncate text-[11px] text-gray-600">
                  {p.name}{p.partySize > 1 ? ` · ${p.partySize}` : ''}
                </li>
              ))}
            </ul>
            {hoverParties.length > 4 && (
              <p className="mt-0.5 text-[10px] text-gray-400">+{hoverParties.length - 4} more</p>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={downloadPng} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" /> PNG
          </button>
          <button onClick={print} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Printer className="h-4 w-4" /> Print
          </button>
          {hasGuestData && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={includeNames}
                onChange={(e) => setIncludeNames(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              Include guest names
            </label>
          )}
        </div>
        {/* Keep Save reachable in View mode too, so switching away mid-edit
            doesn't strand unsaved changes with no way to commit them. */}
        {(editing || dirty) && (
          <button
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {dirty ? 'Save layout' : 'Saved'}
          </button>
        )}
      </div>

      {editable && (
        <p className="mt-2 text-center text-xs text-gray-400">
          {mode === 'view'
            ? 'Tap a table to see who is seated there.'
            : 'Tip: tap an item to select it, then drag to move. Drag the corner handle to resize.'}
        </p>
      )}

      {/* Who's seated here — opened by tapping a table in View mode. */}
      {panelEl && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
          onClick={() => setPanelElId(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-gray-900">
                  {panelTable ? panelTable.name : 'Table'}
                </h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  {!panelTable
                    ? 'Not linked to a table in the seating list'
                    : panelSeated === 0
                      ? `${panelTable.capacity} seats · no one seated yet`
                      : `${panelSeated} of ${panelTable.capacity} seats · ${panelParties.length} ${panelParties.length === 1 ? 'party' : 'parties'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPanelElId(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {panelParties.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  No one seated here yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {panelParties.map((p) => {
                    const tone = RSVP_TONE[p.rsvpStatus] ?? RSVP_TONE.pending;
                    return (
                      <li key={p.id} className="rounded-xl border border-gray-200 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-gray-900">{p.name}</span>
                          {p.partySize > 1 && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                              party of {p.partySize}
                            </span>
                          )}
                          <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.cls}`}>
                            {tone.label}
                          </span>
                        </div>
                        {(p.mealChoice || p.group) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
                            {p.group && <span>{p.group}</span>}
                            {p.group && p.mealChoice && <span>·</span>}
                            {p.mealChoice && <span>{p.mealChoice}</span>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-gray-100 px-5 py-3 text-[11px] text-gray-400">
              Seating is managed in the seating list — this view is read-only.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A row of chairs drawn as ONE svg so the whole row scales as a unit: the chair
 * size and the gap between them are baked into the viewBox, so adding chairs
 * extends the row evenly instead of stretching the spacing.
 */
function ChairRow({ count }: { count: number }) {
  const vbW = count * CHAIR_CELL;
  return (
    <svg
      viewBox={`0 0 ${vbW} ${CHAIR_CELL}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <g key={i} transform={`translate(${i * CHAIR_CELL} 0)`}>
          {CHAIR_GLYPH.map((p, j) => (
            <rect
              key={j}
              x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r}
              fill={CHAIR_FILL} stroke={CHAIR_STROKE} strokeWidth={1}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

function ShapeBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={`rounded-lg border p-1.5 ${active ? 'border-[#1b1b1b] bg-[#1b1b1b] text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}>
      {children}
    </button>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
