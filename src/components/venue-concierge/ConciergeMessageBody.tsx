'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Mail } from 'lucide-react';
import { parseConciergeMessage, tidyEmailText, parseQuoted } from '@/lib/venue-concierge/message-format';
import { EmailRich } from '@/components/email/EmailRich';

function Linkified({ text, className }: { text: string; className?: string }) {
  return <EmailRich text={text} className={className} />;
}

/**
 * Plain concierge message body (an in-app chat message) — just the new reply,
 * linkified. Signature/quoted trails only appear on email messages, which are
 * rendered with ConciergeEmailCard instead.
 */
export function ConciergeMessageBody({ body }: { body: string }) {
  const { reply } = useMemo(() => parseConciergeMessage(body), [body]);
  return (
    <div className="text-[13px] leading-relaxed text-gray-900">
      <Linkified text={tidyEmailText(reply)} />
    </div>
  );
}

/** Nested Gmail-style blockquote for the quoted email trail. */
function QuotedThread({ text }: { text: string }) {
  const groups = useMemo(() => parseQuoted(text), [text]);
  return (
    <div className="space-y-1.5">
      {groups.map((g, i) => {
        const isHeader = g.depth === 0 && /^On\b[\s\S]*wrote:/.test(g.text);
        if (isHeader) {
          return (
            <p key={i} className="text-[11px] italic text-gray-400 whitespace-pre-wrap break-words">
              {g.text}
            </p>
          );
        }
        return (
          <div
            key={i}
            className={g.depth > 0 ? 'border-l-2 border-gray-200 pl-2.5' : ''}
            style={g.depth > 1 ? { marginLeft: (g.depth - 1) * 8 } : undefined}
          >
            <Linkified text={g.text} className="text-[12px] leading-relaxed text-gray-500" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Full-width, GoHighLevel-style accordion card for an email message. Collapsed
 * it shows the direction, an "Email" tag, the time and a one-line preview.
 * Expanded it reveals the reply, the signature, and the quoted email thread —
 * so you can read the whole conversation inline. Neutral (no purple).
 */
export function ConciergeEmailCard({
  body,
  who,
  time,
  highlighted,
}: {
  body: string;
  who: string;
  time: string;
  highlighted?: boolean;
}) {
  const { reply, signature, quoted } = useMemo(() => parseConciergeMessage(body), [body]);
  const [open, setOpen] = useState(false);
  const replyText = useMemo(() => tidyEmailText(reply), [reply]);
  const signatureText = useMemo(() => tidyEmailText(signature), [signature]);
  const preview = (replyText || quoted || '').replace(/\s+/g, ' ').trim() || '(empty email)';

  return (
    <div
      className={`w-full rounded-xl border bg-gray-50 overflow-hidden transition-shadow ${
        highlighted ? 'border-amber-400 ring-2 ring-amber-400 ring-offset-1' : 'border-gray-200'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100"
      >
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-gray-400" />
        )}
        <Mail size={12} className="shrink-0 text-gray-400" />
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{who}</span>
        <span className="shrink-0 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">
          Email
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-gray-400">{time}</span>
      </button>

      {open ? (
        <div className="border-t border-gray-100 px-3.5 py-3 space-y-3">
          {replyText && (
            <Linkified text={replyText} className="block text-[13px] leading-relaxed text-gray-800" />
          )}
          {signatureText && (
            <div className="border-t border-gray-100 pt-2.5">
              <Linkified text={signatureText} className="block text-[12px] leading-relaxed text-gray-500" />
            </div>
          )}
          {quoted && (
            <div className="border-t border-gray-100 pt-2.5">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Quoted thread</p>
              <div className="max-h-72 overflow-auto rounded-md bg-white border border-gray-100 px-3 py-2">
                <QuotedThread text={quoted} />
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="px-3 pb-2 -mt-0.5 pl-[52px] text-[13px] text-gray-600 truncate">{preview}</p>
      )}
    </div>
  );
}
