'use client';

import React from 'react';

/**
 * Shared inline renderer for tidied email text (see `tidyEmailText`).
 *
 * It understands three inline forms and renders them like a Gmail message:
 *   - markdown links `[words](https://url)` → the *words* become the hyperlink
 *   - bare URLs `https://…`                → hyperlinked, with giant tracking
 *                                             URLs shortened to `host/…` for
 *                                             readability (full URL stays the href)
 *   - bare emails `name@host.com`          → `mailto:` link
 *
 * Everything else renders as plain text with `whitespace-pre-wrap` so line
 * breaks and signatures keep their shape.
 */

const DEFAULT_LINK_CLASS =
  'underline decoration-current/40 underline-offset-2 hover:decoration-current break-all';

// Order matters: markdown link first so its inner URL isn't matched as a bare URL.
const TOKEN_RE =
  /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

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

    if (m[1] && m[2]) {
      // [words](url)
      nodes.push(
        <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {m[1]}
        </a>,
      );
    } else if (m[3]) {
      // bare url — trim trailing sentence punctuation out of the href
      const raw = m[3];
      const url = raw.replace(/[.,;:)\]]+$/, '');
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {shortenUrl(url)}
        </a>,
      );
      if (url.length !== raw.length) nodes.push(raw.slice(url.length));
    } else if (m[4]) {
      // bare email
      nodes.push(
        <a key={key++} href={`mailto:${m[4]}`} className={linkClassName}>
          {m[4]}
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
