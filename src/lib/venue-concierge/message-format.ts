/**
 * Parse a Venue Concierge message body into display parts.
 *
 * App-composed messages are plain text and pass through unchanged. Messages
 * that arrived as an email reply (venue owner/team replying to a concierge
 * notification, or vice-versa) carry a lot of noise:
 *   - a quoted trail ("On <date> … wrote:" + `> …` lines)
 *   - a signature block (name/title/phone/email/website)
 *   - marketing image placeholders like `[image: banner] <https://…>`
 *
 * We split those out so the bubble shows just the new reply, with the signature
 * and quoted history tucked behind "Show signature" / "Show quoted email"
 * accordions — same reading experience as the Support Inbox.
 */

export interface ParsedConciergeMessage {
  /** The new message content (what the person actually typed). */
  reply: string;
  /** Trailing signature block, or '' if none detected. */
  signature: string;
  /** Quoted email history ("On … wrote:" + `>` lines), or '' if none. */
  quoted: string;
  /** True when this message clearly arrived via email (has quoted/signature). */
  isEmail: boolean;
}

// A line that begins the trailing signature block.
const SIG_ANCHOR_RE =
  /^(phone|mobile|cell|tel|office|fax|e-?mail|email|website|web|call\s*\/\s*text|call or text|book a call)\b\s*[:\-]/i;
const MARKETING_IMG_RE = /^\[image:[^\]]*\]/i;

/** Strip marketing image placeholders and tidy excess whitespace. */
function cleanInline(s: string): string {
  return s
    .replace(/\[image:[^\]]*\]\s*<[^>]*>/gi, '')
    .replace(/\[image:[^\]]*\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Index where the quoted email trail begins, or -1. */
function findQuoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('>')) return i;
    if (/^-{3,}\s*original message\s*-{3,}/i.test(t)) return i;
    if (/^_{5,}$/.test(t)) return i;
    // Gmail-style header, possibly wrapped across a few physical lines.
    if (/^On\b/.test(t)) {
      const chunk = lines.slice(i, i + 4).join(' ');
      if (/\bwrote:/.test(chunk)) return i;
    }
    // "From: name <email>" block header (Outlook).
    if (/^From:\s.+@/i.test(t) && i + 1 < lines.length && /^(sent|date|to|subject):/i.test(lines[i + 1].trim())) {
      return i;
    }
  }
  return -1;
}

/** Index where the trailing signature block begins within `lines`, or -1. */
function findSignatureStart(lines: string[]): number {
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (SIG_ANCHOR_RE.test(t) || MARKETING_IMG_RE.test(t)) { anchor = i; break; }
  }
  if (anchor <= 0) return anchor === 0 ? 0 : -1;

  // Walk backward over the name/title lines that belong to the signature —
  // short, no terminal punctuation — but stop at a blank line or a sign-off
  // ("Thanks,", "Best,") which reads better left with the reply.
  let start = anchor;
  for (let i = anchor - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) break;
    if (/^(thanks|thank you|best|best regards|regards|sincerely|warmly|cheers|talk soon|many thanks|kind regards)[,!.]?$/i.test(t)) break;
    const words = t.split(/\s+/).length;
    if (words <= 6 && !/[.!?]$/.test(t)) { start = i; continue; }
    break;
  }
  return start;
}

// Trailing call-to-action phrases that, when they sit right before a link,
// should become the *visible* hyperlink text (keeping any label prefix plain) —
// e.g. "Book A Strategy Call: Click Here <url>" → "Book A Strategy Call: [Click Here](url)".
const CTA_TAIL_RE =
  /(click here|book (?:a )?(?:strategy )?call|schedule (?:a )?(?:call|demo)|learn more|read more|see more|watch(?: now)?|register|sign up|get started|download|reply here|view(?: here| more| details)?|book now|here)$/i;

/** Turn an `Anchor <url>` fragment into `[link text](url)`, choosing sensible
 *  link text so it reads like Gmail: a trailing CTA ("Click Here"), else the
 *  trailing token ("storyvenue.com"), keeping any bold "Label:" prefix plain. */
function anchorToMarkdown(rawAnchor: string, rawUrl: string): string {
  const anchor = rawAnchor.replace(/[ \t]+$/, '');
  const url = rawUrl.replace(/\s+/g, ''); // rejoin URLs wrapped across lines
  const cta = anchor.match(CTA_TAIL_RE);
  if (cta) {
    if (cta.index === 0) return `[${anchor}](${url})`;
    const label = anchor.slice(0, cta.index);
    const sep = /[\s*]$/.test(label) ? '' : ' ';
    return `${label}${sep}[${cta[1]}](${url})`;
  }
  // "Label: value" → link only the trailing token, keep the label plain.
  const tok = anchor.match(/^([\s\S]*\s)(\S+)$/);
  if (tok) return `${tok[1]}[${tok[2]}](${url})`;
  return `[${anchor}](${url})`;
}

