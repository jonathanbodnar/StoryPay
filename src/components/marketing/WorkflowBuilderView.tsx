'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Hand,
  Link2,
  Loader2,
  Mail,
  Maximize2,
  Minus,
  MoreHorizontal,
  Plus,
  Save,
  Smartphone,
  Tag,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AutomationTriggerType } from '@/lib/marketing-email-schema';

interface AutomationRow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused';
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
}

interface TagRow {
  id: string;
  name: string;
}

interface StageOpt {
  id: string;
  name: string;
  pipelineName: string;
}

interface LinkRow {
  id: string;
  name: string;
  short_code: string;
}

interface FormRow {
  id: string;
  name: string;
  published: boolean;
}

interface TemplateOpt {
  id: string;
  name: string;
}

const DEFAULT_AUTOMATION_SMS =
  'Hi {{first_name}}, a quick note from {{venue_name}}. Reply STOP to opt out.';

type LocalStep =
  | { localId: string; step_type: 'delay'; delay_minutes: number }
  | { localId: string; step_type: 'send_email'; template_id: string }
  | { localId: string; step_type: 'send_sms'; body: string };

type BuilderTab = 'builder' | 'settings';

const GRID_BG =
  'bg-[#eef1f6] [background-image:linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:20px_20px]';

function triggerMeta(t: AutomationTriggerType): { label: string; Icon: typeof Tag; iconClass: string } {
  switch (t) {
    case 'tag_added':
      return { label: 'Tag added', Icon: Tag, iconClass: 'bg-emerald-500 text-white' };
    case 'stage_changed':
      return { label: 'Stage changed', Icon: GitBranch, iconClass: 'bg-sky-600 text-white' };
    case 'trigger_link_click':
      return { label: 'Trigger link click', Icon: Link2, iconClass: 'bg-violet-600 text-white' };
    case 'wedding_date_followup':
      return { label: 'After wedding date', Icon: CalendarHeart, iconClass: 'bg-rose-500 text-white' };
    case 'proposal_paid':
      return { label: 'Proposal paid', Icon: DollarSign, iconClass: 'bg-amber-500 text-white' };
    case 'form_submitted':
      return { label: 'Form submitted', Icon: ClipboardList, iconClass: 'bg-indigo-600 text-white' };
    default: {
      const u = t as string;
      return { label: u.replace(/_/g, ' '), Icon: Tag, iconClass: 'bg-slate-600 text-white' };
    }
  }
}

function stepMeta(s: LocalStep): { title: string; subtitle: string; Icon: typeof Clock; bar: string } {
  if (s.step_type === 'delay') {
    return {
      title: 'Wait',
      subtitle: `${s.delay_minutes} minute${s.delay_minutes === 1 ? '' : 's'}`,
      Icon: Clock,
      bar: 'bg-slate-400',
    };
  }
  if (s.step_type === 'send_sms') {
    return {
      title: 'Send SMS',
      subtitle: s.body.trim().slice(0, 72) + (s.body.length > 72 ? '…' : ''),
      Icon: Smartphone,
      bar: 'bg-emerald-500',
    };
  }
  return { title: 'Send email', subtitle: 'Template message', Icon: Mail, bar: 'bg-sky-500' };
}

function triggerSubtitle(
  auto: AutomationRow,
  selTags: string[],
  selStages: string[],
  selLinks: string[],
  selForms: string[],
  tags: TagRow[],
  stages: StageOpt[],
  links: LinkRow[],
  forms: FormRow[],
  daysAfterWedding: number,
): string {
  switch (auto.trigger_type) {
    case 'tag_added':
      if (selTags.length === 0) return 'Runs when any tag is added to a lead';
      {
        const names = selTags
          .map((id) => tags.find((t) => t.id === id)?.name)
          .filter(Boolean)
          .slice(0, 3);
        const extra = selTags.length > 3 ? ` +${selTags.length - 3}` : '';
        return `Tag is any of: ${names.join(', ')}${extra}`;
      }
    case 'stage_changed':
      if (selStages.length === 0) return 'Runs when a lead enters any stage you select below';
      return `${selStages.length} stage(s) selected`;
    case 'trigger_link_click':
      if (selLinks.length === 0) return 'Choose at least one trigger link in Settings';
      return `${selLinks.length} link(s) selected`;
    case 'wedding_date_followup':
      return `${daysAfterWedding} day(s) after wedding date (venue timezone)`;
    case 'proposal_paid':
      return 'When a proposal is marked paid (matched by lead email)';
    case 'form_submitted':
      if (selForms.length === 0) return 'Runs when any lead-capture form is submitted';
      {
        const names = selForms
          .map((id) => forms.find((f) => f.id === id)?.name)
          .filter(Boolean)
          .slice(0, 3);
        const extra = selForms.length > 3 ? ` +${selForms.length - 3}` : '';
        return `Form is any of: ${names.join(', ')}${extra}`;
      }
    default:
      return '';
  }
}

