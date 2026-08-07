'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Link2,
  Unlink,
  Send,
  CalendarClock,
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

// ── Tripleseat Integration Card ───────────────────────────────────────────────

interface TSLocation { id: number; name: string }

function TripleseatCard() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading');
  const [maskedKey, setMaskedKey]   = useState('');
  const [locationId, setLocationId] = useState<number | null>(null);
  const [locations, setLocations]   = useState<TSLocation[]>([]);

  const [inputKey, setInputKey]       = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [testing, setTesting]         = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const r = await fetch('/api/integrations/tripleseat', { cache: 'no-store' });
      const d = await r.json() as { connected: boolean; publicKey: string | null; locationId: number | null; locations: TSLocation[] };
      setStatus(d.connected ? 'connected' : 'disconnected');
      setMaskedKey(d.publicKey ?? '');
      setLocationId(d.locationId);
      setLocations(d.locations ?? []);
    } catch {
      setStatus('disconnected');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function connect() {
    if (!inputKey.trim()) { flash(false, 'Paste your Tripleseat public API key first.'); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/integrations/tripleseat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: inputKey.trim(), locationId }),
      });
      const d = await r.json() as { connected?: boolean; locations?: TSLocation[]; locationId?: number | null; error?: string };
      if (!r.ok) { flash(false, d.error ?? 'Connection failed.'); return; }
      setInputKey('');
      setShowConnect(false);
      setLocations(d.locations ?? []);
      setLocationId(d.locationId ?? null);
      setStatus('connected');
      flash(true, 'Tripleseat connected successfully.');
    } catch {
      flash(false, 'Network error — check your connection and try again.');
    } finally { setSaving(false); }
  }

  async function updateLocation(id: number) {
    setLocationId(id);
    await fetch('/api/integrations/tripleseat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId: id }),
    });
  }

  async function sendTest() {
    setTesting(true); setMsg(null);
    try {
      const r = await fetch('/api/integrations/tripleseat/test', { method: 'POST' });
      const d = await r.json() as { ok?: boolean; tripleseatLeadId?: number; error?: string };
      if (r.ok && d.ok) flash(true, `Test lead sent to Tripleseat${d.tripleseatLeadId ? ` (ID #${d.tripleseatLeadId})` : ''}.`);
      else flash(false, d.error ?? 'Test lead failed.');
    } catch {
      flash(false, 'Network error.');
    } finally { setTesting(false); }
  }

  async function disconnect() {
    if (!confirm('Disconnect Tripleseat? New leads will stop being sent over.')) return;
    setDisconnecting(true);
    await fetch('/api/integrations/tripleseat', { method: 'DELETE' });
    setStatus('disconnected');
    setMaskedKey('');
    setLocationId(null);
    setLocations([]);
    setDisconnecting(false);
    flash(true, 'Tripleseat disconnected.');
  }

  const isLoading = status === 'loading';
  const isConnected = status === 'connected';

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* Header row */}
      <div className="px-6 py-5 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-50">
          {/* Tripleseat wordmark-style logo placeholder */}
          <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none">
            <rect width="32" height="32" rx="8" fill="#0ea5e9" />
            <text x="16" y="22" textAnchor="middle" fontSize="14" fontWeight="700" fill="white" fontFamily="sans-serif">T</text>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">Tripleseat</h2>
            {isLoading ? (
              <Loader2 size={13} className="animate-spin text-gray-400" />
            ) : isConnected ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">Connected</span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">Not connected</span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500 leading-relaxed">
            Automatically send new leads into Tripleseat the moment they submit your form — name, email, phone,
            message, and UTM attribution, all mapped over instantly.
          </p>

          {/* Connected state */}
          {isConnected && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <ShieldCheck size={13} className="text-emerald-500" />
                <span>Key: <code className="font-mono text-gray-700">{maskedKey}</code></span>
              </div>

              {locations.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-700 shrink-0">Location:</label>
                  <select
                    value={locationId ?? ''}
                    onChange={(e) => void updateLocation(Number(e.target.value))}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 focus:border-gray-400 focus:outline-none"
                  >
                    <option value="" disabled>Select a location</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {locations.length === 1 && (
                <p className="text-xs text-gray-500">Location: <strong className="text-gray-700">{locations[0].name}</strong></p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void sendTest()}
                  disabled={testing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-all"
                >
                  {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Send test lead
                </button>
                <button
                  onClick={() => void disconnect()}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 transition-all"
                >
                  {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {/* Disconnected state */}
          {!isConnected && !isLoading && (
            <div className="mt-3">
              {!showConnect ? (
                <button
                  onClick={() => setShowConnect(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-all"
                >
                  <Link2 size={14} /> Connect Tripleseat
                </button>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Public API key
                      <a
                        href="https://app.tripleseat.com/settings/api"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 font-normal text-sky-600 hover:text-sky-800 inline-flex items-center gap-0.5"
                      >
                        Find it in Tripleseat <ExternalLink size={10} />
                      </a>
                    </label>
                    <input
                      type="text"
                      value={inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      placeholder="Paste your Tripleseat public API key"
                      className="w-full max-w-md rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors font-mono"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">
                      In Tripleseat: Settings → API → copy your <strong>Public Key</strong>.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void connect()}
                      disabled={saving || !inputKey.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                    >
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      {saving ? 'Connecting…' : 'Connect'}
                    </button>
                    <button
                      onClick={() => { setShowConnect(false); setInputKey(''); }}
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Feedback message */}
          {msg && (
            <div className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
              {msg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {msg.text}
            </div>
          )}
        </div>
      </div>

      {/* What gets sent */}
      <div className="border-t border-gray-100 px-6 py-4 text-sm text-gray-500">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1.5">What gets pushed to Tripleseat</span>
        <p>Name · Email · Phone · Message · UTM source / medium / campaign — sent the moment a lead submits your form. No sync back — data only flows from StoryVenue to Tripleseat.</p>
      </div>
    </div>
  );
}

// ── Calendly Integration Card ─────────────────────────────────────────────────

interface CalendlyStatus {
  connected: boolean;
  user_name?: string;
  user_email?: string;
  event_count?: number;
  webhook_registered?: boolean;
  error?: string;
}

function CalendlyCard() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading');
  const [info, setInfo] = useState<CalendlyStatus>({ connected: false });
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const r = await fetch('/api/integrations/calendly/status', { cache: 'no-store' });
      const d = await r.json() as CalendlyStatus;
      setInfo(d);
      setStatus(d.connected ? 'connected' : 'disconnected');
    } catch {
      setStatus('disconnected');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function connect() {
    if (!token.trim()) { flash(false, 'Paste your Calendly Personal Access Token first.'); return; }
    setConnecting(true); setMsg(null);
    try {
      const r = await fetch('/api/integrations/calendly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: token.trim() }),
      });
      const d = await r.json() as { connected?: boolean; user_name?: string; user_email?: string; error?: string };
      if (!r.ok) { flash(false, d.error ?? 'Connection failed.'); return; }
      setToken('');
      setInfo({ connected: true, user_name: d.user_name, user_email: d.user_email });
      setStatus('connected');
      flash(true, 'Calendly connected successfully.');
    } catch {
      flash(false, 'Network error — check your connection and try again.');
    } finally { setConnecting(false); }
  }

  async function syncNow() {
    setSyncing(true); setMsg(null);
    try {
      const r = await fetch('/api/integrations/calendly/sync', { method: 'POST' });
      if (r.ok) { flash(true, 'Sync complete — your calendar is up to date.'); void load(); }
      else { const d = await r.json() as { error?: string }; flash(false, d.error ?? 'Sync failed.'); }
    } catch {
      flash(false, 'Network error.');
    } finally { setSyncing(false); }
  }

  async function disconnect() {
    if (!confirm('Disconnect Calendly? Bookings will no longer sync in real time.')) return;
    setDisconnecting(true);
    try {
      await fetch('/api/integrations/calendly/disconnect', { method: 'POST' });
      setInfo({ connected: false });
      setStatus('disconnected');
      flash(true, 'Calendly disconnected.');
    } finally { setDisconnecting(false); }
  }

  const isLoading = status === 'loading';
  const isConnected = status === 'connected';

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* Header row */}
      <div className="px-6 py-5 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50">
          <CalendarClock size={22} className="text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">Calendly</h2>
            {isLoading ? (
              <Loader2 size={13} className="animate-spin text-gray-400" />
            ) : isConnected ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">Connected</span>
            ) : (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">Not connected</span>
            )}
          </div>

          {/* Connected state */}
          {isConnected && (
            <div className="mt-3 space-y-3">
              <div className="space-y-1 text-xs text-gray-500">
                {info.user_name && (
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={13} className="text-emerald-500 shrink-0" />
                    <span>Account: <strong className="text-gray-700">{info.user_name}</strong></span>
                  </div>
                )}
                {info.user_email && (
                  <div className="flex items-center gap-2">
                    <span className="ml-[21px] text-gray-400">{info.user_email}</span>
                  </div>
                )}
                {typeof info.event_count === 'number' && (
                  <div className="flex items-center gap-2">
                    <span className="ml-[21px]">{info.event_count} upcoming event{info.event_count !== 1 ? 's' : ''} synced</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void syncNow()}
                  disabled={syncing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-all"
                >
                  {syncing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Sync now
                </button>
                <button
                  onClick={() => void disconnect()}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 transition-all"
                >
                  {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {/* Disconnected state */}
          {!isConnected && !isLoading && (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-gray-500 leading-relaxed">
                Automatically sync tour bookings from Calendly into your calendar and lead pipeline.
                When a bride books a tour, her lead moves to Booked Tours and AI follow-up pauses.
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Personal Access Token
                  <a
                    href="https://calendly.com/integrations/api_webhooks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 font-normal text-sky-600 hover:text-sky-800 inline-flex items-center gap-0.5"
                  >
                    Find your token <ExternalLink size={10} />
                  </a>
                </label>
                <input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your Calendly Personal Access Token"
                  className="w-full max-w-md rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors font-mono"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Find your token at{' '}
                  <a
                    href="https://calendly.com/integrations/api_webhooks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 hover:underline"
                  >
                    calendly.com/integrations/api_webhooks
                  </a>{' '}
                  → Personal Access Tokens
                </p>
              </div>
              <button
                onClick={() => void connect()}
                disabled={connecting || !token.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-all"
              >
                {connecting ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                {connecting ? 'Connecting…' : 'Connect Calendly'}
              </button>
            </div>
          )}

          {/* Feedback message */}
          {msg && (
            <div className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
              {msg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {msg.text}
            </div>
          )}
        </div>
      </div>

      {/* Capabilities */}
      <div className="border-t border-gray-100 px-6 py-4 text-sm text-gray-500">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-2">What Calendly does</span>
        <ul className="space-y-1.5">
          <li className="flex items-start gap-2">
            <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
            <span><strong className="text-gray-700">Real-time booking sync</strong> — new bookings appear in your Calendar instantly</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
            <span><strong className="text-gray-700">Lead pipeline update</strong> — matching leads auto-advance to &ldquo;Booked Tours&rdquo;</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
            <span><strong className="text-gray-700">AI pause</strong> — follow-up sequences pause when a tour is booked</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={13} className="text-gray-400 mt-0.5 shrink-0" />
            <span className="text-gray-400">Cannot block dates in Calendly from StoryVenue (Calendly read-only)</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={13} className="text-gray-400 mt-0.5 shrink-0" />
            <span className="text-gray-400">Cannot reschedule or create bookings from StoryVenue</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

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
    if (!confirm('Delete this key permanently? Anything using it will immediately stop working and cannot be recovered.')) return;
    setRevokingId(id);
    try {
      await fetch(`/api/integrations/api-keys/${id}`, { method: 'DELETE' });
      // Remove instantly from local state — no need to reload from server.
      setKeys((prev) => prev.filter((k) => k.id !== id));
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
            Connect StoryVenue to thousands of other apps via Zapier.
          </p>
        </div>
      </div>

      {/* ── Tripleseat card ──────────────────────────────────────────── */}
      <TripleseatCard />

      {/* ── Calendly card ────────────────────────────────────────────── */}
      <CalendlyCard />

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

    </div>
  );
}
