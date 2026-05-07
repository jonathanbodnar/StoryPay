'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Globe,
  CheckCircle2,
  Clock,
  AlertCircle,
  Copy,
  Check,
  Loader2,
  Trash2,
  RefreshCw,
  Mail,
  ShieldCheck,
} from 'lucide-react';

interface DnsRecord {
  record: string;
  name: string;
  value: string;
  ttl?: string | number;
  priority?: number;
  status: 'verified' | 'not_started' | 'failed';
}

interface DomainConfig {
  custom_email_domain: string | null;
  resend_domain_id: string | null;
  custom_from_email: string | null;
  custom_from_name: string | null;
  custom_domain_status: 'not_configured' | 'pending' | 'verified' | 'failed';
  custom_domain_dns_records: DnsRecord[] | null;
  custom_domain_verified_at: string | null;
}

const STATUS_META = {
  not_configured: { label: 'Not configured', color: 'text-gray-400', bg: 'bg-gray-50', Icon: Globe },
  pending:        { label: 'Awaiting DNS',   color: 'text-amber-600', bg: 'bg-amber-50', Icon: Clock },
  verified:       { label: 'Verified',        color: 'text-green-700', bg: 'bg-green-50', Icon: CheckCircle2 },
  failed:         { label: 'Failed',          color: 'text-red-600',   bg: 'bg-red-50',   Icon: AlertCircle },
};

