'use client';

/**
 * Conversations tab inside a contact profile.
 *
 * Shows the full back-and-forth history (SMS + email) with this contact — the
 * same thread that appears on the Conversations page — and lets the user reply
 * by SMS or email right here. Emails render through the shared EmailThreadCard
 * (single source of truth SaaS-wide); SMS render as iMessage-style bubbles.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, RefreshCw, MessageSquare, Mail, AlertCircle } from 'lucide-react';
import { EmailThreadCard } from '@/components/email/EmailThreadCard';
import { EmailRich } from '@/components/email/EmailRich';
import { tidyEmailText } from '@/lib/email-format';

interface ConvMessage {
  id: string;
  channel: string;
  body: string;
  sender_kind: string;
  visibility: string | null;
  audience: string | null;
  created_at: string;
  email_subject: string | null;
  author_label?: string | null;
  contact_from_name?: string | null;
  send_error?: string | null;
  external_email_sent?: boolean | null;
}

type Channel = 'sms' | 'email';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ContactConversationsTab({
  contactId,
  contactName,
  contactEmail,
  contactPhone,
}: {
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasEmail = !!(contactEmail && contactEmail.includes('@'));
  const hasPhone = !!(contactPhone && contactPhone.trim());
  const [channel, setChannel] = useState<Channel>(hasEmail ? 'email' : 'sms');
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const threadIdRef = useRef<string | null>(null);

  // Only true back-and-forth with the contact — exclude internal team notes and
  // the concierge↔venue "Venue Direct" side-channel.
  const visible = useMemo(
    () =>
      messages.filter(
        (m) => m.visibility === 'external' && m.audience !== 'venue_direct' && m.sender_kind !== 'concierge',
      ),
    [messages],
  );

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const loadMessages = useCallback(async (tid: string, opts?: { silent?: boolean }) => {
    try {
      const res = await fetch(`/api/conversations/threads/${tid}/messages${opts?.silent ? '?nosync=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as ConvMessage[];
      setMessages((prev) => {
        // Avoid needless re-render churn when nothing changed.
        if (prev.length === json.length && prev[prev.length - 1]?.id === json[json.length - 1]?.id) return prev;
        return json;
      });
    } catch { /* ignore transient */ }
  }, []);

  // Resolve (or create) the contact's thread, then load its messages.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/conversations/contacts/${contactId}/thread`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not open conversation');
        if (cancelled) return;
        const tid = json.thread_id as string;
        setThreadId(tid);
        threadIdRef.current = tid;
        if (json.external_reply_channel === 'sms' && !hasEmail) setChannel('sms');
        await loadMessages(tid);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load conversation');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contactId, hasEmail, loadMessages]);

  useEffect(() => { if (!loading) scrollToBottom(); }, [loading, visible.length, scrollToBottom]);

  // Lightweight poll so inbound replies land automatically while the tab is open.
  useEffect(() => {
    if (!threadId) return;
    const t = setInterval(() => { void loadMessages(threadId, { silent: true }); }, 7000);
    return () => clearInterval(t);
  }, [threadId, loadMessages]);

  const send = useCallback(async () => {
    const tid = threadIdRef.current;
    const text = draft.trim();
    if (!tid || !text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/conversations/threads/${tid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visibility: 'external',
          external_channel: channel,
          body: text,
          ...(channel === 'email' && subject.trim() ? { email_subject: subject.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setSendError(json.error || 'Failed to send'); return; }
      // The row may report a delivery failure even on 201.
      if (json.send_error) setSendError(json.send_error);
      setDraft('');
      setSubject('');
      await loadMessages(tid);
      requestAnimationFrame(() => scrollToBottom(true));
    } catch {
      setSendError('Network error — please try again.');
    } finally {
      setSending(false);
    }
  }, [draft, channel, subject, sending, loadMessages, scrollToBottom]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Loading conversation…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle size={14} className="inline mr-1.5 -mt-0.5" />
        {error}
      </div>
    );
  }

  const canSendChannel = channel === 'email' ? hasEmail : hasPhone;

  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 truncate">Conversation with {contactName}</h2>
          <p className="text-[11px] text-gray-400 truncate">
            {[hasEmail ? contactEmail : null, hasPhone ? contactPhone : null].filter(Boolean).join(' · ') || 'No email or phone on file'}
          </p>
        </div>
        <button
          onClick={() => threadId && loadMessages(threadId)}
          className="shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="max-h-[55vh] min-h-[240px] overflow-y-auto px-4 py-4 bg-gray-50/40">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <MessageSquare size={26} className="text-gray-300" />
            <p className="text-sm text-gray-500">No messages yet.</p>
            <p className="text-xs text-gray-400">Send an SMS or email below to start the conversation.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((m) => {
              const inbound = m.sender_kind === 'contact';
              const who = inbound
                ? (m.contact_from_name || contactName || 'Contact')
                : (m.author_label || 'You');
              if (m.channel === 'email') {
                return (
                  <EmailThreadCard
                    key={m.id}
                    body={m.body}
                    who={who}
                    time={fmtTime(m.created_at)}
                  />
                );
              }
              // SMS → iMessage-style bubble.
              return (
                <div key={m.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                  <div className="max-w-[80%]">
                    <div
                      className={`rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                        inbound ? 'bg-white border border-gray-200 text-gray-900 rounded-tl-sm' : 'bg-gray-900 text-white rounded-tr-sm'
                      }`}
                    >
                      <EmailRich text={tidyEmailText(m.body)} linkClassName={inbound ? undefined : 'text-white underline underline-offset-2 break-all'} />
                    </div>
                    <p className={`mt-1 text-[10px] text-gray-400 ${inbound ? 'text-left' : 'text-right'}`}>
                      {who} · {fmtTime(m.created_at)}
                      {m.send_error ? <span className="text-red-500"> · failed</span> : null}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="mb-2 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
          <button
            onClick={() => setChannel('sms')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${channel === 'sms' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <MessageSquare size={12} /> SMS
          </button>
          <button
            onClick={() => setChannel('email')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${channel === 'email' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
          >
            <Mail size={12} /> Email
          </button>
        </div>

        {channel === 'email' && (
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
            className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
          />
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send(); }}
            rows={2}
            placeholder={channel === 'email' ? `Email ${contactName}…  ⌘⏎ to send` : `Text ${contactName}…  ⌘⏎ to send`}
            className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !draft.trim() || !canSendChannel}
            className="inline-flex h-fit items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
            title={!canSendChannel ? (channel === 'email' ? 'Add an email to this contact to send email' : 'Add a phone number to this contact to send SMS') : undefined}
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
          </button>
        </div>

        {!canSendChannel && (
          <p className="mt-1.5 text-[11px] text-amber-600">
            {channel === 'email'
              ? 'This contact has no email on file. Add one on the Overview tab to send email.'
              : 'This contact has no phone number on file. Add one on the Overview tab to send SMS.'}
          </p>
        )}
        {sendError && <p className="mt-1.5 text-[11px] text-red-600">{sendError}</p>}
      </div>
    </div>
  );
}
