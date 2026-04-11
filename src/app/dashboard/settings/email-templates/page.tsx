'use client';

import { useEffect, useState } from 'react';
import {
  FileText, CreditCard, Bell, RefreshCw, XCircle, AlertTriangle,
  Eye, Save, Loader2, ChevronRight, CheckCircle2, PenLine, Send, X,
} from 'lucide-react';

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
};

const INPUT = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function VariablePill({ variable, onClick }: { variable: string; onClick: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(variable);
    setCopied(true);
    onClick();
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={copy}
      className={`rounded-lg border px-2.5 py-1 text-xs font-mono transition-all ${copied ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-white'}`}>
      {copied ? '✓ copied' : variable}
    </button>
  );
}

function PreviewModal({ template, venueName, logoUrl, brandColor, onClose }: {
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
      .replace(/\{\{customer_email\}\}/g, 'jane@example.com');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100" style={{ backgroundColor: '#1b1b1b' }}>
          <div>
            <p className="text-sm font-semibold text-white">Email Preview</p>
            <p className="text-xs text-white/60 mt-0.5">{template.label}</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1">
          <div className="p-4">
            {/* Email preview */}
            <div className="rounded-xl border border-gray-200 overflow-hidden text-sm">
              {/* Subject line */}
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Subject: </span>
                <span className="text-gray-700">{fill(template.subject)}</span>
              </div>
              {/* Body */}
              <div style={{ fontFamily: 'Arial, sans-serif' }}>
                <div className="px-6 py-5" style={{ backgroundColor: brandColor || '#1b1b1b' }}>
                  {logoUrl
                    ? <img src={logoUrl} alt={venueName} style={{ maxHeight: 52, maxWidth: 220, objectFit: 'contain', display: 'block' }} />
                    : <p className="text-white font-bold text-lg m-0">{venueName || 'Your Venue'}</p>
                  }
                </div>
                <div className="px-6 py-6">
                  <h2 className="text-lg font-bold text-gray-900 mb-3">{fill(template.heading)}</h2>
                  <div className="text-gray-600 text-sm leading-relaxed whitespace-pre-line mb-5">
                    {fill(template.body)}
                  </div>
                  {template.button_text && (
                    <div className="text-center my-5">
                      <span className="inline-block rounded-xl px-6 py-3 text-sm font-bold text-white" style={{ backgroundColor: '#1b1b1b' }}>
                        {fill(template.button_text)}
                      </span>
                    </div>
                  )}
                  {template.footer && (
                    <p className="text-xs text-gray-400 text-center mt-4 pt-4 border-t border-gray-100">{fill(template.footer)}</p>
                  )}
                  <p className="text-[10px] text-gray-300 text-center mt-4">Sent via StoryPay</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [preview, setPreview]       = useState(false);
  const [venueName, setVenueName]   = useState('');
  const [logoUrl, setLogoUrl]       = useState('');
  const [brandColor, setBrandColor] = useState('#1b1b1b');
  const [showTestForm, setShowTestForm] = useState(false);
  const [testEmail, setTestEmail]       = useState('');
  const [testSending, setTestSending]   = useState(false);
  const [testResult, setTestResult]     = useState<'sent' | 'error' | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/email-templates').then(r => r.json()),
      fetch('/api/venues/me').then(r => r.json()),
    ]).then(([tmpl, venue]) => {
      setTemplates(Array.isArray(tmpl) ? tmpl : []);
      if (tmpl.length > 0) setSelected(tmpl[0].type);
      setVenueName(venue?.name || '');
      setLogoUrl(venue?.brand_logo_url || '');
      setBrandColor(venue?.brand_color || '#1b1b1b');
    }).finally(() => setLoading(false));
  }, []);

  const current = templates.find(t => t.type === selected);

  function update(field: keyof EmailTemplate, value: string | boolean) {
    setTemplates(prev => prev.map(t => t.type === selected ? { ...t, [field]: value } : t));
  }

  async function save() {
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
    } finally { setSaving(false); }
  }

  async function sendTest() {
    if (!current || !testEmail.includes('@')) return;
    setTestSending(true);
    setTestResult(null);
    try {
      // Pass the live editor state so the test reflects unsaved edits,
      // not the last-saved version in the database.
      const res = await fetch(`/api/email-templates/${current.type}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmail,
          template: {
            subject:     current.subject,
            heading:     current.heading,
            body:        current.body,
            button_text: current.button_text,
            footer:      current.footer,
          },
        }),
      });
      setTestResult(res.ok ? 'sent' : 'error');
      if (res.ok) setTimeout(() => { setTestResult(null); setShowTestForm(false); setTestEmail(''); }, 3000);
    } catch { setTestResult('error'); }
    finally { setTestSending(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl text-gray-900">Email Templates</h1>
        <p className="mt-1 text-sm text-gray-500">Customize the emails sent to your customers</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">

        {/* ── Left: Email Types list ── */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">Email Types</span>
          </div>
          <div className="divide-y divide-gray-50">
            {templates.map(t => {
              const Icon = ICON_MAP[t.icon] ?? FileText;
              const active = selected === t.type;
              return (
                <button key={t.type} onClick={() => setSelected(t.type)}
                  className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors ${active ? 'bg-gray-100 text-gray-900' : 'hover:bg-gray-50/80 text-gray-700'}`}>
                  <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${active ? 'bg-white border border-gray-200' : 'bg-gray-100'}`}>
                    <Icon size={16} className="text-gray-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight text-gray-900">{t.label}</p>
                    <p className="text-[11px] mt-0.5 truncate text-gray-400">{t.description}</p>
                  </div>
                  <ChevronRight size={15} className={active ? 'text-gray-500' : 'text-gray-300'} />
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: Editor ── */}
        {current ? (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Editor header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                {(() => { const Icon = ICON_MAP[current.icon] ?? FileText; return <Icon size={18} className="text-gray-500" />; })()}
                <div>
                  <p className="text-base font-semibold text-gray-900">{current.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{current.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowTestForm(v => !v); setTestResult(null); }}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  <Send size={14} /> Send Test
                </button>
                <button onClick={() => setPreview(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  <Eye size={14} /> Preview
                </button>
                <button onClick={save} disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all shadow-sm"
                  style={{ backgroundColor: '#1b1b1b' }}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
                  {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
                </button>
              </div>
            </div>

            {/* ── Test email inline form ── */}
            {showTestForm && (
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60">
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendTest()}
                    placeholder="Enter email address to send test to..."
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
                  />
                  <button
                    onClick={sendTest}
                    disabled={testSending || !testEmail.includes('@')}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-all"
                    style={{ backgroundColor: '#1b1b1b' }}
                  >
                    {testSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {testSending ? 'Sending...' : 'Send'}
                  </button>
                  <button onClick={() => { setShowTestForm(false); setTestResult(null); setTestEmail(''); }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                    <X size={14} />
                  </button>
                </div>
                {testResult === 'sent' && (
                  <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle2 size={13} /> Test email sent! Check your inbox.
                  </p>
                )}
                {testResult === 'error' && (
                  <p className="mt-2 text-xs text-red-500">Failed to send — check that your email service (Resend/SendGrid) is configured.</p>
                )}
              </div>
            )}

            <div className="px-6 py-5 space-y-5">
              {/* Variables */}
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3.5">
                <p className="text-xs font-semibold text-gray-500 mb-2.5">Available Variables</p>
                <div className="flex flex-wrap gap-2">
                  {current.variables.map(v => (
                    <VariablePill key={v} variable={v} onClick={() => {}} />
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Click a variable to copy it, then paste into your template.</p>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject Line</label>
                <input type="text" value={current.subject} onChange={e => update('subject', e.target.value)} className={INPUT} />
              </div>

              {/* Heading */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email Heading</label>
                <input type="text" value={current.heading} onChange={e => update('heading', e.target.value)} className={INPUT} />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Body Text</label>
                <textarea
                  value={current.body}
                  onChange={e => update('body', e.target.value)}
                  rows={5}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors resize-none"
                />
              </div>

              {/* Button Text */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Button Text <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={current.button_text} onChange={e => update('button_text', e.target.value)}
                  placeholder="e.g. View Invoice" className={INPUT} />
              </div>

              {/* Footer */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Footer Text <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={current.footer} onChange={e => update('footer', e.target.value)}
                  placeholder="Additional note or disclaimer..." className={INPUT} />
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Enable this email</p>
                  <p className="text-xs text-gray-400 mt-0.5">When disabled, this email type will not be sent</p>
                </div>
                <Toggle checked={current.enabled} onChange={v => update('enabled', v)} />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-12 text-center">
            <p className="text-sm text-gray-400">Select an email type to edit</p>
          </div>
        )}
      </div>

      {/* Preview modal */}
      {preview && current && (
        <PreviewModal template={current} venueName={venueName} logoUrl={logoUrl || undefined} brandColor={brandColor} onClose={() => setPreview(false)} />
      )}
    </div>
  );
}
