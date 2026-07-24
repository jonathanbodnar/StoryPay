'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Mail,
  Pencil,
  RotateCcw,
  Send,
  X,
  Check,
  Loader2,
} from 'lucide-react';
import { CATEGORY_LABELS, type SystemEmailCategory } from '@/lib/system-email-registry';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TemplateItem {
  key: string;
  label: string;
  description: string;
  trigger: string;
  schedule: string | null;
  category: SystemEmailCategory;
  editable: boolean;
  subject: string;
  heading: string;
  body: string;
  button_text: string | null;
  is_customized: boolean;
  updated_at: string | null;
  updated_by: string | null;
  default_subject: string;
  default_heading: string;
  default_body: string;
  default_button_text: string | null;
}

// ── Category badge ─────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<SystemEmailCategory, string> = {
  onboarding:   'bg-blue-50 text-blue-700 border-blue-200',
  reengagement: 'bg-amber-50 text-amber-700 border-amber-200',
  leads:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  auth:         'bg-gray-50 text-gray-600 border-gray-200',
  reporting:    'bg-violet-50 text-violet-700 border-violet-200',
  ai:           'bg-indigo-50 text-indigo-700 border-indigo-200',
  billing:      'bg-rose-50 text-rose-700 border-rose-200',
};

function CategoryBadge({ cat }: { cat: SystemEmailCategory }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${CATEGORY_COLORS[cat]}`}>
      {CATEGORY_LABELS[cat]}
    </span>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function PreviewModal({ keyId, onClose }: { keyId: string; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/system-emails/preview?key=${encodeURIComponent(keyId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((h) => { setHtml(h); setLoading(false); })
      .catch((e) => { setErr(e.message); setLoading(false); });
  }, [keyId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mt-8 mb-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">Email Preview</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="p-5 min-h-[400px]">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          )}
          {err && <p className="text-red-600 text-sm">{err}</p>}
          {html && !loading && (
            <iframe
              srcDoc={html}
              title="Email preview"
              className="w-full border border-gray-200 rounded"
              style={{ height: 520 }}
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edit drawer ───────────────────────────────────────────────────────────────

function EditDrawer({
  tpl,
  onClose,
  onSaved,
}: {
  tpl: TemplateItem;
  onClose: () => void;
  onSaved: (updated: Partial<TemplateItem>) => void;
}) {
  const [subject, setSubject]     = useState(tpl.subject);
  const [heading, setHeading]     = useState(tpl.heading);
  const [body, setBody]           = useState(tpl.body);
  const [btnText, setBtnText]     = useState(tpl.button_text ?? '');
  const [saving, setSaving]       = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg]             = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/system-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: tpl.key,
          subject,
          heading,
          body,
          button_text: btnText || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setMsg('Saved');
      onSaved({ subject, heading, body, button_text: btnText || null, is_customized: true });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm('Reset this template to the default copy?')) return;
    setResetting(true);
    try {
      await fetch('/api/admin/system-emails', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: tpl.key, reset: true }),
      });
      setSubject(tpl.default_subject);
      setHeading(tpl.default_heading);
      setBody(tpl.default_body);
      setBtnText(tpl.default_button_text ?? '');
      onSaved({
        subject:     tpl.default_subject,
        heading:     tpl.default_heading,
        body:        tpl.default_body,
        button_text: tpl.default_button_text,
        is_customized: false,
      });
      setMsg('Reset to default');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-end">
      <div className="relative bg-white h-full w-full max-w-xl shadow-xl flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{tpl.label}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Edit email copy</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Subject line</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <p className="text-xs text-gray-400 mt-1">Use {'{{owner_first_name}}'}, {'{{venue_name}}'}, etc.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Heading</label>
            <input
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 font-mono resize-y"
            />
            <p className="text-xs text-gray-400 mt-1">Blank lines become spacers. Merge vars: {'{{venue_name}}'}, {'{{owner_first_name}}'}, {'{{action_url}}'}.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Button text (leave blank to hide)</label>
            <input
              value={btnText}
              onChange={(e) => setBtnText(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save changes
          </button>
          <button
            onClick={reset}
            disabled={resetting}
            className="flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCcw size={13} />
            Reset to default
          </button>
          {msg && (
            <span className={`text-xs ml-auto ${msg === 'Saved' || msg === 'Reset to default' ? 'text-emerald-600' : 'text-red-600'}`}>
              {msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TemplateCard ──────────────────────────────────────────────────────────────

function TemplateCard({
  tpl,
  adminEmail,
  onUpdated,
}: {
  tpl: TemplateItem;
  adminEmail: string;
  onUpdated: (key: string, patch: Partial<TemplateItem>) => void;
}) {
  const [expanded, setExpanded]         = useState(false);
  const [previewing, setPreviewing]     = useState(false);
  const [editing, setEditing]           = useState(false);
  const [testTo, setTestTo]             = useState(adminEmail);
  const [testSending, setTestSending]   = useState(false);
  const [testMsg, setTestMsg]           = useState<string | null>(null);

  const sendTest = useCallback(async () => {
    if (!testTo) return;
    setTestSending(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/admin/system-emails/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: tpl.key, to: testTo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Send failed');
      setTestMsg(`Sent to ${testTo}`);
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setTestSending(false);
    }
  }, [tpl.key, testTo]);

  return (
    <>
      {previewing && <PreviewModal keyId={tpl.key} onClose={() => setPreviewing(false)} />}
      {editing && tpl.editable && (
        <EditDrawer
          tpl={tpl}
          onClose={() => setEditing(false)}
          onSaved={(patch) => {
            onUpdated(tpl.key, patch);
            setEditing(false);
          }}
        />
      )}

      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        {/* Header row */}
        <button
          onClick={() => setExpanded((x) => !x)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
        >
          {expanded ? (
            <ChevronDown size={16} className="text-gray-400 shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-gray-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-900">{tpl.label}</span>
              <CategoryBadge cat={tpl.category} />
              {tpl.is_customized && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                  Customized
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{tpl.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewing(true)}
              title="Preview"
              className="p-1.5 rounded hover:bg-gray-100"
            >
              <Eye size={15} className="text-gray-500" />
            </button>
            {tpl.editable && (
              <button
                onClick={() => setEditing(true)}
                title="Edit copy"
                className="p-1.5 rounded hover:bg-gray-100"
              >
                <Pencil size={15} className="text-gray-500" />
              </button>
            )}
          </div>
        </button>

        {/* Expanded body */}
        {expanded && (
          <div className="border-t border-gray-100 px-5 py-4 space-y-4">
            {/* Trigger / schedule */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">When it fires</p>
                <p className="text-sm text-gray-700">{tpl.trigger}</p>
              </div>
              {tpl.schedule && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Schedule</p>
                  <p className="text-sm text-gray-700">{tpl.schedule}</p>
                </div>
              )}
            </div>

            {/* Copy preview */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div>
                <span className="text-xs font-medium text-gray-500">Subject: </span>
                <span className="text-sm text-gray-800">{tpl.subject}</span>
              </div>
              <div>
                <span className="text-xs font-medium text-gray-500">Heading: </span>
                <span className="text-sm text-gray-800">{tpl.heading}</span>
              </div>
              <div>
                <span className="text-xs font-medium text-gray-500">Body preview: </span>
                <span className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-4">{tpl.body}</span>
              </div>
              {tpl.button_text && (
                <div>
                  <span className="text-xs font-medium text-gray-500">Button: </span>
                  <span className="text-sm text-gray-800">{tpl.button_text}</span>
                </div>
              )}
            </div>

            {/* Updated by */}
            {tpl.is_customized && tpl.updated_at && (
              <p className="text-xs text-gray-400">
                Last edited {new Date(tpl.updated_at).toLocaleDateString()}
                {tpl.updated_by ? ` by ${tpl.updated_by}` : ''}
              </p>
            )}

            {/* Test send */}
            <div className="flex items-center gap-2 flex-wrap">
              <Mail size={14} className="text-gray-400 shrink-0" />
              <span className="text-xs font-medium text-gray-600 shrink-0">Send test to:</span>
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="email@example.com"
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 min-w-0 flex-1"
              />
              <button
                onClick={sendTest}
                disabled={testSending || !testTo}
                className="flex items-center gap-1.5 text-sm font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-50 shrink-0"
              >
                {testSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Send test
              </button>
              {testMsg && (
                <span className={`text-xs ${testMsg.startsWith('Sent') ? 'text-emerald-600' : 'text-red-600'}`}>
                  {testMsg}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SystemEmailsPanel({ adminEmail }: { adminEmail: string }) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [filter, setFilter]       = useState<SystemEmailCategory | 'all'>('all');

  useEffect(() => {
    fetch('/api/admin/system-emails')
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
        setTemplates(json.templates ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setErr(String(e?.message || e));
        setLoading(false);
      });
  }, []);

  function handleUpdated(key: string, patch: Partial<TemplateItem>) {
    setTemplates((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  const visible = filter === 'all'
    ? templates
    : templates.filter((t) => t.category === filter);

  const categories: Array<SystemEmailCategory | 'all'> = [
    'all',
    'reengagement',
    'leads',
    'onboarding',
    'auth',
    'reporting',
    'ai',
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">System Email Templates</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            All automatic emails StoryVenue sends. Editable templates can have their copy customized here.
          </p>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              filter === cat
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            {cat === 'all' ? 'All emails' : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-8 justify-center">
          <Loader2 size={18} className="animate-spin" />
          Loading templates...
        </div>
      )}
      {err && <p className="text-red-600 text-sm">{err}</p>}

      {!loading && !err && visible.length === 0 && (
        <p className="text-gray-500 text-sm py-8 text-center">No templates in this category.</p>
      )}

      <div className="space-y-3">
        {visible.map((tpl) => (
          <TemplateCard
            key={tpl.key}
            tpl={tpl}
            adminEmail={adminEmail}
            onUpdated={handleUpdated}
          />
        ))}
      </div>
    </div>
  );
}
