'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Zap, Mail, MessageSquare, Bot, ChevronDown, ChevronUp,
  Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, GripVertical,
  Clock, Send, Pencil, X, Check,
} from 'lucide-react';
import type { BookingSystemConfig, StepConfig } from '@/app/api/listing/booking-system/route';

// ─── Tiny helpers ──────────────────────────────────────────────────────────

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
  return (
    <div className={`rounded-2xl border bg-white transition-shadow ${enabled ? 'shadow-sm border-gray-200' : 'border-gray-100 opacity-60'}`}>
      <div className="flex items-start gap-4 p-5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accent}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Phase {number}</span>
              </div>
              <h3 className="text-[15px] font-semibold text-gray-900 leading-tight">{title}</h3>
              <p className="mt-0.5 text-[12px] text-gray-500">{subtitle}</p>
            </div>
            <Toggle checked={enabled} onChange={onToggle} disabled={disabled} />
          </div>
        </div>
      </div>
      {enabled && children && (
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

// ─── Step editor ──────────────────────────────────────────────────────────

const DAY_OPTIONS = [0.5, 1, 2, 3, 4, 5, 7, 10, 14];

function StepRow({
  step, index, total, onChange, onRemove,
}: {
  step: StepConfig; index: number; total: number;
  onChange: (s: StepConfig) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const dayLabel = step.delay_minutes
    ? step.delay_minutes >= 1440
      ? `Day ${Math.round(step.delay_minutes / 1440)}`
      : `${Math.round(step.delay_minutes / 60)}h`
    : 'Day 1';

  if (step.step_type === 'delay') {
    return (
      <div className="flex items-center gap-3 py-2 px-3 rounded-xl bg-gray-50 border border-gray-100">
        <Clock size={14} className="text-gray-400 shrink-0" />
        <span className="text-[12px] text-gray-500 flex-1">Wait</span>
        <select
          value={step.delay_minutes ?? 1440}
          onChange={(e) => onChange({ ...step, delay_minutes: Number(e.target.value) })}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700 focus:outline-none focus:border-violet-400"
        >
          {[1440, 2880, 4320, 5760, 7200, 10080, 14400, 20160].map((m) => (
            <option key={m} value={m}>{Math.round(m / 1440)} day{Math.round(m / 1440) !== 1 ? 's' : ''}</option>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-400 transition-colors ml-1">
          <X size={13} />
        </button>
      </div>
    );
  }

  const isSms   = step.step_type === 'send_sms';
  const accent  = isSms ? 'text-violet-600' : 'text-blue-500';
  const Icon    = isSms ? MessageSquare : Mail;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <GripVertical size={13} className="text-gray-300 shrink-0" />
        <Icon size={13} className={`${accent} shrink-0`} />
        <span className="text-[12px] font-medium text-gray-700 flex-1 truncate">
          {step.label || (isSms ? 'SMS' : 'Email')}
          {step.body ? <span className="ml-1.5 font-normal text-gray-400 truncate">{step.body.slice(0, 50)}{step.body.length > 50 ? '…' : ''}</span> : null}
        </span>
        <span className="text-[11px] text-gray-400 shrink-0">{dayLabel}</span>
        <div className="flex items-center gap-1 ml-1">
          {expanded ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="text-gray-300 hover:text-red-400 transition-colors p-0.5"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-2.5 space-y-2">
          <InlineInput
            value={step.label}
            onChange={(v) => onChange({ ...step, label: v })}
            placeholder="Step label (e.g. Day 1 intro)"
            className="w-full"
          />
          {!isSms && (
            <InlineInput
              value={step.subject ?? ''}
              onChange={(v) => onChange({ ...step, subject: v })}
              placeholder="Email subject line"
              className="w-full"
            />
          )}
          <TextArea
            value={step.body ?? ''}
            onChange={(v) => onChange({ ...step, body: v })}
            rows={4}
            placeholder={isSms ? 'SMS message text… Use {{first_name}}, {{venue_name}}' : 'Email body… Use {{first_name}}, {{venue_name}}'}
          />
        </div>
      )}
    </div>
  );
}

// ─── AI Message editor ────────────────────────────────────────────────────

function AiMessageList({
  messages, onChange,
}: { messages: string[]; onChange: (msgs: string[]) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  function startEdit(i: number) { setEditing(i); setDraft(messages[i]); }
  function saveEdit(i: number) {
    if (draft.trim()) { const n = [...messages]; n[i] = draft.trim(); onChange(n); }
    setEditing(null);
  }
  function remove(i: number) { onChange(messages.filter((_, idx) => idx !== i)); }
  function add() {
    onChange([...messages, '']);
    setEditing(messages.length);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      {messages.map((msg, i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white">
          {editing === i ? (
            <div className="p-3 space-y-2">
              <TextArea value={draft} onChange={setDraft} rows={3} placeholder="Message text… Use {{first_name}}, {{venue_name}}" />
              <div className="flex gap-2">
                <button type="button" onClick={() => saveEdit(i)} className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-700">
                  <Check size={12} /> Save
                </button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-500 hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 px-3 py-2.5">
              <p className="flex-1 text-[12px] text-gray-700 leading-relaxed">{msg || <span className="italic text-gray-400">Empty message</span>}</p>
              <div className="flex shrink-0 gap-1 mt-0.5">
                <button type="button" onClick={() => startEdit(i)} className="text-gray-400 hover:text-violet-600 transition-colors"><Pencil size={12} /></button>
                <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-200 py-2.5 text-[12px] font-medium text-gray-400 hover:border-violet-300 hover:text-violet-600 transition-colors"
      >
        <Plus size={13} /> Add message
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function BookingSystemPage() {
  const [cfg, setCfg]       = useState<BookingSystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/listing/booking-system', { cache: 'no-store' });
      if (!r.ok) throw new Error('Failed to load');
      setCfg(await r.json() as BookingSystemConfig);
    } catch { setError('Unable to load Booking System settings.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(patch: Partial<BookingSystemConfig>) {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const r = await fetch('/api/listing/booking-system', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})) as { error?: string }; throw new Error(d.error || 'Save failed'); }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  function addStep(type: StepConfig['step_type']) {
    if (!cfg) return;
    const order = cfg.steps.length;
    const newStep: StepConfig = {
      step_order: order,
      step_type: type,
      label: type === 'delay' ? 'Wait 1 day' : type === 'send_sms' ? 'Follow-up SMS' : 'Follow-up Email',
      body: '',
      subject: '',
      delay_minutes: type === 'delay' ? 1440 : 0,
    };
    void save({ steps: [...cfg.steps, newStep] });
  }

  function updateStep(i: number, updated: StepConfig) {
    if (!cfg) return;
    const next = [...cfg.steps];
    next[i] = updated;
    void save({ steps: next });
  }

  function removeStep(i: number) {
    if (!cfg) return;
    void save({ steps: cfg.steps.filter((_, idx) => idx !== i) });
  }

  if (loading) return (
    <div className="flex min-h-[400px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
    </div>
  );

  if (!cfg) return (
    <div className="flex min-h-[400px] items-center justify-center text-sm text-gray-500">
      {error || 'Unable to load settings.'}
    </div>
  );

  const aiBlocked = !cfg.a2pVerified || !cfg.ghlConnected;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-0">

      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600">
              <Zap size={16} className="text-white" />
            </div>
            <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Booking System</h1>
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
            <Toggle
              checked={cfg.masterEnabled}
              onChange={(v) => void save({ masterEnabled: v })}
            />
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

        {/* ── Phase 1: Guide Delivery ────────────────────────────────────── */}
        <PhaseCard
          number={1}
          title="Guide Delivery"
          subtitle="Send your pricing guide the moment a bride fills out your listing form."
          icon={<Send size={18} className="text-blue-600" />}
          accent="bg-blue-50"
          enabled={cfg.guideEmailEnabled || cfg.guideSmsEnabled}
          onToggle={(v) => void save({ guideEmailEnabled: v, guideSmsEnabled: v })}
        >
          <div className="space-y-4">
            {/* Email toggle */}
            <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-blue-500" />
                <div>
                  <p className="text-[13px] font-medium text-gray-800">Email</p>
                  <p className="text-[11px] text-gray-500">Sends immediately on form submit</p>
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

            {/* SMS toggle */}
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
              Available merge tags: <code className="rounded bg-gray-100 px-1">{'{{first_name}}'}</code> <code className="rounded bg-gray-100 px-1">{'{{venue_name}}'}</code> <code className="rounded bg-gray-100 px-1">{'{{pricing_guide_url}}'}</code>
            </p>
          </div>
        </PhaseCard>

        {/* ── Phase 2: 14-Day Sequence ───────────────────────────────────── */}
        <PhaseCard
          number={2}
          title="14-Day Follow-up Sequence"
          subtitle="A series of SMS and email touchpoints to get the bride to respond. Stops the moment she replies."
          icon={<MessageSquare size={18} className="text-violet-600" />}
          accent="bg-violet-50"
          enabled={cfg.sequenceEnabled}
          onToggle={(v) => void save({ sequenceEnabled: v })}
        >
          <div className="space-y-2">
            {cfg.steps.length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-[12px] text-gray-400">
                No steps yet. Add your first touchpoint below.
              </p>
            )}
            {cfg.steps.map((step, i) => (
              <StepRow
                key={i}
                step={step}
                index={i}
                total={cfg.steps.length}
                onChange={(s) => updateStep(i, s)}
                onRemove={() => removeStep(i)}
              />
            ))}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => addStep('send_sms')}
                className="flex items-center gap-1.5 rounded-xl border border-dashed border-violet-200 px-3 py-2 text-[12px] font-medium text-violet-600 hover:bg-violet-50 transition-colors"
              >
                <Plus size={13} /> SMS
              </button>
              <button
                type="button"
                onClick={() => addStep('send_email')}
                className="flex items-center gap-1.5 rounded-xl border border-dashed border-blue-200 px-3 py-2 text-[12px] font-medium text-blue-500 hover:bg-blue-50 transition-colors"
              >
                <Plus size={13} /> Email
              </button>
              <button
                type="button"
                onClick={() => addStep('delay')}
                className="flex items-center gap-1.5 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-[12px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <Plus size={13} /> Wait
              </button>
            </div>
            <p className="text-[11px] text-gray-400 pt-1">
              The sequence stops automatically when the bride replies. Build it top-down — add a "Wait" before each follow-up.
            </p>
          </div>
        </PhaseCard>

        {/* ── Phase 3: AI Concierge ──────────────────────────────────────── */}
        <PhaseCard
          number={3}
          title="AI Long-tail Outreach"
          subtitle="After 14 days with no reply, the AI keeps reaching out — up to 60 days. It stops the moment she replies."
          icon={<Bot size={18} className="text-emerald-600" />}
          accent="bg-emerald-50"
          enabled={cfg.aiEnabled}
          onToggle={(v) => {
            if (v && aiBlocked) return;
            void save({ aiEnabled: v });
          }}
          disabled={aiBlocked}
        >
          <div className="space-y-5">

            {/* Cadence */}
            <div>
              <SectionLabel>Outreach cadence</SectionLabel>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[13px] text-gray-600">Send every</span>
                <select
                  value={cfg.aiMinGapDays}
                  onChange={(e) => void save({ aiMinGapDays: Number(e.target.value) })}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] focus:outline-none focus:border-violet-400"
                >
                  {[1,2,3].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span className="text-[13px] text-gray-600">to</span>
                <select
                  value={cfg.aiMaxGapDays}
                  onChange={(e) => void save({ aiMaxGapDays: Number(e.target.value) })}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] focus:outline-none focus:border-violet-400"
                >
                  {[2,3,5,7].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span className="text-[13px] text-gray-600">days (randomized)</span>
              </div>
            </div>

            {/* Max days */}
            <div>
              <SectionLabel>Stop after</SectionLabel>
              <div className="flex items-center gap-3">
                <select
                  value={cfg.aiMaxDays}
                  onChange={(e) => void save({ aiMaxDays: Number(e.target.value) })}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] focus:outline-none focus:border-violet-400"
                >
                  {[30,45,60,90].map(d => <option key={d} value={d}>{d} days with no reply</option>)}
                </select>
                <span className="text-[11px] text-gray-400">→ moves to Not Interested automatically</span>
              </div>
            </div>

            {/* Message pool */}
            <div>
              <SectionLabel>Message pool <span className="normal-case font-normal text-gray-400">— AI rotates through these</span></SectionLabel>
              <AiMessageList messages={cfg.aiMessages} onChange={(msgs) => void save({ aiMessages: msgs })} />
            </div>

            {/* Notify emails */}
            <div>
              <SectionLabel>Notify when bride replies</SectionLabel>
              <InlineInput
                value={cfg.aiNotifyEmails.join(', ')}
                onChange={(v) => void save({ aiNotifyEmails: v.split(',').map(e => e.trim()).filter(Boolean) })}
                placeholder="email@venue.com, concierge@storyvenue.com"
                className="w-full"
              />
              <p className="mt-1 text-[11px] text-gray-400">Separate multiple emails with commas.</p>
            </div>
          </div>
        </PhaseCard>

        {aiBlocked && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Phase 3 requires <strong>A2P 10DLC verification</strong> and a connected <strong>GHL / LeadConnector account</strong>.
              Once both are active, Phase 3 will unlock automatically.
            </span>
          </div>
        )}

      </div>
    </div>
  );
}
