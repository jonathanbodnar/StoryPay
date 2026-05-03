'use client';

import { useEffect, useState } from 'react';
import {
  Bell, CreditCard, FileText, Loader2, Save, CheckCircle2, Eye, Send,
  X, PenLine, RefreshCw, XCircle, AlertTriangle, ChevronRight, FilePen,
} from 'lucide-react';
import type { ReminderOffset } from '@/lib/appointment-reminders';
import {
  DEFAULT_PAYMENT_REMINDER_OFFSETS,
  normalizePaymentReminderOffsets,
} from '@/lib/payment-reminders';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailTemplate {
  type: string;
  label: string;
  description: string;
  icon: string;
  variables: string[];
  subject: string;
  heading: string;
  body: string;
  button_text: string;
  footer: string;
  enabled: boolean;
}

const ICON_MAP: Record<string, React.ElementType> = {
  FileText, FileSignature: PenLine, CreditCard, Bell, RefreshCw, XCircle, AlertTriangle,
  Eye, FilePen,
};

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';

// ─── Payment reminder timing helpers ─────────────────────────────────────────

function padPayOffsets(rows: ReminderOffset[]): ReminderOffset[] {
  const out = rows.slice(0, 3);
  while (out.length < 3) out.push({ d: 0, h: 0, m: 0 });
  return out;
}

// ─── Small components ─────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  size = 'md',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  size?: 'sm' | 'md';
}) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const thumb = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const on    = size === 'sm' ? 'translate-x-[18px]' : 'translate-x-6';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`relative inline-flex flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${track} ${
        checked ? 'bg-emerald-500' : 'bg-gray-200'
      }`}
    >
      <span className={`inline-block transform rounded-full border border-gray-200 bg-white transition-transform duration-200 ${thumb} ${
        checked ? on : 'translate-x-1'
      }`} />
    </button>
  );
}

function VariablePill({ variable }: { variable: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(variable);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={`rounded-lg border px-2.5 py-1 text-xs font-mono transition-all ${
        copied
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-white'
      }`}
    >
      {copied ? '✓ copied' : variable}
    </button>
  );
}

