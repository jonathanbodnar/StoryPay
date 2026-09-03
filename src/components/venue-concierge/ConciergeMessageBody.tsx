'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { parseConciergeMessage } from '@/lib/venue-concierge/message-format';

const URL_RE = /(https?:\/\/[^\s<>()]+)/g;

function Linkified({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: Array<{ t: string; href?: string }> = [];
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ t: text.slice(last, idx) });
      const url = m[0].replace(/[.,)\]]+$/, '');
      out.push({ t: url, href: url });
      last = idx + m[0].length;
      if (url.length !== m[0].length) out.push({ t: m[0].slice(url.length) });
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }, [text]);

  return (
    <span className={`whitespace-pre-wrap break-words ${className ?? ''}`}>
      {parts.map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {p.t}
          </a>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </span>
  );
}

/**
 * Renders a concierge message body iMessage-style: the new reply is shown
 * plainly, while an email signature and the quoted email history each collapse
 * behind a small toggle so the thread stays readable.
 *
 * `tone` matches the bubble background — 'dark' for the sender's own black
 * bubble (white text) and 'light' for the other party's gray bubble.
 */
export function ConciergeMessageBody({ body, tone }: { body: string; tone: 'dark' | 'light' }) {
  const { reply, signature, quoted } = useMemo(() => parseConciergeMessage(body), [body]);
  const [showSig, setShowSig] = useState(false);
  const [showQuote, setShowQuote] = useState(false);

  const muted = tone === 'dark' ? 'text-white/60' : 'text-gray-400';
  const toggle =
    tone === 'dark'
      ? 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
      : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300';
  const divider = tone === 'dark' ? 'border-white/15' : 'border-gray-200';

  return (
    <div className="text-[13px] leading-relaxed">
      <Linkified text={reply} />

      {signature && (
        <div className={`mt-1.5 border-t pt-1.5 ${divider}`}>
          {showSig ? (
            <>
              <Linkified text={signature} className={muted} />
              <button
                type="button"
                onClick={() => setShowSig(false)}
                className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toggle}`}
              >
                <ChevronUp size={10} /> Hide signature
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowSig(true)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toggle}`}
            >
              <ChevronDown size={10} /> Show signature
            </button>
          )}
        </div>
      )}

      {quoted && (
        <div className={`mt-1.5 border-t pt-1.5 ${divider}`}>
          {showQuote ? (
            <>
              <div className={`max-h-64 overflow-auto rounded-md px-1 py-0.5 text-[12px] ${muted}`}>
                <Linkified text={quoted} className={muted} />
              </div>
              <button
                type="button"
                onClick={() => setShowQuote(false)}
                className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toggle}`}
              >
                <ChevronUp size={10} /> Hide quoted email
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowQuote(true)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toggle}`}
            >
              <ChevronDown size={10} /> Show quoted email
            </button>
          )}
        </div>
      )}
    </div>
  );
}