export default function WorkflowBuilderView({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const id = workflowId;

  const [tab, setTab] = useState<BuilderTab>('builder');
  const [auto, setAuto] = useState<AutomationRow | null>(null);
  const [steps, setSteps] = useState<LocalStep[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [selTags, setSelTags] = useState<string[]>([]);
  const [selStages, setSelStages] = useState<string[]>([]);
  const [selLinks, setSelLinks] = useState<string[]>([]);
  const [selForms, setSelForms] = useState<string[]>([]);
  const [daysAfterWedding, setDaysAfterWedding] = useState(3);

  const [zoom, setZoom] = useState(1);
  const [insertMenuAt, setInsertMenuAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [aRes, tagRes, pipeRes, linkRes, formsRes, tmplRes] = await Promise.all([
      fetch(`/api/marketing/automations/${id}`, { cache: 'no-store' }),
      fetch('/api/marketing/tags', { cache: 'no-store' }),
      fetch('/api/pipelines', { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links', { cache: 'no-store' }),
      fetch('/api/marketing/forms', { cache: 'no-store' }),
      fetch('/api/marketing/email-templates', { cache: 'no-store' }),
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
          return {
            localId: lid,
            step_type: 'delay',
            delay_minutes: Number((s.config_json as { delay_minutes?: number }).delay_minutes ?? 60),
          };
        }
        if (s.step_type === 'send_sms') {
          return {
            localId: lid,
            step_type: 'send_sms',
            body: String((s.config_json as { body?: string }).body ?? DEFAULT_AUTOMATION_SMS),
          };
        }
        return {
          localId: lid,
          step_type: 'send_email',
          template_id: String((s.config_json as { template_id?: string }).template_id ?? ''),
        };
      });
      setSteps(mapped);
    } else setAuto(null);
    if (tagRes.ok) {
      const d = await tagRes.json();
      setTags(d.tags ?? []);
    }
    if (pipeRes.ok) {
      const d = await pipeRes.json();
      const pipes = d.pipelines ?? [];
      const flat: StageOpt[] = [];
      for (const p of pipes) {
        for (const s of p.stages ?? []) {
          flat.push({ id: s.id, name: s.name, pipelineName: p.name });
        }
      }
      setStages(flat);
    }
    if (linkRes.ok) {
      const d = await linkRes.json();
      setLinks(d.links ?? []);
    }
    if (formsRes.ok) {
      const d = await formsRes.json();
      setForms(d.forms ?? []);
    }
    if (tmplRes.ok) {
      const d = await tmplRes.json();
      setTemplates(d.templates ?? []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (insertMenuAt === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInsertMenuAt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [insertMenuAt]);

  function toggle(arr: string[], tid: string, set: (v: string[]) => void) {
    set(arr.includes(tid) ? arr.filter((x) => x !== tid) : [...arr, tid]);
  }

  function buildTriggerConfig(): Record<string, unknown> {
    if (!auto) return {};
    if (auto.trigger_type === 'tag_added') return { tag_ids: selTags };
    if (auto.trigger_type === 'stage_changed') return { to_stage_ids: selStages };
    if (auto.trigger_type === 'wedding_date_followup') {
      return { days_after_wedding: Math.max(0, Math.min(3650, Math.floor(daysAfterWedding))) };
    }
    if (auto.trigger_type === 'proposal_paid') return {};
    if (auto.trigger_type === 'form_submitted') return { form_ids: selForms };
    return { trigger_link_ids: selLinks };
  }

  function stepsPayload() {
    return steps.map((s, i) => {
      if (s.step_type === 'delay') {
        return {
          step_order: i,
          step_type: 'delay' as const,
          config: { delay_minutes: Math.max(1, Math.min(10080, s.delay_minutes)) },
        };
      }
      if (s.step_type === 'send_sms') {
        return { step_order: i, step_type: 'send_sms' as const, config: { body: s.body.trim() } };
      }
      return { step_order: i, step_type: 'send_email' as const, config: { template_id: s.template_id } };
    });
  }

  async function saveAll() {
    if (!auto) return;
    setSaving(true);
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
    if (!res.ok) {
      setErr((j as { error?: string }).error || 'Save failed');
      return;
    }
    setMsg('Saved');
    setTimeout(() => setMsg(null), 2000);
    void load();
  }

  async function removeAutomation() {
    if (!confirm('Delete this workflow and its enrollments?')) return;
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

  function insertStep(at: number, kind: 'delay' | 'send_email' | 'send_sms') {
    const newStep: LocalStep =
      kind === 'delay'
        ? { localId: crypto.randomUUID(), step_type: 'delay', delay_minutes: 60 }
        : kind === 'send_email'
          ? { localId: crypto.randomUUID(), step_type: 'send_email', template_id: templates[0]?.id ?? '' }
          : { localId: crypto.randomUUID(), step_type: 'send_sms', body: DEFAULT_AUTOMATION_SMS };
    setSteps((prev) => {
      const copy = [...prev];
      copy.splice(at, 0, newStep);
      return copy;
    });
    setInsertMenuAt(null);
  }

  const minimapDots = useMemo(() => 1 + steps.length, [steps.length]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-slate-500">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!auto) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-slate-600">Workflow not found.</p>
        <Link href="/dashboard/marketing/workflows" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Back to Workflows
        </Link>
      </div>
    );
  }

  const { label: triggerLabel, Icon: TriggerIcon, iconClass: triggerIconClass } = triggerMeta(auto.trigger_type);
  const trigSub = triggerSubtitle(
    auto,
    selTags,
    selStages,
    selLinks,
    selForms,
    tags,
    stages,
    links,
    forms,
    daysAfterWedding,
  );

  function ConnectorAdd({ at }: { at: number }) {
    const open = insertMenuAt === at;
    return (
      <div className="relative flex flex-col items-center">
        <div className="h-4 w-px bg-slate-300" />
        <button
          type="button"
          onClick={() => setInsertMenuAt(open ? null : at)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-white text-slate-500 shadow-sm transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-600"
          aria-label="Add step"
        >
          <Plus size={16} strokeWidth={2.5} />
        </button>
        {open ? (
          <div className="absolute top-full z-20 mt-2 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
            <button
              type="button"
              className="whitespace-nowrap rounded-md px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => insertStep(at, 'delay')}
            >
              Wait (delay)
            </button>
            <button
              type="button"
              className="whitespace-nowrap rounded-md px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => insertStep(at, 'send_email')}
            >
              Send email
            </button>
            <button
              type="button"
              className="whitespace-nowrap rounded-md px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => insertStep(at, 'send_sms')}
            >
              Send SMS
            </button>
          </div>
        ) : null}
        <div className="h-4 w-px bg-slate-300" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      {/* Top bar — GHL-inspired */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 lg:-mx-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/marketing/workflows"
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            Back to Workflows
          </Link>
          <span className="hidden h-4 w-px bg-slate-200 sm:block" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input
              className="min-w-0 max-w-md border-0 bg-transparent text-lg font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              value={auto.name}
              onChange={(e) => setAuto({ ...auto, name: e.target.value })}
              aria-label="Workflow name"
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                auto.status === 'active'
                  ? 'bg-emerald-100 text-emerald-800'
                  : auto.status === 'paused'
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {auto.status}
            </span>
            {msg ? <span className="text-xs font-medium text-emerald-600">Saved</span> : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAll()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#155eef] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#1249d1] disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save
            </button>
          </div>
        </div>
        <div className="mt-3 flex gap-1 border-b border-transparent">
          {(
            [
              ['builder', 'Builder'],
              ['settings', 'Settings'],
            ] as const
          ).map(([k, lab]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`relative px-4 py-2 text-sm font-medium transition ${
                tab === k ? 'text-[#155eef]' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {lab}
              {tab === k ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#155eef]" />
              ) : null}
            </button>
          ))}
          <button
            type="button"
            disabled
            className="cursor-not-allowed px-4 py-2 text-sm font-medium text-slate-400"
            title="Coming soon"
          >
            Enrollment history
          </button>
          <button
            type="button"
            disabled
            className="cursor-not-allowed px-4 py-2 text-sm font-medium text-slate-400"
            title="Coming soon"
          >
            Execution logs
          </button>
        </div>
      </div>

      {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}

      {tab === 'settings' ? (
        <div className="mx-auto mt-6 w-full max-w-3xl space-y-6 pb-16">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Workflow settings</h2>
            <p className="mt-1 text-xs text-slate-500">
              Today: email &amp; SMS steps. More channels can plug into this builder later.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500">Status</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={auto.status}
                  onChange={(e) => setAuto({ ...auto, status: e.target.value as AutomationRow['status'] })}
                >
                  <option value="draft">Draft (does not enroll)</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Trigger type</p>
                <p className="mt-1 text-sm capitalize text-slate-800">{auto.trigger_type.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-xs text-slate-500">Fixed after creation — duplicate the workflow to change trigger.</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Trigger configuration</h3>
            {auto.trigger_type === 'tag_added' ? (
              <div className="mt-3">
                <p className="text-xs font-medium text-slate-500">Tags (empty = any tag)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <label key={t.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs">
                      <input type="checkbox" checked={selTags.includes(t.id)} onChange={() => toggle(selTags, t.id, setSelTags)} />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {auto.trigger_type === 'stage_changed' ? (
              <div className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
                {stages.map((s) => (
                  <label key={s.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={selStages.includes(s.id)} onChange={() => toggle(selStages, s.id, setSelStages)} />
                    <span className="text-slate-500">{s.pipelineName}:</span> {s.name}
                  </label>
                ))}
              </div>
            ) : null}
            {auto.trigger_type === 'trigger_link_click' ? (
              <div className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
                {links.map((l) => (
                  <label key={l.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={selLinks.includes(l.id)} onChange={() => toggle(selLinks, l.id, setSelLinks)} />
                    {l.name} <span className="text-slate-400">({l.short_code})</span>
                  </label>
                ))}
              </div>
            ) : null}
            {auto.trigger_type === 'wedding_date_followup' ? (
              <div className="mt-3">
                <label className="text-xs font-medium text-slate-500" htmlFor="days-after-wedding">
                  Days after wedding date
                </label>
                <input
                  id="days-after-wedding"
                  type="number"
                  min={0}
                  max={3650}
                  className="mt-1 w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={daysAfterWedding}
                  onChange={(e) => setDaysAfterWedding(Number(e.target.value) || 0)}
                />
              </div>
            ) : null}
            {auto.trigger_type === 'proposal_paid' ? (
              <p className="mt-3 text-xs text-slate-600">
                Enrolls when a proposal is marked paid — lead matched by email.
              </p>
            ) : null}
            {auto.trigger_type === 'form_submitted' ? (
              <div className="mt-3">
                <p className="text-xs font-medium text-slate-500">Forms (empty = any form)</p>
                {forms.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No forms yet. Create one in{' '}
                    <Link href="/dashboard/marketing/forms" className="text-[#155eef] hover:underline">
                      Marketing → Forms
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
                    {forms.map((f) => (
                      <label key={f.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selForms.includes(f.id)}
                          onChange={() => toggle(selForms, f.id, setSelForms)}
                        />
                        {f.name}
                        {!f.published ? <span className="text-slate-400">(draft)</span> : null}
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  The lead must include an email address on the form for enrollment.
                </p>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void removeAutomation()}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            Delete workflow
          </button>
        </div>
      ) : (
        <div className="relative mt-4 flex min-h-[560px] flex-1 flex-col lg:flex-row">
          {/* Canvas */}
          <div className={`relative flex-1 overflow-auto rounded-xl border border-slate-200/80 ${GRID_BG}`}>
            <div
              className="mx-auto flex min-h-full justify-center px-6 py-10 pb-24 pt-8"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            >
              <div className="flex w-full max-w-md flex-col items-center">
                {/* Trigger card */}
                <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-start gap-3 p-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${triggerIconClass}`}>
                      <TriggerIcon size={20} strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Trigger</p>
                      <p className="font-semibold text-slate-900">{triggerLabel}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{trigSub}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('settings')}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="Edit trigger in Settings"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                </div>

                <ConnectorAdd at={0} />

                {steps.length === 0 ? (
                  <div className="w-full rounded-xl border border-dashed border-slate-300 bg-white/90 px-4 py-8 text-center shadow-sm">
                    <p className="text-sm text-slate-600">No actions yet.</p>
                    <p className="mt-1 text-xs text-slate-500">Use the + above or below to add waits, emails, or SMS.</p>
                  </div>
                ) : (
                  steps.map((s, idx) => {
                    const meta = stepMeta(s);
                    const templateName =
                      s.step_type === 'send_email'
                        ? templates.find((t) => t.id === s.template_id)?.name || 'Select template'
                        : '';
                    return (
                      <div key={s.localId} className="flex w-full flex-col items-center">
                        <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                          <div className={`h-1 w-full ${meta.bar}`} />
                          <div className="flex items-start gap-3 p-4">
                            <div className="flex flex-col gap-0.5 pt-0.5">
                              <button
                                type="button"
                                className="rounded text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                                onClick={() => moveStep(idx, -1)}
                                title="Move up"
                              >
                                <ChevronUp size={16} />
                              </button>
                              <button
                                type="button"
                                className="rounded text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                                onClick={() => moveStep(idx, 1)}
                                title="Move down"
                              >
                                <ChevronDown size={16} />
                              </button>
                            </div>
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700`}>
                              <meta.Icon size={20} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-2 text-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-slate-900">{meta.title}</p>
                                  {s.step_type === 'send_email' ? (
                                    <p className="text-xs text-slate-600">{templateName}</p>
                                  ) : s.step_type === 'send_sms' ? (
                                    <p className="text-xs text-slate-600">{meta.subtitle}</p>
                                  ) : (
                                    <p className="text-xs text-slate-600">{meta.subtitle}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  className="text-slate-400 hover:text-red-600"
                                  onClick={() => setSteps((prev) => prev.filter((x) => x.localId !== s.localId))}
                                  aria-label="Remove step"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                              {s.step_type === 'delay' ? (
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                  Minutes
                                  <input
                                    type="number"
                                    min={1}
                                    max={10080}
                                    className="w-24 rounded-lg border border-slate-200 px-2 py-1"
                                    value={s.delay_minutes}
                                    onChange={(e) => {
                                      const n = Number(e.target.value) || 1;
                                      setSteps((prev) =>
                                        prev.map((x) =>
                                          x.localId === s.localId && x.step_type === 'delay' ? { ...x, delay_minutes: n } : x,
                                        ),
                                      );
                                    }}
                                  />
                                </label>
                              ) : null}
                              {s.step_type === 'send_email' ? (
                                <select
                                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                                  value={s.template_id}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSteps((prev) =>
                                      prev.map((x) =>
                                        x.localId === s.localId && x.step_type === 'send_email' ? { ...x, template_id: v } : x,
                                      ),
                                    );
                                  }}
                                >
                                  {templates.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                              {s.step_type === 'send_sms' ? (
                                <textarea
                                  className="min-h-[72px] w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                                  value={s.body}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSteps((prev) =>
                                      prev.map((x) =>
                                        x.localId === s.localId && x.step_type === 'send_sms' ? { ...x, body: v } : x,
                                      ),
                                    );
                                  }}
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <ConnectorAdd at={idx + 1} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Zoom + minimap */}
          <div className="mt-4 flex flex-row justify-between gap-4 lg:mt-0 lg:w-44 lg:flex-col lg:pl-4">
            <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
              <button
                type="button"
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                title="Pan (scroll canvas)"
                disabled
              >
                <Hand size={18} />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10))}
              >
                <ZoomIn size={18} />
              </button>
              <div className="py-1 text-center text-[10px] font-medium text-slate-500">{Math.round(zoom * 100)}%</div>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
              >
                <ZoomOut size={18} />
              </button>
              <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" onClick={() => setZoom(1)} title="100%">
                <Minus size={18} />
              </button>
              <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" onClick={() => setZoom(1)} title="Fit">
                <Maximize2 size={18} />
              </button>
            </div>
            <div className="hidden h-28 w-36 rounded-xl border border-slate-200 bg-white p-2 shadow-sm lg:block">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">Map</p>
              <div className="mt-2 flex flex-col items-center gap-1">
                <div className="h-2 w-2 rounded-sm bg-emerald-500" title="Trigger" />
                {steps.map((s) => (
                  <div key={s.localId} className="flex flex-col items-center gap-0.5">
                    <div className="h-3 w-px bg-slate-300" />
                    <div
                      className={`h-1.5 w-8 rounded-sm ${
                        s.step_type === 'delay' ? 'bg-slate-400' : s.step_type === 'send_sms' ? 'bg-emerald-500' : 'bg-sky-500'
                      }`}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-center text-[9px] text-slate-400">{minimapDots} nodes</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
