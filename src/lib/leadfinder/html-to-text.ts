/**
 * StoryVenue LeadFinder™ — HTML email body to readable, LINE-STRUCTURED text.
 *
 * The extractor is label-driven ("Name: …", "Guests: …"), so it needs one field
 * per line. The generic stripper the conversation paths use collapses every
 * whitespace run — newlines included — into a single space, which turns an
 * HTML-only marketplace notification into one long line where no label can be
 * found. This keeps the structure instead:
 *
 *   - block elements and <br> become line breaks,
 *   - a two-cell table row ("Name" | "Sarah Johnson") becomes "Name: Sarah Johnson",
 *     which is how most marketplace templates lay out their fields,
 *   - links keep their URL next to the text, so the venue's copy still carries
 *     the marketplace's "reply" link.
 *
 * Pure and dependency-free: it reads a string and returns a string.
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
  hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  zwnj: '', zwj: '', shy: '',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) {
      const n = parseInt(lower.slice(2), 16);
      return Number.isFinite(n) ? safeFromCodePoint(n) : whole;
    }
    if (lower.startsWith('#')) {
      const n = parseInt(lower.slice(1), 10);
      return Number.isFinite(n) ? safeFromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function safeFromCodePoint(n: number): string {
  try {
    // Zero-width and control characters carry no meaning for a reader.
    if (n === 0x200b || n === 0x200c || n === 0x200d || n === 0xfeff || n < 0x20) return n === 0x0a ? '\n' : ' ';
    return String.fromCodePoint(n);
  } catch {
    return ' ';
  }
}

/** A table cell that reads like a field label rather than content. */
function looksLikeLabel(cell: string): boolean {
  return cell.length > 0 && cell.length <= 40 && !/[.!?]\s/.test(cell) && !/https?:\/\//i.test(cell);
}

export function htmlToStructuredText(html: string): string {
  if (!html) return '';

  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|title|noscript)[\s\S]*?<\/\1>/gi, ' ')
    // Newlines in the source are layout noise; structure comes from the tags.
    .replace(/[\r\n]+/g, ' ');

  // Links: keep the visible text, and the destination when it adds something.
  s = s.replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const url = decodeEntities(href.trim());
    if (!/^https?:\/\//i.test(url)) return ` ${text} `;
    if (!text || text === url) return ` ${url} `;
    return ` ${text} (${url}) `;
  });

  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, '\t')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|table|tbody|thead|tfoot|section|article|header|footer|blockquote|pre|center|dd|dt)\s*>/gi, '\n')
    .replace(/<(p|div|h[1-6]|table|section|article|header|footer|blockquote|pre|center|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s);

  const out: string[] = [];
  for (const rawLine of s.split('\n')) {
    const cells = rawLine
      .split('\t')
      .map((c) => c.replace(/[  \f\v]+/g, ' ').trim())
      .filter(Boolean);
    if (cells.length === 0) {
      out.push('');
      continue;
    }
    if (cells.length === 2 && looksLikeLabel(cells[0])) {
      // "Name" | "Sarah Johnson"  →  "Name: Sarah Johnson"
      out.push(`${cells[0].replace(/[:\s]+$/, '')}: ${cells[1]}`);
      continue;
    }
    for (const c of cells) out.push(c);
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The body LeadFinder should read. A text part that already has line structure
 * is the sender's own plain-text rendering and is preferred; an HTML-only
 * message (or a text part squashed onto one line) is rebuilt from the HTML.
 */
export function chooseLeadFinderBody(text: string | null | undefined, html: string | null | undefined): string {
  const t = (text ?? '').replace(/\r\n?/g, '\n').trim();
  const lines = t ? t.split('\n').filter((l) => l.trim()).length : 0;
  if (t && lines >= 3) return t;
  const fromHtml = html ? htmlToStructuredText(html) : '';
  if (fromHtml && fromHtml.split('\n').filter((l) => l.trim()).length > lines) return fromHtml;
  return t || fromHtml;
}
