'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck, Shield, Loader2, CheckCircle2, AlertTriangle,
  Copy, Check, X,
} from 'lucide-react';

interface StatusResponse {
  available?:            boolean;
  enabled:               boolean;
  enabledAt?:            string | null;
  backupCodesRemaining?: number;
}

interface SetupResponse {
  secret:      string;
  otpauthUri:  string;
}

/**
 * Self-contained 2FA management section for the profile page.
 *
 * Flows:
 *  - Disabled → "Enable 2FA" → /setup → show QR + secret → user scans →
 *    user types code → /enable → show backup codes (one-time) → done.
 *  - Enabled → "Disable 2FA" → password + code → /disable → done.
 */
export default function TwoFactorSection() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Enrolment flow
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupData, setSetupData] = useState<SetupResponse | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  // Backup codes (shown once after enabling)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Disable flow
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePw, setDisablePw] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);

  async function refresh() {
    try {
      const res = await fetch('/api/auth/2fa/status', { cache: 'no-store' });
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  // Hide the entire section when 2FA is disabled at the platform level.
  // The status endpoint returns available:false when TWOFA_ENABLED is off.
  // We also render nothing while loading to avoid a flash of the section
  // for users on a platform where 2FA is gated off.
  if (loading) return null;
  if (status?.available === false) return null;

  async function startSetup() {
    setSetupBusy(true);
    setSetupError('');
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setSetupError(data.error ?? 'Failed to start setup'); return; }
      setSetupData(data);
      setSetupOpen(true);
    } finally {
      setSetupBusy(false);
    }
  }

  async function confirmEnable() {
    setSetupBusy(true);
    setSetupError('');
    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: setupCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setSetupError(data.error ?? 'Code is incorrect'); return; }
      setBackupCodes(data.backupCodes ?? []);
      setSetupOpen(false);
      setSetupData(null);
      setSetupCode('');
      void refresh();
    } finally {
      setSetupBusy(false);
    }
  }

  async function confirmDisable() {
    setDisableBusy(true);
    setDisableError('');
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePw, code: disableCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setDisableError(data.error ?? 'Failed to disable'); return; }
      setDisableOpen(false);
      setDisablePw('');
      setDisableCode('');
      void refresh();
    } finally {
      setDisableBusy(false);
    }
  }

  async function copySecret() {
    if (!setupData?.secret) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-5">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2.5">
        <ShieldCheck size={16} className="text-gray-700" />
        <h2 className="text-sm font-semibold text-gray-900">Two-Factor Authentication</h2>
      </div>

      <div className="px-6 py-5">
        {status?.enabled ? (
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-500" />
                <p className="text-sm font-semibold text-gray-900">2FA is on</p>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                You&apos;ll be asked for a 6-digit code from your authenticator app each time you sign in.
                {typeof status.backupCodesRemaining === 'number' && (
                  <> · {status.backupCodesRemaining} backup code{status.backupCodesRemaining === 1 ? '' : 's'} remaining.</>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDisableOpen(true)}
              className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors"
            >
              Disable 2FA
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Shield size={14} className="text-gray-400" />
                <p className="text-sm font-semibold text-gray-900">2FA is off</p>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Add an extra layer of security with a code from your phone&apos;s authenticator app
                (Google Authenticator, Authy, 1Password, etc.).
              </p>
            </div>
            <button
              type="button"
              onClick={() => void startSetup()}
              disabled={setupBusy}
              className="shrink-0 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-85 transition-opacity disabled:opacity-60"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {setupBusy && <Loader2 size={13} className="animate-spin" />}
              Enable 2FA
            </button>
          </div>
        )}
        {setupError && !setupOpen && (
          <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{setupError}</p>
        )}
      </div>

      {/* Setup modal */}
      {setupOpen && setupData && (
        <Modal onClose={() => { setSetupOpen(false); setSetupData(null); setSetupCode(''); setSetupError(''); }}>
          <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Set up two-factor authentication</h3>
            <button onClick={() => { setSetupOpen(false); setSetupData(null); setSetupCode(''); setSetupError(''); }}
              className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
            <ol className="text-sm text-gray-700 space-y-3 list-decimal list-inside">
              <li>Open your authenticator app (Google Authenticator, Authy, 1Password).</li>
              <li>Scan the QR code below — or paste the secret manually.</li>
              <li>Enter the 6-digit code your app shows.</li>
            </ol>

            <div className="flex justify-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.otpauthUri)}`}
                alt="2FA QR code"
                width={200}
                height={200}
                className="rounded-lg border border-gray-200"
              />
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1.5">Or enter this secret manually:</p>
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <code className="flex-1 text-xs font-mono text-gray-900 break-all">{setupData.secret}</code>
                <button
                  type="button"
                  onClick={() => void copySecret()}
                  className="text-gray-500 hover:text-gray-900 transition-colors"
                  title="Copy"
                >
                  {secretCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                placeholder="123456"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center tracking-widest font-mono focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
            </div>

            {setupError && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{setupError}</p>
            )}

            <button
              type="button"
              onClick={() => void confirmEnable()}
              disabled={setupBusy || setupCode.trim().length < 6}
              className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-85 transition-opacity disabled:opacity-60"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {setupBusy && <Loader2 size={13} className="animate-spin" />}
              {setupBusy ? 'Verifying…' : 'Verify and Turn On'}
            </button>
          </div>
        </Modal>
      )}

      {/* Backup codes modal — shown ONCE after a successful enable */}
      {backupCodes && (
        <Modal onClose={() => setBackupCodes(null)}>
          <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Save your backup codes</h3>
            <button onClick={() => setBackupCodes(null)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                Store these somewhere safe — a password manager works great.
                Each code can be used once if you lose access to your authenticator app.
                <strong className="block mt-1">You won&apos;t be able to view them again.</strong>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((c) => (
                <div key={c}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center font-mono text-sm tracking-wide text-gray-900">
                  {c}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={async () => {
                try { await navigator.clipboard.writeText(backupCodes.join('\n')); } catch { /* ignore */ }
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Copy size={14} /> Copy all codes
            </button>
            <button
              type="button"
              onClick={() => setBackupCodes(null)}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-85 transition-opacity"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              I&apos;ve saved my codes
            </button>
          </div>
        </Modal>
      )}

      {/* Disable modal */}
      {disableOpen && (
        <Modal onClose={() => { setDisableOpen(false); setDisablePw(''); setDisableCode(''); setDisableError(''); }}>
          <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Disable 2FA</h3>
            <button onClick={() => { setDisableOpen(false); setDisablePw(''); setDisableCode(''); setDisableError(''); }}
              className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-gray-600">
              Confirm your password and a current 2FA code (or backup code) to turn 2FA off.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Password</label>
              <input
                type="password"
                value={disablePw}
                onChange={(e) => setDisablePw(e.target.value)}
                placeholder="Current password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">2FA code or backup code</label>
              <input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="123456 or backup code"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
            </div>
            {disableError && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{disableError}</p>
            )}
            <button
              type="button"
              onClick={() => void confirmDisable()}
              disabled={disableBusy || !disablePw || !disableCode.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
            >
              {disableBusy && <Loader2 size={13} className="animate-spin" />}
              Disable 2FA
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