export default function EmailSettingsPage() {
  const [config, setConfig] = useState<DomainConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  // Connect form state
  const [domainInput, setDomainInput] = useState('');
  const [fromEmailInput, setFromEmailInput] = useState('');
  const [fromNameInput, setFromNameInput] = useState('');

  // Sender details edit state (when domain already connected)
  const [editFrom, setEditFrom] = useState(false);
  const [editFromEmail, setEditFromEmail] = useState('');
  const [editFromName, setEditFromName] = useState('');

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await fetch('/api/venues/custom-email-domain', { cache: 'no-store' });
    if (res.ok) {
      const j = (await res.json()) as { domain: DomainConfig };
      setConfig(j.domain);
    } else {
      setErr('Failed to load email settings');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleConnect() {
    const domain = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) { setErr('Enter a domain'); return; }
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/venues/custom-email-domain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain,
        from_email: fromEmailInput.trim().toLowerCase() || undefined,
        from_name: fromNameInput.trim() || undefined,
      }),
    });
    const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; domain?: DomainConfig };
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? 'Failed to connect domain'); return; }
    setConfig(j.domain ?? null);
    setDomainInput('');
    setFromEmailInput('');
    setFromNameInput('');
    setMsg('Domain connected — add the DNS records below to your registrar.');
    setTimeout(() => setMsg(null), 6000);
  }

  async function handleVerify() {
    setChecking(true);
    setErr(null);
    const res = await fetch('/api/venues/custom-email-domain/verify', { method: 'POST' });
    const j = await res.json().catch(() => ({})) as { status?: string; records?: DnsRecord[]; error?: string; verified_at?: string | null };
    setChecking(false);
    if (!res.ok) { setErr(j.error ?? 'Verification check failed'); return; }
    setConfig((prev) => prev ? {
      ...prev,
      custom_domain_status: (j.status ?? prev.custom_domain_status) as DomainConfig['custom_domain_status'],
      custom_domain_dns_records: j.records ?? prev.custom_domain_dns_records,
      custom_domain_verified_at: j.verified_at ?? prev.custom_domain_verified_at,
    } : prev);
    if (j.status === 'verified') {
      setMsg('Domain verified! Emails will now send from your custom domain.');
      setTimeout(() => setMsg(null), 5000);
    } else {
      setMsg('DNS not verified yet — make sure all records are added and try again in a few minutes.');
      setTimeout(() => setMsg(null), 8000);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Remove this custom domain? Emails will fall back to the shared StoryVenue sending domain.')) return;
    setBusy(true);
    await fetch('/api/venues/custom-email-domain', { method: 'DELETE' });
    setBusy(false);
    setConfig((prev) => prev ? { ...prev, custom_email_domain: null, resend_domain_id: null, custom_from_email: null, custom_from_name: null, custom_domain_status: 'not_configured', custom_domain_dns_records: null, custom_domain_verified_at: null } : prev);
    setMsg('Custom domain removed.');
    setTimeout(() => setMsg(null), 4000);
  }

  async function handleSaveSender() {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/venues/custom-email-domain', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_email: editFromEmail, from_name: editFromName }),
    });
    const j = await res.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? 'Save failed'); return; }
    setConfig((prev) => prev ? { ...prev, custom_from_email: editFromEmail, custom_from_name: editFromName } : prev);
    setEditFrom(false);
    setMsg('Sender details updated.');
    setTimeout(() => setMsg(null), 3000);
  }

  function copy(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const status = config?.custom_domain_status ?? 'not_configured';
  const statusMeta = STATUS_META[status];
  const StatusIcon = statusMeta.Icon;
  const hasDomain = !!config?.custom_email_domain;
  const records = config?.custom_domain_dns_records ?? [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Email sending</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your own domain so marketing emails send from your address instead of the shared StoryVenue domain.
        </p>
      </div>

      {msg && <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{msg}</p>}
      {err && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}

      {/* ── Status card ─────────────────────────────────────────────────── */}
      <div className={`flex items-center gap-3 rounded-xl border px-5 py-4 ${statusMeta.bg}`}>
        <StatusIcon size={20} className={statusMeta.color} />
        <div className="flex-1">
          <p className={`text-sm font-medium ${statusMeta.color}`}>{statusMeta.label}</p>
          {hasDomain && (
            <p className="text-xs text-gray-500 mt-0.5">
              {config?.custom_email_domain}
              {config?.custom_domain_verified_at
                ? ` · verified ${new Date(config.custom_domain_verified_at).toLocaleDateString()}`
                : ''}
            </p>
          )}
        </div>
        {hasDomain && status !== 'verified' && (
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={checking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Check status
          </button>
        )}
        {hasDomain && status === 'verified' && (
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={checking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Re-check
          </button>
        )}
      </div>

      {/* ── Connect form ────────────────────────────────────────────────── */}
      {!hasDomain && (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-800">Connect your domain</h2>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Enter your venue&apos;s domain name. We&apos;ll generate DNS records you&apos;ll need to add to your registrar (GoDaddy, Cloudflare, Squarespace, etc.). Once DNS is verified, all your marketing emails will send from your domain.
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Domain</label>
              <input
                type="text"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                placeholder="yourvenue.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                From email <span className="text-gray-400 font-normal">(optional — defaults to hello@yourdomain.com)</span>
              </label>
              <input
                type="email"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                placeholder={`hello@${domainInput || 'yourvenue.com'}`}
                value={fromEmailInput}
                onChange={(e) => setFromEmailInput(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                From name <span className="text-gray-400 font-normal">(how your name appears in the inbox)</span>
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                placeholder="Rolling Meadows Venue"
                value={fromNameInput}
                onChange={(e) => setFromNameInput(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={busy || !domainInput.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
            Connect domain
          </button>
        </div>
      )}

      {/* ── DNS records table ─────────────────────────────────────────── */}
      {hasDomain && records.length > 0 && status !== 'verified' && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-800">Add these DNS records</h2>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Log in to your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.) and add the following records exactly as shown. DNS changes can take up to 48 hours to propagate — most resolve within 30 minutes.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-2 text-left font-medium text-gray-500">Type</th>
                  <th className="pb-2 text-left font-medium text-gray-500">Name / Host</th>
                  <th className="pb-2 text-left font-medium text-gray-500">Value</th>
                  <th className="pb-2 text-left font-medium text-gray-500 w-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {records.map((r, i) => (
                  <tr key={i} className="group">
                    <td className="py-2.5 pr-3 font-mono font-semibold text-gray-700">{r.record}</td>
                    <td className="py-2.5 pr-3 font-mono text-gray-600 max-w-[120px] truncate">{r.name}</td>
                    <td className="py-2.5 pr-3 font-mono text-gray-600 max-w-[240px]">
                      <span className="block truncate">{r.value}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => copy(r.value, `r-${i}`)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="Copy value"
                      >
                        {copiedKey === `r-${i}` ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={checking}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            I've added the records — check now
          </button>
        </div>
      )}

      {/* ── Verified: show DNS records collapsed + sender details ─────── */}
      {hasDomain && status === 'verified' && (
        <div className="rounded-xl border border-green-100 bg-green-50 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-600" />
            <p className="text-sm font-medium text-green-700">All DNS records verified</p>
          </div>
          {records.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-green-600 hover:underline">View DNS records</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-green-100">
                      <th className="pb-2 text-left font-medium text-green-700">Type</th>
                      <th className="pb-2 text-left font-medium text-green-700">Name</th>
                      <th className="pb-2 text-left font-medium text-green-700">Value</th>
                      <th className="pb-2 w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-green-50">
                    {records.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-3 font-mono font-semibold text-green-700">{r.record}</td>
                        <td className="py-2 pr-3 font-mono text-green-600 max-w-[120px] truncate">{r.name}</td>
                        <td className="py-2 pr-3 font-mono text-green-600 max-w-[240px]">
                          <span className="block truncate">{r.value}</span>
                        </td>
                        <td className="py-2">
                          <button type="button" onClick={() => copy(r.value, `rv-${i}`)} className="rounded px-1 py-0.5 text-green-400 hover:text-green-700">
                            {copiedKey === `rv-${i}` ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Sender details (editable when domain is connected) ────────── */}
      {hasDomain && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-800">Sender details</h2>
            </div>
            {!editFrom && (
              <button
                type="button"
                onClick={() => {
                  setEditFromEmail(config?.custom_from_email ?? '');
                  setEditFromName(config?.custom_from_name ?? '');
                  setEditFrom(true);
                }}
                className="text-xs text-blue-600 hover:underline"
              >
                Edit
              </button>
            )}
          </div>

          {!editFrom ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span className="text-xs text-gray-500">From email</span>
                <span className="font-medium text-gray-800">{config?.custom_from_email ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span className="text-xs text-gray-500">From name</span>
                <span className="font-medium text-gray-800">{config?.custom_from_name ?? '—'}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">From email</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                  value={editFromEmail}
                  onChange={(e) => setEditFromEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">From name</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                  value={editFromName}
                  onChange={(e) => setEditFromName(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveSender()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                  Save
                </button>
                <button type="button" onClick={() => setEditFrom(false)} className="text-sm text-gray-500 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      {hasDomain && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">Disconnect domain</h2>
          <p className="text-xs text-gray-500 mb-4">
            Removing your custom domain will revert all marketing emails to sending from the shared StoryVenue address. Your DNS records can be removed from your registrar after disconnecting.
          </p>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={14} />
            Disconnect domain
          </button>
        </div>
      )}

      {/* ── Shared domain info ───────────────────────────────────────────── */}
      {!hasDomain && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-5 text-xs text-gray-500 space-y-1.5 leading-relaxed">
          <p className="font-medium text-gray-700">Using shared StoryVenue domain</p>
          <p>
            Without a custom domain, emails send from <span className="font-mono">hello@send.storyvenue.com</span>.
            Recipients will see your venue name in the inbox but the sending address will be StoryVenue&apos;s.
          </p>
          <p>
            Connecting your own domain improves deliverability and makes emails look more professional.
            DNS records take 15–60 minutes to verify after you add them.
          </p>
        </div>
      )}
    </div>
  );
}
