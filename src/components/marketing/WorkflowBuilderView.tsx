'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarHeart,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  DollarSign,
  GitBranch,
  Link2,
  Loader2,
  Mail,
  Plus,
  Smartphone,
  Tag,
  Trash2,
} from 'lucide-react';
import type { AutomationTriggerType } from '@/lib/marketing-email-schema';

interface AutomationRow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused';
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
}

interface TagRow { id: string; name: string }
interface StageOpt { id: string; name: string; pipelineName: string }
interface LinkRow { id: string; name: string; short_code: string }
interface FormRow { id: string; name: string; published: boolean }
interface TemplateOpt { id: string; name: string }

const DEFAULT_AUTOMATION_SMS =
  'Hi {{first_name}}, a quick note from {{venue_name}}. Reply STOP to opt out.';

type LocalStep =
  | { localId: string; step_type: 'delay'; delay_minutes: number }
  | { localId: string; step_type: 'send_email'; template_id: string }
  | { localId: string; step_type: 'send_sms'; body: string };

type StepKind = LocalStep['step_type'];

type SelectedItem = { kind: 'trigger' } | { kind: 'step'; localId: string } | null;

// ─── Step palette shown in the right panel — same DNA as email builder ───────
const PALETTE: { type: StepKind; label: string; desc: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { type: 'delay',      label: 'Wait',       desc: 'Pause for a duration',       Icon: Clock },
  { type: 'send_email', label: 'Send Email', desc: 'Choose a saved template',    Icon: Mail },
  { type: 'send_sms',   label: 'Send SMS',   desc: 'Send a text message',        Icon: Smartphone },
];

function stepMeta(s: LocalStep, templates: TemplateOpt[]): { title: string; subtitle: string; Icon: typeof Clock } {
  if (s.step_type === 'delay') {
    const h = Math.round((s.delay_minutes / 60) * 10) / 10;
    return {
      title: 'Wait',
      subtitle:
        s.delay_minutes >= 60
          ? `${h} hour${h === 1 ? '' : 's'}`
          : `${s.delay_minutes} minute${s.delay_minutes === 1 ? '' : 's'}`,
      Icon: Clock,
    };
  }
  if (s.step_type === 'send_sms') {
    const b = s.body.trim();
    return { title: 'Send SMS', subtitle: b.slice(0, 56) + (b.length > 56 ? '…' : '—'), Icon: Smartphone };
  }
  const tpl = templates.find((t) => t.id === s.template_id);
  return { title: 'Send email', subtitle: tpl?.name || 'Choose a template', Icon: Mail };
}

