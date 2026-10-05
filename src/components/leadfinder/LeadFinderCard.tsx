'use client';

/**
 * The Lead Finder card: the venue's own inbound address, the two ways to send
 * directory inquiries to it, a test, and what has arrived. Shown on its own
 * page under the Bride Booking System (Lead Finder) and, as before, in
 * Settings → Integrations.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Copy,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Activity,
  Send,
  Inbox,
  MailCheck,
  TrendingDown,
} from 'lucide-react';

// ── Lead Finder ──────────────────────────────────────────────────────────────

interface LeadFinderSourceDrift {
  source: string;
  label: string;
  arrivals: number;
  leadsCreated: number;
  skipped: number;
  needsReview: number;
  skipRate: number;
  needsReviewRate: number;
  avgExtractionConfidence: number | null;
  avgClassificationConfidence: number | null;
  drifted: boolean;
  reasons: string[];
  judged: boolean;
  note: string | null;
}

interface LeadFinderData {
  enabled: boolean;
  configured: boolean;
  address: string | null;
  forwardedCopyTo: string | null;
  /** Whether copies of every arrival are emailed to the venue's own inbox. */
  mirrorEnabled: boolean;
  stats: {
    emailsSeen: number;
    leadsCreated: number;
    skipped: number;
    /** Arrivals created but held back from the couple pending a human check. */
    needsReview: number;
    /** Copies we could not send. Best-effort — never affects the lead itself. */
    mirrorFailures: number;
    lastEmailAt: string | null;
    lastLeadAt: string | null;
  };
  drift: {
    windowDays: number;
    baselineDays: number;
    minSample: number;
  };
  sources: LeadFinderSourceDrift[];
  /** Directory couples invited to "Send me my guide", and how many opted in to texts. */
  textOptIns: { invited: number; optedIn: number } | null;
  /** Gmail's forwarding confirmation, while the venue still has to enter it. */
  gmailConfirmation: {
    code: string | null;
    confirmUrl: string | null;
    requestedBy: string | null;
    receivedAt: string | null;
  } | null;
  recent: Array<{
    subject: string | null;
    senderDomain: string | null;
    detectedSource: string | null;
    status: string;
    reason: string | null;
    /** Plain-language version of `reason`. */
    reasonLabel: string | null;
    receivedAt: string | null;
  }>;
}

/** What a test inquiry came back with (GET /api/venue/leadfinder/test). */
interface LeadFinderTestResult {
  receivedAt: string | null;
  recognizedAsTest: boolean;
  read: {
    name: string | null;
    email: string | null;
    phone: string | null;
    weddingDate: string | null;
    guestCount: number | null;
  };
  copySent: boolean;
}

type LeadFinderTestState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'waiting'; ref: string; startedAt: number }
  | { phase: 'done'; result: LeadFinderTestResult }
  | { phase: 'timeout' }
  | { phase: 'error'; message: string };

/** How long to wait for a test to come back before saying it has not arrived. */
const LEADFINDER_TEST_TIMEOUT_MS = 120_000;

/** Plain-language explanation of each drift reason key from the API. */
const DRIFT_REASON_LABELS: Record<string, string> = {
  skipped_up: 'more messages are being skipped than before',
  needs_review_up: 'more messages need a human check than before',
  extraction_confidence_down: 'we are reading fewer details than before',
  classification_confidence_down: 'we are less sure these are inquiries than before',
};

/**
 * StoryVenue Lead Finder — the venue's inbound lead address, with the two ways
 * to point mail at it and a short record of what has actually arrived.
 *
 * The address is fetched rather than computed here: its signature is an HMAC
 * over the venue id with a server-only secret.
 */
