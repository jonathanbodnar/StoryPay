/**
 * Post-processing for AI-generated text.
 *
 * - Strips em dashes (U+2014) and en dashes (U+2013) and replaces them with
 *   natural punctuation (commas, periods) so AI output never reads as
 *   AI-generated to the recipient.
 * - Cleans up the spacing artifacts the swap might introduce.
 *
 * Apply this to ANY text that came from a model before showing it to a
 * human or sending it as an outbound message.
 */

export function stripEmDashes(text: string | null | undefined): string {
  if (!text) return '';
  let s = String(text);

  // Replace em/en dashes that are flanked by whitespace with a comma + space.
  // " — " -> ", "
  s = s.replace(/\s*[—–]\s+/g, ', ');
  s = s.replace(/\s+[—–]\s*/g, ', ');

  // Any remaining bare em/en dashes (no surrounding whitespace, e.g. "yes—no")
  // become a comma+space.
  s = s.replace(/[—–]/g, ', ');

  // Cleanup artifacts:
  s = s.replace(/,\s*,+/g, ',')      // collapse runs of commas
       .replace(/\s+,/g, ',')         // " ," -> ","
       .replace(/,(\s*[.!?])/g, '$1') // ", ." -> "."
       .replace(/,(\s*$)/g, '')       // trailing comma
       .replace(/\s{2,}/g, ' ')       // collapse spaces
       .trim();

  // Capitalize the first letter if we accidentally lowercased the start.
  if (s.length > 0 && /[a-z]/.test(s[0])) {
    s = s[0].toUpperCase() + s.slice(1);
  }

  return s;
}
