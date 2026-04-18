'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import type { CampaignSegment } from '@/lib/marketing-email-schema';

interface Campaign {
  id: string;
  name: string;
  template_id: string;
  segment_json: unknown;
  status: string;
  scheduled_at: string | null;
  last_error: string | null;
}

interface TemplateOpt {
  id: string;
  name: string;
}

interface TagRow {
  id: string;
  name: string;
}

interface StageRow {
  id: string;
  name: string;
  pipeline_id: string;
  kind?: string;
}

interface PipelineRow {
  id: string;
  name: string;
  stages: StageRow[];
}

interface TriggerLinkOpt {
  id: string;
  name: string;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const id = String(params.id || '');

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState({ sent: 0 });
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [segType, setSegType] = useState<CampaignSegment['type']>('all_leads');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [scheduleLocal, setScheduleLocal] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testLeadId, setTestLeadId] = useState('');
  const [testModal, setTestModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const [excludeStageIds, setExcludeStageIds] = useState<string[]>([]);
  const [requireWeddingDate, setRequireWeddingDate] = useState(false);
  const [clickedLinkIds, setClickedLinkIds] = useState<string[]>([]);
  const [requireNotBooked, setRequireNotBooked] = useState(false);
  const [bookedStageIds, setBookedStageIds] = useState<string[]>([]);
  const [triggerLinks, setTriggerLinks] = useState<TriggerLinkOpt[]>([]);

  const allStages = pipelines.flatMap((p) => (p.stages || []).map((s) => ({ ...s, pipelineName: p.name })));

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [cRes, tRes, tagRes, pipeRes, tlRes] = await Promise.all([
      fetch(`/api/marketing/campaigns/${id}`, { cache: 'no-store' }),
      fetch('/api/marketing/email-templates', { cache: 'no-store' }),
      fetch('/api/marketing/tags', { cache: 'no-store' }),
      fetch('/api/pipelines', { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links', { cache: 'no-store' }),
    ]);
    if (cRes.ok) {
      const j = await cRes.json();
      const c = j.campaign as Campaign;
      setCampaign(c);
      setStats(j.stats ?? { sent: 0 });
      setName(c.name);
      setTemplateId(c.template_id);
      const raw = (c.segment_json || {}) as Record<string, unknown>;
      const t = raw.type === 'tags_any' ? 'tags_any' : raw.type === 'stages' ? 'stages' : 'all_leads';
      setSegType(t);
      setTagIds(Array.isArray(raw.tag_ids) ? raw.tag_ids.filter((x): x is string => typeof x === 'string') : []);
      setStageIds(Array.isArray(raw.stage_ids) ? raw.stage_ids.filter((x): x is string => typeof x === 'string') : []);
      setExcludeStageIds(
        Array.isArray(raw.exclude_stage_ids) ? raw.exclude_stage_ids.filter((x): x is string => typeof x === 'string') : [],
      );
      setRequireWeddingDate(raw.require_wedding_date === true);
      setClickedLinkIds(
        Array.isArray(raw.clicked_trigger_link_ids)
          ? raw.clicked_trigger_link_ids.filter((x): x is string => typeof x === 'string')
          : [],
      );
      setRequireNotBooked(raw.require_not_booked === true);
      setBookedStageIds(
        Array.isArray(raw.booked_stage_ids) ? raw.booked_stage_ids.filter((x): x is string => typeof x === 'string') : [],
      );
    } else {
      setCampaign(null);
    }
    if (tRes.ok) {
      const d = await tRes.json();
      setTemplates(d.templates ?? []);
    }
    if (tagRes.ok) {
      const d = await tagRes.json();
      setTags(d.tags ?? []);
    }
    if (pipeRes.ok) {
      const d = await pipeRes.json();
      setPipelines(d.pipelines ?? []);
    }
    if (tlRes.ok) {
      const d = (await tlRes.json()) as { links?: Array<{ id: string; name: string }> };
      setTriggerLinks((d.links ?? []).map((x) => ({ id: x.id, name: x.name })));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  function buildSegment(): CampaignSegment {
    const extra: Partial<CampaignSegment> = {};
    if (excludeStageIds.length) extra.exclude_stage_ids = excludeStageIds;
    if (requireWeddingDate) extra.require_wedding_date = true;
    if (clickedLinkIds.length) extra.clicked_trigger_link_ids = clickedLinkIds;
    if (requireNotBooked) {
      extra.require_not_booked = true;
      if (bookedStageIds.length) extra.booked_stage_ids = bookedStageIds;
    }
    if (segType === 'tags_any') return { type: 'tags_any', tag_ids: tagIds, ...extra };
    if (segType === 'stages') return { type: 'stages', stage_ids: stageIds, ...extra };
    return { type: 'all_leads', ...extra };
  }

  async function saveDraft() {
    if (!campaign) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/marketing/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, templateId, segment: buildSegment() }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr((j as { error?: string }).error || 'Save failed');
      return;
    }
    setMsg('Saved');
    setTimeout(() => setMsg(null), 2000);
    void load();
  }

  async function schedule() {
    if (!scheduleLocal) {
      setErr('Pick a date and time');
      return;
    }
    const iso = new Date(scheduleLocal).toISOString();
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/marketing/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'schedule', scheduledAt: iso }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr((j as { error?: string }).error || 'Schedule failed');
      return;
    }
    setMsg('Scheduled');
    setTimeout(() => setMsg(null), 2000);
    void load();
  }

  async function sendNow() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/marketing/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_now' }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr((j as { error?: string }).error || 'Could not queue send');
      return;
    }
    setMsg('Queued — cron will deliver in batches.');
    setTimeout(() => setMsg(null), 3000);
    void load();
  }

  async function cancel() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/marketing/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr((j as { error?: string }).error || 'Cancel failed');
      return;
    }
    void load();
  }

  async function sendTest() {
    const to = testEmail.trim();
    if (!to) {
      setErr('Enter an email');
      return;
    }
    const lid = testLeadId.trim();
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/marketing/campaigns/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, ...(lid ? { leadId: lid } : {}) }),
    });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr((j as { error?: string }).error || 'Test send failed');
      return;
    }
    setTestModal(false);
    setMsg('Test email sent');
    setTimeout(() => setMsg(null), 2000);
  }

  function toggleTag(tid: string) {
    setTagIds((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]));
  }

  function toggleStage(sid: string) {
    setStageIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }

  function toggleExcludeStage(sid: string) {
    setExcludeStageIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }

  function toggleClickedLink(lid: string) {
    setClickedLinkIds((prev) => (prev.includes(lid) ? prev.filter((x) => x !== lid) : [...prev, lid]));
  }

  function toggleBookedStage(sid: string) {
    setBookedStageIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-gray-600">Campaign not found.</p>
        <Link href="/dashboard/marketing/email/campaigns" className="mt-4 inline-block text-brand-700 hover:underline">
          Back to campaigns
        </Link>
      </div>
    );
  }

  const editable = campaign.status === 'draft' || campaign.status === 'scheduled';

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/dashboard/marketing/email/campaigns"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft size={16} />
        Campaigns
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Campaign</h1>
          <p className="mt-1 text-sm text-gray-600">
            Status: <span className="font-medium capitalize">{campaign.status}</span>
            {campaign.last_error ? <span className="text-red-600"> — {campaign.last_error}</span> : null}
            {' · '}
            Sent: {stats.sent}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTestModal(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
        >
          <Send size={16} />
          Test send
        </button>
      </div>

      {msg ? <p className="mb-3 text-sm text-green-700">{msg}</p> : null}
      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <label className="text-xs font-medium text-gray-500">Name</label>
          <input
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={name}
            disabled={!editable}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Template</label>
          <select
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={templateId}
            disabled={!editable}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500">Audience</p>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="seg" checked={segType === 'all_leads'} disabled={!editable} onChange={() => setSegType('all_leads')} />
              All leads (with email, excluding unsubscribes)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="seg" checked={segType === 'tags_any'} disabled={!editable} onChange={() => setSegType('tags_any')} />
              Any of these tags
            </label>
            {segType === 'tags_any' ? (
              <div className="ml-6 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <label key={t.id} className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs">
                    <input type="checkbox" disabled={!editable} checked={tagIds.includes(t.id)} onChange={() => toggleTag(t.id)} />
                    {t.name}
                  </label>
                ))}
              </div>
            ) : null}
            <label className="flex items-center gap-2">
              <input type="radio" name="seg" checked={segType === 'stages'} disabled={!editable} onChange={() => setSegType('stages')} />
              In any of these pipeline stages
            </label>
            {segType === 'stages' ? (
              <div className="ml-6 max-h-40 space-y-1 overflow-y-auto text-xs">
                {allStages.map((s) => (
                  <label key={s.id} className="flex items-center gap-2">
                    <input type="checkbox" disabled={!editable} checked={stageIds.includes(s.id)} onChange={() => toggleStage(s.id)} />
                    <span className="text-gray-600">{s.pipelineName}:</span> {s.name}
                  </label>
                ))}
              </div>
            ) : null}

            <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50/80 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-700">Behavior & filters</p>
              <p className="text-[11px] text-gray-500">
                Narrow any audience type: exclude stages, require a wedding date, require past trigger-link clicks, or
                exclude “booked” stages.
              </p>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={requireWeddingDate}
                  onChange={(e) => setRequireWeddingDate(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Only leads with a wedding date on file</span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={requireNotBooked}
                  onChange={(e) => setRequireNotBooked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Exclude leads in booked / won stages (pick which stages count as booked below)</span>
              </label>
              {requireNotBooked ? (
                <div className="ml-1 max-h-32 space-y-1 overflow-y-auto border-l-2 border-gray-200 pl-2">
                  <p className="text-[10px] font-medium uppercase text-gray-400">Booked stages</p>
                  {allStages.filter((s) => s.kind === 'won').length === 0 ? (
                    <p className="text-[11px] text-gray-500">No won stages in pipelines — select stages manually.</p>
                  ) : null}
                  {allStages.map((s) => (
                    <label key={`booked-${s.id}`} className="flex items-center gap-2 text-[11px]">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={bookedStageIds.includes(s.id)}
                        onChange={() => toggleBookedStage(s.id)}
                      />
                      <span className="text-gray-600">{s.pipelineName}:</span> {s.name}
                      {s.kind ? <span className="text-gray-400">({s.kind})</span> : null}
                    </label>
                  ))}
                </div>
              ) : null}
              <div>
                <p className="text-[10px] font-medium uppercase text-gray-400 mb-1">Exclude stages</p>
                <div className="max-h-28 space-y-1 overflow-y-auto text-[11px]">
                  {allStages.map((s) => (
                    <label key={`ex-${s.id}`} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={excludeStageIds.includes(s.id)}
                        onChange={() => toggleExcludeStage(s.id)}
                      />
                      <span className="text-gray-600">{s.pipelineName}:</span> {s.name}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase text-gray-400 mb-1">Clicked any of these trigger links</p>
                {triggerLinks.length === 0 ? (
                  <p className="text-[11px] text-gray-500">No trigger links yet.</p>
                ) : (
                  <div className="max-h-28 space-y-1 overflow-y-auto text-[11px]">
                    {triggerLinks.map((tl) => (
                      <label key={tl.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!editable}
                          checked={clickedLinkIds.includes(tl.id)}
                          onChange={() => toggleClickedLink(tl.id)}
                        />
                        {tl.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {editable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveDraft()}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Save changes
          </button>
        ) : null}
      </div>

      <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Send</h2>
        <p className="text-xs text-gray-500">
          Scheduled campaigns are picked up by the platform cron (typically every few minutes). Past-due schedules send
          on the next run.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500">Schedule for</label>
            <input
              type="datetime-local"
              className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={scheduleLocal}
              disabled={!editable || busy}
              onChange={(e) => setScheduleLocal(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={!editable || busy}
            onClick={() => void schedule()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Schedule
          </button>
          <button
            type="button"
            disabled={!editable || busy}
            onClick={() => void sendNow()}
            className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            Send now
          </button>
          {campaign.status === 'draft' || campaign.status === 'scheduled' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancel()}
              className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel send
            </button>
          ) : null}
        </div>
      </div>

      {testModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="font-semibold text-gray-900">Test send</h3>
            <p className="mt-1 text-xs text-gray-500">
              Optional: enter a lead id to merge real wedding date, guest count, and names (email still sends to the address
              below).
            </p>
            <input
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              type="email"
              placeholder="you@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
            <input
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
              placeholder="Lead UUID (optional)"
              value={testLeadId}
              onChange={(e) => setTestLeadId(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="text-sm text-gray-600 hover:underline" onClick={() => setTestModal(false)}>
                Close
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => void sendTest()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