export default function LeadFinderCard() {
  const [data, setData] = useState<LeadFinderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mirrorEnabled, setMirrorEnabled] = useState(true);
  const [savingMirror, setSavingMirror] = useState(false);
  const [test, setTest] = useState<LeadFinderTestState>({ phase: 'idle' });

  const load = useCallback(() => {
    fetch('/api/venue/leadfinder', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const parsed = d as LeadFinderData | null;
        setData(parsed);
        // Tolerant: a missing flag means on, matching the database default.
        if (parsed) setMirrorEnabled(parsed.mirrorEnabled !== false);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendTest() {
    setTest({ phase: 'sending' });
    try {
      const r = await fetch('/api/venue/leadfinder/test', { method: 'POST' });
      const j = (await r.json().catch(() => ({}))) as { ref?: string; error?: string };
      if (!r.ok || !j.ref) throw new Error(j.error || 'We could not send the test. Please try again.');
      setTest({ phase: 'waiting', ref: j.ref, startedAt: Date.now() });
    } catch (e) {
      setTest({ phase: 'error', message: e instanceof Error ? e.message : 'We could not send the test.' });
    }
  }

  // While a test is in flight, check every few seconds whether it has arrived.
  useEffect(() => {
    if (test.phase !== 'waiting') return;
    const { ref, startedAt } = test;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > LEADFINDER_TEST_TIMEOUT_MS) {
        setTest({ phase: 'timeout' });
        return;
      }
      try {
        const r = await fetch(`/api/venue/leadfinder/test?ref=${encodeURIComponent(ref)}`, { cache: 'no-store' });
        const j = (await r.json().catch(() => ({}))) as { arrived?: boolean } & Partial<LeadFinderTestResult>;
        if (!cancelled && r.ok && j.arrived && j.read) {
          setTest({
            phase: 'done',
            result: {
              receivedAt: j.receivedAt ?? null,
              recognizedAsTest: j.recognizedAsTest === true,
              read: j.read,
              copySent: j.copySent === true,
            },
          });
          load(); // show it in Activity too
        }
      } catch {
        /* keep polling until the timeout */
      }
    };
    const timer = setInterval(() => void tick(), 3000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [test, load]);

  async function toggleMirror(next: boolean) {
    const prev = mirrorEnabled;
    setMirrorEnabled(next); // optimistic — the switch should feel instant
    setSavingMirror(true);
    try {
      const r = await fetch('/api/venue/leadfinder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mirrorEnabled: next }),
      });
      if (!r.ok) throw new Error('save failed');
    } catch {
      setMirrorEnabled(prev); // revert on failure so the switch never lies
    } finally {
      setSavingMirror(false);
    }
  }

  async function copyAddress() {
    if (!data?.address) return;
    try {
      await navigator.clipboard.writeText(data.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the address is selectable text either way */
    }
  }

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

  const status = !data || loading
    ? null
    : !data.configured
      ? { label: 'Unavailable', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
      : !data.enabled
        ? { label: 'Not enabled yet', cls: 'bg-amber-100 text-amber-700 border-amber-200' }
        : { label: 'Live', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-6 py-5 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
          <Inbox size={22} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">Lead Finder</h2>
            {status && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${status.cls}`}>
                {status.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">
            Turn wedding inquiries that arrive in your own inbox into StoryVenue leads. Give this
            address to your directories, and any inquiry emailed to it lands in your Leads
            automatically.
          </p>

          {loading && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" /> Loading your address…
            </div>
          )}

          {!loading && data && !data.configured && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-sm text-gray-600">
              Inbound email is not configured for this account yet, so Lead Finder has no address to
              give you. Contact StoryVenue support to have it switched on.
            </div>
          )}

          {!loading && data?.address && (
            <>
              <div className="mt-3">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Your Lead Finder address
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] font-medium text-gray-800">
                    {data.address}
                  </code>
                  <button
                    onClick={copyAddress}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3.5 text-sm leading-relaxed text-gray-600">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  How to connect it
                </span>
                <p className="mb-2">
                  <strong>Easiest:</strong> paste the address above wherever a directory asks for the
                  email that should receive leads — The Knot, WeddingWire, Zola and so on. That is a
                  one-time paste per site, and nothing else to set up.
                </p>
                <p>
                  <strong>If a site will not let you change that email:</strong> add one forwarding
                  rule in Gmail. In Settings → Forwarding and POP/IMAP, add the address above — Gmail
                  sends a confirmation code to it, which will appear right here — then create a
                  filter (for example <em>from:theknot.com OR from:weddingwire.com</em>) that forwards
                  matching mail to it. One rule can cover several directories at once.
                </p>
              </div>

              {data.gmailConfirmation && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-amber-700">
                    Gmail is waiting for you to confirm forwarding
                  </span>
                  {data.gmailConfirmation.code ? (
                    <p className="leading-relaxed">
                      Your confirmation code is{' '}
                      <code className="rounded-md border border-amber-300 bg-white px-1.5 py-0.5 font-semibold tracking-wider">
                        {data.gmailConfirmation.code}
                      </code>
                      {data.gmailConfirmation.requestedBy ? <> for <strong>{data.gmailConfirmation.requestedBy}</strong></> : null}.
                      In Gmail, open Settings → Forwarding and POP/IMAP, click <em>Verify</em> next to
                      your Lead Finder address and enter it.
                    </p>
                  ) : (
                    <p className="leading-relaxed">Gmail sent a confirmation for your forwarding request.</p>
                  )}
                  {data.gmailConfirmation.confirmUrl && (
                    <a
                      href={data.gmailConfirmation.confirmUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      Or confirm with Gmail&apos;s link
                    </a>
                  )}
                </div>
              )}

              {/* Test your address — a real email through the real inbound path, as a dry run. */}
              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3.5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      Test your address
                    </span>
                    <p className="text-sm leading-relaxed text-gray-600">
                      Send a sample inquiry to your Lead Finder address and see what we read from it. It&apos;s
                      a dry run — no lead is created and nobody is emailed.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void sendTest()}
                    disabled={test.phase === 'sending' || test.phase === 'waiting'}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {test.phase === 'sending' || test.phase === 'waiting'
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Send size={13} />}
                    {test.phase === 'done' || test.phase === 'timeout' ? 'Send another test' : 'Send a test inquiry'}
                  </button>
                </div>

                {test.phase === 'waiting' && (
                  <p className="mt-2.5 flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={12} className="animate-spin" />
                    Test sent. Waiting for it to arrive — usually under a minute…
                  </p>
                )}

                {test.phase === 'done' && test.result.recognizedAsTest && (
                  <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 size={13} /> Received{when(test.result.receivedAt) ? ` ${when(test.result.receivedAt)}` : ''} — Lead Finder is working.
                    </p>
                    <p className="mt-1 leading-relaxed">
                      We read:{' '}
                      {[
                        test.result.read.name,
                        test.result.read.email,
                        test.result.read.phone,
                        test.result.read.weddingDate && `wedding ${test.result.read.weddingDate}`,
                        test.result.read.guestCount !== null && `${test.result.read.guestCount} guests`,
                      ].filter(Boolean).join(' · ') || 'nothing'}
                      . Because it was a test, no lead was created.
                      {test.result.copySent ? ' A copy is in your inbox.' : ''}
                    </p>
                  </div>
                )}

                {test.phase === 'done' && !test.result.recognizedAsTest && (
                  <p className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    The test arrived, but it wasn&apos;t recognized as a test. Check Activity below, and contact
                    StoryVenue support if it looks wrong.
                  </p>
                )}

                {test.phase === 'timeout' && (
                  <p className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    We sent the test, but it hasn&apos;t arrived after two minutes. Email can be delayed — check
                    Activity below in a few minutes. If it never shows up, contact StoryVenue support.
                  </p>
                )}

                {test.phase === 'error' && (
                  <p className="mt-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                    {test.message}
                  </p>
                )}
              </div>

              <div className="mt-3 flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3.5">
                <MailCheck size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    Keep a copy in your inbox
                  </span>
                  <p className="text-sm leading-relaxed text-gray-600">
                    We&apos;ll email you a copy of every message Lead Finder sees — whether it becomes
                    a lead or not — with a short note on what we did with it, so nothing is captured
                    silently.{' '}
                    {data.forwardedCopyTo
                      ? <>Copies go to <strong>{data.forwardedCopyTo}</strong>.</>
                      : 'Add a notification email to your account to receive them.'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={mirrorEnabled}
                  aria-label="Email me a copy of every Lead Finder message"
                  disabled={savingMirror}
                  onClick={() => toggleMirror(!mirrorEnabled)}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                    mirrorEnabled ? 'bg-[#1b1b1b]' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform ${
                      mirrorEnabled ? 'translate-x-[22px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>

              {!data.enabled && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Lead Finder is built but not switched on for your account yet, so mail sent here is
                    not being turned into leads. Contact StoryVenue support to enable it.
                  </span>
                </div>
              )}

              {data.stats.needsReview > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                  <AlertCircle size={14} className="shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1 text-xs text-amber-800">
                    <strong>{data.stats.needsReview}</strong>{' '}
                    {data.stats.needsReview === 1
                      ? 'arrival needs your review before we email the couple.'
                      : 'arrivals need your review before we email the couple.'}
                  </span>
                  <Link
                    href="/dashboard/settings/integrations/leadfinder-review"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Review
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Activity — only once the address exists and there is something to report. */}
      {!loading && data?.address && (
        <div className="border-t border-gray-100 px-6 py-4 text-sm text-gray-500">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Activity
          </span>
          {data.stats.emailsSeen === 0 ? (
            <p className="text-xs text-gray-400">
              Nothing received yet. Once mail starts arriving, you will see each message here.
            </p>
          ) : (
            <>
              <ul className="space-y-1">
                <li className="flex items-start gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                  <span>
                    {data.stats.leadsCreated} lead{data.stats.leadsCreated === 1 ? '' : 's'} created from{' '}
                    {data.stats.emailsSeen} email{data.stats.emailsSeen === 1 ? '' : 's'}
                    {data.stats.skipped > 0 ? ` · ${data.stats.skipped} skipped` : ''}
                  </span>
                </li>
                {data.textOptIns && data.textOptIns.invited > 0 && (
                  <li className="flex items-start gap-2">
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                    <span>
                      Text opt-ins: {data.textOptIns.optedIn} of {data.textOptIns.invited} couple
                      {data.textOptIns.invited === 1 ? '' : 's'} (
                      {Math.round((data.textOptIns.optedIn / data.textOptIns.invited) * 100)}%) tapped
                      &ldquo;Send me my guide&rdquo;
                    </span>
                  </li>
                )}
                {when(data.stats.lastEmailAt) && (
                  <li className="flex items-start gap-2">
                    <Activity size={13} className="mt-0.5 shrink-0 text-gray-400" />
                    <span>Last email {when(data.stats.lastEmailAt)}</span>
                  </li>
                )}
                {when(data.stats.lastLeadAt) && (
                  <li className="flex items-start gap-2">
                    <Activity size={13} className="mt-0.5 shrink-0 text-gray-400" />
                    <span>Last lead {when(data.stats.lastLeadAt)}</span>
                  </li>
                )}
                {data.stats.mirrorFailures > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                    <span>
                      {data.stats.mirrorFailures} inbox cop
                      {data.stats.mirrorFailures === 1 ? 'y' : 'ies'} could not be sent. The leads
                      themselves were unaffected.
                    </span>
                  </li>
                )}
              </ul>
              {data.recent.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  {data.recent.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.status === 'processed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : r.status === 'skipped'
                              ? 'bg-gray-100 text-gray-500 border-gray-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {r.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-600">
                        {r.detectedSource || r.senderDomain || 'Unknown sender'}
                        {r.subject ? ` — ${r.subject}` : ''}
                      </span>
                      {(r.reasonLabel || r.reason) && (
                        <span className="text-gray-400">{r.reasonLabel ?? r.reason?.replace(/_/g, ' ')}</span>
                      )}
                      <span className="text-gray-400">{when(r.receivedAt) ?? ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Per-source quality — makes a marketplace template change visible instead
          of silently producing thinner leads. */}
      {!loading && data?.address && data.sources.length > 0 && (
        <div className="border-t border-gray-100 px-6 py-4 text-sm text-gray-500">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Sources — last {data.drift.windowDays} days
          </span>
          <p className="text-xs text-gray-400">
            Each source is compared against its own earlier {data.drift.baselineDays} days, so a
            source that is always brief is never treated as a problem. A source needs at least{' '}
            {data.drift.minSample} messages in both periods before we judge it.
          </p>
          <div className="mt-2.5 space-y-2">
            {data.sources.map((s) => (
              <div
                key={s.source}
                className={`rounded-xl border p-3 ${
                  s.drifted ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-gray-50'
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-gray-800">{s.label}</span>
                  {s.drifted && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      <TrendingDown size={11} /> Drift detected
                    </span>
                  )}
                  {!s.judged && (
                    <span className="rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-400">
                      Not enough history
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {s.arrivals} message{s.arrivals === 1 ? '' : 's'} · {s.leadsCreated} lead
                  {s.leadsCreated === 1 ? '' : 's'} · {s.skipped} skipped · {s.needsReview} needed a
                  check
                  {s.avgExtractionConfidence !== null
                    ? ` · avg detail read ${Math.round(s.avgExtractionConfidence * 100)}%`
                    : ''}
                </div>
                {s.drifted && s.reasons.length > 0 && (
                  <div className="mt-1 text-xs font-medium text-amber-800">
                    Quality has dropped for this source:{' '}
                    {s.reasons.map((r) => DRIFT_REASON_LABELS[r] ?? r.replace(/_/g, ' ')).join('; ')}.
                    Check whether the directory changed its email template.
                  </div>
                )}
                {!s.judged && s.note && <div className="mt-1 text-xs text-gray-400">{s.note}</div>}
                {s.judged && !s.drifted && (
                  <div className="mt-1 text-xs text-gray-400">
                    Stable — no meaningful change against the previous {data.drift.baselineDays} days.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