function PreviewModal({
  template, venueName, logoUrl, brandColor, onClose,
}: {
  template: EmailTemplate;
  venueName: string;
  logoUrl?: string;
  brandColor?: string;
  onClose: () => void;
}) {
  function fill(text: string) {
    return text
      .replace(/\{\{organization\}\}/g, venueName || 'Your Venue')
      .replace(/\{\{customer_name\}\}/g, 'Jane Smith')
      .replace(/\{\{invoice_number\}\}/g, 'INV-2026-0001')
      .replace(/\{\{amount\}\}/g, '$4,500.00')
      .replace(/\{\{due_date\}\}/g, 'June 15, 2026')
      .replace(/\{\{date\}\}/g, 'April 7, 2026')
      .replace(/\{\{payment_method\}\}/g, 'Visa ••••4242')
      .replace(/\{\{frequency\}\}/g, 'monthly')
      .replace(/\{\{next_payment_date\}\}/g, 'May 7, 2026')
      .replace(/\{\{net_amount\}\}/g, '$4,376.25')
      .replace(/\{\{fee\}\}/g, '$123.75')
      .replace(/\{\{reason\}\}/g, 'Insufficient funds')
      .replace(/\{\{customer_email\}\}/g, 'jane@example.com')
      .replace(/\{\{offset_label\}\}/g, '3 days');
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-white overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200" style={{ backgroundColor: '#1b1b1b' }}>
          <div>
            <p className="text-sm font-semibold text-white">Email Preview</p>
            <p className="text-xs text-white/60 mt-0.5">{template.label}</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1">
          <div className="p-4">
            <div className="rounded-2xl border border-gray-200 overflow-hidden text-sm">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Subject: </span>
                <span className="text-gray-700">{fill(template.subject)}</span>
              </div>
              <div style={{ fontFamily: 'Arial, sans-serif' }}>
                <div style={{ backgroundColor: '#ffffff', padding: '20px 24px 16px', borderBottom: `4px solid ${brandColor || '#1b1b1b'}` }}>
                  {logoUrl
                    ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt={venueName} style={{ maxHeight: 48, maxWidth: 180, width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
                    ) : (
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: '#111827' }}>{venueName || 'Your Venue'}</p>
                    )}
                </div>
                <div className="px-6 py-6">
                  <h2 className="text-lg font-bold text-gray-900 mb-3">{fill(template.heading)}</h2>
                  <div className="text-gray-600 text-sm leading-relaxed whitespace-pre-line mb-5">{fill(template.body)}</div>
                  {template.button_text && (
                    <div className="text-center my-5">
                      <span className="inline-block rounded-xl px-6 py-3 text-sm font-bold text-white" style={{ backgroundColor: brandColor || '#1b1b1b' }}>
                        {fill(template.button_text)}
                      </span>
                    </div>
                  )}
                  {template.footer && (
                    <p className="text-xs text-gray-400 text-center mt-4 pt-4 border-t border-gray-200">{fill(template.footer)}</p>
                  )}
                  <p className="text-[10px] text-gray-300 text-center mt-4">Sent via StoryVenue</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  // ── Email templates ──
  const [templates, setTemplates]     = useState<EmailTemplate[]>([]);
  const [selected, setSelected]       = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [preview, setPreview]         = useState(false);
  const [venueName, setVenueName]     = useState('');
  const [logoUrl, setLogoUrl]         = useState('');
  const [brandColor, setBrandColor]   = useState('#1b1b1b');
  const [showTestForm, setShowTestForm] = useState(false);
  const [testEmail, setTestEmail]     = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult]   = useState<'sent' | 'error' | null>(null);

  // ── Payment reminder timing (shown inside payment_reminder editor) ──
  const [payLoading, setPayLoading]   = useState(true);
  const [payEnabled, setPayEnabled]   = useState(true);
  const [payCount, setPayCount]       = useState(3);
  const [payRows, setPayRows]         = useState<ReminderOffset[]>(() => padPayOffsets([...DEFAULT_PAYMENT_REMINDER_OFFSETS]));
  const [paySaving, setPaySaving]     = useState(false);
  const [paySaved, setPaySaved]       = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/email-templates').then((r) => r.json()),
      fetch('/api/venues/me').then((r) => r.json()),
    ]).then(([tmpl, venue]) => {
      const list = Array.isArray(tmpl) ? tmpl as EmailTemplate[] : [];
      setTemplates(list);
      if (list.length > 0) setSelected(list[0].type);
      setVenueName((venue as { name?: string })?.name || '');
      setLogoUrl((venue as { brand_logo_url?: string })?.brand_logo_url || '');
      setBrandColor((venue as { brand_color?: string })?.brand_color || '#1b1b1b');
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/venues/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (!v) return;
        const venue = v as {
          payment_reminders_enabled?: boolean;
          payment_reminder_offsets?: unknown;
        };
        if (typeof venue.payment_reminders_enabled === 'boolean') setPayEnabled(venue.payment_reminders_enabled);
        const normPay = normalizePaymentReminderOffsets(venue.payment_reminder_offsets);
        setPayRows(padPayOffsets(normPay));
        setPayCount(Math.min(3, Math.max(1, normPay.length || 3)));
      })
      .finally(() => setPayLoading(false));
  }, []);

  const current = templates.find((t) => t.type === selected) ?? null;

  function updateTemplate(field: keyof EmailTemplate, value: string | boolean) {
    setTemplates((prev) => prev.map((t) => (t.type === selected ? { ...t, [field]: value } : t)));
  }

  /** Toggle a template's enabled flag and immediately persist. */
  async function quickToggle(type: string, enabled: boolean) {
    setTemplates((prev) => prev.map((t) => (t.type === type ? { ...t, enabled } : t)));
    const tpl = templates.find((t) => t.type === type);
    if (!tpl) return;
    await fetch(`/api/email-templates/${type}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...tpl, enabled }),
    });
  }

  async function saveTemplate() {
    if (!current) return;
    setSaving(true);
    try {
      await fetch(`/api/email-templates/${current.type}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!current || !testEmail.includes('@')) return;
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/email-templates/${current.type}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmail,
          template: {
            subject: current.subject,
            heading: current.heading,
            body: current.body,
            button_text: current.button_text,
            footer: current.footer,
          },
        }),
      });
      setTestResult(res.ok ? 'sent' : 'error');
      if (res.ok) setTimeout(() => { setTestResult(null); setShowTestForm(false); setTestEmail(''); }, 3000);
    } catch {
      setTestResult('error');
    } finally {
      setTestSending(false);
    }
  }

  async function savePaymentReminders() {
    setPaySaving(true);
    setPaySaved(false);
    try {
      const res = await fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_reminders_enabled: payEnabled,
          payment_reminder_offsets: payRows.slice(0, payCount),
        }),
      });
      if (res.ok) {
        setPaySaved(true);
        setTimeout(() => setPaySaved(false), 3000);
      }
    } finally {
      setPaySaving(false);
    }
  }

  function patchPayRow(i: number, field: 'd' | 'h' | 'm', val: number) {
    setPayRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl text-gray-900">Notifications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage and customize every email notification sent from your account. Use the toggle on each row to enable or disable individual emails. Changes take effect immediately.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">

        {/* ── Left: template list with inline enable toggle ── */}
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">Email notifications</span>
          </div>
          <div className="divide-y divide-gray-50">
            {templates.map((t) => {
              const Icon = ICON_MAP[t.icon] ?? FileText;
              const active = selected === t.type;
              return (
                <div
                  key={t.type}
                  className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                    active ? 'bg-gray-100' : 'hover:bg-gray-50/80'
                  }`}
                  onClick={() => setSelected(t.type)}
                >
                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${
                    active ? 'bg-white border border-gray-200' : 'bg-gray-100'
                  }`}>
                    <Icon size={14} className="text-gray-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold leading-tight ${t.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                      {t.label}
                    </p>
                    <p className="text-[11px] mt-0.5 truncate text-gray-400">{t.description}</p>
                  </div>
                  <Toggle
                    checked={t.enabled}
                    size="sm"
                    onChange={(v) => void quickToggle(t.type, v)}
                  />
                  <ChevronRight size={14} className={`shrink-0 ${active ? 'text-gray-500' : 'text-gray-300'}`} />
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: editor ── */}
        {current ? (
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            {/* Editor header — no toggle here, toggle is in the list */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                {(() => { const Icon = ICON_MAP[current.icon] ?? FileText; return <Icon size={17} className="text-gray-500" />; })()}
                <div>
                  <p className="text-base font-semibold text-gray-900">{current.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{current.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <button
                  onClick={() => { setShowTestForm((v) => !v); setTestResult(null); }}
                  className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Send size={13} /> Send Test
                </button>
                <button
                  onClick={() => setPreview(true)}
                  className="flex items-center gap-1.5 rounded-2xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Eye size={13} /> Preview
                </button>
                <button
                  onClick={() => void saveTemplate()}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                  style={{ backgroundColor: '#1b1b1b' }}
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : <Save size={13} />}
                  {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
                </button>
              </div>
            </div>

            {/* Test email inline form */}
            {showTestForm && (
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void sendTest(); }}
                    placeholder="Enter email address to send test to…"
                    className="flex-1 rounded-2xl border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                  />
                  <button
                    onClick={() => void sendTest()}
                    disabled={testSending || !testEmail.includes('@')}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-all"
                    style={{ backgroundColor: '#1b1b1b' }}
                  >
                    {testSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {testSending ? 'Sending…' : 'Send'}
                  </button>
                  <button
                    onClick={() => { setShowTestForm(false); setTestResult(null); setTestEmail(''); }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                {testResult === 'sent' && (
                  <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle2 size={13} /> Test email sent! Check your inbox.
                  </p>
                )}
                {testResult === 'error' && (
                  <p className="mt-2 text-xs text-red-500">Failed to send — check that Resend is configured (RESEND_API_KEY and a verified sending domain).</p>
                )}
              </div>
            )}

            <div className="px-6 py-5 space-y-5">
              {/* Variables */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/60 px-4 py-3.5">
                <p className="text-xs font-semibold text-gray-500 mb-2.5">Available variables</p>
                <div className="flex flex-wrap gap-2">
                  {current.variables.map((v) => (
                    <VariablePill key={v} variable={v} />
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Click a variable to copy it, then paste into your template.</p>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject line</label>
                <input type="text" value={current.subject} onChange={(e) => updateTemplate('subject', e.target.value)} className={INPUT} />
              </div>

              {/* Heading */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email heading</label>
                <input type="text" value={current.heading} onChange={(e) => updateTemplate('heading', e.target.value)} className={INPUT} />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Body text</label>
                <textarea
                  value={current.body}
                  onChange={(e) => updateTemplate('body', e.target.value)}
                  rows={5}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors resize-none"
                />
              </div>

              {/* Button text */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Button text <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input type="text" value={current.button_text} onChange={(e) => updateTemplate('button_text', e.target.value)} placeholder="e.g. View Invoice" className={INPUT} />
              </div>

              {/* Footer */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Footer text <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input type="text" value={current.footer} onChange={(e) => updateTemplate('footer', e.target.value)} placeholder="Additional note or disclaimer…" className={INPUT} />
              </div>

              {/* ── Payment reminder timing (only shown for payment_reminder) ── */}
              {current.type === 'payment_reminder' && (
                <div className="rounded-2xl border border-gray-200 bg-gray-50/40 overflow-hidden">
                    <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-200">
                    <CreditCard size={14} className="text-gray-400" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">Reminder schedule</p>
                      <p className="text-xs text-gray-400 mt-0.5">Set how long after each installment due date to send overdue reminders. Up to 3 reminders.</p>
                    </div>
                  </div>
                  <div className="px-5 py-4 space-y-4">
                    {payLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 size={20} className="animate-spin text-gray-300" />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">Send payment reminder emails</span>
                          <Toggle checked={payEnabled} onChange={setPayEnabled} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Number of overdue reminders (1–3)</label>
                          <select
                            value={payCount}
                            onChange={(e) => setPayCount(Number(e.target.value))}
                            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
                          >
                            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <p className="text-xs text-gray-400">Each reminder fires this long after the due date if payment has not been received.</p>
                        <div className="space-y-3">
                          {Array.from({ length: payCount }, (_, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="text-gray-500 w-24 shrink-0">Reminder {i + 1}</span>
                              <input
                                type="number" min={0} max={365}
                                value={payRows[i]?.d ?? 0}
                                onChange={(e) => patchPayRow(i, 'd', Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0)))}
                                className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900 bg-white"
                              />
                              <span className="text-gray-400">days</span>
                              <input
                                type="number" min={0}
                                value={payRows[i]?.h ?? 0}
                                onChange={(e) => patchPayRow(i, 'h', Math.max(0, parseInt(e.target.value, 10) || 0))}
                                className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900 bg-white"
                              />
                              <span className="text-gray-400">hours</span>
                              <input
                                type="number" min={0} max={59}
                                value={payRows[i]?.m ?? 0}
                                onChange={(e) => patchPayRow(i, 'm', Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                                className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-gray-900 bg-white"
                              />
                              <span className="text-gray-400">min</span>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void savePaymentReminders()}
                          disabled={paySaving}
                          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                          style={{ backgroundColor: '#1b1b1b' }}
                        >
                          {paySaving ? <Loader2 size={13} className="animate-spin" /> : paySaved ? <CheckCircle2 size={13} /> : <Save size={13} />}
                          {paySaving ? 'Saving…' : paySaved ? 'Saved!' : 'Save schedule'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
            <p className="text-sm text-gray-400">Select a notification type to edit</p>
          </div>
        )}
      </div>

      {/* Preview modal */}
      {preview && current && (
        <PreviewModal
          template={current}
          venueName={venueName}
          logoUrl={logoUrl || undefined}
          brandColor={brandColor}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
