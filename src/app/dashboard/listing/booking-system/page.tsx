'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Zap, Mail, MessageSquare, Bot, ChevronDown, ChevronUp,
  Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, GripVertical,
  Clock, Send, Users, ExternalLink, SkipForward, X as XIcon,
  RefreshCw, Image as ImageIcon, Link as LinkIcon,
} from 'lucide-react';
import type { BookingSystemConfig, StepConfig } from '@/app/api/listing/booking-system/route';
import type { StepLeadsPayload, StepLeadInfo } from '@/app/api/listing/booking-system/step-leads/route';
import RichTextEditor from '@/components/RichTextEditor';
import AiConciergeSettingsPage from '@/app/dashboard/marketing/ai-concierge/page';

// ─── Shared primitives ────────────────────────────────────────────────────

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-violet-600' : 'bg-gray-200'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
}

function PhaseCard({
  number, title, subtitle, icon, enabled, onToggle, disabled, children, accent,
}: {
  number: number; title: string; subtitle: string;
  icon: React.ReactNode; enabled: boolean; onToggle: (v: boolean) => void;
  disabled?: boolean; children?: React.ReactNode; accent: string;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className={`rounded-2xl border bg-white transition-shadow ${enabled ? 'shadow-sm border-gray-200' : 'border-gray-100 opacity-60'}`}>
      <div className="flex items-start gap-4 p-5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="cursor-pointer flex-1" onClick={() => setIsOpen(!isOpen)}>
              <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase flex items-center gap-1">
                Phase {number}
                {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </span>
              <h3 className="text-[15px] font-semibold text-gray-900 leading-tight">{title}</h3>
              <p className="mt-0.5 text-[12px] text-gray-500">{subtitle}</p>
            </div>
            <Toggle checked={enabled} onChange={onToggle} disabled={disabled} />
          </div>
        </div>
      </div>
      {enabled && isOpen && children && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">{children}</p>;
}

function TextArea({
  value, onChange, rows = 4, placeholder,
}: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition resize-none"
    />
  );
}

function InlineInput({
  value, onChange, placeholder, className = '',
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition ${className}`}
    />
  );
}

// ─── Individual step blocks ───────────────────────────────────────────────

// ── Wait duration helpers ─────────────────────────────────────────────────

type WaitUnit = 'minutes' | 'hours' | 'days';

function minutesToUnit(minutes: number): { value: number; unit: WaitUnit } {
  if (minutes % 1440 === 0 && minutes >= 1440) return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0  && minutes >= 60)   return { value: minutes / 60,   unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function unitToMinutes(value: number, unit: WaitUnit): number {
  if (unit === 'days')    return value * 1440;
  if (unit === 'hours')   return value * 60;
  return value;
}

function waitLabel(minutes: number): string {
  const { value, unit } = minutesToUnit(minutes);
  return `Wait ${value} ${unit === 'minutes' ? 'min' : unit === 'hours' ? `hr${value !== 1 ? 's' : ''}` : `day${value !== 1 ? 's' : ''}`}`;
}

// Wait block — inline, no expand needed
function WaitBlock({
  step, onRemove, onChange, dragHandleProps, leadsHere = [],
}: {
  step: StepConfig;
  onRemove: () => void;
  onChange: (s: StepConfig) => void;
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>;
  leadsHere?: StepLeadInfo[];
}) {
  const existing = step.delay_minutes ? minutesToUnit(step.delay_minutes) : { value: undefined as number | undefined, unit: 'minutes' as WaitUnit };
  const [val,  setVal]  = useState<string>(existing.value !== undefined ? String(existing.value) : '');
  const [unit, setUnit] = useState<WaitUnit>(existing.unit);

  function commit(newVal: string, newUnit: WaitUnit) {
    const n = parseInt(newVal, 10);
    if (!newVal || isNaN(n) || n < 1) return;
    const mins = unitToMinutes(n, newUnit);
    onChange({ ...step, delay_minutes: mins, label: waitLabel(mins) });
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <span {...dragHandleProps} className="cursor-grab text-gray-300 hover:text-gray-400 active:cursor-grabbing shrink-0">
        <GripVertical size={14} />
      </span>
      <Clock size={13} className="text-gray-400 shrink-0" />
      <span className="text-[12px] text-gray-500">Wait</span>
      <input
        type="number"
        min={1}
        value={val}
        placeholder="—"
        onChange={(e) => { setVal(e.target.value); commit(e.target.value, unit); }}
        className="w-14 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700 text-center focus:outline-none focus:border-violet-400"
      />
      <select
        value={unit}
        onChange={(e) => { const u = e.target.value as WaitUnit; setUnit(u); commit(val, u); }}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700 focus:outline-none focus:border-violet-400"
      >
        <option value="minutes">min</option>
        <option value="hours">hrs</option>
        <option value="days">days</option>
      </select>
      <div className="flex-1" />
      {leadsHere.length > 0 && <LeadsPill stepLabel={step.label || 'Wait'} leads={leadsHere} />}
      <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// SMS / Email block — collapsible
function MessageBlock({
  step, onRemove, onChange, dragHandleProps, leadsHere = [],
}: {
  step: StepConfig;
  onRemove: () => void;
  onChange: (s: StepConfig) => void;
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>;
  leadsHere?: StepLeadInfo[];
}) {
  const [expanded, setExpanded] = useState(false);
  const isSms = step.step_type === 'send_sms';
  const Icon  = isSms ? MessageSquare : Mail;
  const color = isSms ? 'text-violet-600' : 'text-blue-500';
  const preview = step.body?.trim().slice(0, 60);

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${expanded ? 'border-gray-300 shadow-sm' : 'border-gray-200'}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <span
          {...dragHandleProps}
          className="cursor-grab text-gray-300 hover:text-gray-400 active:cursor-grabbing shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </span>
        <Icon size={13} className={`${color} shrink-0`} />
        <span className="flex-1 min-w-0 text-[12px] font-medium text-gray-700 truncate">
          {step.label || (isSms ? 'SMS message' : 'Email message')}
          {!expanded && preview
            ? <span className="ml-1.5 font-normal text-gray-400">{preview}{(step.body?.length ?? 0) > 60 ? '…' : ''}</span>
            : null}
        </span>
        {leadsHere.length > 0 && (
          <span onClick={e => e.stopPropagation()}>
            <LeadsPill stepLabel={step.label || (isSms ? 'SMS' : 'Email')} leads={leadsHere} />
          </span>
        )}
        {expanded
          ? <ChevronUp size={13} className="text-gray-400 shrink-0" />
          : <ChevronDown size={13} className="text-gray-400 shrink-0" />}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-gray-300 hover:text-red-400 transition-colors p-0.5 shrink-0"
        >
          <Trash2 size={13} />
        </button>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-2.5 space-y-3">
          <InlineInput
            value={step.label}
            onChange={(v) => onChange({ ...step, label: v })}
            placeholder={isSms ? 'e.g. Day 1 — intro text' : 'e.g. Day 3 — follow-up email'}
            className="w-full"
          />
          {!isSms && (
            <div className="space-y-2">
              <InlineInput
                value={step.subject ?? ''}
                onChange={(v) => onChange({ ...step, subject: v })}
                placeholder="Subject line"
                className="w-full font-medium"
              />
              <InlineInput
                value={step.preview_text ?? ''}
                onChange={(v) => onChange({ ...step, preview_text: v })}
                placeholder="Preview text (optional preheader)"
                className="w-full text-gray-500"
              />
            </div>
          )}
          
          {isSms ? (
            <TextArea
              value={step.body ?? ''}
              onChange={(v) => onChange({ ...step, body: v })}
              rows={4}
              placeholder={'SMS body… {{first_name}}, {{venue_name}}'}
            />
          ) : (
            <div className="space-y-3 border border-gray-200 rounded-lg p-3 bg-gray-50/50">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><ImageIcon size={12}/> Image Block (Optional)</label>
                <div className="flex gap-2">
                  <InlineInput
                    value={step.image_url ?? ''}
                    onChange={(v) => onChange({ ...step, image_url: v })}
                    placeholder="Image URL (https://...)"
                    className="flex-1"
                  />
                  <InlineInput
                    value={step.image_link ?? ''}
                    onChange={(v) => onChange({ ...step, image_link: v })}
                    placeholder="Link URL (when clicked)"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email Body</label>
                <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
                  <RichTextEditor
                    content={step.body ?? ''}
                    onChange={(v: string) => onChange({ ...step, body: v })}
                    placeholder="Email body… {{first_name}}, {{venue_name}}"
                    minHeight={120}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5"><LinkIcon size={12}/> Button Block (Optional)</label>
                <div className="flex gap-2">
                  <InlineInput
                    value={step.button_text ?? ''}
                    onChange={(v) => onChange({ ...step, button_text: v })}
                    placeholder="Button Text (e.g. Book a Tour)"
                    className="flex-1"
                  />
                  <InlineInput
                    value={step.button_link ?? ''}
                    onChange={(v) => onChange({ ...step, button_link: v })}
                    placeholder="Button Link (https://...)"
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// AI Concierge handoff block — terminal, no expand
function AiHandoffBlock({
  onRemove, dragHandleProps, leadsHere = [],
}: {
  onRemove: () => void;
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>;
  leadsHere?: StepLeadInfo[];
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
      <span {...dragHandleProps} className="cursor-grab text-emerald-300 hover:text-emerald-400 active:cursor-grabbing shrink-0">
        <GripVertical size={14} />
      </span>
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
        <Bot size={13} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-emerald-800">Activate AI Concierge</p>
        <p className="text-[11px] text-emerald-600">AI takes over from this point and continues outreach automatically.</p>
      </div>
      {leadsHere.length > 0 && <LeadsPill stepLabel="AI Concierge" leads={leadsHere} variant="emerald" />}
      <button type="button" onClick={onRemove} className="text-emerald-300 hover:text-red-400 transition-colors shrink-0">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── LeadsPill + Modal ─────────────────────────────────────────────────────────

function LeadsPill({ stepLabel, leads, variant = 'default' }: {
  stepLabel: string;
  leads: StepLeadInfo[];
  variant?: 'default' | 'emerald';
}) {
  const [open, setOpen] = useState(false);
  const cls = variant === 'emerald'
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200'
    : 'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${cls}`}
      >
        <Users size={9} />
        {leads.length}
      </button>
      {open && (
        <StepLeadsModal
          stepLabel={stepLabel}
          leads={leads}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StepLeadsModal({ stepLabel, leads, onClose }: {
  stepLabel: string;
  leads: StepLeadInfo[];
  onClose: () => void;
}) {
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanced,  setAdvanced]  = useState<Set<string>>(new Set());
  const [errors,    setErrors]    = useState<Record<string, string>>({});

  async function handleAdvance(enrollmentId: string) {
    setAdvancing(enrollmentId);
    try {
      const r = await fetch('/api/listing/booking-system/step-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; action?: string };
      if (d.ok) {
        setAdvanced(prev => new Set([...prev, enrollmentId]));
      } else {
        setErrors(prev => ({ ...prev, [enrollmentId]: d.error ?? 'Failed' }));
      }
    } catch {
      setErrors(prev => ({ ...prev, [enrollmentId]: 'Network error' }));
    } finally {
      setAdvancing(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Waiting at step</p>
            <p className="text-[14px] font-semibold text-gray-900">{stepLabel}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <XIcon size={15} />
          </button>
        </div>

        {/* Lead list */}
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
          {leads.map(l => {
            const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email || 'Unknown';
            const done = advanced.has(l.enrollment_id);
            const err  = errors[l.enrollment_id];
            return (
              <div key={l.enrollment_id} className={`flex items-center gap-3 px-4 py-3 ${done ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-900 truncate">{name}</p>
                  {l.email && <p className="text-[11px] text-gray-400 truncate">{l.email}</p>}
                  {l.next_run_at && !done && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Next: {new Date(l.next_run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  )}
                  {done && <p className="text-[10px] text-emerald-600 font-medium mt-0.5">✓ Advanced to next step</p>}
                  {err  && <p className="text-[10px] text-red-500 mt-0.5">{err}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Profile link */}
                  {l.email && (
                    <a
                      href={`/dashboard/conversations?email=${encodeURIComponent(l.email)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open conversation thread"
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-violet-600 transition-colors"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                  {/* Force advance */}
                  {!done && (
                    <button
                      onClick={() => void handleAdvance(l.enrollment_id)}
                      disabled={advancing === l.enrollment_id}
                      title="Force to next step"
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 disabled:opacity-50 transition-colors"
                    >
                      {advancing === l.enrollment_id
                        ? <RefreshCw size={10} className="animate-spin" />
                        : <SkipForward size={10} />}
                      Next
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-4 py-3 text-center">
          <p className="text-[11px] text-gray-400">
            "Next" skips the current wait and queues up the following step immediately.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Sequence editor (Phase 2 body) ──────────────────────────────────────

function SequenceEditor({
  steps,
  onStepsChange,
  leadsData,
  allowAi = true,
}: {
  steps: StepConfig[];
  onStepsChange: (s: StepConfig[]) => void;
  leadsData: StepLeadsPayload | null;
  allowAi?: boolean;
}) {
  const dragSrc = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  function handleDragStart(e: React.DragEvent, i: number) {
    dragSrc.current = i;
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(i);
  }
  function handleDrop(i: number) {
    if (dragSrc.current === null || dragSrc.current === i) { reset(); return; }
    const next = [...steps];
    const [moved] = next.splice(dragSrc.current, 1);
    next.splice(i, 0, moved);
    onStepsChange(next.map((s, idx) => ({ ...s, step_order: idx })));
    reset();
  }
  function reset() { dragSrc.current = null; setOverIdx(null); }

  function updateStep(i: number, s: StepConfig) {
    const next = [...steps]; next[i] = s; onStepsChange(next);
  }
  function removeStep(i: number) {
    onStepsChange(steps.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, step_order: idx })));
  }
  function addStep(type: StepConfig['step_type']) {
    const newStep: StepConfig = {
      step_order: steps.length,
      step_type: type,
      label: '',
      body: '',
      subject: '',
      delay_minutes: type === 'delay' ? undefined : 0,
    };
    onStepsChange([...steps, newStep]);
  }

  const dragHandleFor = (i: number): React.HTMLAttributes<HTMLSpanElement> => ({
    draggable: true,
    onDragStart: (e) => handleDragStart(e as unknown as React.DragEvent, i),
    onDragEnd:   reset,
  });

  return (
    <div className="space-y-2">
      {steps.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-[12px] text-gray-400">
          No steps yet. Add your first touchpoint below.
        </p>
      )}

      {steps.map((step, i) => {
        const isOver    = overIdx === i && dragSrc.current !== null && dragSrc.current !== i;
        const leadsHere = leadsData?.byStep?.[i] ?? [];
        return (
          <div
            key={i}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={() => handleDrop(i)}
            className={`transition-all ${isOver ? 'ring-2 ring-violet-400 ring-offset-1 rounded-xl' : ''}`}
          >
            {step.step_type === 'delay' && (
              <WaitBlock
                step={step}
                onRemove={() => removeStep(i)}
                onChange={(s) => updateStep(i, s)}
                dragHandleProps={dragHandleFor(i)}
                leadsHere={leadsHere}
              />
            )}
            {(step.step_type === 'send_sms' || step.step_type === 'send_email') && (
              <MessageBlock
                step={step}
                onRemove={() => removeStep(i)}
                onChange={(s) => updateStep(i, s)}
                dragHandleProps={dragHandleFor(i)}
                leadsHere={leadsHere}
              />
            )}
            {step.step_type === 'start_ai_concierge' && (
              <AiHandoffBlock
                onRemove={() => removeStep(i)}
                dragHandleProps={dragHandleFor(i)}
                leadsHere={leadsHere}
              />
            )}
          </div>
        );
      })}

      {/* Add buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => addStep('send_sms')}
          className="flex items-center gap-1.5 rounded-xl border border-dashed border-violet-200 px-3 py-2 text-[12px] font-medium text-violet-600 hover:bg-violet-50 transition-colors"
        >
          <Plus size={13} /> SMS
        </button>
        {steps.filter(s => s.step_type === 'send_email').length < 5 && (
          <button
            type="button"
            onClick={() => addStep('send_email')}
            className="flex items-center gap-1.5 rounded-xl border border-dashed border-blue-200 px-3 py-2 text-[12px] font-medium text-blue-500 hover:bg-blue-50 transition-colors"
          >
            <Plus size={13} /> Email
          </button>
        )}
        <button
          type="button"
          onClick={() => addStep('delay')}
          className="flex items-center gap-1.5 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <Plus size={13} /> Wait
        </button>
        {!steps.some(s => s.step_type === 'start_ai_concierge') && allowAi && (
          <button
            type="button"
            onClick={() => addStep('start_ai_concierge')}
            className="flex items-center gap-1.5 rounded-xl border border-dashed border-emerald-200 px-3 py-2 text-[12px] font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
          >
            <Plus size={13} /> <Bot size={12} /> AI Concierge
          </button>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pt-1">
        Drag <GripVertical size={11} className="inline mb-0.5 text-gray-400" /> to reorder. Sequence stops automatically when the bride replies.
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function BookingSystemPage() {
  const [cfg, setCfg]             = useState<BookingSystemConfig | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState('');
  const [leadsData, setLeadsData] = useState<StepLeadsPayload | null>(null);

  // Placeholders for new phases (removed local state, using cfg)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, leadsRes] = await Promise.all([
        fetch('/api/listing/booking-system', { cache: 'no-store' }),
        fetch('/api/listing/booking-system/step-leads', { cache: 'no-store' }),
      ]);
      if (!cfgRes.ok) throw new Error('Failed to load');
      setCfg(await cfgRes.json() as BookingSystemConfig);
      if (leadsRes.ok) setLeadsData(await leadsRes.json() as StepLeadsPayload);
    } catch { setError('Unable to load Booking System settings.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(patch: Partial<BookingSystemConfig>) {
    if (!cfg) return;
    setCfg(prev => prev ? { ...prev, ...patch } : prev);
    setSaving(true); setSaved(false); setError('');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      const r = await fetch('/api/listing/booking-system', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string; hint?: string };
        const msg = [d.error, d.hint].filter(Boolean).join(' — ');
        throw new Error(msg || 'Save failed');
      }
      setSaved(true);
      saveTimer.current = setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-0 flex min-h-[400px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
    </div>
  );
  if (!cfg) return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-0 flex min-h-[400px] items-center justify-center text-sm text-gray-500">
      {error || 'Unable to load settings.'}
    </div>
  );

  const aiBlocked = !cfg.a2pVerified || !cfg.ghlConnected;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-0">

      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600">
              <Zap size={16} className="text-white" />
            </div>
            <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Speed to Lead System</h1>
          </div>
          <p className="text-[13px] text-gray-500 ml-10">
            Automatically follow up with every new lead — from first inquiry to booked tour.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {saving && <Loader2 size={14} className="animate-spin text-gray-400" />}
          {saved  && <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-600"><CheckCircle2 size={13} /> Saved</span>}
          <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
            <span className="text-[12px] font-medium text-gray-700">
              {cfg.masterEnabled ? 'System on' : 'System off'}
            </span>
            <Toggle checked={cfg.masterEnabled} onChange={(v) => void save({ masterEnabled: v })} />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}
      {!cfg.masterEnabled && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          The Booking System is off. New leads won't receive any automated follow-up until you turn it back on.
        </div>
      )}

      <div className="space-y-4">

        {/* Phase 1 — Guide Delivery */}
        <PhaseCard
          number={1}
          title="Guide Delivery"
          subtitle="Send your pricing guide the moment a bride submits your listing form."
          icon={<Send size={18} className="text-blue-600" />}
          accent="bg-blue-50"
          enabled={cfg.guideEmailEnabled || cfg.guideSmsEnabled}
          onToggle={(v) => void save({ guideEmailEnabled: v, guideSmsEnabled: v })}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-blue-500" />
                <div>
                  <p className="text-[13px] font-medium text-gray-800">Email</p>
                  <p className="text-[11px] text-gray-500">Sent immediately on form submit</p>
                </div>
              </div>
              <Toggle checked={cfg.guideEmailEnabled} onChange={(v) => void save({ guideEmailEnabled: v })} />
            </div>
            {cfg.guideEmailEnabled && (
              <div>
                <SectionLabel>Email body</SectionLabel>
                <TextArea
                  value={cfg.guideEmailBody}
                  onChange={(v) => void save({ guideEmailBody: v })}
                  rows={6}
                  placeholder="Use {{first_name}}, {{venue_name}}, {{pricing_guide_url}}"
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-violet-500" />
                <div>
                  <p className="text-[13px] font-medium text-gray-800">SMS</p>
                  <p className="text-[11px] text-gray-500">Text with guide link, sent immediately</p>
                </div>
              </div>
              <Toggle checked={cfg.guideSmsEnabled} onChange={(v) => void save({ guideSmsEnabled: v })} />
            </div>
            {cfg.guideSmsEnabled && (
              <div>
                <SectionLabel>SMS message</SectionLabel>
                <TextArea
                  value={cfg.guideSmsBody}
                  onChange={(v) => void save({ guideSmsBody: v })}
                  rows={3}
                  placeholder="Use {{first_name}}, {{venue_name}}, {{pricing_guide_url}}"
                />
              </div>
            )}
            <p className="text-[11px] text-gray-400">
              Tags: <code className="rounded bg-gray-100 px-1">{'{{first_name}}'}</code>{' '}
              <code className="rounded bg-gray-100 px-1">{'{{venue_name}}'}</code>{' '}
              <code className="rounded bg-gray-100 px-1">{'{{pricing_guide_url}}'}</code>
            </p>
          </div>
        </PhaseCard>

        {/* Phase 2 — Sequence */}
        <PhaseCard
          number={2}
          title="Follow-up Sequence"
          subtitle={leadsData?.total
            ? `${leadsData.total} lead${leadsData.total !== 1 ? 's' : ''} active in sequence · SMS and email touchpoints that fire until she replies.`
            : 'SMS and email touchpoints that fire until she replies. Drag to reorder.'}
          icon={<MessageSquare size={18} className="text-violet-600" />}
          accent="bg-violet-50"
          enabled={cfg.sequenceEnabled}
          onToggle={(v) => void save({ sequenceEnabled: v })}
        >
          <SequenceEditor
            steps={cfg.steps}
            onStepsChange={(steps) => void save({ steps })}
            leadsData={leadsData}
          />
        </PhaseCard>

        {/* Phase 3 — Nurture */}
        <PhaseCard
          number={3}
          title="Nurture Sequence"
          subtitle="Tips to picking / touring venues (5 email sequence)"
          icon={<Mail size={18} className="text-pink-600" />}
          accent="bg-pink-50"
          enabled={cfg.phase3Enabled}
          onToggle={(v) => void save({ phase3Enabled: v })}
        >
          <SequenceEditor
            steps={cfg.phase3Steps}
            onStepsChange={(steps) => void save({ phase3Steps: steps })}
            leadsData={null}
            allowAi={false}
          />
        </PhaseCard>

        {/* Phase 4 — Booked Tour */}
        <PhaseCard
          number={4}
          title="Booked Tour"
          subtitle="If they book a tour, what to expect (5 email sequence)"
          icon={<Users size={18} className="text-amber-600" />}
          accent="bg-amber-50"
          enabled={cfg.phase4Enabled}
          onToggle={(v) => void save({ phase4Enabled: v })}
        >
          <SequenceEditor
            steps={cfg.phase4Steps}
            onStepsChange={(steps) => void save({ phase4Steps: steps })}
            leadsData={null}
            allowAi={false}
          />
        </PhaseCard>

        {/* Phase 5 — Booked Wedding */}
        <PhaseCard
          number={5}
          title="Booked Wedding"
          subtitle="If they book a wedding, what to expect (5 email sequence)"
          icon={<CheckCircle2 size={18} className="text-emerald-600" />}
          accent="bg-emerald-50"
          enabled={cfg.phase5Enabled}
          onToggle={(v) => void save({ phase5Enabled: v })}
        >
          <SequenceEditor
            steps={cfg.phase5Steps}
            onStepsChange={(steps) => void save({ phase5Steps: steps })}
            leadsData={null}
            allowAi={false}
          />
        </PhaseCard>

        {/* Phase 6 — AI Concierge Settings */}
        <PhaseCard
          number={6}
          title="AI Concierge"
          subtitle="A personal AI assistant that follows up with quiet leads via SMS until they reply or 60 days pass."
          icon={<Bot size={18} className="text-emerald-600" />}
          accent="bg-emerald-50"
          enabled={cfg.aiEnabled}
          onToggle={(v) => void save({ aiEnabled: v })}
        >
          <div className="pt-2">
            <AiConciergeSettingsPage />
          </div>
        </PhaseCard>
      </div>
    </div>
  );
}
