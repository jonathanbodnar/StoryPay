'use client';

import React from 'react';

/**
 * Shared inline renderer for tidied email text (see `tidyEmailText`).
 *
 * It understands these inline forms and renders them like a Gmail message:
 *   - bold `**words**`                     → <strong> (signature labels)
 *   - markdown links `[words](https://url)`→ the *words* become the hyperlink
 *   - bare URLs `https://…`                → hyperlinked, with giant tracking
 *                                             URLs shortened to `host/…` for
 *                                             readability (full URL stays the href)
 *   - bare emails `name@host.com`          → `mailto:` link
 *
 * Everything else renders as plain text with `whitespace-pre-wrap` so line
 * breaks and signatures keep their shape.
 */

// Gmail-style blue links by default.
const DEFAULT_LINK_CLASS =
  'text-blue-600 hover:text-blue-700 underline underline-offset-2 break-all';

// Order matters: bold + markdown link before bare URL so inner URLs aren't
// double-matched.
const TOKEN_RE =
  /\*\*([^*]+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function shortenUrl(url: string): string {
  if (url.length <= 48) return url;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const hasPath = u.pathname && u.pathname !== '/';
    return host + (hasPath ? '/…' : '');
  } catch {
    return url.slice(0, 45) + '…';
  }
}

export function renderEmailRich(text: string, linkClassName = DEFAULT_LINK_CLASS): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));

    if (m[1] !== undefined) {
      // **bold** — render inner recursively so a link inside bold still works.
      nodes.push(
        <strong key={key++} className="font-semibold">
          {renderEmailRich(m[1], linkClassName)}
        </strong>,
      );
    } else if (m[2] && m[3]) {
      // [words](url)
      nodes.push(
        <a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {m[2]}
        </a>,
      );
    } else if (m[4]) {
      // bare url — trim trailing sentence punctuation out of the href
      const raw = m[4];
      const url = raw.replace(/[.,;:)\]]+$/, '');
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {shortenUrl(url)}
        </a>,
      );
      if (url.length !== raw.length) nodes.push(raw.slice(url.length));
    } else if (m[5]) {
      // bare email
      nodes.push(
        <a key={key++} href={`mailto:${m[5]}`} className={linkClassName}>
          {m[5]}
        </a>,
      );
    }

    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function EmailRich({
  text,
  className,
  linkClassName,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
}) {
  return (
    <span className={`whitespace-pre-wrap break-words ${className ?? ''}`}>
      {renderEmailRich(text, linkClassName)}
    </span>
  );
}
