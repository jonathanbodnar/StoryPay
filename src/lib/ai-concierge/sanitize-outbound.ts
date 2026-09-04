/**
 * AI Concierge — outbound message sanitizer (single source of truth).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every message the AI Concierge sends is bride-facing. A bride should only
 * ever receive clean words, phrases, and sentences with normal punctuation —
 * exactly like a text a real person typed on their phone. She must NEVER see:
 *   - HTML tags or tag fragments (the production bug: an SMS ended in
 *     "...how many you're inviting?</" — a truncated closing "<</sms>>" wrapper
 *     leaked through because DeepSeek hit the max-tokens cap mid-tag).
 *   - Markdown artifacts (**bold**, *italic*, `code`, # headings, > quotes,
 *     [links](url), stray asterisks).
 *   - Exotic typography (em/en dashes, curly quotes, ellipsis char, bullets,
 *     arrows, checkmarks) or invisible/zero-width control characters.
 *
 * `sanitizeConciergeOutbound` is the ONE function every AI outbound path funnels
 * through. It layers HTML + markdown-structural cleanup on top of the shared
 * `sanitizeSmsText` helper (which already handles emoji, typography, dashes,
 * whitespace, de-duplication, and capitalization) so we centralize rather than
 * duplicate that logic.
 *
 * Design contract:
 *   - Pure & deterministic. No I/O, no side effects.
 *   - Idempotent: sanitize(sanitize(x)) === sanitize(x).
 *   - Safe on already-clean text: a normal sentence passes through unchanged.
 *
 * EM/EN DASH DECISION: we normalize both "—" and "–" to a plain hyphen "-"
 * surrounded by the original spacing collapsed to ", " when the dash was used
 * as a clause separator (handled inside `sanitizeSmsText`). This keeps the
 * message readable as a casual text without any unicode punctuation.
 */

import { sanitizeSmsText } from '@/lib/ai-text-cleanup';

// ── HTML entity decoding ────────────────────────────────────────────────────
// The model occasionally emits HTML-escaped text (e.g. "you&#39;re",
// "Sarah &amp; Tom"). Decode the common ones to their real character so the
// bride sees an apostrophe, not "&#39;". Anything we don't recognize is left
// as-is (never guessed).
const NAMED_ENTITIES: Record<string, string> = {
  '&amp;':   '&',
  '&apos;':  "'",
  '&quot;':  '"',
  '&nbsp;':  ' ',
  '&mdash;': '-',   // em dash entity → hyphen (matches our dash rule)
  '&ndash;': '-',   // en dash entity → hyphen
  '&hellip;': '...',
  '&lsquo;': "'",
  '&rsquo;': "'",
  '&ldquo;': '"',
  '&rdquo;': '"',
  // &lt; / &gt; are decoded LAST (below) so a decoded "<"/">" can still be
  // caught by the tag-stripping pass rather than re-introducing markup.
};

function decodeHtmlEntities(input: string): string {
  let s = input;

  // Named entities (except lt/gt — handled after tag stripping).
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    s = s.split(entity).join(char);
  }

  // Numeric entities: decimal (&#39;) and hex (&#x27;).
  s = s.replace(/&#(\d+);/g, (_m, dec: string) => {
    const code = Number(dec);
    return Number.isFinite(code) ? safeFromCodePoint(code) : _m;
  });
  s = s.replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, hex: string) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) ? safeFromCodePoint(code) : _m;
  });

  return s;
}

/** Guard against invalid code points blowing up String.fromCodePoint. */
function safeFromCodePoint(code: number): string {
  try {
    if (code < 0 || code > 0x10ffff) return '';
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export function sanitizeConciergeOutbound(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);

  // 1. Decode HTML entities first so escaped markup (e.g. "&lt;br&gt;") becomes
  //    real "<br>" that the tag-stripping pass below can remove — and so
  //    escaped apostrophes/ampersands render as normal characters.
  s = decodeHtmlEntities(s);

  // 1b. Strip zero-width / non-printable / control characters up front. We do
  //     this BEFORE handing off to sanitizeSmsText (which would otherwise turn a
  //     zero-width space into a regular space and silently split a word). These
  //     are always invisible noise the model should never have emitted:
  //     C0/C1 controls, DEL, zero-width space/joiner/non-joiner, LTR/RTL marks,
  //     line/paragraph separators, word joiner, and the BOM.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, '');

  // 2. Remove fenced code blocks (```...```), then any stray fence markers.
  //    Brides never want a code block; drop the whole thing.
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/```/g, '');

  // 3. Markdown images ![alt](url) → alt (drop the image, keep any caption).
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // 4. Markdown links [label](url) → label, or the url when there's no label.
  //    A bride can't tap markdown syntax; show the human-readable part only.
  s = s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_m, label: string, url: string) => {
    const l = (label || '').trim();
    return l || (url || '').trim();
  });

  // 5. Strip COMPLETE HTML tags (<br>, <p>, </div>, <a href="...">, etc.).
  s = s.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ');

  // 6. Strip INCOMPLETE / trailing tag fragments — the exact production bug.
  //    a) A partial tag with a name but no closing ">" (usually truncated at
  //       the max-token cap): "<br", "</div", "<p style=".
  s = s.replace(/<\/?[a-zA-Z][^<>]*$/g, '');
  //    b) A dangling "</" (the screenshot case: "...inviting?</") or "<>" that
  //       isn't a real "less-than" usage. We only remove "</" that is NOT the
  //       start of a valid tag, so legitimate math like "under < 5 guests"
  //       (a "<" followed by a space) is preserved.
  s = s.replace(/<\/(?![a-zA-Z])/g, '');
  s = s.replace(/<>/g, '');
  //    c) A lone "<" or "</" left at the very end of the message.
  s = s.replace(/<\/?\s*$/g, '');

  // 7. Decode any remaining &lt; / &gt; now that tag stripping is done — these
  //    are legitimate "<"/">" the bride might mean literally (rare, but safe).
  s = s.split('&lt;').join('<').split('&gt;').join('>');

  // 8. Markdown block syntax at line starts: headings (#) and blockquotes (>).
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '');   // "# Heading" → "Heading"
  s = s.replace(/^\s{0,3}>\s?/gm, '');         // "> quoted" → "quoted"

  // 9. Inline code backticks — unwrap `code` → code, then drop stray backticks.
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/`/g, '');

  // 10. Stray asterisks — bold/italic markers and any leftover "*". Asterisks
  //     have no place in a conversational text, so remove them entirely.
  s = s.replace(/\*/g, '');

  // 11. Emphasis underscores (_italic_, __bold__) used as a whole-word wrapper.
  //     We only strip underscores acting as emphasis delimiters (bounded by a
  //     space/punctuation/edge) so we never mangle underscores inside a URL or
  //     handle like "some_thing".
  s = s.replace(/(^|[\s.,!?;:])_{1,2}([^_\n]+?)_{1,2}(?=[\s.,!?;:]|$)/g, '$1$2');

  // 12. Hand off to the shared SMS sanitizer for the rest: emoji/symbol
  //     stripping, smart-quote → straight-quote, ellipsis → "...", em/en dash
  //     normalization, bullet/arrow/checkmark removal, whitespace collapse,
  //     duplicated-body de-dupe, and first-letter capitalization.
  s = sanitizeSmsText(s);

  // 13. Safety net: strip any zero-width / control characters re-introduced by
  //     the steps above (e.g. an entity that decoded to one) — see step 1b.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, '');

  // 14. Final whitespace tidy (steps 5-11 may have left double spaces where a
  //     tag/marker used to be) and trim any leading/trailing junk.
  s = s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return s;
}
