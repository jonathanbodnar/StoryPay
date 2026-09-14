'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Send,
  Plus,
  X,
  MailCheck,
  Globe,
  Lock,
  Users,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Recipient = { name: string; email: string; phone: string; source: 'guest' | 'added' };

interface LoadData {
  coupleName: string;
  weddingDate: string | null;
  site: { published: boolean; url: string | null; hasPassword: boolean };
  replyTo: string | null;
  maxRecipients: number;
  guestRecipients: { name: string; email: string; phone: string; invitedAt: string | null }[];
  guestsWithoutEmail: number;
  lastSend: {
    subject: string | null;
    recipient_count: number;
    sent_count: number;
    failed_count: number;
    created_at: string;
  } | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Phone-ish cell: mostly phone chars with at least 7 digits (US-friendly, permissive). */
const PHONE_RE = /^[+()\-.\s\d]{7,}$/;
function looksLikePhone(v: string): boolean {
  return PHONE_RE.test(v) && (v.match(/\d/g)?.length ?? 0) >= 7;
}

const DEFAULT_SUBJECT = 'You’re invited to our wedding website';
const DEFAULT_MESSAGE =
  "We're so excited to celebrate with you! We've put together a wedding website with all the details — our story, the schedule, travel info, and how to RSVP. Take a look and we can't wait to see you there.";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export default function InviteGuestsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [needsLink, setNeedsLink] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [data, setData] = useState<LoadData | null>(null);

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [sitePassword, setSitePassword] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [addName, setAddName] = useState('');
  const [addInput, setAddInput] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addError, setAddError] = useState('');
  const [csvNote, setCsvNote] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Keep a live snapshot for merges triggered from async handlers (CSV read).
  const recipientsRef = useRef<Recipient[]>([]);
  useEffect(() => {
    recipientsRef.current = recipients;
  }, [recipients]);

  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; skippedSuppressed: number } | null>(null);

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const res = await coupleAuthedFetch('/api/couple/website-invite');
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    if (res.status === 409) {
      setNeedsLink(true);
      setLoading(false);
      return;
    }
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const d = (await res.json().catch(() => ({}))) as LoadData;
    setData(d);
    // Prefill only guests who haven't been invited yet. Already-invited guests
    // (stamped with invited_at on a prior send) are kept off the list so the
    // "Send to N guests" count reflects who still needs an invite — and so the
    // button resets cleanly after a successful send instead of re-listing them.
    setRecipients(
      (d.guestRecipients ?? [])
        .filter((g) => !g.invitedAt)
        .map((g) => ({
          name: g.name,
          email: g.email,
          phone: g.phone ?? '',
          source: 'guest' as const,
        })),
    );
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const max = data?.maxRecipients ?? 300;

  // Merge incoming contacts. A name AND a valid email are BOTH required — we
  // want to own complete records, so anything missing either is skipped and
  // counted so the UI can explain why.
  const mergeRecipients = useCallback(
    (
      incoming: { name?: string; email: string; phone?: string }[],
    ): { added: number; dupes: number; invalid: number; missing: number } => {
      const prev = recipientsRef.current;
      const seen = new Set(prev.map((r) => r.email.toLowerCase()));
      const toAdd: Recipient[] = [];
      let dupes = 0;
      let invalid = 0;
      let missing = 0;
      for (const item of incoming) {
        const email = item.email.trim().toLowerCase();
        const name = (item.name ?? '').trim();
        if (!EMAIL_RE.test(email)) { invalid++; continue; }
        if (!name) { missing++; continue; }
        if (seen.has(email)) { dupes++; continue; }
        seen.add(email);
        toAdd.push({ name, email, phone: (item.phone ?? '').trim(), source: 'added' });
      }
      if (toAdd.length) setRecipients((prev2) => [...prev2, ...toAdd]);
      return { added: toAdd.length, dupes, invalid, missing };
    },
    [],
  );

  // Manual add is a single, complete contact: name + email required, phone optional.
  const addContact = useCallback(() => {
    const name = addName.trim();
    const email = addInput.trim().toLowerCase();
    if (!name) { setAddError('Add a name.'); return; }
    if (!EMAIL_RE.test(email)) { setAddError('Enter a valid email address.'); return; }
    const { added, dupes } = mergeRecipients([{ name, email, phone: addPhone }]);
    if (added) {
      setAddName('');
      setAddInput('');
      setAddPhone('');
      setAddError('');
    } else if (dupes) {
      setAddError('That email is already on the list.');
    }
  }, [addName, addInput, addPhone, mergeRecipients]);

  const importCsv = useCallback(
    async (file: File) => {
      setCsvNote('');
      if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
        setCsvNote('Please choose a .csv file.');
        return;
      }
      if (file.size > 2_000_000) {
        setCsvNote('That file is too large (max 2 MB).');
        return;
      }
      let text = '';
      try {
        text = await file.text();
      } catch {
        setCsvNote('Could not read that file.');
        return;
      }
      const rows = parseCsv(text);
      const incoming: { name: string; email: string; phone: string }[] = [];
      let truncated = false;
      for (const row of rows) {
        if (incoming.length >= max) { truncated = true; break; }
        // Classify each cell: email, phone, or (first leftover) name. Header
        // rows fall out naturally (no email → skipped). Both name and email are
        // required to be included; rows missing either are dropped below.
        let email = '';
        let phone = '';
        let name = '';
        for (const cell of row) {
          const v = cell.trim();
          if (!v) continue;
          if (!email && EMAIL_RE.test(v.toLowerCase())) email = v;
          else if (!phone && looksLikePhone(v)) phone = v;
          else if (!name && !v.includes('@')) name = v;
        }
        incoming.push({ email, name, phone });
      }
      const withEmail = incoming.filter((r) => EMAIL_RE.test(r.email.toLowerCase()));
      if (withEmail.length === 0) {
        setCsvNote('No email addresses found in that file. Include a name and email column.');
        return;
      }
      const { added, dupes, invalid, missing } = mergeRecipients(incoming);
      const parts = [`${added} added`];
      if (missing) parts.push(`${missing} skipped (missing name)`);
      if (dupes) parts.push(`${dupes} duplicate${dupes === 1 ? '' : 's'} skipped`);
      if (invalid) parts.push(`${invalid} without an email skipped`);
      if (truncated) parts.push(`stopped at the ${max}-guest limit`);
      setCsvNote(parts.join(' · '));
    },
    [max, mergeRecipients],
  );

  function removeRecipient(email: string) {
    setRecipients((prev) => prev.filter((r) => r.email !== email));
  }

  const overCap = recipients.length > max;
  const canSend =
    !!data?.site.published && recipients.length > 0 && !overCap && subject.trim().length > 0 && message.trim().length >= 2;

  async function send() {
    if (!canSend || sending) return;
    setSending(true);
    setError('');
    setResult(null);
    try {
      const res = await coupleAuthedFetch('/api/couple/website-invite', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          sitePassword: sitePassword.trim() || undefined,
          recipients: recipients.map((r) => ({
            email: r.email,
            name: r.name || undefined,
            phone: r.phone || undefined,
          })),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        failed?: number;
        skippedSuppressed?: number;
      };
      if (!res.ok) {
        setError(d.error || 'Could not send invites.');
        return;
      }
      setResult({ sent: d.sent ?? 0, failed: d.failed ?? 0, skippedSuppressed: d.skippedSuppressed ?? 0 });
      // Refresh last-send + suppression-filtered guest list.
      await load();
    } finally {
      setSending(false);
    }
  }

  const guestCount = useMemo(() => recipients.filter((r) => r.source === 'guest').length, [recipients]);
  const addedCount = recipients.length - guestCount;
  const alreadyInvitedCount = useMemo(
    () => (data?.guestRecipients ?? []).filter((g) => g.invitedAt).length,
    [data],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (needsLink) {
    return (
      <NoticeCard
        icon={<Globe className="mx-auto h-8 w-8 text-gray-300" />}
        text="Connect with your venue to unlock your Wedding Planner."
        cta={{ href: '/couple/wedding', label: 'Go to Wedding Planner' }}
      />
    );
  }

  if (forbidden) {
    return (
      <NoticeCard
        icon={<ShieldCheck className="mx-auto h-8 w-8 text-gray-300" />}
        text="Inviting guests is private to the couple. Collaborators can't send website invites."
        cta={{ href: '/couple/wedding', label: 'Back to Wedding Planner' }}
      />
    );
  }

  return (
    <div className="pb-16">
      <div>
        <h1 className="font-heading text-2xl text-gray-900">Invite guests to your website</h1>
        <p className="mt-1 text-sm text-gray-500">
          Email your guest list a link to your public wedding website. We add the link (and password, if you have one)
          automatically — you just write the note.
        </p>
      </div>

      {data?.lastSend && (
        <p className="mt-3 text-xs text-gray-400">
          Last sent {fmtWhen(data.lastSend.created_at)} · {data.lastSend.sent_count} delivered
          {data.lastSend.failed_count ? `, ${data.lastSend.failed_count} failed` : ''}
        </p>
      )}

      {!data?.site.published && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your wedding website isn’t published yet.{' '}
          <Link href="/couple/site" className="font-semibold underline">
            Publish it first
          </Link>{' '}
          so guests have somewhere to land.
        </div>
      )}

      {result && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Invites sent!</p>
            <p className="mt-0.5">
              {result.sent} delivered
              {result.failed ? `, ${result.failed} failed` : ''}
              {result.skippedSuppressed ? ` · ${result.skippedSuppressed} skipped (unsubscribed)` : ''}.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        {/* ── Compose ─────────────────────────────────────────── */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-gray-900">Your message</h2>
            <label className="mt-4 block text-xs font-medium text-gray-500">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={150}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
            />
            <label className="mt-4 block text-xs font-medium text-gray-500">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              rows={6}
              className="mt-1 w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-gray-400">
              Your website link is added automatically as a button at the bottom of the email. For your guests’ safety,
              any other links you type in the note are removed.
            </p>

            {data?.site.hasPassword && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  <Lock className="h-4 w-4 text-gray-500" /> Your site is password protected
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Enter your website password to include it in the invite so guests can get in. Leave blank to send
                  without it. (We store it encrypted, so we can’t fill it in for you.)
                </p>
                <input
                  type="text"
                  value={sitePassword}
                  onChange={(e) => setSitePassword(e.target.value)}
                  placeholder="Website password"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                />
              </div>
            )}
          </section>

          <section
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void importCsv(f);
            }}
            className={`rounded-2xl border bg-white p-6 transition-colors ${
              dragOver ? 'border-[#1b1b1b] ring-2 ring-gray-200' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Users className="h-4 w-4 text-gray-500" /> Recipients
              </h2>
              <span className={`text-xs font-medium ${overCap ? 'text-red-600' : 'text-gray-400'}`}>
                {recipients.length} / {max}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {guestCount} from your guest list{addedCount ? ` · ${addedCount} added` : ''}
              {alreadyInvitedCount ? ` · ${alreadyInvitedCount} already invited` : ''}
              {data && data.guestsWithoutEmail > 0 ? ` · ${data.guestsWithoutEmail} guest(s) have no email` : ''}
            </p>

            <div className="mt-3 space-y-2">
              <input
                value={addName}
                onChange={(e) => { setAddName(e.target.value); setAddError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addContact(); } }}
                placeholder="Full name (required)"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
              />
              <input
                value={addInput}
                onChange={(e) => { setAddInput(e.target.value); setAddError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addContact(); } }}
                placeholder="Email address (required)"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addContact(); } }}
                  placeholder="Phone (optional)"
                  className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addContact}
                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
              {addError && <p className="text-xs text-red-600">{addError}</p>}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium text-gray-600 transition-colors hover:bg-gray-50">
                <Upload className="h-3.5 w-3.5" /> Import CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importCsv(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <span>Or drag a .csv here — needs a name + email column (phone optional).</span>
            </div>
            {csvNote && <p className="mt-1.5 text-xs text-gray-500">{csvNote}</p>}

            {overCap && (
              <p className="mt-2 text-xs text-red-600">
                That’s over the {max}-guest limit per send. Remove {recipients.length - max} to continue.
              </p>
            )}

            <div className="mt-4 max-h-72 space-y-1.5 overflow-y-auto">
              {recipients.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-400">No recipients yet. Add a guest above.</p>
              )}
              {recipients.map((r) => (
                <div
                  key={r.email}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-800">{r.name || r.email}</p>
                    <p className="truncate text-xs text-gray-400">
                      {r.email}
                      {r.phone ? ` · ${r.phone}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRecipient(r.email)}
                    className="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                    aria-label={`Remove ${r.email}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── Preview + Send ──────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-gray-900">Preview</h2>
            <div className="mt-3 overflow-hidden rounded-xl border border-gray-100">
              <div className="bg-[#1b1b1b] px-5 py-6 text-center">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/70">You’re invited</p>
                <p className="mt-1 font-heading text-lg text-white">{data?.coupleName || 'Our Wedding'}</p>
              </div>
              <div className="px-5 py-5">
                <p className="text-sm text-gray-700">Hi there,</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                  {message || 'Your message will appear here.'}
                </p>
                <div className="my-4 text-center">
                  <span className="inline-block rounded-full bg-[#1b1b1b] px-6 py-2.5 text-sm font-semibold text-white">
                    Visit our wedding website
                  </span>
                </div>
                {data?.site.url && (
                  <p className="break-all text-center text-xs text-gray-400">{data.site.url}</p>
                )}
                {data?.site.hasPassword && sitePassword.trim() && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
                    <p className="text-[11px] text-gray-500">Password</p>
                    <p className="text-sm font-bold text-gray-800">{sitePassword.trim()}</p>
                  </div>
                )}
                <p className="mt-4 text-sm text-gray-600">With love,<br />{data?.coupleName || 'The couple'}</p>
              </div>
            </div>
            {data?.replyTo && (
              <p className="mt-3 text-xs text-gray-400">
                Replies go to <span className="font-medium text-gray-500">{data.replyTo}</span>.
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={!canSend || sending}
            onClick={() => void send()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] px-6 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Sending…' : `Send to ${recipients.length} guest${recipients.length === 1 ? '' : 's'}`}
          </button>
          <p className="text-center text-[11px] text-gray-400">
            Every invite includes a one-click unsubscribe. Guests who opt out are skipped on future sends.
          </p>
        </div>
      </div>
    </div>
  );
}

function NoticeCard({
  icon,
  text,
  cta,
}: {
  icon: React.ReactNode;
  text: string;
  cta: { href: string; label: string };
}) {
  return (
    <div>
      <h1 className="font-heading text-2xl text-gray-900">Invite guests to your website</h1>
      <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
        {icon}
        <p className="mt-3 text-sm text-gray-600">{text}</p>
        <Link
          href={cta.href}
          className="mt-4 inline-flex rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
        >
          {cta.label}
        </Link>
      </div>
    </div>
  );
}
