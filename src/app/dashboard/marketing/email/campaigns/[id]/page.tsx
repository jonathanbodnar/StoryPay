'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { parseSegment, type CampaignSegment } from '@/lib/marketing-email-schema';
import {
  AudiencePicker,
  type AudiencePickerSavedSegment,
  type AudiencePickerStage,
  type AudiencePickerTag,
  type AudiencePickerTriggerLink,
} from '@/components/marketing/AudiencePicker';

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

interface PipelineRow {
  id: string;
  name: string;
  stages: { id: string; name: string; pipeline_id: string; kind?: string }[];
}

interface SavedSegmentRow {
  id: string;
  name: string;
  description: string;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const id = String(params.id || '');

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState({ sent: 0 });
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [tags, setTags] = useState<AudiencePickerTag[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [triggerLinks, setTriggerLinks] = useState<AudiencePickerTriggerLink[]>([]);
  const [savedSegments, setSavedSegments] = useState<AudiencePickerSavedSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [segment, setSegment] = useState<CampaignSegment>({ type: 'all_leads' });
  const [scheduleLocal, setScheduleLocal] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testLeadId, setTestLeadId] = useState('');
  const [testModal, setTestModal] = useState(false);
  const [busy, setBusy] = useState(false);

  const stages: AudiencePickerStage[] = useMemo(
    () => pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipelineName: p.name }))),
    [pipelines],
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [cRes, tRes, tagRes, pipeRes, tlRes, segRes] = await Promise.all([
      fetch(`/api/marketing/campaigns/${id}`, { cache: 'no-store' }),
      fetch('/api/marketing/email-templates', { cache: 'no-store' }),
      fetch('/api/marketing/tags', { cache: 'no-store' }),
      fetch('/api/pipelines', { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links', { cache: 'no-store' }),
      fetch('/api/marketing/segments', { cache: 'no-store' }),
    ]);
    if (cRes.ok) {
      const j = await cRes.json();
      const c = j.campaign as Campaign;
      setCampaign(c);
      setStats(j.stats ?? { sent: 0 });
      setName(c.name);
      setTemplateId(c.template_id);
      setSegment(parseSegment(c.segment_json));
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
    if (segRes.ok) {
      const d = (await segRes.json()) as { segments?: SavedSegmentRow[] };
      setSavedSegments(
        (d.segments ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description })),
      );
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function saveDraft() {
    if (!campaign) return;
    if (segment.type === 'saved_segment' && !segment.saved_segment_id) {
      setErr('Pick a saved segment or choose another audience type');
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/marketing/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, templateId, segment }),
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

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
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
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Audience</p>
            <Link
              href="/dashboard/marketing/email/segments"
              className="text-xs font-medium text-gray-700 underline-offset-2 hover:underline"
            >
              Manage saved segments →
            </Link>
          </div>
          <AudiencePicker
            value={segment}
            onChange={setSegment}
            disabled={!editable}
            tags={tags}
            stages={stages}
            triggerLinks={triggerLinks}
            savedSegments={savedSegments}
          />
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

      <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-5">
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
            className="rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50"
          >
            Schedule
          </button>
          <button
            type="button"
            disabled={!editable || busy}
            onClick={() => void sendNow()}
            className="rounded-lg border border-brand-900 px-4 py-2 text-sm font-medium text-brand-900 hover:bg-gray-50 disabled:opacity-50"
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
          <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-5">
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
                className="rounded-lg bg-brand-900 px-3 py-2 text-sm text-white transition hover:bg-brand-800 disabled:opacity-50"
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
