'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CalendarHeart, CheckSquare, ChevronDown, ChevronUp,
  ClipboardList, Clock, DollarSign, GitBranch, Image as ImageIcon, Link2,
  Loader2, Mail, Minus, Plus, Send, Smartphone, Square,
  Tag, Trash2, Users, X, Zap,
} from 'lucide-react';
import { VenueMediaPickerModal } from '@/components/venue-media/VenueMediaPickerModal';
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, useDraggable, DragOverlay,
  type DragEndEvent, type DragStartEvent, type DragOverEvent,
  type Modifier, type PointerActivationConstraint,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AutomationTriggerType } from '@/lib/marketing-email-schema';

// ─── Sensor — never activates on inputs / buttons / links / data-no-dnd ──────
class SmartPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (
        { nativeEvent }: { nativeEvent: PointerEvent },
        { activationConstraint }: { activationConstraint?: PointerActivationConstraint },
      ) => {
        const t = nativeEvent.target as HTMLElement | null;
        if (!t) return true;
        if (
          t.tagName === 'INPUT' || t.tagName === 'BUTTON' ||
          t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
          t.tagName === 'A' || t.closest?.('[data-no-dnd]')
        ) return false;
        void activationConstraint;
        return true;
      },
    },
  ];
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface AutomationRow {
  id: string; name: string;
  status: 'draft' | 'active' | 'paused';
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
}
interface TagRow    { id: string; name: string }
interface StageOpt { id: string; name: string; pipelineName: string }
interface LinkRow   { id: string; name: string; short_code: string }
interface FormRow   { id: string; name: string; published: boolean }
interface TemplateOpt { id: string; name: string }
interface EnrollContact {
  id: string; stepIndex: number; status: string; nextRunAt: string | null;
  leadId: string | null; firstName: string; lastName: string; email: string;
}

const DEFAULT_SMS = 'Hi {{first_name}}, a quick note from {{venue_name}}. Reply STOP to opt out.';
const CARD_W = 320; // canvas card width in pixels

type StepKind = 'delay' | 'send_email' | 'send_sms';
type WaitUnit = 'minutes' | 'hours' | 'days';
type LocalStep =
  | { localId: string; step_type: 'delay';      delay_minutes: number }
  | { localId: string; step_type: 'send_email'; template_id: string }
  | { localId: string; step_type: 'send_sms';   body: string; media_urls?: string[] };

type SelectedItem = { kind: 'trigger' } | { kind: 'step'; localId: string } | null;

// ─── Wait unit helpers ────────────────────────────────────────────────────────
function minutesToDisplay(minutes: number): { value: number; unit: WaitUnit } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes >= 60   && minutes % 60   === 0) return { value: minutes / 60,   unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}
function displayToMinutes(value: number, unit: WaitUnit): number {
  if (unit === 'hours') return Math.max(1, value) * 60;
  if (unit === 'days')  return Math.max(1, value) * 1440;
  return Math.max(1, value);
}

// ─── Step palette ─────────────────────────────────────────────────────────────
const PALETTE: { type: StepKind; label: string; desc: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { type: 'delay',      label: 'Wait',       desc: 'Pause for a duration',     Icon: Clock },
  { type: 'send_email', label: 'Send Email', desc: 'Choose a saved template',  Icon: Mail },
  { type: 'send_sms',   label: 'Send SMS',   desc: 'Send a text message',      Icon: Smartphone },
];

const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { value: 'form_submitted',        label: 'Form submitted',     Icon: ClipboardList },
  { value: 'tag_added',             label: 'Tag added',          Icon: Tag },
  { value: 'stage_changed',         label: 'Stage changed',      Icon: GitBranch },
  { value: 'trigger_link_click',    label: 'Trigger link click', Icon: Link2 },
  { value: 'wedding_date_followup', label: 'After wedding date', Icon: CalendarHeart },
  { value: 'proposal_paid',         label: 'Proposal paid',      Icon: DollarSign },
];

// ─── Draggable palette card ───────────────────────────────────────────────────
function PaletteCard({ type, label, desc, Icon }: typeof PALETTE[number]) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `new:${type}`,
    data: { source: 'palette', stepType: type },
  });
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab', touchAction: 'none' }}
      className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 transition-colors hover:border-gray-300 select-none"
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

