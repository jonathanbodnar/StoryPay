/**
 * Post-processing for AI-generated SMS text.
 *
 * `sanitizeSmsText` (the main export) performs a full pipeline:
 *   1. Strip emojis and all non-basic-latin unicode symbols
 *   2. Replace typographic / "smart" punctuation with plain ASCII equivalents
 *   3. Strip markdown formatting (bold, italic, bullet lists)
 *   4. Replace em/en dashes with natural punctuation
 *   5. Collapse whitespace artifacts left behind by the above steps
 *
 * The result should read like a plain text message sent from a real person's
 * phone — no symbols, no decorations, no code-editor noise.
 *
 * `stripEmDashes` is kept as a named export so existing callers don't break;
 * it now delegates to the full sanitizer.
 */

// ── Emoji & symbol ranges ──────────────────────────────────────────────────
// Covers Emoticons, Transport/Map, Misc Symbols, Dingbats, Supplemental
// Symbols, CJK/pictographic blocks, and Enclosed Alphanumerics.
const EMOJI_AND_SYMBOLS_RE =
  /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u{2B00}-\u{2BFF}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|\u{200D}/gu;

// ── Typographic replacements (unicode → ASCII) ────────────────────────────
const TYPO_MAP: Array<[RegExp, string]> = [
  // Smart / curly quotes → straight quotes
  [/[\u2018\u2019\u201A\u201B\u{2032}\u{2035}]/gu, "'"],
  [/[\u201C\u201D\u201E\u201F\u{2033}\u{2036}]/gu, '"'],
  // Horizontal ellipsis → three dots
  [/\u2026/g, '...'],
  // Non-breaking and figure spaces → regular space
  [/[\u00A0\u2002-\u200B\u202F\u205F\u3000]/g, ' '],
  // Bullet / list marker → nothing (we'll clean the leftover whitespace)
  [/[•◦‣⁃◆◇■□●○▶▷►▸]+\s*/g, ''],
  // Checkmarks, crosses, stars
  [/[✓✔✗✘★☆✩✪✫✬✭✮✯✰]+/g, ''],
  // Arrow characters
  [/[→←↑↓↔↕⇒⇐⇑⇓⇔⇕➜➞➡➤➨➪➫➬➭➮➯➱]+/g, ''],
  // Superscript ™ ® ©
  [/[™®©℠]/g, ''],
];

// ── Markdown formatting ────────────────────────────────────────────────────
// Strip **bold**, *italic*, __underline__, `code`, ~~strikethrough~~
const MARKDOWN_RE = /(\*{1,2}|_{1,2}|~~|`)([^*_~`]+)\1/g;
// Strip leading "- " or "* " list markers at the start of a line
const LIST_MARKER_RE = /^[\-\*]\s+/gm;

// ── Repeated-text collapse ─────────────────────────────────────────────────

/**
 * Collapse an AI message that came back with its content duplicated.
 *
 * Real-world failure (seen in production): DeepSeek emitted the same SMS body
 * twice inside one `<<sms>>` tag, so the bride received:
 *
 *   "Hey Simon, what's the most surprising part of planning? Just curious.
 *    Hey Simon, what's the most surprising part of planning? Just curious."
 *
 * We collapse two cases, conservatively (only substantial repeats, never short
 * phrases like "Ha ha" or "Yes. Yes."):
 *   1. The ENTIRE message repeated 2+ times, separated only by whitespace /
 *      newlines (exact repeat). Handled by a backreference regex.
 *   2. Consecutive duplicate lines (case-insensitive, whitespace-normalized).
 */
export function dedupeRepeatedText(text: string | null | undefined): string {
  if (!text) return '';
  let out = String(text).trim();

  // Case 1 — whole-message exact repetition (unit must be ≥12 chars so we never
  // collapse short intentional repeats). The unit and each repeat are separated
  // only by whitespace/newlines.
  const wholeRepeat = /^([\s\S]{12,}?)(?:\s+\1)+$/.exec(out);
  if (wholeRepeat) out = wholeRepeat[1].trim();

  // Case 2 — drop consecutive duplicate lines.
  const norm = (l: string) => l.trim().toLowerCase().replace(/\s+/g, ' ');
  const kept: string[] = [];
  for (const line of out.split('\n')) {
    const n = norm(line);
    const prev = kept.length ? norm(kept[kept.length - 1]) : null;
    if (!n || n !== prev) kept.push(line);
  }
  return kept.join('\n').trim();
}

// ── Main export ────────────────────────────────────────────────────────────

export function sanitizeSmsText(text: string | null | undefined): string {
  if (!text) return '';
  let s = String(text);

  // 1. Remove emojis & symbol codepoints
  s = s.replace(EMOJI_AND_SYMBOLS_RE, '');

  // 2. Typographic → ASCII
  for (const [re, rep] of TYPO_MAP) {
    s = s.replace(re, rep);
  }

  // 3. Strip markdown
  s = s.replace(MARKDOWN_RE, '$2');   // unwrap bold/italic
  s = s.replace(LIST_MARKER_RE, '');  // strip bullet prefixes

  // 4. Em/en dash → natural punctuation
  s = s.replace(/\s*[—–]\s+/g, ', ');
  s = s.replace(/\s+[—–]\s*/g, ', ');
  s = s.replace(/[—–]/g, ', ');

  // 5. Cleanup artifacts from all the above replacements
  s = s
    .replace(/,\s*,+/g, ',')       // collapse ",," artifacts
    .replace(/\s+,/g, ',')          // " ," -> ","
    .replace(/,(\s*[.!?])/g, '$1')  // ", ." -> "."
    .replace(/,(\s*$)/g, '')        // trailing comma
    .replace(/[ \t]{2,}/g, ' ')     // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')     // max two consecutive newlines
    .trim();

  // 6. Collapse duplicated message bodies (DeepSeek occasionally repeats the
  // whole SMS inside one tag — see dedupeRepeatedText).
  s = dedupeRepeatedText(s);

  // Capitalize first letter if the replacements lowercased it.
  if (s.length > 0 && /[a-z]/.test(s[0])) {
    s = s[0].toUpperCase() + s.slice(1);
  }

  return s;
}

/** Backward-compat alias — existing callers (`llm.ts`, etc.) continue to work. */
export function stripEmDashes(text: string | null | undefined): string {
  return sanitizeSmsText(text);
}
