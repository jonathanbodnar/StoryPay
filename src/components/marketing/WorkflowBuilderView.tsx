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
  Link2,
  Loader2,
  Mail,
  Maximize2,
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
      bar: 'bg-gray-400',
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
      <div className="flex min-h-[50vh] items-center justify-center text-gray-500">
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
        <div className="h-5 w-px bg-gray-200" />
        <button
          type="button"
          onClick={() => setInsertMenuAt(open ? null : at)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition hover:border-brand-900 hover:bg-brand-900 hover:text-white"
          aria-label="Add step"
        >
          <Plus size={14} strokeWidth={2.5} />
        </button>
        {open ? (
          <div className="absolute top-full z-20 mt-2 min-w-[140px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              onClick={() => insertStep(at, 'delay')}
            >
              <Clock size={13} className="text-gray-400" /> Wait
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-left text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              onClick={() => insertStep(at, 'send_email')}
            >
              <Mail size={13} className="text-gray-400" /> Send email
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-left text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              onClick={() => insertStep(at, 'send_sms')}
            >
              <Smartphone size={13} className="text-gray-400" /> Send SMS
            </button>
          </div>
        ) : null}
        <div className="h-5 w-px bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      {/* Top bar — mirrors email builder and form builder header */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 lg:-mx-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/marketing/workflows"
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} />
            Workflows
          </Link>
          <span className="hidden h-4 w-px bg-gray-200 sm:block" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input
              className="min-w-0 max-w-md border-0 bg-transparent text-lg font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
              value={auto.name}
              onChange={(e) => setAuto({ ...auto, name: e.target.value })}
              aria-label="Workflow name"
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                auto.status === 'active'
                  ? 'bg-emerald-50 text-emerald-700'
                  : auto.status === 'paused'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
              }`}
            >
              {auto.status}
            </span>
            {msg ? <span className="text-xs font-medium text-emerald-600">Saved</span> : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAll()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-1">
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
                tab === k ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {lab}
              {tab === k ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gray-900" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}

      {tab === 'settings' ? (
        <div className="mx-auto mt-6 w-full max-w-3xl space-y-4 pb-16">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-gray-900">Workflow settings</h2>
            <p className="mt-1 text-xs text-gray-500">
              Email &amp; SMS steps today — more channels can plug into this builder later.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Status</label>
                <select
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  value={auto.status}
                  onChange={(e) => setAuto({ ...auto, status: e.target.value as AutomationRow['status'] })}
                >
                  <option value="draft">Draft (does not enroll)</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Trigger type</p>
                <p className="mt-1 text-sm capitalize text-gray-800">{auto.trigger_type.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-xs text-gray-500">Fixed after creation — create a new workflow to change the trigger.</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-sm font-semibold text-gray-900">Trigger configuration</h3>
            {auto.trigger_type === 'tag_added' ? (
              <div className="mt-3">
                <p className="mb-2 text-xs text-gray-500">Choose tags — leave empty to fire on any tag added.</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <label key={t.id} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs cursor-pointer hover:border-gray-300">
                      <input type="checkbox" checked={selTags.includes(t.id)} onChange={() => toggle(selTags, t.id, setSelTags)} />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {auto.trigger_type === 'stage_changed' ? (
              <div className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
                <p className="mb-2 text-xs text-gray-500">Choose stages — fire when a lead enters any of these.</p>
                {stages.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selStages.includes(s.id)} onChange={() => toggle(selStages, s.id, setSelStages)} />
                    <span className="text-gray-400">{s.pipelineName}:</span> {s.name}
                  </label>
                ))}
              </div>
            ) : null}
            {auto.trigger_type === 'trigger_link_click' ? (
              <div className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
                <p className="mb-2 text-xs text-gray-500">Choose trigger links — fire when any of these are clicked.</p>
                {links.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selLinks.includes(l.id)} onChange={() => toggle(selLinks, l.id, setSelLinks)} />
                    {l.name} <span className="text-gray-400">({l.short_code})</span>
                  </label>
                ))}
              </div>
            ) : null}
            {auto.trigger_type === 'wedding_date_followup' ? (
              <div className="mt-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5" htmlFor="days-after-wedding">
                  Days after wedding date
                </label>
                <input
                  id="days-after-wedding"
                  type="number"
                  min={0}
                  max={3650}
                  className="w-32 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  value={daysAfterWedding}
                  onChange={(e) => setDaysAfterWedding(Number(e.target.value) || 0)}
                />
                <p className="mt-2 text-xs text-gray-500">Days can be negative (before) or positive (after) the wedding date.</p>
              </div>
            ) : null}
            {auto.trigger_type === 'proposal_paid' ? (
              <p className="mt-3 text-xs text-gray-500">
                Enrolls when a proposal is marked paid — lead matched by email address.
              </p>
            ) : null}
            {auto.trigger_type === 'form_submitted' ? (
              <div className="mt-3">
                <p className="mb-2 text-xs text-gray-500">Choose forms — leave empty to enroll on any form submission.</p>
                {forms.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No forms yet.{' '}
                    <Link href="/dashboard/marketing/form-builder" className="text-brand-600 hover:underline">
                      Create one in Lead Capture Forms →
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
                        {f.name}
                        {!f.published ? <span className="text-gray-400">(draft)</span> : null}
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-gray-400">
                  The form must include an Email field — that&apos;s what links the submission to a lead.
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-red-100 bg-white p-6">
            <h3 className="text-sm font-semibold text-gray-900">Danger zone</h3>
            <p className="mt-1 text-xs text-gray-500">Permanently delete this workflow and all its enrollments.</p>
            <button
              type="button"
              onClick={() => void removeAutomation()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <Trash2 size={14} />
              Delete workflow
            </button>
          </div>
        </div>
      ) : (
        <div className="relative mt-4 flex min-h-[560px] flex-1 flex-col lg:flex-row">
          {/* Canvas */}
          <div className={`relative flex-1 overflow-auto rounded-xl border border-gray-200 ${GRID_BG}`}>
            <div
              className="mx-auto flex min-h-full justify-center px-6 pb-24 pt-8"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            >
              <div className="flex w-full max-w-md flex-col items-center">
                {/* Trigger card */}
                <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="flex items-start gap-3 p-4">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${triggerIconClass}`}>
                      <TriggerIcon size={20} strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Trigger</p>
                      <p className="font-semibold text-gray-900">{triggerLabel}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{trigSub}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('settings')}
                      className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                      title="Edit trigger in Settings"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                </div>

                <ConnectorAdd at={0} />

                {steps.length === 0 ? (
                  <div className="w-full rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                    <p className="text-sm font-medium text-gray-700">No steps yet</p>
                    <p className="mt-1 text-xs text-gray-500">Click the + above to add a wait, send email, or send SMS step.</p>
                  </div>
                ) : (
                  steps.map((s, idx) => {
                    const meta = stepMeta(s);
                    const templateName =
                      s.step_type === 'send_email'
                        ? templates.find((t) => t.id === s.template_id)?.name || 'Select a template'
                        : '';
                    return (
                      <div key={s.localId} className="flex w-full flex-col items-center">
                        <div className="w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                          <div className={`h-1 w-full ${meta.bar}`} />
                          <div className="flex items-start gap-3 p-4">
                            <div className="flex flex-col gap-0.5 pt-0.5">
                              <button
                                type="button"
                                className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                                onClick={() => moveStep(idx, -1)}
                                title="Move up"
                              >
                                <ChevronUp size={15} />
                              </button>
                              <button
                                type="button"
                                className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                                onClick={() => moveStep(idx, 1)}
                                title="Move down"
                              >
                                <ChevronDown size={15} />
                              </button>
                            </div>
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                              <meta.Icon size={20} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-2 text-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-gray-900">{meta.title}</p>
                                  <p className="text-xs text-gray-500">{s.step_type === 'send_email' ? templateName : meta.subtitle}</p>
                                </div>
                                <button
                                  type="button"
                                  className="text-gray-400 transition hover:text-red-500"
                                  onClick={() => setSteps((prev) => prev.filter((x) => x.localId !== s.localId))}
                                  aria-label="Remove step"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                              {s.step_type === 'delay' ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min={1}
                                    max={10080}
                                    className="w-24 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs focus:border-gray-400 focus:bg-white focus:outline-none"
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
                                  <span className="text-xs text-gray-500">minutes</span>
                                  <span className="text-xs text-gray-400">({Math.round(s.delay_minutes / 60 * 10) / 10}h)</span>
                                </div>
                              ) : null}
                              {s.step_type === 'send_email' ? (
                                <select
                                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-gray-400 focus:bg-white focus:outline-none"
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
                                  className="min-h-[72px] w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs focus:border-gray-400 focus:bg-white focus:outline-none"
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

          {/* Zoom controls */}
          <div className="mt-4 flex flex-row gap-2 lg:mt-0 lg:w-12 lg:flex-col lg:pl-2">
            <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
              <button
                type="button"
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
                onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10))}
                title="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
              <div className="py-0.5 text-center text-[9px] font-medium text-gray-400">{Math.round(zoom * 100)}%</div>
              <button
                type="button"
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
                onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                title="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
                onClick={() => setZoom(1)}
                title="Reset zoom"
              >
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