/**
 * Tidy an email text fragment for display so it reads like a normal Gmail
 * message instead of raw MIME text:
 *   - render `*emphasis*` as **bold** (Gmail bolds signature labels like
 *     `*Text Us:*`, `*Website:*`) — kept as markdown for the EmailRich renderer
 *   - turn `Anchor <https://…>` into a markdown link `[words](url)` so the
 *     *words* become the hyperlink (Gmail-style), rejoining URLs that were
 *     wrapped across multiple lines
 *   - drop `<(740) 880-8586>`-style phone/tel angle-bracket duplicates
 *   - unwrap any remaining bare `<https://…>` / `<a@b.com>` angle brackets
 *   - collapse extra blank lines
 *
 * The resulting `**bold**` / `[text](url)` markdown is understood by EmailRich.
 */
export function tidyEmailText(s: string): string {
  return (s ?? '')
    // 1. Emphasis → bold markdown (handles `*Label: *` with inner spaces too).
    .replace(/\*([^*\n]+?)\*/g, '**$1**')
    // 2. Anchored links: `Anchor <url>` (URL may wrap onto following lines) →
    //    `[words](url)`.
    .replace(
      /([^\n<>]*?\S)[ \t]*\n?[ \t]*<\s*(https?:\/\/[\s\S]*?)\s*>/g,
      (_m, anchor: string, url: string) => anchorToMarkdown(anchor, url),
    )
    // 3. Phone / tel angle-bracket duplicates → drop.
    .replace(/[ \t]*<\(?\d[\d\s()%.+\-]*>/g, '')
    // 4. Any remaining bare `<url>` (possibly wrapped) / `<email>` → unwrap.
    .replace(/<\s*(https?:\/\/[\s\S]*?)\s*>/g, (_m, u: string) => u.replace(/\s+/g, ''))
    .replace(/<\s*([^<>@\s]+@[^<>\s]+?)\s*>/g, '$1')
    // 5. Whitespace.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface QuoteGroup {
  /** Quote nesting level: 0 = a header line ("On … wrote:"), 1+ = quoted. */
  depth: number;
  text: string;
}

/**
 * Parse a quoted email trail into depth-grouped blocks with the leading `>`
 * markers stripped, so it can render as nested Gmail-style blockquotes.
 */
export function parseQuoted(quoted: string): QuoteGroup[] {
  // Strip the `>` quote markers FIRST (capturing depth), then group consecutive
  // same-depth lines, then tidy each block. Doing it in this order means a URL
  // that was wrapped across several `>`-prefixed lines is rejoined cleanly (no
  // stray `>` left mid-signature) and tidyEmailText sees marker-free text.
  const lines = (quoted ?? '').replace(/\r\n/g, '\n').split('\n').map((l) => {
    const m = l.match(/^(\s*>\s?)+/);
    const depth = m ? (m[0].match(/>/g) || []).length : 0;
    const content = l.replace(/^(\s*>\s?)+/, '');
    return { depth, content };
  });

  const groups: QuoteGroup[] = [];
  for (const ln of lines) {
    const last = groups[groups.length - 1];
    if (last && last.depth === ln.depth) last.text += '\n' + ln.content;
    else groups.push({ depth: ln.depth, text: ln.content });
  }
  return groups
    .map((g) => ({ depth: g.depth, text: tidyEmailText(g.text) }))
    .filter((g) => g.text.length > 0);
}

export function parseConciergeMessage(body: string): ParsedConciergeMessage {
  const text = (body ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  const qi = findQuoteStart(lines);
  const replyLines = qi >= 0 ? lines.slice(0, qi) : lines;
  const quoted = qi >= 0 ? cleanInline(lines.slice(qi).join('\n')) : '';

  const si = findSignatureStart(replyLines);
  let reply: string;
  let signature = '';
  if (si >= 0) {
    reply = cleanInline(replyLines.slice(0, si).join('\n'));
    signature = cleanInline(replyLines.slice(si).join('\n'));
  } else {
    reply = cleanInline(replyLines.join('\n'));
  }

  // If stripping left nothing readable, fall back to the cleaned full reply
  // portion so we never show an empty bubble.
  if (!reply) {
    reply = cleanInline(replyLines.join('\n')) || '(no message)';
    signature = '';
  }

  return { reply, signature, quoted, isEmail: !!(quoted || signature) };
}