// ─── Sortable step wrapper ────────────────────────────────────────────────────
function SortableStep({ id, children }: { id: string; children: (isDragging: boolean) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners}
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

// ─── + Add step button ────────────────────────────────────────────────────────
function AddStepBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="group/addbtn relative flex h-10 items-center justify-center my-1">
      <button
        type="button" data-no-dnd
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white opacity-0 group-hover/addbtn:opacity-100 transition-all duration-150 hover:scale-110"
        style={{ border: '1.5px solid #1b1b1b', color: '#1b1b1b' }}
        title="Add step"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

// ─── Drop indicator line ──────────────────────────────────────────────────────
function DropIndicator({ label }: { label: string }) {
  return (
    <div className="pointer-events-none py-1">
      <div style={{ borderTop: '2px solid #3b82f6' }}>
        <span className="text-[10px] font-semibold text-white rounded px-1.5 py-0.5"
          style={{ background: '#3b82f6', lineHeight: 1.4 }}>
          {label} — drop here
        </span>
      </div>
    </div>
  );
}

// ─── Step picker modal ────────────────────────────────────────────────────────
function StepPickerModal({ onSelect, onClose }: { onSelect: (t: StepKind) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-[420px] max-w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Add a step</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><Minus size={18} /></button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PALETTE.map(({ type, label, desc, Icon }) => (
            <button key={type} type="button" onClick={() => onSelect(type)}
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

// ─── Enrollment pill ──────────────────────────────────────────────────────────
function EnrollPill({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" data-no-dnd
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="absolute -top-3 -right-3 z-20 flex items-center gap-1 rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow hover:bg-blue-600 transition-colors"
      title={`${count} contact${count === 1 ? '' : 's'} here — click to view`}
    >
      <Users size={10} />{count}
    </button>
  );
}

// ─── Canvas step card body ────────────────────────────────────────────────────
function triggerDesc(type: AutomationTriggerType, config: {
  selForms: string[]; selTags: string[]; selStages: string[];
  selLinks: string[]; daysAfterWedding: number;
}): string {
  if (type === 'form_submitted')        return config.selForms.length > 0   ? `${config.selForms.length} form(s) selected`       : 'Any form submission';
  if (type === 'tag_added')             return config.selTags.length > 0    ? `${config.selTags.length} tag(s) selected`          : 'Any tag added';
  if (type === 'stage_changed')         return config.selStages.length > 0  ? `${config.selStages.length} stage(s) selected`      : 'Any stage entered';
  if (type === 'trigger_link_click')    return config.selLinks.length > 0   ? `${config.selLinks.length} link(s) selected`        : 'Any trigger link';
  if (type === 'wedding_date_followup') return `${config.daysAfterWedding} day${config.daysAfterWedding === 1 ? '' : 's'} after`;
  if (type === 'proposal_paid')         return 'On proposal paid';
  return 'Configure in panel →';
}

function stepMeta(s: LocalStep, templates: TemplateOpt[]): { title: string; subtitle: string; Icon: React.FC<{ size?: number; className?: string }> } {
  if (s.step_type === 'delay') {
    const { value, unit } = minutesToDisplay(s.delay_minutes);
    return { title: 'Wait', subtitle: `${value} ${unit}`, Icon: Clock };
  }
  if (s.step_type === 'send_sms') {
    const b = s.body.trim();
    return { title: 'Send SMS', subtitle: b.slice(0, 52) + (b.length > 52 ? '…' : ''), Icon: Smartphone };
  }
  const tpl = templates.find((t) => t.id === s.template_id);
  return { title: 'Send Email', subtitle: tpl?.name ?? 'Choose a template →', Icon: Mail };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function WorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const id = workflowId;

  const [auto, setAuto]           = useState<AutomationRow | null>(null);
  const [steps, setSteps]         = useState<LocalStep[]>([]);
  const [tags, setTags]           = useState<TagRow[]>([]);
  const [stages, setStages]       = useState<StageOpt[]>([]);
  const [links, setLinks]         = useState<LinkRow[]>([]);
  const [forms, setForms]         = useState<FormRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr]             = useState<string | null>(null);

  const [selTags,          setSelTags]          = useState<string[]>([]);
  const [selStages,        setSelStages]        = useState<string[]>([]);
  const [selLinks,         setSelLinks]         = useState<string[]>([]);
  const [selForms,         setSelForms]         = useState<string[]>([]);
  const [daysAfterWedding, setDaysAfterWedding] = useState(3);

  const [selected, setSelected] = useState<SelectedItem>(null);

  // ── Infinite canvas state ──────────────────────────────────────────────────
  const [zoom, setZoom]         = useState(1);
  const [pan,  setPan]          = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const zoomRef                 = useRef(1);
  const panRef                  = useRef({ x: 0, y: 0 });
  const panningRef              = useRef(false);
  const panStartRef             = useRef({ clientX: 0, clientY: 0, px: 0, py: 0 });
  const canvasContainerRef      = useRef<HTMLDivElement>(null);
  const containerInitialized    = useRef(false);

  // sync refs
  zoomRef.current = zoom;
  panRef.current  = pan;

  // ── DnD ───────────────────────────────────────────────────────────────────
  const [activePaletteType, setActivePaletteType] = useState<StepKind | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const pointerYRef = useRef(0);

  // ── Step picker + enrollment + test email ────────────────────────────────
  const [pickerIdx, setPickerIdx]           = useState<number | null>(null);
  const [enrollCounts, setEnrollCounts]     = useState<Record<number, number>>({});
  const [enrollModal, setEnrollModal]       = useState<{ stepIndex: number } | null>(null);
  const [enrollList, setEnrollList]         = useState<EnrollContact[]>([]);
  const [enrollLoading, setEnrollLoading]   = useState(false);
  const [selEnroll, setSelEnroll]           = useState<Set<string>>(new Set());
  const [advancing, setAdvancing]           = useState(false);
  const [testStepOrder, setTestStepOrder]   = useState<number | null>(null);
  const [testEmail, setTestEmail]           = useState('');
  const [testSending, setTestSending]       = useState(false);
  const [testResult, setTestResult]         = useState<string | null>(null);
  // SMS-specific state
  const [testSmsPhone, setTestSmsPhone]     = useState('');
  const [testSmsSending, setTestSmsSending] = useState(false);
  const [testSmsResult, setTestSmsResult]   = useState<string | null>(null);
  const [smsMediaPickerOpen, setSmsMediaPickerOpen] = useState(false);
  const [mergeTagOpen, setMergeTagOpen]     = useState(false);
  const [triggerLinkOpen, setTriggerLinkOpen] = useState(false);
  const smsTextareaRef                      = useRef<HTMLTextAreaElement>(null);

  // ── dnd sensors ───────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(SmartPointerSensor, { activationConstraint: { distance: 6 } }));

  // Zoom modifier for dnd-kit — compensates for CSS zoom on the canvas
  const compensateForZoom: Modifier = useCallback(({ transform }) => ({
    ...transform,
    x: transform.x / zoomRef.current,
    y: transform.y / zoomRef.current,
  }), []);

  // ── Track pointer Y for drop position ─────────────────────────────────────
  useEffect(() => {
    const mv = (e: PointerEvent) => { pointerYRef.current = e.clientY; };
    window.addEventListener('pointermove', mv, { passive: true });
    return () => window.removeEventListener('pointermove', mv);
  }, []);

  // ── Close merge-tag / trigger-link dropdowns on outside click ─────────────
  useEffect(() => {
    if (!mergeTagOpen && !triggerLinkOpen) return;
    const handler = () => { setMergeTagOpen(false); setTriggerLinkOpen(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [mergeTagOpen, triggerLinkOpen]);

  // ── Center canvas on first mount ───────────────────────────────────────────
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el || containerInitialized.current) return;
    containerInitialized.current = true;
    const rect = el.getBoundingClientRect();
    const initPan = { x: rect.width / 2 - CARD_W / 2, y: 60 };
    panRef.current = initPan;
    setPan(initPan);
  }, []); // intentionally empty — fires once after mount

  // ── Zoom at cursor ─────────────────────────────────────────────────────────
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const z = zoomRef.current;
    const p = panRef.current;
    const newZoom = Math.max(0.2, Math.min(3, z * factor));
    const newPan = {
      x: mx - (mx - p.x) * (newZoom / z),
      y: my - (my - p.y) * (newZoom / z),
    };
    zoomRef.current = newZoom;
    panRef.current  = newPan;
    setZoom(newZoom);
    setPan(newPan);
  }, []);

  // ── Wheel: pinch = zoom; scroll = pan ────────────────────────────────────
  // Browsers handle pinch gestures very differently:
  //   - Mac Chrome/Edge: pinch trackpad → wheel event with ctrlKey:true
  //   - Mac Safari:      pinch trackpad → gesturestart/change/end events
  //                      (NOT wheel events — that's why pinch was broken in Safari)
  //   - Mouse + Ctrl:    wheel event with ctrlKey:true (treated as pinch)
  //   - Two-finger scroll on trackpad: wheel event with ctrlKey:false → pan
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // Pinch-to-zoom (Mac trackpad on Chrome/Edge) or Ctrl+scroll (mouse).
        // Use exponential decay so the zoom feels smooth & symmetric across
        // browsers, regardless of how big each individual deltaY is.
        // negative deltaY = spread fingers = zoom in (factor > 1)
        // positive deltaY = pinch fingers  = zoom out (factor < 1)
        const factor = Math.exp(-e.deltaY * 0.01);
        zoomAt(e.clientX, e.clientY, factor);
      } else {
        // Two-finger scroll → pan. deltaX/deltaY are in CSS pixels on Mac.
        const newPan = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY };
        panRef.current = newPan;
        setPan(newPan);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ── Safari pinch-to-zoom (gesture* events) ───────────────────────────────
  // Safari uses non-standard gesture events for trackpad pinch.
  // e.scale is the cumulative scale factor since gesturestart (1.0 = no change).
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    let lastScale = 1;
    let gx = 0, gy = 0;

    type GestureEvt = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      const ge = e as GestureEvt;
      e.preventDefault();
      lastScale = 1;
      gx = ge.clientX;
      gy = ge.clientY;
    };
    const onGestureChange = (e: Event) => {
      const ge = e as GestureEvt;
      e.preventDefault();
      const factor = ge.scale / lastScale;
      lastScale = ge.scale;
      // Use the latest pointer coords if Safari supplies them; otherwise reuse start point.
      const x = Number.isFinite(ge.clientX) ? ge.clientX : gx;
      const y = Number.isFinite(ge.clientY) ? ge.clientY : gy;
      zoomAt(x, y, factor);
    };
    const onGestureEnd = (e: Event) => { e.preventDefault(); lastScale = 1; };

    // These are non-standard events, but TS doesn't know about them
    el.addEventListener('gesturestart',  onGestureStart  as EventListener, { passive: false });
    el.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
    el.addEventListener('gestureend',    onGestureEnd    as EventListener, { passive: false });
    return () => {
      el.removeEventListener('gesturestart',  onGestureStart  as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend',    onGestureEnd    as EventListener);
    };
  }, [zoomAt]);

  // ── Global mousemove / mouseup for pan dragging ───────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panningRef.current) return;
      const newPan = {
        x: panStartRef.current.px + (e.clientX - panStartRef.current.clientX),
        y: panStartRef.current.py + (e.clientY - panStartRef.current.clientY),
      };
      panRef.current = newPan;
      setPan(newPan);
    };
    const onUp = () => {
      if (!panningRef.current) return;
      panningRef.current = false;
      setIsPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── Background mousedown → start pan + deselect ───────────────────────────
  function onBgMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement) !== e.currentTarget) return;
    setSelected(null);
    panningRef.current = true;
    setIsPanning(true);
    panStartRef.current = {
      clientX: e.clientX, clientY: e.clientY,
      px: panRef.current.x, py: panRef.current.y,
    };
  }

  // ── Double-click on background → zoom in ─────────────────────────────────
  function onBgDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement) !== e.currentTarget) return;
    zoomAt(e.clientX, e.clientY, 1.5);
  }

  function resetView() {
    const el = canvasContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const resetPan = { x: rect.width / 2 - CARD_W / 2, y: 60 };
    panRef.current = resetPan;
    zoomRef.current = 1;
    setPan(resetPan);
    setZoom(1);
  }

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [aRes, tagRes, pipeRes, linkRes, formsRes, tmplRes] = await Promise.all([
      fetch(`/api/marketing/automations/${id}`,  { cache: 'no-store' }),
      fetch('/api/marketing/tags',               { cache: 'no-store' }),
      fetch('/api/pipelines',                    { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links',      { cache: 'no-store' }),
      fetch('/api/marketing/forms',              { cache: 'no-store' }),
      fetch('/api/marketing/email-templates',    { cache: 'no-store' }),
    ]);
    if (aRes.ok) {
      const j = await aRes.json();
      const a = j.automation as AutomationRow;
      setAuto(a);
      const cfg = (a.trigger_config || {}) as {
        tag_ids?: string[]; to_stage_ids?: string[];
        trigger_link_ids?: string[]; form_ids?: string[];
        days_after_wedding?: number;
      };
      setSelTags(cfg.tag_ids ?? []);
      setSelStages(cfg.to_stage_ids ?? []);
      setSelLinks(cfg.trigger_link_ids ?? []);
      setSelForms(cfg.form_ids ?? []);
      setDaysAfterWedding(Math.max(0, Math.min(3650, Number(cfg.days_after_wedding ?? 3) || 0)));
      const rawSteps = (j.steps ?? []) as Array<{ step_type: string; config_json: Record<string, unknown> }>;
      setSteps(rawSteps.map((s, i) => {
        const localId = `s-${i}-${Math.random().toString(36).slice(2)}`;
        if (s.step_type === 'delay')
          return { localId, step_type: 'delay', delay_minutes: Number((s.config_json as { delay_minutes?: number }).delay_minutes ?? 60) };
        if (s.step_type === 'send_sms') {
          const sc = s.config_json as { body?: string; media_urls?: string[] };
          return { localId, step_type: 'send_sms', body: String(sc.body ?? DEFAULT_SMS), media_urls: sc.media_urls ?? [] };
        }
        return { localId, step_type: 'send_email', template_id: String((s.config_json as { template_id?: string }).template_id ?? '') };
      }));
    }
    if (tagRes.ok)   { const d = await tagRes.json();  setTags(d.tags ?? []); }
    if (pipeRes.ok)  {
      const d = await pipeRes.json();
      const flat: StageOpt[] = [];
      for (const p of d.pipelines ?? []) for (const s of p.stages ?? []) flat.push({ id: s.id, name: s.name, pipelineName: p.name });
      setStages(flat);
    }
    if (linkRes.ok)  { const d = await linkRes.json();  setLinks(d.links ?? []); }
    if (formsRes.ok) { const d = await formsRes.json(); setForms(d.forms ?? []); }
    if (tmplRes.ok)  { const d = await tmplRes.json();  setTemplates(d.templates ?? []); }
    setLoading(false);
  }, [id]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const refreshCounts = useCallback(async () => {
    const res = await fetch(`/api/marketing/automations/${id}/enrollments`, { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); setEnrollCounts(d.counts ?? {}); }
  }, [id]);

  useEffect(() => { if (!loading) void refreshCounts(); }, [loading, refreshCounts]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function toggle(arr: string[], v: string, set: (x: string[]) => void) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  function changeTriggerType(newType: AutomationTriggerType) {
    if (!auto) return;
    setAuto({ ...auto, trigger_type: newType });
    setSelTags([]); setSelStages([]); setSelLinks([]); setSelForms([]); setDaysAfterWedding(3);
  }

  function buildTriggerConfig(): Record<string, unknown> {
    if (!auto) return {};
    if (auto.trigger_type === 'tag_added')             return { tag_ids: selTags };
    if (auto.trigger_type === 'stage_changed')         return { to_stage_ids: selStages };
    if (auto.trigger_type === 'wedding_date_followup') return { days_after_wedding: Math.max(0, Math.min(3650, Math.floor(daysAfterWedding))) };
    if (auto.trigger_type === 'proposal_paid')         return {};
    if (auto.trigger_type === 'form_submitted')        return { form_ids: selForms };
    return { trigger_link_ids: selLinks };
  }

  async function saveAll() {
    if (!auto) return;
    setSaving(true); setSaveStatus('saving'); setErr(null);
    const res = await fetch(`/api/marketing/automations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: auto.name,
        status: auto.status,
        triggerType: auto.trigger_type,
        triggerConfig: buildTriggerConfig(),
        steps: steps.map((s, i) => {
          if (s.step_type === 'delay')
            return { step_order: i, step_type: 'delay' as const, config: { delay_minutes: Math.max(1, Math.min(10080, s.delay_minutes)) } };
          if (s.step_type === 'send_sms')
            return { step_order: i, step_type: 'send_sms' as const, config: { body: s.body.trim(), media_urls: s.media_urls ?? [] } };
          return { step_order: i, step_type: 'send_email' as const, config: { template_id: s.template_id } };
        }),
      }),
    });
    setSaving(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr((j as { error?: string }).error || 'Save failed'); setSaveStatus('error'); return; }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
    void load(); void refreshCounts();
  }

  async function removeAutomation() {
    if (!window.confirm('Delete this workflow? This cannot be undone.')) return;
    const res = await fetch(`/api/marketing/automations/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/dashboard/marketing/workflows');
    else setErr('Delete failed');
  }

  function addStepAt(kind: StepKind, insertIdx: number) {
    const localId = `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const step: LocalStep =
      kind === 'delay'      ? { localId, step_type: 'delay',      delay_minutes: 60 }
      : kind === 'send_sms' ? { localId, step_type: 'send_sms',   body: DEFAULT_SMS }
      :                       { localId, step_type: 'send_email', template_id: templates[0]?.id ?? '' };
    setSteps((prev) => { const c = [...prev]; c.splice(insertIdx, 0, step); return c; });
    setSelected({ kind: 'step', localId });
  }

  function removeStep(localId: string) {
    setSteps((prev) => prev.filter((s) => s.localId !== localId));
    setSelected(null);
  }

  function moveStep(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= steps.length) return;
    setSteps((prev) => {
      const c = [...prev];
      [c[index], c[j]] = [c[j]!, c[index]!];
      return c;
    });
  }

  // ── DnD handlers ──────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    const aid = String(event.active.id);
    if (aid.startsWith('new:')) setActivePaletteType(aid.replace('new:', '') as StepKind);
    else setActivePaletteType(null);
    setDropTarget(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const aid = String(event.active.id);
    if (!aid.startsWith('new:') || !event.over) { setDropTarget(null); return; }
    const overId = String(event.over.id);
    const rect   = event.over.rect;
    const pos: 'before' | 'after' = pointerYRef.current >= rect.top + rect.height / 2 ? 'after' : 'before';
    setDropTarget((prev) => prev?.id === overId && prev.pos === pos ? prev : { id: overId, pos });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const target = dropTarget;
    setActivePaletteType(null); setDropTarget(null);
    const aid = String(active.id);
    if (aid.startsWith('new:')) {
      const kind = aid.replace('new:', '') as StepKind;
      if (over && target) {
        const overIdx = steps.findIndex((s) => s.localId === target.id);
        addStepAt(kind, overIdx >= 0 ? (target.pos === 'after' ? overIdx + 1 : overIdx) : steps.length);
      } else { addStepAt(kind, steps.length); }
      return;
    }
    if (over && active.id !== over.id) {
      const oldIdx = steps.findIndex((s) => s.localId === active.id);
      const newIdx = steps.findIndex((s) => s.localId === over.id);
      if (oldIdx !== -1 && newIdx !== -1) setSteps((prev) => arrayMove(prev, oldIdx, newIdx));
    }
  }

  // ── Enrollment modal ───────────────────────────────────────────────────────
  async function openEnrollModal(stepIndex: number) {
    setEnrollModal({ stepIndex }); setSelEnroll(new Set()); setEnrollLoading(true);
    const res = await fetch(`/api/marketing/automations/${id}/enrollments?stepIndex=${stepIndex}`, { cache: 'no-store' });
    setEnrollList(res.ok ? (await res.json()).list ?? [] : []);
    setEnrollLoading(false);
  }

  async function advanceSelected() {
    const ids = Array.from(selEnroll);
    if (!ids.length) return;
    setAdvancing(true);
    const res = await fetch(`/api/marketing/automations/${id}/enrollments/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentIds: ids }),
    });
    setAdvancing(false);
    if (res.ok) { setEnrollModal(null); void refreshCounts(); }
  }

  // ── Test email ─────────────────────────────────────────────────────────────
  async function sendTestEmail(stepOrder: number) {
    if (!testEmail.trim()) { setTestResult('Enter an email address first.'); return; }
    setTestSending(true); setTestResult(null);
    const res = await fetch(`/api/marketing/automations/${id}/test-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepOrder, toEmail: testEmail.trim() }),
    });
    setTestSending(false);
    const j = await res.json().catch(() => ({}));
    setTestResult(res.ok ? '✓ Sent! Check your inbox.' : `Error: ${(j as { error?: string }).error ?? 'Send failed'}`);
  }

  // ── Test SMS ───────────────────────────────────────────────────────────────
  async function sendTestSms(stepOrder: number, smsBody: string, mediaUrls: string[]) {
    if (!testSmsPhone.trim()) { setTestSmsResult('Enter a phone number first.'); return; }
    setTestSmsSending(true); setTestSmsResult(null);
    const res = await fetch(`/api/marketing/automations/${id}/test-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepOrder, toPhone: testSmsPhone.trim(), body: smsBody, mediaUrls }),
    });
    setTestSmsSending(false);
    const j = await res.json().catch(() => ({}));
    setTestSmsResult(res.ok ? '✓ SMS sent!' : `Error: ${(j as { error?: string }).error ?? 'Send failed'}`);
  }

  // ── Merge tag / trigger link insert ───────────────────────────────────────
  function insertAtCursor(text: string, lid: string) {
    const ta = smsTextareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const newVal = ta.value.slice(0, start) + text + ta.value.slice(end);
    setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'send_sms' ? { ...x, body: newVal } : x));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    });
  }

  // ── Render guards ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }
  if (!auto) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-gray-600">Workflow not found.</p>
        <Link href="/dashboard/marketing/workflows" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Back to Workflows</Link>
      </div>
    );
  }

  const trig = TRIGGER_OPTIONS.find((t) => t.value === auto.trigger_type) ?? TRIGGER_OPTIONS[0]!;
  const TriggerIcon = trig.Icon;
  const selectedStep = selected?.kind === 'step' ? steps.find((s) => s.localId === selected.localId) ?? null : null;

  const trigSubtitle = triggerDesc(auto.trigger_type, { selForms, selTags, selStages, selLinks, daysAfterWedding });


  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white" style={{ minHeight: '100vh' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center bg-white px-6 py-3"
        style={{
          position: 'fixed', top: 0,
          left: 'var(--sidebar-w, 216px)', right: 0, zIndex: 20,
          boxShadow: '0 1px 18px rgba(0,0,0,0.05)',
          transition: 'left 200ms ease-out',
        }}
      >
        <div className="flex items-center flex-shrink-0 w-48">
          <Link href="/dashboard/marketing/workflows"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} /><span>Back</span>
          </Link>
        </div>

        <div
          className="hidden sm:flex items-center gap-2 text-[11px] tracking-widest font-medium uppercase"
          style={{ position: 'absolute', left: 'calc(50% - 144px)', transform: 'translateX(-50%)' }}
        >
          <span className="text-gray-700 border-b border-gray-700 pb-0.5">Design Workflow</span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
          <input
            className="hidden md:block w-52 border-0 bg-transparent text-sm font-semibold text-gray-800 placeholder:text-gray-300 focus:outline-none text-right"
            value={auto.name}
            onChange={(e) => setAuto({ ...auto, name: e.target.value })}
            aria-label="Workflow name"
          />
          <select
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-gray-400 focus:outline-none"
            value={auto.status}
            onChange={(e) => setAuto({ ...auto, status: e.target.value as AutomationRow['status'] })}
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
          <div className="flex items-center gap-1 min-w-[50px] justify-end">
            {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin text-gray-300" />}
            {saveStatus === 'saved'  && <span className="text-[11px] text-gray-300">Saved</span>}
            {saveStatus === 'error'  && <span className="text-[11px] text-red-400">Error</span>}
          </div>
          <button type="button" disabled={saving} onClick={() => void saveAll()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </header>

      {err && (
        <div className="fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 shadow">
          {err}
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[compensateForZoom]}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setActivePaletteType(null); setDropTarget(null); }}
      >
        <div
          style={{
            position: 'fixed', top: 52,
            left: 'var(--sidebar-w, 216px)', right: 0, bottom: 0,
            display: 'flex', overflow: 'hidden',
          }}
        >

          {/* ── Infinite canvas ───────────────────────────────────────────── */}
          <div
            ref={canvasContainerRef}
            style={{
              flex: 1, position: 'relative', overflow: 'hidden',
              cursor: isPanning ? 'grabbing' : 'grab',
              background: '#f4f4f5',
              // Prevent the browser from doing its own page-zoom on pinch —
              // we handle pinch ourselves via wheel/gesture events.
              touchAction: 'none',
              overscrollBehavior: 'contain',
            }}
            onMouseDown={onBgMouseDown}
            onDoubleClick={onBgDoubleClick}
          >
            {/* ── Zoom pill — left side, vertically centered ──────────────── */}
            <div
              data-no-dnd
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md"
              style={{ width: 44 }}
            >
              {/* Zoom in */}
              <button
                type="button"
                title="Zoom in"
                onClick={() => {
                  const el = canvasContainerRef.current;
                  if (!el) return;
                  const r = el.getBoundingClientRect();
                  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25);
                }}
                className="flex h-11 w-full items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                <Plus size={18} strokeWidth={1.75} />
              </button>

              {/* Divider */}
              <div className="w-full border-t border-gray-200" />

              {/* Zoom % */}
              <button
                type="button"
                title="Reset zoom"
                onClick={resetView}
                className="flex h-10 w-full items-center justify-center text-[11px] font-semibold tabular-nums text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors select-none"
              >
                {Math.round(zoom * 100)}%
              </button>

              {/* Divider */}
              <div className="w-full border-t border-gray-200" />

              {/* Zoom out */}
              <button
                type="button"
                title="Zoom out"
                onClick={() => {
                  const el = canvasContainerRef.current;
                  if (!el) return;
                  const r = el.getBoundingClientRect();
                  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
                }}
                className="flex h-11 w-full items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                <Minus size={18} strokeWidth={1.75} />
              </button>
            </div>

            {/* Transform layer — all canvas content */}
            <div
              style={{
                position: 'absolute',
                top: 0, left: 0,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                cursor: 'default',
              }}
              onMouseDown={(e) => e.stopPropagation()} // cards don't trigger pan
            >
              {/* Centered column */}
              <div style={{ width: CARD_W, paddingBottom: 200 }}>

                {/* Trigger card */}
                <div
                  className="relative group/block"
                  onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'trigger' }); }}
                  style={{ cursor: 'pointer' }}
                >
                  <div
                    className="overflow-hidden rounded-xl border bg-white"
                    style={{
                      transition: 'outline 0.1s ease, box-shadow 0.2s ease',
                      outline: selected?.kind === 'trigger' ? '1px solid #3b82f6' : '1px solid transparent',
                      outlineOffset: '-1px',
                      boxShadow: selected?.kind === 'trigger' ? '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)' : 'none',
                      borderColor: selected?.kind === 'trigger' ? 'transparent' : '#e5e7eb',
                    }}
                    onMouseEnter={(e) => {
                      if (selected?.kind !== 'trigger') {
                        (e.currentTarget as HTMLDivElement).style.outline = '1px solid #3b82f6';
                        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selected?.kind !== 'trigger') {
                        (e.currentTarget as HTMLDivElement).style.outline = '1px solid transparent';
                        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                      }
                    }}
                  >
                    <div className="flex items-start gap-3 p-4">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                        <TriggerIcon size={16} className="text-gray-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Trigger</p>
                        <p className="mt-0.5 text-sm font-semibold text-gray-900">{trig.label}</p>
                        <p className="mt-0.5 truncate text-[11px] text-gray-500">{trigSubtitle}</p>
                      </div>
                    </div>
                  </div>

                  {/* Side toolbar when selected */}
                  {selected?.kind === 'trigger' && (
                    <div className="absolute -right-11 top-1/2 -translate-y-1/2 z-10" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col items-center gap-1 bg-white rounded-2xl shadow-lg border border-gray-100 px-1.5 py-2">
                        <button type="button" title="Delete workflow" onClick={() => void removeAutomation()}
                          className="flex h-7 w-7 items-center justify-center rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                        ><Trash2 size={14} /></button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Step list */}
                <SortableContext items={steps.map((s) => s.localId)} strategy={verticalListSortingStrategy}>
                  {steps.length === 0 && activePaletteType === null ? (
                    <>
                      <AddStepBtn onClick={() => setPickerIdx(0)} />
                      <div className="rounded-xl border border-dashed border-gray-200 bg-white/80 px-4 py-8 text-center">
                        <p className="text-sm font-medium text-gray-600">No steps yet</p>
                        <p className="mt-1 text-xs text-gray-400">Drag a block from the right panel or use + above.</p>
                      </div>
                    </>
                  ) : steps.map((s, idx) => {
                    const meta = stepMeta(s, templates);
                    const StepIcon = meta.Icon;
                    const isSelected = selected?.kind === 'step' && selected.localId === s.localId;
                    const isDropTarget = dropTarget?.id === s.localId && activePaletteType !== null;
                    const enrollCount = enrollCounts[idx] ?? 0;

                    return (
                      <SortableStep key={s.localId} id={s.localId}>
                        {(isDragging) => (
                          <div>
                            {isDropTarget && dropTarget?.pos === 'before' && (
                              <DropIndicator label={PALETTE.find((p) => p.type === activePaletteType)?.label ?? ''} />
                            )}

                            <AddStepBtn onClick={() => setPickerIdx(idx)} />

                            <div
                              className="relative group/block"
                              style={{ cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); if (!isDragging) setSelected({ kind: 'step', localId: s.localId }); }}
                            >
                              <div
                                className="overflow-hidden rounded-xl border bg-white"
                                style={{
                                  transition: 'outline 0.1s ease, box-shadow 0.2s ease',
                                  outline: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                  outlineOffset: '-1px',
                                  boxShadow: isSelected ? '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)' : 'none',
                                  borderColor: isSelected ? 'transparent' : '#e5e7eb',
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
                                <div className="flex items-start gap-3 p-4">
                                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                                    <StepIcon size={16} className="text-gray-700" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Step {idx + 1}</p>
                                    <p className="mt-0.5 text-sm font-semibold text-gray-900">{meta.title}</p>
                                    <p className="mt-0.5 truncate text-[11px] text-gray-500">{meta.subtitle}</p>
                                  </div>
                                </div>
                              </div>

                              {/* Enrollment pill */}
                              <EnrollPill count={enrollCount} onClick={() => void openEnrollModal(idx)} />

                              {/* Side toolbar when selected */}
                              <div
                                className={`absolute -right-11 top-1/2 -translate-y-1/2 z-10 transition-opacity duration-150 ${isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex flex-col items-center gap-1 bg-white rounded-2xl shadow-lg border border-gray-100 px-1.5 py-2">
                                  <button type="button" title="Move up" disabled={idx === 0}
                                    onClick={() => moveStep(idx, -1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all disabled:opacity-25"
                                  ><ChevronUp size={14} /></button>
                                  <button type="button" title="Move down" disabled={idx === steps.length - 1}
                                    onClick={() => moveStep(idx, 1)}
                                    className="flex h-7 w-7 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all disabled:opacity-25"
                                  ><ChevronDown size={14} /></button>
                                  <div className="w-4 h-px bg-gray-100 my-0.5" />
                                  <button type="button" title="Remove step" onClick={() => removeStep(s.localId)}
                                    className="flex h-7 w-7 items-center justify-center rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                                  ><Trash2 size={14} /></button>
                                </div>
                              </div>
                            </div>

                            {isDropTarget && dropTarget?.pos === 'after' && (
                              <DropIndicator label={PALETTE.find((p) => p.type === activePaletteType)?.label ?? ''} />
                            )}

                            {idx === steps.length - 1 && (
                              <AddStepBtn onClick={() => setPickerIdx(steps.length)} />
                            )}
                          </div>
                        )}
                      </SortableStep>
                    );
                  })}
                </SortableContext>

                {/* Drop at end indicator */}
                {activePaletteType !== null && dropTarget === null && steps.length > 0 && (
                  <div className="pointer-events-none py-1">
                    <div style={{ borderTop: '2px solid #3b82f6' }}>
                      <span className="text-[10px] font-semibold text-white rounded px-1.5 py-0.5" style={{ background: '#3b82f6', lineHeight: 1.4 }}>
                        {PALETTE.find((p) => p.type === activePaletteType)?.label} — drop to add at end
                      </span>
                    </div>
                  </div>
                )}

                {/* End cap */}
                <AddStepBtn onClick={() => setPickerIdx(steps.length)} />
                <div className="rounded-xl border border-gray-100 bg-white/80 px-4 py-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">End of workflow</p>
                </div>

              </div>
            </div>
          </div>

          {/* ── Right panel ───────────────────────────────────────────────── */}
          <aside
            className="w-72 flex-shrink-0 bg-white flex flex-col overflow-hidden"
            style={{ boxShadow: '-12px 0 32px -8px rgba(0,0,0,0.07)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="fb-scroll-pane flex-1 overflow-y-auto"
              style={{ overscrollBehavior: 'contain', scrollbarWidth: 'none', msOverflowStyle: 'none', minHeight: 0 } as React.CSSProperties}
            >

              {/* ── Trigger inspector ──────────────────────────────────── */}
              {selected?.kind === 'trigger' ? (
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">Trigger</span>
                    <button type="button" onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">Done</button>
                  </div>

                  {/* Trigger type picker */}
                  <div className="mb-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Trigger type</p>
                    <select
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                      value={auto.trigger_type}
                      onChange={(e) => changeTriggerType(e.target.value as AutomationTriggerType)}
                    >
                      {TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  {auto.trigger_type === 'form_submitted' && (
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Forms</p>
                      {forms.length === 0 ? (
                        <p className="text-[11px] text-gray-500">No forms yet. <Link href="/dashboard/marketing/form-builder" className="text-brand-600 hover:underline">Create one →</Link></p>
                      ) : (
                        <div className="max-h-52 space-y-1.5 overflow-y-auto text-xs">
                          {forms.map((f) => (
                            <label key={f.id} className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={selForms.includes(f.id)} onChange={() => toggle(selForms, f.id, setSelForms)} />
                              <span className="truncate">{f.name}</span>
                              {!f.published && <span className="text-gray-400">(draft)</span>}
                            </label>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-gray-400">Empty = enroll on any form.</p>
                    </div>
                  )}

                  {auto.trigger_type === 'tag_added' && (
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((t) => (
                          <label key={t.id} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs cursor-pointer hover:border-gray-300">
                            <input type="checkbox" checked={selTags.includes(t.id)} onChange={() => toggle(selTags, t.id, setSelTags)} />
                            {t.name}
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-gray-400">Empty = fire on any tag added.</p>
                    </div>
                  )}

                  {auto.trigger_type === 'stage_changed' && (
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Stages</p>
                      <div className="max-h-52 space-y-1.5 overflow-y-auto text-xs">
                        {stages.map((s) => (
                          <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={selStages.includes(s.id)} onChange={() => toggle(selStages, s.id, setSelStages)} />
                            <span className="text-gray-400">{s.pipelineName}:</span> {s.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {auto.trigger_type === 'trigger_link_click' && (
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Trigger links</p>
                      <div className="max-h-52 space-y-1.5 overflow-y-auto text-xs">
                        {links.map((l) => (
                          <label key={l.id} className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={selLinks.includes(l.id)} onChange={() => toggle(selLinks, l.id, setSelLinks)} />
                            <span className="truncate">{l.name}</span>
                            <span className="text-gray-400">({l.short_code})</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {auto.trigger_type === 'wedding_date_followup' && (
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Days after wedding</p>
                      <input type="number" min={0} max={3650}
                        className="w-28 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                        value={daysAfterWedding}
                        onChange={(e) => setDaysAfterWedding(Number(e.target.value) || 0)}
                      />
                    </div>
                  )}

                  {auto.trigger_type === 'proposal_paid' && (
                    <p className="mb-4 text-xs text-gray-500">Enrolls when a proposal is marked paid — lead matched by email.</p>
                  )}

                  <div className="mt-6 border-t border-gray-100 pt-4">
                    <button type="button" onClick={() => void removeAutomation()}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={12} /> Delete workflow
                    </button>
                  </div>
                </div>

              ) : selectedStep ? (
                /* ── Step inspector ──────────────────────────────────────── */
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                      {selectedStep.step_type === 'send_email' ? 'send email'
                        : selectedStep.step_type === 'send_sms' ? 'send sms'
                        : 'wait'}
                    </span>
                    <button type="button" onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">Done</button>
                  </div>

                  {/* ── Wait step ─────────────────────────────────────── */}
                  {selectedStep.step_type === 'delay' && (() => {
                    const { value, unit } = minutesToDisplay(selectedStep.delay_minutes);
                    const lid = selectedStep.localId;
                    const updateMinutes = (v: number, u: WaitUnit) => {
                      setSteps((prev) => prev.map((x) =>
                        x.localId === lid && x.step_type === 'delay' ? { ...x, delay_minutes: displayToMinutes(v, u) } : x
                      ));
                    };
                    return (
                      <div>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Wait for</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min={1}
                            className="w-20 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                            value={value}
                            onChange={(e) => updateMinutes(Number(e.target.value) || 1, unit)}
                          />
                          <select
                            className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                            value={unit}
                            onChange={(e) => updateMinutes(value, e.target.value as WaitUnit)}
                          >
                            <option value="minutes">minutes</option>
                            <option value="hours">hours</option>
                            <option value="days">days</option>
                          </select>
                        </div>
                        <p className="mt-2 text-[11px] text-gray-400">
                          = {selectedStep.delay_minutes} minute{selectedStep.delay_minutes === 1 ? '' : 's'} total
                        </p>
                        {/* Quick presets */}
                        <p className="mt-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Presets</p>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { label: '15m', v: 15,   u: 'minutes' as WaitUnit },
                            { label: '1h',  v: 1,    u: 'hours'   as WaitUnit },
                            { label: '1d',  v: 1,    u: 'days'    as WaitUnit },
                            { label: '2d',  v: 2,    u: 'days'    as WaitUnit },
                            { label: '3d',  v: 3,    u: 'days'    as WaitUnit },
                            { label: '7d',  v: 7,    u: 'days'    as WaitUnit },
                            { label: '14d', v: 14,   u: 'days'    as WaitUnit },
                          ].map((p) => (
                            <button key={p.label} type="button"
                              className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:border-gray-400 transition-colors"
                              onClick={() => updateMinutes(p.v, p.u)}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Send Email step ───────────────────────────────── */}
                  {selectedStep.step_type === 'send_email' && (() => {
                    const stepOrder = steps.findIndex((s) => s.localId === selectedStep.localId);
                    return (
                      <div>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Template</p>
                        {templates.length === 0 ? (
                          <p className="text-[11px] text-gray-500">No templates. <Link href="/dashboard/marketing/email/templates" className="text-brand-600 hover:underline">Create one →</Link></p>
                        ) : (
                          <select
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                            value={selectedStep.template_id}
                            onChange={(e) => {
                              const v = e.target.value; const lid = selectedStep.localId;
                              setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'send_email' ? { ...x, template_id: v } : x));
                            }}
                          >
                            <option value="">Choose a template</option>
                            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )}
                        <p className="mt-2 text-[11px] text-gray-400">Unsubscribe and bounce suppression applied automatically.</p>

                        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Send test</p>
                          <input type="email" placeholder="your@email.com"
                            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
                            value={testStepOrder === stepOrder ? testEmail : ''}
                            onChange={(e) => { setTestEmail(e.target.value); setTestStepOrder(stepOrder); setTestResult(null); }}
                          />
                          <button type="button" disabled={testSending}
                            onClick={() => { setTestStepOrder(stepOrder); void sendTestEmail(stepOrder); }}
                            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                          >
                            {testSending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                            {testSending ? 'Sending…' : 'Send test email'}
                          </button>
                          {testResult && testStepOrder === stepOrder && (
                            <p className={`mt-1.5 text-[11px] ${testResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>{testResult}</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── SMS step ─────────────────────────────────────── */}
                  {selectedStep.step_type === 'send_sms' && (() => {
                    const lid = selectedStep.localId;
                    const stepOrder = steps.findIndex((s) => s.localId === lid);
                    const smsBody = selectedStep.body;
                    const mediaUrls = selectedStep.media_urls ?? [];
                    // Character / segment count
                    const charCount = smsBody.length;
                    const segCount = charCount === 0 ? 0 : Math.ceil(charCount / 160);
                    return (
                      <div data-no-dnd>
                        {/* ── Message label + toolbar ───────────────── */}
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Message</p>
                          <div className="flex items-center gap-1">
                            {/* Merge tags button */}
                            <div className="relative">
                              <button
                                type="button"
                                title="Insert merge tag"
                                onClick={() => { setMergeTagOpen((v) => !v); setTriggerLinkOpen(false); }}
                                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 transition-colors"
                              >
                                <Tag size={11} /> Tags
                              </button>
                              {mergeTagOpen && (
                                <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-gray-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
                                  <p className="border-b border-gray-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Merge Tags</p>
                                  {[
                                    { label: 'First name', code: '{{first_name}}' },
                                    { label: 'Last name',  code: '{{last_name}}'  },
                                    { label: 'Venue name', code: '{{venue_name}}' },
                                    { label: 'Wedding date', code: '{{wedding_date}}' },
                                    { label: 'Unsubscribe URL', code: '{{unsubscribe_url}}' },
                                  ].map(({ label, code }) => (
                                    <button key={code} type="button"
                                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                                      onClick={() => { insertAtCursor(code, lid); setMergeTagOpen(false); }}
                                    >
                                      <span className="text-[12px] font-medium text-gray-800">{label}</span>
                                      <span className="font-mono text-[10px] text-gray-400">{code}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* Trigger links button */}
                            <div className="relative">
                              <button
                                type="button"
                                title="Insert trigger link"
                                onClick={() => { setTriggerLinkOpen((v) => !v); setMergeTagOpen(false); }}
                                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 transition-colors"
                              >
                                <Zap size={11} /> Links
                              </button>
                              {triggerLinkOpen && (
                                <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-xl border border-gray-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
                                  <p className="border-b border-gray-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Trigger Links</p>
                                  {links.length === 0 ? (
                                    <p className="px-3 py-3 text-[11px] text-gray-400">No trigger links created yet.</p>
                                  ) : links.map((lnk) => (
                                    <button key={lnk.id} type="button"
                                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                                      onClick={() => { insertAtCursor(`{{trigger_link.${lnk.short_code}}}`, lid); setTriggerLinkOpen(false); }}
                                    >
                                      <span className="text-[12px] font-medium text-gray-800">{lnk.name}</span>
                                      <span className="font-mono text-[10px] text-gray-400">{`{{trigger_link.${lnk.short_code}}}`}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* ── Textarea ───────────────────────────────── */}
                        <textarea
                          ref={smsTextareaRef}
                          className="min-h-[110px] w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                          value={smsBody}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'send_sms' ? { ...x, body: v } : x));
                          }}
                        />
                        {/* Character / segment count */}
                        <div className="mt-1 flex items-center justify-end gap-2">
                          <span className="text-[10px] text-gray-400">
                            {charCount} char{charCount !== 1 ? 's' : ''} · {segCount} SMS segment{segCount !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* ── Media attachments (MMS) ────────────────── */}
                        <div className="mt-4">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Attachments <span className="normal-case text-gray-300">(MMS, max 3 images)</span></p>
                          {mediaUrls.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-2">
                              {mediaUrls.map((url) => (
                                <div key={url} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                  <button
                                    type="button"
                                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                    onClick={() => setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'send_sms' ? { ...x, media_urls: (x.media_urls ?? []).filter((u) => u !== url) } : x))}
                                  >
                                    <X size={9} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {mediaUrls.length < 3 && (
                            <button
                              type="button"
                              onClick={() => setSmsMediaPickerOpen(true)}
                              className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500 hover:border-gray-400 hover:bg-gray-100 transition-colors"
                            >
                              <ImageIcon size={12} /> Add image from Media Gallery
                            </button>
                          )}
                        </div>

                        {/* ── Test SMS ───────────────────────────────── */}
                        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Test phone number</p>
                          <input
                            type="tel"
                            placeholder="+1 555 000 0000"
                            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
                            value={testSmsPhone}
                            onChange={(e) => { setTestSmsPhone(e.target.value); setTestSmsResult(null); }}
                          />
                          <p className="mt-1 text-[10px] text-gray-400">* Please add country code (e.g. +1).</p>
                          <button
                            type="button"
                            disabled={testSmsSending}
                            onClick={() => void sendTestSms(stepOrder, smsBody, mediaUrls)}
                            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                          >
                            {testSmsSending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                            {testSmsSending ? 'Sending…' : 'Send Test SMS'}
                          </button>
                          {testSmsResult && (
                            <p className={`mt-1.5 text-[11px] ${testSmsResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>{testSmsResult}</p>
                          )}
                        </div>

                        {/* ── Media picker modal ─────────────────────── */}
                        <VenueMediaPickerModal
                          open={smsMediaPickerOpen}
                          onOpenChange={setSmsMediaPickerOpen}
                          mode="image"
                          title="Add image attachment"
                          onSelect={(url) => {
                            setSteps((prev) => prev.map((x) => {
                              if (x.localId !== lid || x.step_type !== 'send_sms') return x;
                              const existing = x.media_urls ?? [];
                              if (existing.includes(url) || existing.length >= 3) return x;
                              return { ...x, media_urls: [...existing, url] };
                            }));
                            setSmsMediaPickerOpen(false);
                          }}
                        />
                      </div>
                    );
                  })()}

                  <div className="mt-6 border-t border-gray-100 pt-4">
                    <button type="button" onClick={() => removeStep(selectedStep.localId)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={12} /> Remove step
                    </button>
                  </div>
                </div>

              ) : (
                /* ── Blocks palette ──────────────────────────────────── */
                <div className="p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Blocks</p>
                  <p className="mb-4 text-[11px] text-gray-400">Drag a block onto the canvas, or click a block on the canvas to edit it.</p>
                  <div className="flex flex-col gap-2">
                    {PALETTE.map((item) => <PaletteCard key={item.type} {...item} />)}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-white">
              <span className="text-[11px] text-gray-400">
                {steps.length === 0 ? 'No steps' : `${steps.length} step${steps.length === 1 ? '' : 's'}`}
              </span>
              <span className="ml-auto text-sm text-gray-400">
                {saveStatus === 'saving' && 'Saving…'}
                {saveStatus === 'saved'  && 'Saved'}
                {saveStatus === 'error'  && 'Error'}
              </span>
            </div>
          </aside>

        </div>

        {/* DragOverlay ghost */}
        <DragOverlay dropAnimation={null}>
          {activePaletteType ? (() => {
            const p = PALETTE.find((x) => x.type === activePaletteType);
            if (!p) return null;
            return (
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-xl opacity-90 pointer-events-none" style={{ width: CARD_W }}>
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                  <p.Icon size={15} className="text-gray-500" />
                </div>
                <p className="text-sm font-medium text-gray-800">{p.label}</p>
              </div>
            );
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* ── Step picker modal ──────────────────────────────────────────────── */}
      {pickerIdx !== null && (
        <StepPickerModal
          onSelect={(kind) => { addStepAt(kind, pickerIdx); setPickerIdx(null); }}
          onClose={() => setPickerIdx(null)}
        />
      )}

      {/* ── Enrollment modal ───────────────────────────────────────────────── */}
      {enrollModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setEnrollModal(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Contacts at Step {enrollModal.stepIndex + 1}</h3>
                <p className="mt-0.5 text-xs text-gray-500">Select contacts and click "Advance" to process their next step immediately.</p>
              </div>
              <button type="button" onClick={() => setEnrollModal(null)} className="text-gray-400 hover:text-gray-700"><Minus size={18} /></button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {enrollLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin text-gray-400" size={24} /></div>
              ) : enrollList.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">No active contacts at this step.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="w-10 px-4 py-2 text-left">
                        <button type="button"
                          onClick={() => setSelEnroll(selEnroll.size === enrollList.length ? new Set() : new Set(enrollList.map((e) => e.id)))}
                          className="text-gray-400 hover:text-gray-700"
                        >
                          {selEnroll.size === enrollList.length && enrollList.length > 0 ? <CheckSquare size={15} /> : <Square size={15} />}
                        </button>
                      </th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Name</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Email</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollList.map((c) => (
                      <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setSelEnroll((prev) => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}>
                        <td className="px-4 py-2.5">{selEnroll.has(c.id) ? <CheckSquare size={15} className="text-blue-500" /> : <Square size={15} className="text-gray-300" />}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{c.firstName} {c.lastName}</td>
                        <td className="px-4 py-2.5 text-gray-500">{c.email}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{c.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <span className="text-xs text-gray-500">{selEnroll.size > 0 ? `${selEnroll.size} selected` : 'Click a row to select'}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEnrollModal(null)} className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">Close</button>
                <button type="button" disabled={selEnroll.size === 0 || advancing} onClick={() => void advanceSelected()}
                  className="flex items-center gap-1.5 rounded-xl bg-brand-900 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
                >
                  {advancing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {advancing ? 'Advancing…' : 'Advance selected'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
