'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, Loader2, Save, Check, X, Plus, AlertTriangle, ShieldCheck,
  ShieldAlert, MessageSquare, UserCircle, Mail, BadgeCheck, Lock, ExternalLink,
  TrendingUp, Send, Inbox, UserCheck, UserX, Activity, Pause as PauseIcon,
  AlertOctagon, Gauge, Smartphone,
} from 'lucide-react';

interface Eligibility {
  addonPurchased: boolean;
  a2pVerified:    boolean;
  eligible:       boolean;
  blockers:       string[];
}

interface AiConciergeSettings {
  enabled:                boolean;
  personaName:            string;
  conciergeNotifyEmails:  string[];
  eligibility:            Eligibility;
  ownerNotificationEmail: string | null;
  ghlConnected:           boolean;
  enabledAt:              string | null;
  resourcesReady:         boolean;
}

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-emerald-500' : 'bg-gray-200'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full border border-gray-200 bg-white shadow transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
}

export default function AiConciergeSettingsPage() {
  const [data, setData]         = useState<AiConciergeSettings | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  // Local edit state for non-toggle fields
  const [persona, setPersona]               = useState('');
  const [draftEmails, setDraftEmails]       = useState<string[]>([]);
  const [newEmail, setNewEmail]             = useState('');
  const [saving, setSaving]                 = useState(false);
  const [saved, setSaved]                   = useState(false);
  const [toggleSaving, setToggleSaving]     = useState(false);

  async function load() {
    setError('');
    try {
      const res = await fetch('/api/dashboard/settings/ai-concierge', { cache: 'no-store' });
      if (!res.ok) {
        setError('Unable to load AI Concierge settings.');
        return;
      }
      const json = (await res.json()) as AiConciergeSettings;
      setData(json);
      setPersona(json.personaName);
      setDraftEmails(json.conciergeNotifyEmails);
    } catch {
      setError('Unable to load AI Concierge settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch('/api/dashboard/settings/ai-concierge', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Save failed');
    }
    return json as AiConciergeSettings;
  }

  async function toggleEnabled(next: boolean) {
    if (!data) return;
    setToggleSaving(true);
    setError('');
    try {
      const updated = await patch({ enabled: next });
      setData(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle.');
    } finally {
      setToggleSaving(false);
    }
  }

  async function saveProfile() {
    if (!data) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated = await patch({
        personaName:           persona,
        conciergeNotifyEmails: draftEmails,
      });
      setData(updated);
      setPersona(updated.personaName);
      setDraftEmails(updated.conciergeNotifyEmails);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  function addEmail() {
    const e = newEmail.trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
    if (draftEmails.some((x) => x.toLowerCase() === e.toLowerCase())) {
      setNewEmail('');
      return;
    }
    setDraftEmails((prev) => [...prev, e]);
    setNewEmail('');
  }

  function removeEmail(addr: string) {
    setDraftEmails((prev) => prev.filter((e) => e !== addr));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-500 mb-4">{error || 'Unable to load AI Concierge settings.'}</p>
        <button
          onClick={() => { setLoading(true); void load(); }}
          className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }

  const dirty =
    persona.trim() !== data.personaName.trim() ||
    JSON.stringify(draftEmails) !== JSON.stringify(data.conciergeNotifyEmails);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Sparkles size={22} className="text-purple-500" /> AI Concierge
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          A personal AI assistant that follows up with quiet leads via SMS until they reply or 60 days pass.
        </p>
      </div>

      <div className="space-y-6">

        {/* Metrics card — shows real engagement once leads start activating */}
        <AiConciergeMetricsCard />

        {/* Eligibility status card */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
            <ShieldCheck size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">Eligibility</h2>
          </div>
          <div className="px-6 py-5 space-y-4">

            <EligibilityRow
              label="Venue Concierge add-on"
              ok={data.eligibility.addonPurchased}
              okLabel="Active on this plan"
              failLabel="Not on this plan — upgrade or add the add-on to use AI follow-up"
              actionUrl={!data.eligibility.addonPurchased ? '/dashboard/directory-billing' : undefined}
              actionLabel="Add to plan"
            />

            <EligibilityRow
              label="A2P 10DLC compliance"
              ok={data.eligibility.a2pVerified}
              okLabel="Verified by StoryVenue"
              failLabel="Not yet verified — required by carriers before any AI SMS can be sent"
              info="A2P verification is handled by our team after your venue completes its messaging registration. Reach out to support if this has been pending more than 5 business days."
            />

            <EligibilityRow
              label="SMS messaging connected"
              ok={data.ghlConnected}
              okLabel="Connected — AI will send through your messaging account"
              failLabel="Not connected — AI has nowhere to send SMS through. Connect on the General settings page."
              actionUrl={!data.ghlConnected ? '/dashboard/settings' : undefined}
              actionLabel="Connect now"
            />
          </div>
        </section>

        {/* Master toggle */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
            <BadgeCheck size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">Status</h2>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">AI Concierge is</p>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    data.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {data.enabled ? 'On' : 'Off'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  {data.enabled
                    ? 'New leads who go quiet for 14 days will start receiving AI follow-up SMS during 9am–8pm in your venue\'s timezone.'
                    : 'AI follow-up is paused. Existing active leads will not receive any new messages.'}
                </p>
                {data.enabledAt && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    First enabled {new Date(data.enabledAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  </p>
                )}
              </div>

              {data.eligibility.eligible ? (
                <div className="flex items-center gap-2">
                  {toggleSaving && <Loader2 size={14} className="animate-spin text-gray-400" />}
                  <Toggle
                    checked={data.enabled}
                    disabled={toggleSaving}
                    onChange={(v) => void toggleEnabled(v)}
                  />
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500">
                  <Lock size={12} /> Eligibility required
                </div>
              )}
            </div>

            {data.enabled && data.resourcesReady && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 flex items-start gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                <span>
                  Pipeline stages and tags are ready. New activations will appear under your <strong>Followup</strong> stage with the <strong>AI Active</strong> tag.
                </span>
              </div>
            )}

            {data.enabled && !data.resourcesReady && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
                <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
                <span>Setting up your AI pipeline stages and tags — this finishes within a minute.</span>
              </div>
            )}
          </div>
        </section>

        {/* Persona */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
            <UserCircle size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">Assistant persona</h2>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">First name your AI uses</label>
              <input
                type="text"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="Alison"
                maxLength={60}
                className={INPUT}
              />
              <p className="mt-1.5 text-[11px] text-gray-400">
                Brides see this name when the AI introduces itself (e.g. <em>&quot;Hi Sarah, this is Alison from your venue&quot;</em>). Leave blank to use the default <strong>Alison</strong>.
              </p>
            </div>
          </div>
        </section>

        {/* Test SMS — try the AI before going live */}
        <TestSmsCard
          eligible={data.eligibility.addonPurchased && data.ghlConnected}
          a2pVerified={data.eligibility.a2pVerified}
        />

        {/* Concierge team notification emails */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
            <Mail size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">Concierge notification team</h2>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-xs text-gray-500">
              When a bride asks about pricing, mentions a lawyer, or escalates to a manager, the AI hands the conversation off to a human. These addresses are CC&apos;d on the urgent escalation emails (alongside the venue owner&apos;s address — <strong>{data.ownerNotificationEmail || 'not set on General settings'}</strong>).
            </p>

            <div className="space-y-2">
              {draftEmails.length === 0 && (
                <p className="text-[11px] text-gray-400 italic py-2">No additional concierge addresses — only the venue owner is notified.</p>
              )}
              {draftEmails.map((email) => (
                <div key={email} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3.5 py-2">
                  <span className="text-sm text-gray-900 truncate">{email}</span>
                  <button
                    onClick={() => removeEmail(email)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    aria-label={`Remove ${email}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
                placeholder="concierge@yourvenue.com"
                className={INPUT}
              />
              <button
                onClick={addEmail}
                disabled={!newEmail.trim()}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        </section>

        {/* Save bar — only when there are pending edits */}
        {dirty && (
          <div className="sticky bottom-4 rounded-2xl border border-gray-200 bg-white shadow-md px-5 py-3.5 flex items-center justify-between gap-4">
            <p className="text-xs text-gray-500">You have unsaved changes.</p>
            <div className="flex items-center gap-3">
              {error && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                  <AlertTriangle size={12} /> {error}
                </span>
              )}
              {saved && !error && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <Check size={12} /> Saved
                </span>
              )}
              <button
                onClick={() => { setPersona(data.personaName); setDraftEmails(data.conciergeNotifyEmails); setError(''); }}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                onClick={() => void saveProfile()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}

        {/* How it works */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
            <MessageSquare size={18} className="text-gray-400" />
            <h2 className="font-heading text-base font-semibold text-gray-900">How AI Concierge works</h2>
          </div>
          <div className="px-6 py-5 space-y-3 text-sm text-gray-600">
            <Step
              n={1}
              title="14-day silence triggers activation"
              body="When a lead doesn't reply to your automated email sequence for 14 days, AI Concierge activates and starts following up via SMS."
            />
            <Step
              n={2}
              title="Random 1–3 day cadence for up to 60 days"
              body="The AI sends short, varied SMS messages on a randomized cadence — never spammy, always casual. Each message picks a fresh angle so it never feels repetitive."
            />
            <Step
              n={3}
              title="Reply = AI stops"
              body="The moment the bride replies, the AI pauses and you (or your team) take over. We tag the contact and notify you immediately by email."
            />
            <Step
              n={4}
              title="Quiet hours respected"
              body="AI never sends outside 9am–8pm in your venue's local timezone. Late replies get queued for the next morning."
            />
            <Step
              n={5}
              title="60-day hard cap"
              body="If a bride still hasn't replied after 60 days of follow-up, the AI moves her to your &quot;Not Interested&quot; pipeline and never messages her again automatically."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Small components ───────────────────────────────────────────────────────

function EligibilityRow({
  label, ok, okLabel, failLabel, info, actionUrl, actionLabel,
}: {
  label:        string;
  ok:           boolean;
  okLabel:      string;
  failLabel:    string;
  info?:        string;
  actionUrl?:   string;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          ok ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
        }`}>
          {ok ? <Check size={13} /> : <ShieldAlert size={13} />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="mt-0.5 text-xs text-gray-500">{ok ? okLabel : failLabel}</p>
          {!ok && info && <p className="mt-1 text-[11px] text-gray-400">{info}</p>}
        </div>
      </div>
      {!ok && actionUrl && (
        <a
          href={actionUrl}
          className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {actionLabel || 'Open'} <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-purple-50 text-xs font-semibold text-purple-600">
        {n}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500" dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </div>
  );
}

// ── Test SMS card ──────────────────────────────────────────────────────────

interface TestSmsResult {
  ok:                boolean;
  generatedMessage:  string;
  sentMessage?:      string;
  angle?:            string;
  providerMessageId?: string;
  a2pVerified?:      boolean;
  a2pWarning?:       string | null;
  error?:            string;
  detail?:           string;
}

function TestSmsCard({ eligible, a2pVerified }: { eligible: boolean; a2pVerified: boolean }) {
  const [phone, setPhone]       = useState('');
  const [bride, setBride]       = useState('Sarah');
  const [busy, setBusy]         = useState(false);
  const [result, setResult]     = useState<TestSmsResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function send() {
    const trimmed = phone.trim();
    if (!trimmed) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/dashboard/ai-concierge/test-sms', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone: trimmed, brideFirstName: bride.trim() || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as TestSmsResult;
      if (!res.ok) {
        setResult({ ok: false, generatedMessage: j.generatedMessage || '', error: j.error || `HTTP ${res.status}`, detail: j.detail });
      } else {
        setResult({ ...j, ok: true });
      }
    } catch (e) {
      setResult({
        ok: false,
        generatedMessage: '',
        error: e instanceof Error ? e.message : 'Test send failed',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4">
        <Smartphone size={18} className="text-gray-400" />
        <h2 className="font-heading text-base font-semibold text-gray-900">Test the AI on your phone</h2>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-xs text-gray-500">
          Send yourself a single AI-generated message using your active prompt config and a sample bride profile (Sarah Johnson, 14 days since inquiry, wedding ~6 months out). Messages are prefixed <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px]">[TEST]</code> and don&apos;t count toward your daily cap.
        </p>

        {!eligible && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>You need the Venue Concierge add-on AND a connected GHL account before you can send a test.</span>
          </div>
        )}

        {eligible && !a2pVerified && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>A2P isn&apos;t verified yet — we&apos;ll attempt the test, but carriers may filter it. The test still works for previewing the AI&apos;s tone.</span>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Your phone, e.g. (555) 123-4567"
            disabled={busy || !eligible}
            className={INPUT}
          />
          <button
            onClick={() => void send()}
            disabled={busy || !eligible || !phone.trim()}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Sending…' : 'Send test SMS'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[11px] font-medium text-gray-500 hover:text-gray-700"
        >
          {showAdvanced ? '▾ Hide' : '▸ Customize'} sample bride name
        </button>

        {showAdvanced && (
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Sample bride first name</label>
            <input
              type="text"
              value={bride}
              onChange={(e) => setBride(e.target.value)}
              placeholder="Sarah"
              maxLength={40}
              disabled={busy}
              className={INPUT}
            />
          </div>
        )}

        {result && (
          <div className={`rounded-xl border px-4 py-3 ${
            result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
          }`}>
            {result.ok ? (
              <>
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <Check size={14} /> Sent to your phone
                </div>
                {result.angle && (
                  <p className="mt-1 text-[11px] text-emerald-700/80">
                    Angle picked: <strong>{result.angle}</strong>
                  </p>
                )}
                {result.a2pWarning && (
                  <p className="mt-1.5 text-[11px] text-amber-800 bg-amber-100/60 rounded-md px-2 py-1">
                    {result.a2pWarning}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm font-medium text-rose-800">
                  <X size={14} /> Couldn&apos;t send
                </div>
                <p className="mt-1 text-xs text-rose-700">{result.error}</p>
                {result.detail && (
                  <p className="mt-0.5 text-[11px] text-rose-700/80 font-mono">{result.detail}</p>
                )}
              </>
            )}
            {result.generatedMessage && (
              <div className="mt-3 rounded-lg bg-white border border-gray-200 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-1">
                  AI generated this:
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{result.generatedMessage}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Metrics card ───────────────────────────────────────────────────────────

interface MetricsPayload {
  windowDays:        number;
  windowStartIso:    string;
  messagesSent:      number;
  leadsReplied:      number;
  replyRate:         number;
  handedOff:         number;
  optedOut:          number;
  exhausted:         number;
  activated:         number;
  activeNow:         number;
  pausedNow:         number;
  handoffNow:        number;
  sentToday:         number;
  effectiveDailyCap: number;
  enabled:           boolean;
  a2pVerified:       boolean;
  addonActive:       boolean;
}

const WINDOW_OPTIONS = [
  { days: 7,   label: '7d' },
  { days: 30,  label: '30d' },
  { days: 90,  label: '90d' },
] as const;

function AiConciergeMetricsCard() {
  const [data, setData]       = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<number>(30);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/ai-concierge/metrics?days=${days}`, { cache: 'no-store' });
      if (!res.ok) {
        setData(null);
        return;
      }
      const j = await res.json() as MetricsPayload;
      setData(j);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(windowDays); }, [load, windowDays]);

  // If the venue isn't on the addon at all, hide the metrics card entirely —
  // the eligibility card below already explains they need to upgrade.
  if (!loading && data && !data.addonActive) {
    return null;
  }

  const sentTodayPct = data && data.effectiveDailyCap > 0
    ? Math.min(100, Math.round((data.sentToday / data.effectiveDailyCap) * 100))
    : 0;
  const sentTodayTone =
    sentTodayPct >= 100 ? 'text-rose-600' :
    sentTodayPct >= 80  ? 'text-amber-600' :
    'text-gray-700';

  const replyRatePct = data ? Math.round(data.replyRate * 100) : 0;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <TrendingUp size={18} className="text-gray-400" />
          <h2 className="font-heading text-base font-semibold text-gray-900">Performance</h2>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-gray-100 p-0.5">
          {WINDOW_OPTIONS.map(({ days, label }) => (
            <button
              key={days}
              type="button"
              onClick={() => setWindowDays(days)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                windowDays === days ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-5">
        {loading && !data && (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}

        {!loading && !data && (
          <p className="py-6 text-center text-sm text-gray-400">
            Couldn&apos;t load metrics right now.
          </p>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricTile
                icon={<Send size={14} />}
                label="Messages sent"
                value={data.messagesSent.toLocaleString()}
                hint={`${data.activated.toLocaleString()} activations`}
                tone="default"
              />
              <MetricTile
                icon={<Inbox size={14} />}
                label="Leads who replied"
                value={data.leadsReplied.toLocaleString()}
                hint={data.replyRate > 0 ? `${replyRatePct}% reply rate` : 'No replies yet'}
                tone={data.leadsReplied > 0 ? 'emerald' : 'default'}
              />
              <MetricTile
                icon={<UserCheck size={14} />}
                label="Handed to humans"
                value={data.handedOff.toLocaleString()}
                hint={data.handoffNow > 0 ? `${data.handoffNow} waiting` : '—'}
                tone={data.handoffNow > 0 ? 'amber' : 'default'}
              />
              <MetricTile
                icon={<UserX size={14} />}
                label="Opted out"
                value={data.optedOut.toLocaleString()}
                hint={data.exhausted > 0 ? `+ ${data.exhausted} exhausted` : '—'}
                tone="default"
              />
            </div>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MicroTile
                icon={<Activity size={12} />}
                label="Active now"
                value={data.activeNow}
                tone="emerald"
              />
              <MicroTile
                icon={<PauseIcon size={12} />}
                label="Paused"
                value={data.pausedNow}
                tone="amber"
              />
              <MicroTile
                icon={<AlertOctagon size={12} />}
                label="Awaiting human"
                value={data.handoffNow}
                tone={data.handoffNow > 0 ? 'rose' : 'default'}
              />
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <Gauge size={12} /> Today&apos;s sends
                </div>
                <p className={`mt-0.5 text-base font-semibold ${sentTodayTone}`}>
                  {data.sentToday}
                  <span className="text-xs text-gray-400"> / {data.effectiveDailyCap}</span>
                </p>
              </div>
            </div>

            {!data.enabled && data.addonActive && (
              <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
                AI Concierge is currently <strong>off</strong>. Existing metrics still show but no new follow-ups will go out until you toggle it on below.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const TONE_MAP = {
  default: 'border-gray-200 bg-white text-gray-900',
  emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-900',
  amber:   'border-amber-100 bg-amber-50/60 text-amber-900',
  rose:    'border-rose-100 bg-rose-50/60 text-rose-900',
} as const;

type Tone = keyof typeof TONE_MAP;

function MetricTile({ icon, label, value, hint, tone }: {
  icon:  React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone:  Tone;
}) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${TONE_MAP[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {icon} {label}
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] opacity-60">{hint}</p>}
    </div>
  );
}

function MicroTile({ icon, label, value, tone }: {
  icon:  React.ReactNode;
  label: string;
  value: number;
  tone:  Tone;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${TONE_MAP[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {icon} {label}
      </div>
      <p className="mt-0.5 text-base font-semibold">{value}</p>
    </div>
  );
}
