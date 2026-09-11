'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Plus, Trash2, RotateCw, Download, Printer, Square, Circle, RectangleHorizontal,
} from 'lucide-react';
import {
  ROOM_WIDTH, ROOM_HEIGHT, DECOR_KINDS, DECOR_META, sanitizeLayout,
  type WeddingLayout, type LayoutElement, type DecorKind, type TableShape,
} from '@/lib/wedding-layout';

export type TableLite = { id: string; name: string; capacity: number };

export interface RoomCanvasProps {
  initialLayout: WeddingLayout;
  tables: TableLite[];
  /** seated headcount (sum of party_size) keyed by table id */
  seatedByTable: Record<string, number>;
  readOnly?: boolean;
  /** Persist. On a rev conflict, return { conflict:true, layout } with the latest. */
  onSave?: (layout: WeddingLayout) => Promise<{ ok: boolean; conflict?: boolean; layout?: WeddingLayout }>;
}

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `el_${Math.random().toString(36).slice(2, 10)}`;

export default function RoomCanvas({ initialLayout, tables, seatedByTable, readOnly, onSave }: RoomCanvasProps) {
  const [rev, setRev] = useState(initialLayout.rev);
  const [elements, setElements] = useState<LayoutElement[]>(initialLayout.elements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');

  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | null
    | { id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);

  // Editing is desktop-only (drag-and-drop is fiddly on phones).
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const editable = !readOnly && isDesktop && Boolean(onSave);

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

  const selected = elements.find((e) => e.id === selectedId) ?? null;

  const mutate = useCallback((fn: (els: LayoutElement[]) => LayoutElement[]) => {
    setElements((prev) => fn(prev));
    setDirty(true);
  }, []);

  function addTable(table?: TableLite) {
    const el: LayoutElement = {
      id: uid(), kind: 'table', shape: 'round',
      x: snap(60 + (elements.length % 6) * 30), y: snap(60 + (elements.length % 4) * 30),
      w: 90, h: 90, rotation: 0, tableId: table?.id ?? null,
    };
    mutate((els) => [...els, el]);
    setSelectedId(el.id);
  }

  function addDecor(kind: DecorKind) {
    const meta = DECOR_META[kind];
    const el: LayoutElement = {
      id: uid(), kind, x: snap(80), y: snap(80), w: meta.w, h: meta.h, rotation: 0,
      text: kind === 'label' ? 'Label' : null,
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

  // ── pointer drag / resize ────────────────────────────────────────────────
  function beginDrag(e: React.PointerEvent, el: LayoutElement, mode: 'move' | 'resize') {
    if (!editable) return;
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
        ctx.fillStyle = '#f9fafb';
        ctx.strokeStyle = over ? '#dc2626' : '#111827';
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
        ctx.fillStyle = '#111827';
        ctx.font = '600 14px sans-serif';
        ctx.fillText(t ? t.name : 'Table', 0, t ? -6 : 0);
        if (t) {
          ctx.fillStyle = over ? '#dc2626' : '#6b7280';
          ctx.font = '12px sans-serif';
          ctx.fillText(`${seated}/${t.capacity}`, 0, 12);
        }
      } else if (el.kind === 'label') {
        ctx.fillStyle = '#374151';
        ctx.font = '600 14px sans-serif';
        ctx.fillText(el.text || 'Label', 0, 0);
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
  }, [elements, tableById, seatedByTable]);

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

      {editable && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
          {DECOR_KINDS.map((k) => (
            <button key={k} onClick={() => addDecor(k)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:border-gray-400">
              + {DECOR_META[k].label}
            </button>
          ))}
        </div>
      )}

      {/* Selected element toolbar */}
      {editable && selected && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          {selected.kind === 'table' && (
            <div className="flex items-center gap-1">
              <ShapeBtn active={selected.shape === 'round'} onClick={() => update(selected.id, { shape: 'round' })} title="Round"><Circle className="h-4 w-4" /></ShapeBtn>
              <ShapeBtn active={selected.shape === 'square'} onClick={() => update(selected.id, { shape: 'square', w: Math.max(selected.w, selected.h), h: Math.max(selected.w, selected.h) })} title="Square"><Square className="h-4 w-4" /></ShapeBtn>
              <ShapeBtn active={selected.shape === 'rect'} onClick={() => update(selected.id, { shape: 'rect', w: Math.max(selected.w, 160) })} title="Long / farm table"><RectangleHorizontal className="h-4 w-4" /></ShapeBtn>
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
          <button onClick={() => update(selected.id, { rotation: (selected.rotation + 15) % 360 })} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:border-gray-400">
            <RotateCw className="h-3.5 w-3.5" /> Rotate
          </button>
          <button onClick={() => remove(selected.id)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-red-600 hover:border-red-300">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}

      {/* Stage */}
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
              className={`absolute flex select-none flex-col items-center justify-center text-center ${editable ? 'cursor-move' : ''} ${isSel ? 'z-10' : ''}`}
              style={{
                left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
                transform: `rotate(${el.rotation}deg)`,
              }}
            >
              <div
                className={`flex h-full w-full flex-col items-center justify-center overflow-hidden border text-center ${
                  el.kind === 'table'
                    ? `${el.shape === 'round' ? 'rounded-full' : 'rounded-lg'} ${over ? 'border-red-400 bg-red-50' : 'border-gray-800 bg-gray-50'}`
                    : el.kind === 'label'
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
                ) : (
                  <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{DECOR_META[el.kind as DecorKind].label}</span>
                )}
              </div>

              {editable && isSel && (
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
            {editable ? 'Place your tables and add a dance floor to start.' : 'No room layout yet.'}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={downloadPng} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" /> PNG
          </button>
          <button onClick={print} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
        {editable && (
          <button
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {dirty ? 'Save layout' : 'Saved'}
          </button>
        )}
      </div>

      {!isDesktop && !readOnly && (
        <p className="mt-2 text-center text-xs text-gray-400">Editing the room layout is available on a larger screen. You can still view, download, and print here.</p>
      )}
    </div>
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
