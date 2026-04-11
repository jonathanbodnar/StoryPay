// Shared query normalisation — strips natural-language prefixes before
// embedding or substring-matching so "how do I create a proposal" and
// "create a proposal" produce the same embedding and hit the same results.

const STRIP_PREFIXES = [
  /^how\s+do\s+i\s+/i,
  /^how\s+do\s+you\s+/i,
  /^how\s+to\s+/i,
  /^how\s+can\s+i\s+/i,
  /^what\s+is\s+/i,
  /^what\s+are\s+/i,
  /^where\s+is\s+/i,
  /^where\s+can\s+i\s+/i,
  /^where\s+do\s+i\s+/i,
  /^can\s+i\s+/i,
  /^i\s+want\s+to\s+/i,
  /^i\s+need\s+to\s+/i,
  /^show\s+me\s+/i,
  /^tell\s+me\s+/i,
  /^help\s+me\s+/i,
  /^explain\s+/i,
];

export function normaliseHelpQuery(raw: string): string {
  let q = raw.trim().toLowerCase();
  for (const re of STRIP_PREFIXES) {
    const stripped = q.replace(re, '').trim();
    if (stripped.length >= 2) { q = stripped; break; }
  }
  return q;
}