function triggerMeta(t: AutomationTriggerType): { label: string; Icon: typeof Tag } {
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

export default function WorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const id = workflowId;

  const [auto, setAuto] = useState<AutomationRow | null>(null);
  const [steps, setSteps] = useState<LocalStep[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const [selTags,   setSelTags]   = useState<string[]>([]);
  const [selStages, setSelStages] = useState<string[]>([]);
  const [selLinks,  setSelLinks]  = useState<string[]>([]);
  const [selForms,  setSelForms]  = useState<string[]>([]);
  const [daysAfterWedding, setDaysAfterWedding] = useState(3);

  const [selected, setSelected] = useState<SelectedItem>(null);

  // ─── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [aRes, tagRes, pipeRes, linkRes, formsRes, tmplRes] = await Promise.all([
      fetch(`/api/marketing/automations/${id}`,        { cache: 'no-store' }),
      fetch('/api/marketing/tags',                     { cache: 'no-store' }),
      fetch('/api/pipelines',                          { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links',            { cache: 'no-store' }),
      fetch('/api/marketing/forms',                    { cache: 'no-store' }),
      fetch('/api/marketing/email-templates',          { cache: 'no-store' }),
    ]);
    if (aRes.ok) {
      const j = await aRes.json();
      const a = j.automation as AutomationRow;
      setAuto(a);
      const cfg = (a.trigger_config || {}) as {
        tag_ids?: string[];
        to_stage_ids?: string[];
        trigger_link_ids?: string[];
        form_ids?: string[];
        days_after_wedding?: number;
      };
      setSelTags(cfg.tag_ids ?? []);
      setSelStages(cfg.to_stage_ids ?? []);
      setSelLinks(cfg.trigger_link_ids ?? []);
      setSelForms(cfg.form_ids ?? []);
      setDaysAfterWedding(Math.max(0, Math.min(3650, Number(cfg.days_after_wedding ?? 3) || 0)));
      const rawSteps = (j.steps ?? []) as Array<{ step_type: string; config_json: Record<string, unknown> }>;
      const mapped: LocalStep[] = rawSteps.map((s, i) => {
        const lid = `s-${i}-${Math.random().toString(36).slice(2)}`;
        if (s.step_type === 'delay') {
          return { localId: lid, step_type: 'delay', delay_minutes: Number((s.config_json as { delay_minutes?: number }).delay_minutes ?? 60) };
        }
        if (s.step_type === 'send_sms') {
          return { localId: lid, step_type: 'send_sms', body: String((s.config_json as { body?: string }).body ?? DEFAULT_AUTOMATION_SMS) };
        }
        return { localId: lid, step_type: 'send_email', template_id: String((s.config_json as { template_id?: string }).template_id ?? '') };
      });
      setSteps(mapped);
    } else setAuto(null);
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

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function toggle(arr: string[], tid: string, set: (v: string[]) => void) {
    set(arr.includes(tid) ? arr.filter((x) => x !== tid) : [...arr, tid]);
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
      if (s.step_type === 'delay')      return { step_order: i, step_type: 'delay'      as const, config: { delay_minutes: Math.max(1, Math.min(10080, s.delay_minutes)) } };
      if (s.step_type === 'send_sms')   return { step_order: i, step_type: 'send_sms'   as const, config: { body: s.body.trim() } };
      return                                   { step_order: i, step_type: 'send_email' as const, config: { template_id: s.template_id } };
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
        name: auto.name,
        status: auto.status,
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
  }

  async function removeAutomation() {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Delete this workflow and all of its enrollments? This cannot be undone.')) return;
    const res = await fetch(`/api/marketing/automations/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/dashboard/marketing/workflows');
    else setErr('Delete failed');
  }

  function moveStep(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= steps.length) return;
    setSteps((prev) => {
      const copy = [...prev];
      const t = copy[index]!;
      copy[index] = copy[j]!;
      copy[j] = t;
      return copy;
    });
  }

  function addStepAtEnd(kind: StepKind) {
    const localId = `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const step: LocalStep =
      kind === 'delay'      ? { localId, step_type: 'delay',      delay_minutes: 60 }
      : kind === 'send_sms' ? { localId, step_type: 'send_sms',   body: DEFAULT_AUTOMATION_SMS }
      :                       { localId, step_type: 'send_email', template_id: templates[0]?.id ?? '' };
    setSteps((prev) => [...prev, step]);
    setSelected({ kind: 'step', localId });
  }

  function removeStep(localId: string) {
    setSteps((prev) => prev.filter((s) => s.localId !== localId));
    setSelected(null);
  }

  // ─── Render gates ──────────────────────────────────────────────────────────
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
  const selectedStep =
    selected?.kind === 'step' ? steps.find((s) => s.localId === selected.localId) ?? null : null;

  return (
    <div className="bg-white" style={{ minHeight: '100vh' }}>
      {/* ── Top Bar — fixed, mirrors email builder header ───────────────────── */}
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
            href="/dashboard/marketing/workflows"
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
          </Link>
        </div>

        {/* Center: step breadcrumb (workflow has only this one screen, but keeps the visual rhythm of the email builder) */}
        <div
          className="hidden sm:flex items-center gap-2 text-[11px] tracking-widest font-medium uppercase"
          style={{ position: 'absolute', left: 'calc(50% - 144px)', transform: 'translateX(-50%)' }}
        >
          <span className="text-gray-700 border-b border-gray-700 pb-0.5">Design Workflow</span>
        </div>

        {/* Right: workflow name + save status + status pill + Save */}
        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
          <input
            className="hidden md:block w-56 max-w-xs border-0 bg-transparent text-sm font-semibold text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-0 text-right"
            value={auto.name}
            onChange={(e) => setAuto({ ...auto, name: e.target.value })}
            aria-label="Workflow name"
          />

          <select
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-gray-400 focus:outline-none"
            value={auto.status}
            onChange={(e) => setAuto({ ...auto, status: e.target.value as AutomationRow['status'] })}
            aria-label="Workflow status"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>

          <div className="flex items-center gap-1.5 min-w-[60px] justify-end">
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

      {err ? (
        <div className="fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 shadow">
          {err}
        </div>
      ) : null}

      {/* ── Content — fixed below the header, two panes scroll independently ── */}
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
        {/* ── Canvas ─────────────────────────────────────────────────────────── */}
        <div
          className="fb-scroll-pane flex-1 overflow-y-auto"
          style={{
            background: '#ffffff',
            paddingTop: '36px',
            paddingBottom: '60px',
            paddingLeft: '40px',
            paddingRight: '80px',
            overscrollBehavior: 'contain',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            minHeight: 0,
          } as React.CSSProperties}
          onClick={() => setSelected(null)}
        >
          {/* Workflow canvas — vertical stack centered like the email card */}
          <div className="mx-auto" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            {/* Trigger card */}
            <button
              type="button"
              onClick={() => setSelected({ kind: 'trigger' })}
              className={`block w-full text-left overflow-hidden rounded-xl border bg-white transition ${
                selected?.kind === 'trigger'
                  ? 'border-gray-900 shadow-md'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-3 p-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                  <TriggerIcon size={18} className="text-gray-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Trigger</p>
                  <p className="mt-0.5 font-semibold text-gray-900">{trig.label}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">Click to configure in the panel →</p>
                </div>
              </div>
            </button>

            {/* Connector */}
            <div className="flex flex-col items-center">
              <div className="h-5 w-px bg-gray-200" />
              <div className="h-2 w-2 rounded-full bg-gray-200" />
              <div className="h-5 w-px bg-gray-200" />
            </div>

            {/* Steps */}
            {steps.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center">
                <p className="text-sm font-medium text-gray-700">No steps yet</p>
                <p className="mt-1 text-xs text-gray-500">Drag a block from the right panel — or click one to add it.</p>
              </div>
            ) : (
              steps.map((s, idx) => {
                const meta = stepMeta(s, templates);
                const StepIcon = meta.Icon;
                const isSelected = selected?.kind === 'step' && selected.localId === s.localId;
                return (
                  <div key={s.localId}>
                    <button
                      type="button"
                      onClick={() => setSelected({ kind: 'step', localId: s.localId })}
                      className={`block w-full text-left overflow-hidden rounded-xl border bg-white transition ${
                        isSelected
                          ? 'border-gray-900 shadow-md'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start gap-3 p-4">
                        <div className="flex flex-col gap-0.5 pt-0.5">
                          <span
                            role="button"
                            tabIndex={0}
                            className="cursor-pointer rounded p-0.5 text-gray-300 transition hover:bg-gray-100 hover:text-gray-700"
                            onClick={(e) => { e.stopPropagation(); moveStep(idx, -1); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); moveStep(idx, -1); } }}
                            title="Move up"
                          >
                            <ChevronUp size={13} />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="cursor-pointer rounded p-0.5 text-gray-300 transition hover:bg-gray-100 hover:text-gray-700"
                            onClick={(e) => { e.stopPropagation(); moveStep(idx, 1); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); moveStep(idx, 1); } }}
                            title="Move down"
                          >
                            <ChevronDown size={13} />
                          </span>
                        </div>
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                          <StepIcon size={18} className="text-gray-700" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Step {idx + 1}</p>
                          <p className="mt-0.5 font-semibold text-gray-900">{meta.title}</p>
                          <p className="mt-0.5 truncate text-xs text-gray-500">{meta.subtitle}</p>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer rounded p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                          onClick={(e) => { e.stopPropagation(); removeStep(s.localId); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeStep(s.localId); } }}
                          aria-label="Remove step"
                          title="Remove step"
                        >
                          <Trash2 size={14} />
                        </span>
                      </div>
                    </button>
                    {/* Connector after each step */}
                    <div className="flex flex-col items-center">
                      <div className="h-5 w-px bg-gray-200" />
                      <div className="h-2 w-2 rounded-full bg-gray-200" />
                      <div className="h-5 w-px bg-gray-200" />
                    </div>
                  </div>
                );
              })
            )}

            {/* End cap */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">End of workflow</p>
            </div>
          </div>
        </div>

        {/* ── Right Panel ────────────────────────────────────────────────────── */}
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
            {selected?.kind === 'trigger' ? (
              <div className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                    Trigger
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Done
                  </button>
                </div>

                <div className="mb-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Type</p>
                  <p className="mt-1 text-sm font-medium capitalize text-gray-800">{trig.label}</p>
                  <p className="mt-1 text-[11px] text-gray-400">Fixed after creation — duplicate the workflow to change.</p>
                </div>

                {auto.trigger_type === 'form_submitted' ? (
                  <div className="mb-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Forms</p>
                    {forms.length === 0 ? (
                      <p className="text-[11px] text-gray-500">
                        No forms yet.{' '}
                        <Link href="/dashboard/marketing/form-builder" className="text-brand-600 hover:underline">
                          Create one →
                        </Link>
                      </p>
                    ) : (
                      <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
                        {forms.map((f) => (
                          <label key={f.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selForms.includes(f.id)}
                              onChange={() => toggle(selForms, f.id, setSelForms)}
                            />
                            <span className="truncate">{f.name}</span>
                            {!f.published ? <span className="text-gray-400">(draft)</span> : null}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-gray-400">Empty = enroll on any form. The form must include an Email field.</p>
                  </div>
                ) : null}

                {auto.trigger_type === 'tag_added' ? (
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
                ) : null}

                {auto.trigger_type === 'stage_changed' ? (
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
                ) : null}

                {auto.trigger_type === 'trigger_link_click' ? (
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
                ) : null}

                {auto.trigger_type === 'wedding_date_followup' ? (
                  <div className="mb-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Days after wedding date</p>
                    <input
                      type="number"
                      min={0}
                      max={3650}
                      className="w-32 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                      value={daysAfterWedding}
                      onChange={(e) => setDaysAfterWedding(Number(e.target.value) || 0)}
                    />
                  </div>
                ) : null}

                {auto.trigger_type === 'proposal_paid' ? (
                  <p className="mb-4 text-xs text-gray-500">Enrolls when a proposal is marked paid — lead matched by email address.</p>
                ) : null}

                <div className="mt-6 border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={() => void removeAutomation()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={12} /> Delete workflow
                  </button>
                </div>
              </div>
            ) : selectedStep ? (
              <div className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                    {selectedStep.step_type === 'send_email' ? 'send email' : selectedStep.step_type === 'send_sms' ? 'send sms' : 'wait'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    Done
                  </button>
                </div>

                {selectedStep.step_type === 'delay' ? (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Wait duration</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={10080}
                        className="w-24 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                        value={selectedStep.delay_minutes}
                        onChange={(e) => {
                          const n = Number(e.target.value) || 1;
                          const lid = selectedStep.localId;
                          setSteps((prev) => prev.map((x) => (x.localId === lid && x.step_type === 'delay' ? { ...x, delay_minutes: n } : x)));
                        }}
                      />
                      <span className="text-xs text-gray-500">minutes</span>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-400">
                      ≈ {Math.round((selectedStep.delay_minutes / 60) * 10) / 10} hours
                      {' · '}
                      ≈ {Math.round((selectedStep.delay_minutes / 1440) * 10) / 10} days
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {[
                        { label: '15m',  m: 15 },
                        { label: '1h',   m: 60 },
                        { label: '1d',   m: 1440 },
                        { label: '2d',   m: 2880 },
                        { label: '3d',   m: 4320 },
                        { label: '7d',   m: 10080 },
                      ].map((p) => {
                        const lid = selectedStep.localId;
                        return (
                          <button
                            key={p.label}
                            type="button"
                            className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:border-gray-400"
                            onClick={() => setSteps((prev) => prev.map((x) => (x.localId === lid && x.step_type === 'delay' ? { ...x, delay_minutes: p.m } : x)))}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedStep.step_type === 'send_email' ? (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Template</p>
                    {templates.length === 0 ? (
                      <p className="text-[11px] text-gray-500">
                        No templates yet.{' '}
                        <Link href="/dashboard/marketing/email/templates" className="text-brand-600 hover:underline">
                          Create one →
                        </Link>
                      </p>
                    ) : (
                      <select
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                        value={selectedStep.template_id}
                        onChange={(e) => {
                          const v = e.target.value;
                          const lid = selectedStep.localId;
                          setSteps((prev) => prev.map((x) => (x.localId === lid && x.step_type === 'send_email' ? { ...x, template_id: v } : x)));
                        }}
                      >
                        <option value="">Choose a template</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    )}
                    <p className="mt-2 text-[11px] text-gray-400">Sends respect unsubscribe and bounce suppression automatically.</p>
                  </div>
                ) : null}

                {selectedStep.step_type === 'send_sms' ? (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Message body</p>
                    <textarea
                      className="min-h-[100px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                      value={selectedStep.body}
                      onChange={(e) => {
                        const v = e.target.value;
                        const lid = selectedStep.localId;
                        setSteps((prev) => prev.map((x) => (x.localId === lid && x.step_type === 'send_sms' ? { ...x, body: v } : x)));
                      }}
                    />
                    <p className="mt-2 text-[11px] text-gray-400">Use {`{{first_name}}`} and {`{{venue_name}}`} for personalization. STOP/DND is honored automatically.</p>
                  </div>
                ) : null}

                <div className="mt-6 border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={() => removeStep(selectedStep.localId)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-100 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={12} /> Remove step
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Blocks</p>
                <p className="mb-4 text-[11px] text-gray-400">Click a block to add it to the end of your workflow, or click an existing block on the canvas to edit it.</p>
                <div className="flex flex-col gap-2">
                  {PALETTE.map((item) => {
                    const ItemIcon = item.Icon;
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => addStepAtEnd(item.type)}
                        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-gray-300"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50">
                          <ItemIcon size={15} className="text-gray-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 leading-tight">{item.label}</p>
                          <p className="text-[11px] text-gray-400 truncate">{item.desc}</p>
                        </div>
                        <Plus size={13} className="ml-auto flex-shrink-0 text-gray-300" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Footer status bar — mirrors email builder ───────────────────── */}
          <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-white">
            <span className="text-[11px] text-gray-400">
              {steps.length === 0 ? 'No steps yet' : `${steps.length} step${steps.length === 1 ? '' : 's'}`}
            </span>
            <span className="ml-auto text-sm text-gray-400">
              {saveStatus === 'saving' && 'Saving…'}
              {saveStatus === 'saved'  && 'Saved'}
              {saveStatus === 'error'  && 'Error'}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
