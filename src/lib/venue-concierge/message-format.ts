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
