'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, CalendarHeart, CheckSquare, ChevronDown, ChevronUp,
  ClipboardList, Clock, DollarSign, GitBranch, Link2,
  Loader2, Mail, Minus, Plus, Send, Smartphone, Square,
  Tag, Trash2, Users, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, useDraggable, DragOverlay,
  type DragEndEvent, type DragStartEvent,
  type DragOverEvent, type PointerActivationConstraint,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AutomationTriggerType } from '@/lib/marketing-email-schema';

// ─── Sensor — skip drag when clicking inputs / buttons ───────────────────────
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
        void activationConstraint;
        return true;
      },
    },
  ];
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface AutomationRow {
  id: string;
  name: string;
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

type StepKind = 'delay' | 'send_email' | 'send_sms';
type LocalStep =
  | { localId: string; step_type: 'delay';      delay_minutes: number }
  | { localId: string; step_type: 'send_email'; template_id: string }
  | { localId: string; step_type: 'send_sms';   body: string };

type SelectedItem = { kind: 'trigger' } | { kind: 'step'; localId: string } | null;

// ─── Step palette ─────────────────────────────────────────────────────────────
const PALETTE: { type: StepKind; label: string; desc: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { type: 'delay',      label: 'Wait',       desc: 'Pause for a duration',     Icon: Clock },
  { type: 'send_email', label: 'Send Email', desc: 'Choose a saved template',  Icon: Mail },
  { type: 'send_sms',   label: 'Send SMS',   desc: 'Send a text message',      Icon: Smartphone },
];

// ─── Draggable palette card ───────────────────────────────────────────────────
function PaletteCard({ type, label, desc, Icon }: typeof PALETTE[number]) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `new:${type}`,
    data: { source: 'palette', stepType: type },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
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
function SortableStep({
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

// ─── + Add step button (shows only on hover) ──────────────────────────────────
function AddStepBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="group/addbtn relative flex h-7 items-center justify-center">
      <button
        type="button"
        data-no-dnd
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

// ─── Drop indicator (blue line) ───────────────────────────────────────────────
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

// ─── Step picker modal (matches email builder's BlockPickerModal) ──────────────
function StepPickerModal({ onSelect, onClose }: { onSelect: (t: StepKind) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[440px] max-w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Add a step</h3>
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

// ─── Trigger meta ──────────────────────────────────────────────────────────────
function triggerMeta(t: AutomationTriggerType): { label: string; Icon: React.FC<{ size?: number; className?: string }> } {
  switch (t) {
    case 'tag_added':             return { label: 'Tag added',          Icon: Tag };
    case 'stage_changed':         return { label: 'Stage changed',      Icon: GitBranch };
    case 'trigger_link_click':    return { label: 'Trigger link click', Icon: Link2 };
    case 'wedding_date_followup': return { label: 'After wedding date', Icon: CalendarHeart };
    case 'proposal_paid':         return { label: 'Proposal paid',      Icon: DollarSign };
    case 'form_submitted':        return { label: 'Form submitted',     Icon: ClipboardList };
    default:                      return { label: String(t).replace(/_/g, ' '), Icon: Tag };
  }
}

function stepMeta(s: LocalStep, templates: TemplateOpt[]): { title: string; subtitle: string; Icon: React.FC<{ size?: number; className?: string }> } {
  if (s.step_type === 'delay') {
    const h = Math.round((s.delay_minutes / 60) * 10) / 10;
    return {
      title: 'Wait',
      subtitle: s.delay_minutes >= 60
        ? `${h} hour${h === 1 ? '' : 's'}`
        : `${s.delay_minutes} minute${s.delay_minutes === 1 ? '' : 's'}`,
      Icon: Clock,
    };
  }
  if (s.step_type === 'send_sms') {
    const b = s.body.trim();
    return { title: 'Send SMS', subtitle: b.slice(0, 56) + (b.length > 56 ? '…' : ''), Icon: Smartphone };
  }
  const tpl = templates.find((t) => t.id === s.template_id);
  return { title: 'Send Email', subtitle: tpl?.name ?? 'Choose a template →', Icon: Mail };
}

// ─── Enrollment pill ──────────────────────────────────────────────────────────
function EnrollPill({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      data-no-dnd
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="absolute -top-3 -right-3 z-20 flex items-center gap-1 rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-600 transition-colors"
      title={`${count} contact${count === 1 ? '' : 's'} at this step — click to view`}
    >
      <Users size={10} />
      {count}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function WorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const id = workflowId;

  // ── Core data ──────────────────────────────────────────────────────────────
  const [auto, setAuto]         = useState<AutomationRow | null>(null);
  const [steps, setSteps]       = useState<LocalStep[]>([]);
  const [tags, setTags]         = useState<TagRow[]>([]);
  const [stages, setStages]     = useState<StageOpt[]>([]);
  const [links, setLinks]       = useState<LinkRow[]>([]);
  const [forms, setForms]       = useState<FormRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr]           = useState<string | null>(null);

  // ── Trigger config ─────────────────────────────────────────────────────────
  const [selTags,          setSelTags]          = useState<string[]>([]);
  const [selStages,        setSelStages]        = useState<string[]>([]);
  const [selLinks,         setSelLinks]         = useState<string[]>([]);
  const [selForms,         setSelForms]         = useState<string[]>([]);
  const [daysAfterWedding, setDaysAfterWedding] = useState(3);

  // ── Panel selection ────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<SelectedItem>(null);

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const [zoom, setZoom]         = useState(1);
  const scrollPaneRef           = useRef<HTMLDivElement>(null);

  // ── DnD ───────────────────────────────────────────────────────────────────
  const [activePaletteType, setActivePaletteType] = useState<StepKind | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const pointerYRef = useRef(0);

  // ── Step picker modal ─────────────────────────────────────────────────────
  const [pickerIdx, setPickerIdx] = useState<number | null>(null);

  // ── Enrollment counts ──────────────────────────────────────────────────────
  const [enrollCounts, setEnrollCounts] = useState<Record<number, number>>({});

  // ── Enrollment modal ───────────────────────────────────────────────────────
  const [enrollModal, setEnrollModal]       = useState<{ stepIndex: number } | null>(null);
  const [enrollList, setEnrollList]         = useState<EnrollContact[]>([]);
  const [enrollLoading, setEnrollLoading]   = useState(false);
  const [selEnroll, setSelEnroll]           = useState<Set<string>>(new Set());
  const [advancing, setAdvancing]           = useState(false);

  // ── Test email ─────────────────────────────────────────────────────────────
  const [testStepOrder, setTestStepOrder]   = useState<number | null>(null);
  const [testEmail, setTestEmail]           = useState('');
  const [testSending, setTestSending]       = useState(false);
  const [testResult, setTestResult]         = useState<string | null>(null);

  // ── DnD sensors ───────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(SmartPointerSensor, { activationConstraint: { distance: 6 } }));

  // ── Track pointer Y for drop position ─────────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => { pointerYRef.current = e.clientY; };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // ── Zoom: Ctrl/Cmd + wheel ─────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollPaneRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.max(0.4, Math.min(2.5, z - e.deltaY * 0.003)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [aRes, tagRes, pipeRes, linkRes, formsRes, tmplRes] = await Promise.all([
      fetch(`/api/marketing/automations/${id}`,       { cache: 'no-store' }),
      fetch('/api/marketing/tags',                    { cache: 'no-store' }),
      fetch('/api/pipelines',                         { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links',           { cache: 'no-store' }),
      fetch('/api/marketing/forms',                   { cache: 'no-store' }),
      fetch('/api/marketing/email-templates',         { cache: 'no-store' }),
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
        const lid = `s-${i}-${Math.random().toString(36).slice(2)}`;
        if (s.step_type === 'delay')
          return { localId: lid, step_type: 'delay', delay_minutes: Number((s.config_json as { delay_minutes?: number }).delay_minutes ?? 60) };
        if (s.step_type === 'send_sms')
          return { localId: lid, step_type: 'send_sms', body: String((s.config_json as { body?: string }).body ?? DEFAULT_SMS) };
        return { localId: lid, step_type: 'send_email', template_id: String((s.config_json as { template_id?: string }).template_id ?? '') };
      }));
    }
    if (tagRes.ok)   { const d = await tagRes.json(); setTags(d.tags ?? []); }
    if (pipeRes.ok)  {
      const d = await pipeRes.json();
      const flat: StageOpt[] = [];
      for (const p of d.pipelines ?? []) for (const s of p.stages ?? []) flat.push({ id: s.id, name: s.name, pipelineName: p.name });
      setStages(flat);
    }
    if (linkRes.ok)  { const d = await linkRes.json(); setLinks(d.links ?? []); }
    if (formsRes.ok) { const d = await formsRes.json(); setForms(d.forms ?? []); }
    if (tmplRes.ok)  { const d = await tmplRes.json(); setTemplates(d.templates ?? []); }
    setLoading(false);
  }, [id]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  // ── Fetch enrollment counts ────────────────────────────────────────────────
  const refreshCounts = useCallback(async () => {
    const res = await fetch(`/api/marketing/automations/${id}/enrollments`, { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setEnrollCounts(d.counts ?? {});
    }
  }, [id]);

  useEffect(() => {
    if (!loading) void refreshCounts();
  }, [loading, refreshCounts]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function toggle(arr: string[], v: string, set: (x: string[]) => void) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
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

  function stepsPayload() {
    return steps.map((s, i) => {
      if (s.step_type === 'delay')
        return { step_order: i, step_type: 'delay' as const, config: { delay_minutes: Math.max(1, Math.min(10080, s.delay_minutes)) } };
      if (s.step_type === 'send_sms')
        return { step_order: i, step_type: 'send_sms' as const, config: { body: s.body.trim() } };
      return { step_order: i, step_type: 'send_email' as const, config: { template_id: s.template_id } };
    });
  }

  async function saveAll() {
    if (!auto) return;
    setSaving(true);
    setSaveStatus('saving');
    setErr(null);
    const res = await fetch(`/api/marketing/automations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: auto.name, status: auto.status,
        triggerConfig: buildTriggerConfig(),
        steps: stepsPayload(),
      }),
    });
    setSaving(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr((j as { error?: string }).error || 'Save failed'); setSaveStatus('error'); return; }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
    void load();
    void refreshCounts();
  }

  async function removeAutomation() {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Delete this workflow and all of its enrollments? This cannot be undone.')) return;
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
    setSteps((prev) => {
      const copy = [...prev];
      copy.splice(insertIdx, 0, step);
      return copy;
    });
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
      const copy = [...prev];
      [copy[index], copy[j]] = [copy[j]!, copy[index]!];
      return copy;
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
    const rect = event.over.rect;
    const midY = rect.top + rect.height / 2;
    const pos: 'before' | 'after' = pointerYRef.current >= midY ? 'after' : 'before';
    setDropTarget((prev) => prev?.id === overId && prev.pos === pos ? prev : { id: overId, pos });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const target = dropTarget;
    setActivePaletteType(null);
    setDropTarget(null);

    const aid = String(active.id);

    // Drop from palette
    if (aid.startsWith('new:')) {
      const kind = aid.replace('new:', '') as StepKind;
      if (over && target) {
        const overIdx = steps.findIndex((s) => s.localId === target.id);
        if (overIdx >= 0) {
          addStepAt(kind, target.pos === 'after' ? overIdx + 1 : overIdx);
        } else {
          addStepAt(kind, steps.length);
        }
      } else {
        addStepAt(kind, steps.length);
      }
      return;
    }

    // Reorder existing steps
    if (over && active.id !== over.id) {
      const oldIdx = steps.findIndex((s) => s.localId === active.id);
      const newIdx = steps.findIndex((s) => s.localId === over.id);
      if (oldIdx !== -1 && newIdx !== -1) {
        setSteps((prev) => arrayMove(prev, oldIdx, newIdx));
      }
    }
  }

  // ── Enrollment modal ───────────────────────────────────────────────────────
  async function openEnrollModal(stepIndex: number) {
    setEnrollModal({ stepIndex });
    setSelEnroll(new Set());
    setEnrollLoading(true);
    const res = await fetch(`/api/marketing/automations/${id}/enrollments?stepIndex=${stepIndex}`, { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setEnrollList(d.list ?? []);
    } else {
      setEnrollList([]);
    }
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
    if (res.ok) {
      setEnrollModal(null);
      void refreshCounts();
    }
  }

  function toggleEnroll(enrollId: string) {
    setSelEnroll((prev) => {
      const n = new Set(prev);
      if (n.has(enrollId)) n.delete(enrollId); else n.add(enrollId);
      return n;
    });
  }

  // ── Test email ─────────────────────────────────────────────────────────────
  async function sendTestEmail(stepOrder: number) {
    if (!testEmail.trim()) { setTestResult('Enter an email address first.'); return; }
    setTestSending(true);
    setTestResult(null);
    const res = await fetch(`/api/marketing/automations/${id}/test-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepOrder, toEmail: testEmail.trim() }),
    });
    setTestSending(false);
    const j = await res.json().catch(() => ({}));
    if (res.ok) setTestResult('✓ Sent! Check your inbox.');
    else setTestResult(`Error: ${(j as { error?: string }).error ?? 'Send failed'}`);
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
        <Link href="/dashboard/marketing/workflows" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Back to Workflows
        </Link>
      </div>
    );
  }

  const trig = triggerMeta(auto.trigger_type);
  const TriggerIcon = trig.Icon;
  const selectedStep = selected?.kind === 'step'
    ? steps.find((s) => s.localId === selected.localId) ?? null
    : null;

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
          <Link
            href="/dashboard/marketing/workflows"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
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
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAll()}
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
          {/* ── Canvas ────────────────────────────────────────────────────── */}
          <div
            ref={scrollPaneRef}
            className="fb-scroll-pane flex-1 overflow-y-auto overflow-x-hidden"
            style={{
              background: '#fafafa',
              overscrollBehavior: 'contain',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              minHeight: 0,
              position: 'relative',
            } as React.CSSProperties}
            onClick={() => setSelected(null)}
          >
            {/* Zoom controls — top-left of canvas */}
            <div
              className="absolute top-4 left-4 z-10 flex items-center gap-1"
              data-no-dnd
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-800 transition-colors shadow-sm"
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-800 transition-colors shadow-sm"
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="ml-1 text-[11px] font-medium text-gray-400 tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              {zoom !== 1 && (
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-700 transition-colors"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Zoom wrapper — CSS zoom adjusts layout + scroll correctly */}
            <div
              style={{
                zoom,
                paddingTop: 48,
                paddingBottom: 80,
                paddingLeft: 40,
                paddingRight: 80,
                minHeight: '100%',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto" style={{ maxWidth: 460 }}>

                {/* Trigger card — not sortable, always first */}
                <AddStepBtn onClick={() => { setPickerIdx(0); }} />
                <div
                  className="relative group/block"
                  onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'trigger' }); }}
                >
                  <div
                    className="overflow-hidden rounded-xl border bg-white"
                    style={{
                      transition: 'outline 0.1s ease, box-shadow 0.2s ease',
                      outline: selected?.kind === 'trigger' ? '1px solid #3b82f6' : '1px solid transparent',
                      outlineOffset: '-1px',
                      boxShadow: selected?.kind === 'trigger'
                        ? '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)'
                        : 'none',
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
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                        <TriggerIcon size={18} className="text-gray-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Trigger</p>
                        <p className="mt-0.5 font-semibold text-gray-900">{trig.label}</p>
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                          {selected?.kind === 'trigger' ? 'Editing in panel →' : 'Click to configure'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Selected side toolbar */}
                  {selected?.kind === 'trigger' && (
                    <div
                      className="absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col items-center z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-col items-center gap-1 bg-white rounded-2xl shadow-lg border border-gray-100 px-1.5 py-2">
                        <button
                          type="button" title="Delete workflow"
                          onClick={() => void removeAutomation()}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Step list */}
                <SortableContext items={steps.map((s) => s.localId)} strategy={verticalListSortingStrategy}>
                  {steps.length === 0 && activePaletteType === null ? (
                    <>
                      <AddStepBtn onClick={() => setPickerIdx(0)} />
                      <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center">
                        <p className="text-sm font-medium text-gray-700">No steps yet</p>
                        <p className="mt-1 text-xs text-gray-500">Drag a block from the right panel or use + above.</p>
                      </div>
                    </>
                  ) : (
                    steps.map((s, idx) => {
                      const meta = stepMeta(s, templates);
                      const StepIcon = meta.Icon;
                      const isSelected = selected?.kind === 'step' && selected.localId === s.localId;
                      const isDropTarget = dropTarget?.id === s.localId && activePaletteType !== null;
                      const showTop = isDropTarget && dropTarget?.pos === 'before';
                      const showBot = isDropTarget && dropTarget?.pos === 'after';
                      const enrollCount = enrollCounts[idx] ?? 0;

                      return (
                        <SortableStep key={s.localId} id={s.localId}>
                          {(isDragging) => (
                            <div>
                              {showTop && <DropIndicator label={PALETTE.find((p) => p.type === activePaletteType)?.label ?? ''} />}

                              <AddStepBtn onClick={() => setPickerIdx(idx)} />

                              <div
                                className="relative group/block"
                                onClick={(e) => { e.stopPropagation(); if (!isDragging) setSelected({ kind: 'step', localId: s.localId }); }}
                              >
                                <div
                                  className="overflow-hidden rounded-xl border bg-white"
                                  style={{
                                    transition: 'outline 0.1s ease, box-shadow 0.2s ease',
                                    outline: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                    outlineOffset: '-1px',
                                    boxShadow: isSelected
                                      ? '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)'
                                      : 'none',
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
                                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                                      <StepIcon size={18} className="text-gray-700" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Step {idx + 1}</p>
                                      <p className="mt-0.5 font-semibold text-gray-900">{meta.title}</p>
                                      <p className="mt-0.5 truncate text-xs text-gray-500">{meta.subtitle}</p>
                                    </div>
                                  </div>
                                </div>

                                {/* Enrollment count pill */}
                                <EnrollPill
                                  count={enrollCount}
                                  onClick={() => void openEnrollModal(idx)}
                                />

                                {/* Side toolbar — visible when selected */}
                                <div
                                  className={`absolute -right-12 top-1/2 -translate-y-1/2 flex flex-col items-center z-10 transition-opacity duration-150 ${isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="flex flex-col items-center gap-1 bg-white rounded-2xl shadow-lg border border-gray-100 px-1.5 py-2">
                                    <button type="button" title="Move up" disabled={idx === 0}
                                      onClick={() => moveStep(idx, -1)}
                                      className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                                    >
                                      <ChevronUp size={15} />
                                    </button>
                                    <button type="button" title="Move down" disabled={idx === steps.length - 1}
                                      onClick={() => moveStep(idx, 1)}
                                      className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                                    >
                                      <ChevronDown size={15} />
                                    </button>
                                    <div className="w-5 h-px bg-gray-100 my-0.5" />
                                    <button type="button" title="Remove step"
                                      onClick={() => removeStep(s.localId)}
                                      className="flex h-8 w-8 items-center justify-center rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {showBot && <DropIndicator label={PALETTE.find((p) => p.type === activePaletteType)?.label ?? ''} />}

                              {/* Add button after the last step */}
                              {idx === steps.length - 1 && (
                                <AddStepBtn onClick={() => setPickerIdx(steps.length)} />
                              )}
                            </div>
                          )}
                        </SortableStep>
                      );
                    })
                  )}
                </SortableContext>

                {/* Drop-at-end indicator */}
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
                <div className="mt-2 rounded-xl border border-gray-100 bg-white px-4 py-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">End of workflow</p>
                </div>

              </div>
            </div>
          </div>

          {/* ── Right panel ───────────────────────────────────────────────── */}
          <aside
            className="w-72 flex-shrink-0 bg-white flex flex-col overflow-hidden"
            style={{ boxShadow: '-12px 0 32px -8px rgba(0,0,0,0.07)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="fb-scroll-pane flex-1 overflow-y-auto"
              style={{
                overscrollBehavior: 'contain',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                minHeight: 0,
              } as React.CSSProperties}
            >

              {/* ── Trigger inspector ─────────────────────────────────────── */}
              {selected?.kind === 'trigger' ? (
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                      Trigger
                    </span>
                    <button type="button" onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
                      Done
                    </button>
                  </div>

                  <div className="mb-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Type</p>
                    <p className="mt-1 text-sm font-medium text-gray-800">{trig.label}</p>
                    <p className="mt-1 text-[11px] text-gray-400">Fixed after creation — duplicate the workflow to change.</p>
                  </div>

                  {auto.trigger_type === 'form_submitted' && (
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Forms</p>
                      {forms.length === 0 ? (
                        <p className="text-[11px] text-gray-500">
                          No forms yet.{' '}
                          <Link href="/dashboard/marketing/form-builder" className="text-brand-600 hover:underline">Create one →</Link>
                        </p>
                      ) : (
                        <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
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
                      <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
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
                      <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
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
                      <input
                        type="number" min={0} max={3650}
                        className="w-32 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
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
                /* ── Step inspector ─────────────────────────────────────── */
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                      {selectedStep.step_type === 'send_email' ? 'send email'
                        : selectedStep.step_type === 'send_sms' ? 'send sms'
                        : 'wait'}
                    </span>
                    <button type="button" onClick={() => setSelected(null)}
                      className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      Done
                    </button>
                  </div>

                  {selectedStep.step_type === 'delay' && (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Wait duration</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min={1} max={10080}
                          className="w-24 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                          value={selectedStep.delay_minutes}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 1;
                            const lid = selectedStep.localId;
                            setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'delay' ? { ...x, delay_minutes: v } : x));
                          }}
                        />
                        <span className="text-xs text-gray-500">minutes</span>
                      </div>
                      <p className="mt-2 text-[11px] text-gray-400">
                        ≈ {Math.round((selectedStep.delay_minutes / 60) * 10) / 10}h
                        {' · '}≈ {Math.round((selectedStep.delay_minutes / 1440) * 10) / 10}d
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {[
                          { label: '15m', m: 15 }, { label: '1h', m: 60 },
                          { label: '1d',  m: 1440 }, { label: '2d', m: 2880 },
                          { label: '3d',  m: 4320 }, { label: '7d', m: 10080 },
                        ].map((p) => {
                          const lid = selectedStep.localId;
                          return (
                            <button key={p.label} type="button"
                              className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:border-gray-400"
                              onClick={() => setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'delay' ? { ...x, delay_minutes: p.m } : x))}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedStep.step_type === 'send_email' && (() => {
                    const stepOrder = steps.findIndex((s) => s.localId === selectedStep.localId);
                    return (
                      <div>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Template</p>
                        {templates.length === 0 ? (
                          <p className="text-[11px] text-gray-500">
                            No templates yet.{' '}
                            <Link href="/dashboard/marketing/email/templates" className="text-brand-600 hover:underline">Create one →</Link>
                          </p>
                        ) : (
                          <select
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                            value={selectedStep.template_id}
                            onChange={(e) => {
                              const v = e.target.value;
                              const lid = selectedStep.localId;
                              setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'send_email' ? { ...x, template_id: v } : x));
                            }}
                          >
                            <option value="">Choose a template</option>
                            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        )}
                        <p className="mt-2 text-[11px] text-gray-400">Unsubscribe + bounce suppression applied automatically.</p>

                        {/* Test email */}
                        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Send test</p>
                          <input
                            type="email"
                            placeholder="your@email.com"
                            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:border-gray-400 focus:outline-none"
                            value={testStepOrder === stepOrder ? testEmail : ''}
                            onChange={(e) => { setTestEmail(e.target.value); setTestStepOrder(stepOrder); setTestResult(null); }}
                          />
                          <button
                            type="button"
                            disabled={testSending}
                            onClick={() => { setTestStepOrder(stepOrder); void sendTestEmail(stepOrder); }}
                            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                          >
                            {testSending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                            {testSending ? 'Sending…' : 'Send test email'}
                          </button>
                          {testResult && testStepOrder === stepOrder && (
                            <p className={`mt-1.5 text-[11px] ${testResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>
                              {testResult}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {selectedStep.step_type === 'send_sms' && (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Message body</p>
                      <textarea
                        className="min-h-[100px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                        value={selectedStep.body}
                        onChange={(e) => {
                          const v = e.target.value;
                          const lid = selectedStep.localId;
                          setSteps((prev) => prev.map((x) => x.localId === lid && x.step_type === 'send_sms' ? { ...x, body: v } : x));
                        }}
                      />
                      <p className="mt-2 text-[11px] text-gray-400">
                        {'Use {{first_name}} and {{venue_name}}. STOP/DND honored automatically.'}
                      </p>
                    </div>
                  )}

                  <div className="mt-6 border-t border-gray-100 pt-4">
                    <button type="button" onClick={() => removeStep(selectedStep.localId)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={12} /> Remove step
                    </button>
                  </div>
                </div>

              ) : (
                /* ── Blocks palette ─────────────────────────────────────── */
                <div className="p-4">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Blocks</p>
                  <p className="mb-4 text-[11px] text-gray-400">
                    Drag a block onto the canvas, or click a block on the canvas to edit it.
                  </p>
                  <div className="flex flex-col gap-2">
                    {PALETTE.map((item) => <PaletteCard key={item.type} {...item} />)}
                  </div>
                </div>
              )}
            </div>

            {/* Right-panel footer — step count + save status */}
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
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-xl opacity-90 pointer-events-none" style={{ width: 240 }}>
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setEnrollModal(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Contacts at Step {enrollModal.stepIndex + 1}
                </h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  Select contacts and click "Advance" to process their next step immediately.
                </p>
              </div>
              <button type="button" onClick={() => setEnrollModal(null)} className="text-gray-400 hover:text-gray-700 transition-colors">
                <Minus size={18} />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {enrollLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-gray-400" size={24} />
                </div>
              ) : enrollList.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  No active contacts at this step.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="w-10 px-4 py-2 text-left">
                        <button type="button"
                          onClick={() => {
                            if (selEnroll.size === enrollList.length) setSelEnroll(new Set());
                            else setSelEnroll(new Set(enrollList.map((e) => e.id)));
                          }}
                          className="text-gray-400 hover:text-gray-700"
                        >
                          {selEnroll.size === enrollList.length && enrollList.length > 0
                            ? <CheckSquare size={15} />
                            : <Square size={15} />}
                        </button>
                      </th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Name</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Email</th>
                      <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollList.map((contact) => (
                      <tr
                        key={contact.id}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggleEnroll(contact.id)}
                      >
                        <td className="px-4 py-2.5">
                          {selEnroll.has(contact.id)
                            ? <CheckSquare size={15} className="text-blue-500" />
                            : <Square size={15} className="text-gray-300" />}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">
                          {contact.firstName} {contact.lastName}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{contact.email}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${contact.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                            {contact.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <span className="text-xs text-gray-500">
                {selEnroll.size > 0 ? `${selEnroll.size} selected` : 'Click a row to select'}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEnrollModal(null)}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={selEnroll.size === 0 || advancing}
                  onClick={() => void advanceSelected()}
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
