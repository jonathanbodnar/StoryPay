'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
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

interface TemplateOpt {
  id: string;
  name: string;
}

type LocalStep =
  | { localId: string; step_type: 'delay'; delay_minutes: number }
  | { localId: string; step_type: 'send_email'; template_id: string };

export default function AutomationEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');

  const [auto, setAuto] = useState<AutomationRow | null>(null);
  const [steps, setSteps] = useState<LocalStep[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [stages, setStages] = useState<StageOpt[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [selTags, setSelTags] = useState<string[]>([]);
  const [selStages, setSelStages] = useState<string[]>([]);
  const [selLinks, setSelLinks] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [aRes, tagRes, pipeRes, linkRes, tmplRes] = await Promise.all([
      fetch(`/api/marketing/automations/${id}`, { cache: 'no-store' }),
      fetch('/api/marketing/tags', { cache: 'no-store' }),
      fetch('/api/pipelines', { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links', { cache: 'no-store' }),
      fetch('/api/marketing/email-templates', { cache: 'no-store' }),
    ]);
    if (aRes.ok) {
      const j = await aRes.json();
      const a = j.automation as AutomationRow;
      setAuto(a);
      const cfg = (a.trigger_config || {}) as { tag_ids?: string[]; to_stage_ids?: string[]; trigger_link_ids?: string[] };
      setSelTags(cfg.tag_ids ?? []);
      setSelStages(cfg.to_stage_ids ?? []);
      setSelLinks(cfg.trigger_link_ids ?? []);
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
    if (tmplRes.ok) {
      const d = await tmplRes.json();
      setTemplates(d.templates ?? []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  function toggle(arr: string[], id: string, set: (v: string[]) => void) {
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  }

  function buildTriggerConfig(): Record<string, unknown> {
    if (!auto) return {};
    if (auto.trigger_type === 'tag_added') return { tag_ids: selTags };
    if (auto.trigger_type === 'stage_changed') return { to_stage_ids: selStages };
    return { trigger_link_ids: selLinks };
  }

  function stepsPayload() {
    return steps.map((s, i) => {
      if (s.step_type === 'delay') {
        return { step_order: i, step_type: 'delay' as const, config: { delay_minutes: Math.max(1, Math.min(10080, s.delay_minutes)) } };
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
    if (!confirm('Delete this automation and its enrollments?')) return;
    const res = await fetch(`/api/marketing/automations/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/dashboard/marketing/email/automations');
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

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!auto) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-gray-600">Automation not found.</p>
        <Link href="/dashboard/marketing/email/automations" className="mt-4 inline-block text-brand-700 hover:underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/dashboard/marketing/email/automations"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft size={16} />
        Automations
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Edit automation</h1>
        <button type="button" onClick={() => void removeAutomation()} className="text-sm text-red-600 hover:underline">
          Delete
        </button>
      </div>

      {msg ? <p className="mb-2 text-sm text-green-700">{msg}</p> : null}
      {err ? <p className="mb-2 text-sm text-red-600">{err}</p> : null}

      <div className="mb-6 space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <label className="text-xs font-medium text-gray-500">Name</label>
          <input
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={auto.name}
            onChange={(e) => setAuto({ ...auto, name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Status</label>
          <select
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={auto.status}
            onChange={(e) => setAuto({ ...auto, status: e.target.value as AutomationRow['status'] })}
          >
            <option value="draft">Draft (does not enroll)</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">Trigger type</p>
          <p className="mt-1 text-sm capitalize text-gray-800">{auto.trigger_type.replace(/_/g, ' ')}</p>
          <p className="mt-1 text-xs text-gray-500">Trigger type is fixed after creation. Create a new automation to switch.</p>
        </div>

        {auto.trigger_type === 'tag_added' ? (
          <div>
            <p className="text-xs font-medium text-gray-500">Tags (leave empty to match any tag added)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((t) => (
                <label key={t.id} className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs">
                  <input type="checkbox" checked={selTags.includes(t.id)} onChange={() => toggle(selTags, t.id, setSelTags)} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {auto.trigger_type === 'stage_changed' ? (
          <div>
            <p className="text-xs font-medium text-gray-500">Stages (lead must land in one of these)</p>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {stages.map((s) => (
                <label key={s.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={selStages.includes(s.id)} onChange={() => toggle(selStages, s.id, setSelStages)} />
                  <span className="text-gray-500">{s.pipelineName}:</span> {s.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {auto.trigger_type === 'trigger_link_click' ? (
          <div>
            <p className="text-xs font-medium text-gray-500">Trigger links</p>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {links.map((l) => (
                <label key={l.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={selLinks.includes(l.id)} onChange={() => toggle(selLinks, l.id, setSelLinks)} />
                  {l.name} <span className="text-gray-400">({l.short_code})</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Steps</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setSteps((s) => [...s, { localId: crypto.randomUUID(), step_type: 'delay', delay_minutes: 60 }])
              }
              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
            >
              <Plus size={14} /> Delay
            </button>
            <button
              type="button"
              onClick={() =>
                setSteps((s) => [
                  ...s,
                  { localId: crypto.randomUUID(), step_type: 'send_email', template_id: templates[0]?.id ?? '' },
                ])
              }
              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
            >
              <Plus size={14} /> Send email
            </button>
          </div>
        </div>
        {steps.length === 0 ? (
          <p className="text-sm text-gray-500">Add at least one step. Delays wait before the next step runs.</p>
        ) : (
          <ul className="space-y-2">
            {steps.map((s, idx) => (
              <li key={s.localId} className="flex flex-wrap items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="flex flex-col gap-0.5">
                  <button type="button" className="text-gray-500 hover:text-gray-800" onClick={() => moveStep(idx, -1)} title="Up">
                    <ChevronUp size={16} />
                  </button>
                  <button type="button" className="text-gray-500 hover:text-gray-800" onClick={() => moveStep(idx, 1)} title="Down">
                    <ChevronDown size={16} />
                  </button>
                </div>
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  {s.step_type === 'delay' ? (
                    <>
                      <span className="font-medium">Wait</span>
                      <label className="ml-2 text-xs text-gray-600">
                        Minutes{' '}
                        <input
                          type="number"
                          min={1}
                          max={10080}
                          className="w-24 rounded border border-gray-200 px-2 py-1"
                          value={s.delay_minutes}
                          onChange={(e) => {
                            const n = Number(e.target.value) || 1;
                            setSteps((prev) =>
                              prev.map((x) => (x.localId === s.localId && x.step_type === 'delay' ? { ...x, delay_minutes: n } : x)),
                            );
                          }}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">Send template</span>
                      <select
                        className="ml-2 rounded border border-gray-200 px-2 py-1 text-xs"
                        value={s.template_id}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSteps((prev) =>
                            prev.map((x) => (x.localId === s.localId && x.step_type === 'send_email' ? { ...x, template_id: v } : x)),
                          );
                        }}
                      >
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="text-gray-400 hover:text-red-600"
                  onClick={() => setSteps((prev) => prev.filter((x) => x.localId !== s.localId))}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void saveAll()}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? <Loader2 className="animate-spin" size={16} /> : null}
        Save automation
      </button>
    </div>
  );
}
