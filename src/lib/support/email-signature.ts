/**
 * Heuristic signature-block detector for inbound/outbound email bodies.
 *
 * Goal: fold the trailing "Thanks, — Jane Doe / (555) 123-4567 / [image:
 * facebook] <url>" tail that real venue emails carry, so the collapsible
 * email body (see CollapsibleBody in SupportInboxPanel.tsx) can hide it
 * behind a small "show more" toggle by default.
 *
 * Deliberately CONSERVATIVE: better to under-trim (leave a signature visible)
 * than to accidentally hide real message content. We only cut at a line that
 * strongly looks like the start of a signature, and only when that line
 * falls in the back portion of the message (last 60% of lines) — a false
 * match near the top of a short message never triggers a cut.
 */

export interface SplitEmailBody {
  main:        string;
  /** null when no signature block was confidently detected. */
  signature:   string | null;
}

// Lines that strongly mark "everything after this is a signature".
const SIGN_OFF_RE = /^(thanks|thank you|best|best regards|regards|sincerely|warmly|cheers|talk soon|many thanks|kind regards)[,!.]?\s*$/i;
const DASH_RULE_RE = /^--\s*$|^-{2,}\s*$|^_{2,}\s*$/;
const SENT_FROM_RE = /^sent from my (iphone|ipad|android|galaxy|mobile device)/i;
const MARKETING_LINK_RE = /^\[image:.*?\]\s*<?https?:\/\//i;
const CONTACT_LINE_RE = /^(phone|mobile|cell|tel|office|fax|email|website|web)\s*[:\-]/i;
const URL_ONLY_RE = /^<?https?:\/\/\S+>?$/i;

function looksLikeSignatureStart(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return (
    SIGN_OFF_RE.test(t) ||
    DASH_RULE_RE.test(t) ||
    SENT_FROM_RE.test(t) ||
    MARKETING_LINK_RE.test(t)
  );
}

/** Lines that, once we're already inside a detected signature block, keep it going. */
function continuesSignature(line: string): boolean {
  const t = line.trim();
  if (!t) return true; // blank lines inside a signature block are fine
  return (
    CONTACT_LINE_RE.test(t) ||
    SENT_FROM_RE.test(t) ||
    MARKETING_LINK_RE.test(t) ||
    URL_ONLY_RE.test(t) ||
    // Short name-like lines (<=6 words, no terminal punctuation) commonly
    // follow a sign-off ("Jane Doe", "VP of Sales, Acme Venues").
    (t.split(/\s+/).length <= 6 && !/[.!?]$/.test(t))
  );
}

/**
 * Split an email body into the "real" message and a trailing signature
 * block, if one is confidently detected. Returns signature=null when no
 * split point met the conservative bar above.
 */
export function splitEmailSignature(body: string): SplitEmailBody {
  const raw = (body ?? '').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  if (lines.length < 3) return { main: raw, signature: null };

  // Only consider cut points in the back portion of the message so a
  // sign-off phrase appearing early (e.g. quoted in the actual question)
  // can't accidentally eat real content.
  const earliestCutIdx = Math.floor(lines.length * 0.4);

  let cutIdx = -1;
  for (let i = earliestCutIdx; i < lines.length; i++) {
    if (looksLikeSignatureStart(lines[i])) {
      cutIdx = i;
      break;
    }
  }
  if (cutIdx === -1) return { main: raw, signature: null };

  // Require the remainder to plausibly BE a signature (short, contact-like)
  // rather than the sign-off phrase just happening to be a normal sentence
  // followed by more prose. Walk forward from the sign-off line and bail
  // out (treat as no-match) if we hit a clearly-prose line (long, ends in
  // terminal punctuation, more than ~12 words) before the block ends.
  const tail = lines.slice(cutIdx + 1);
  let sawAnyContactSignal = DASH_RULE_RE.test(lines[cutIdx].trim()) || SENT_FROM_RE.test(lines[cutIdx].trim());
  for (const line of tail) {
    const t = line.trim();
    if (!t) continue;
    if (continuesSignature(t)) {
      if (CONTACT_LINE_RE.test(t) || SENT_FROM_RE.test(t) || MARKETING_LINK_RE.test(t) || URL_ONLY_RE.test(t)) {
        sawAnyContactSignal = true;
      }
      continue;
    }
    // Looks like real prose continuing after the "sign-off" — conservatively
    // bail out entirely rather than risk hiding content.
    return { main: raw, signature: null };
  }

  // A bare "Thanks," with nothing contact-like after it (e.g. followed only
  // by a one-word name) is still fine to trim — it's clearly a sign-off.
  if (!sawAnyContactSignal && tail.filter(l => l.trim()).length > 3) {
    // More than a few non-empty trailing lines with no contact/marketing
    // signal at all is less certain to be a signature — skip trimming.
    return { main: raw, signature: null };
  }

  const main = lines.slice(0, cutIdx).join('\n').replace(/\s+$/, '');
  const signature = lines.slice(cutIdx).join('\n').replace(/^\s+|\s+$/g, '');
  if (!main.trim()) return { main: raw, signature: null };
  return { main, signature: signature || null };
}
