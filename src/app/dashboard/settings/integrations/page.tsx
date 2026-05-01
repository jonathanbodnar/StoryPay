'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Zap,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Activity,
  ShieldCheck,
} from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  source: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  active: boolean;
}

// Public invite URL for the StoryVenue private Zapier integration.
// Anyone who clicks this can self-onboard to the integration without us
// having to manually `zapier users:add <email>` for each person.
const ZAPIER_INVITE_URL =
  process.env.NEXT_PUBLIC_ZAPIER_INVITE_URL ||
  'https://zapier.com/developer/public-invite/241169/4cb250d00c7d98a07f4e8d9a2a6adc8c/';

export default function IntegrationsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/api-keys');
      if (!res.ok) throw new Error('Failed to load API keys');
      const json = (await res.json()) as { keys: ApiKey[] };
      setKeys(json.keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createKey() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() || 'Zapier' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create key');
      setNewPlaintext(json.plaintext as string);
      setNewKeyName('');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm('Revoke this key? Anything using it will immediately stop working.')) return;
    setRevokingId(id);
    try {
      await fetch(`/api/integrations/api-keys/${id}`, { method: 'DELETE' });
      void load();
    } finally {
      setRevokingId(null);
    }
  }

  function copyPlaintext() {
    if (!newPlaintext) return;
    void navigator.clipboard.writeText(newPlaintext);
    setCopiedId('plaintext');
    setTimeout(() => setCopiedId(null), 1800);
  }

  function copyKeyPrefix(prefix: string) {
    void navigator.clipboard.writeText(prefix);
    setCopiedId(prefix);
    setTimeout(() => setCopiedId(null), 1800);
  }

  const activeKeys = useMemo(() => keys.filter((k) => k.active), [keys]);

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Integrations</h1>
          <p className="mt-1 text-sm text-gray-500">
            Connect StoryVenue to thousands of other apps via Zapier — or use the public API directly.
          </p>
        </div>
      </div>

      {/* ── Zapier card ──────────────────────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-5 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50">
            <Zap size={22} className="text-orange-500" fill="currentColor" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Zapier</h2>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">Live</span>
            </div>
            <p className="mt-1 text-sm text-gray-500 leading-relaxed">
              Trigger Zaps when leads arrive, proposals are signed, payments are received, or appointments are booked.
              Send data into StoryVenue from any of Zapier's 6,000+ apps.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={ZAPIER_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all"
              >
                Open Zapier <ExternalLink size={14} />
              </a>
              <button
                onClick={() => {
                  setShowCreate(true);
                  setNewKeyName('Zapier');
                  setTimeout(() => {
                    document.getElementById('keys-section')?.scrollIntoView({ behavior: 'smooth' });
                  }, 30);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-all"
              >
                <KeyRound size={14} /> Generate API key
              </button>
            </div>
          </div>
        </div>

        {/* Triggers + Actions summary */}
        <div className="border-t border-gray-200 px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">Triggers</div>
            <ul className="space-y-1 text-gray-700">
              <li>• New lead</li>
              <li>• New contact</li>
              <li>• Tag added to a contact</li>
              <li>• Proposal sent / signed</li>
              <li>• Payment received</li>
              <li>• Appointment booked / cancelled</li>
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">Actions</div>
            <ul className="space-y-1 text-gray-700">
              <li>• Create or update contact</li>
              <li>• Create lead</li>
              <li>• Add tag to contact (fires workflows)</li>
              <li>• Send SMS</li>
              <li>• Send email</li>
              <li>• Find contact by email</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── Newly-created key reveal ────────────────────────────────── */}
      {newPlaintext && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-emerald-900">Your new API key</h3>
              <p className="mt-1 text-xs text-emerald-800">
                Copy it now — for security, this is the <strong>only time</strong> we'll show the full key.
                Paste it into Zapier's connection screen when prompted.
              </p>
              <div className="mt-3 flex items-stretch gap-2">
                <code className="flex-1 min-w-0 break-all rounded-lg bg-white px-3 py-2.5 text-[13px] font-mono text-gray-900 border border-emerald-200">
                  {newPlaintext}
                </code>
                <button
                  onClick={copyPlaintext}
                  className="flex items-center gap-1.5 rounded-lg bg-[#1b1b1b] px-3 py-2.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  {copiedId === 'plaintext' ? <Check size={14} /> : <Copy size={14} />}
                  {copiedId === 'plaintext' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button
                onClick={() => setNewPlaintext(null)}
                className="mt-3 text-xs font-semibold text-emerald-900 hover:underline"
              >
                I've copied it — dismiss this
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── API keys section ────────────────────────────────────────── */}
      <div id="keys-section" className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <KeyRound size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">API keys</h2>
            <span className="text-xs text-gray-400">({activeKeys.length} active)</span>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            <Plus size={14} /> New key
          </button>
        </div>

        {showCreate && (
          <div className="border-b border-gray-200 px-6 py-4 bg-gray-50">
            <label className="block text-xs font-semibold text-gray-700 mb-2">Key name</label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Zapier, n8n, Acme webhook"
                className="flex-1 min-w-[220px] rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors"
              />
              <button
                onClick={createKey}
                disabled={creating}
                className="flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {creating ? 'Creating...' : 'Create key'}
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewKeyName('');
                }}
                className="rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-600" />
            <span className="text-sm text-red-700">{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        ) : keys.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <p className="text-sm text-gray-500">No API keys yet.</p>
            <p className="mt-1 text-xs text-gray-400">
              Create one to connect Zapier or any other tool to StoryVenue.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {keys.map((k) => (
              <div key={k.id} className="px-6 py-3.5 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 truncate">{k.name}</span>
                    {!k.active && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Revoked</span>
                    )}
                    {k.active && k.source === 'zapier' && (
                      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">Zapier</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                    <button
                      onClick={() => copyKeyPrefix(k.key_prefix)}
                      className="font-mono hover:text-gray-900 inline-flex items-center gap-1"
                      title="Copy prefix"
                    >
                      {k.key_prefix}…
                      {copiedId === k.key_prefix ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} className="text-gray-400" />}
                    </button>
                    <span>•</span>
                    <span>Created {new Date(k.created_at).toLocaleDateString()}</span>
                    {k.last_used_at && (
                      <>
                        <span>•</span>
                        <span>Last used {new Date(k.last_used_at).toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </div>
                {k.active && (
                  <button
                    onClick={() => revokeKey(k.id)}
                    disabled={revokingId === k.id}
                    className="text-xs font-semibold text-gray-500 hover:text-red-600 transition-colors flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {revokingId === k.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Quickstart card ─────────────────────────────────────────── */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Connect via Zapier</h3>
        </div>
        <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
          <li>Click <strong>Generate API key</strong> above and copy the secret.</li>
          <li>Open the StoryVenue Zap (or accept your Zapier invite link).</li>
          <li>When Zapier asks for an API key, paste the value you copied.</li>
          <li>Pick a trigger (e.g. <em>New Lead</em>) and connect it to any other app.</li>
        </ol>
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
          <ShieldCheck size={14} className="text-emerald-500" />
          API keys are hashed with SHA-256 and shown only once. Revoke at any time.
        </div>
      </div>

      {/* ── Direct API note ─────────────────────────────────────────── */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Using the API directly?</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          Send <code className="bg-white px-1.5 py-0.5 rounded border border-gray-200 font-mono">Authorization: Bearer sv_live_…</code> with any request to <code className="bg-white px-1.5 py-0.5 rounded border border-gray-200 font-mono">/api/v1/*</code>.
          Test your key:
        </p>
        <pre className="mt-3 text-xs bg-gray-900 text-emerald-300 rounded-lg p-3 overflow-x-auto">
{`curl -H "Authorization: Bearer sv_live_..." \\
  https://app.storyvenue.com/api/v1/me`}
        </pre>
      </div>
    </div>
  );
}
