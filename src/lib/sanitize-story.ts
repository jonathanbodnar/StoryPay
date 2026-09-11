import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize the couple's rich-text "story" HTML before storing it. The public
 * page renders this via dangerouslySetInnerHTML, so this is the single trust
 * boundary — only a small allowlist of formatting tags + safe inline styles
 * (alignment, font size, weight) survive. Everything else is discarded.
 */
const MAX_STORY_HTML = 20000;

export function sanitizeStoryHtml(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const input = raw.slice(0, MAX_STORY_HTML);

  const clean = sanitizeHtml(input, {
    allowedTags: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li'],
    allowedAttributes: { '*': ['style'] },
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify)$/],
        // Numeric units + CSS keyword sizes (contentEditable's execCommand emits keywords).
        'font-size': [/^(\d{1,3}(px|pt|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/],
        'font-weight': [/^(bold|bolder|normal|[1-9]00)$/],
        'font-style': [/^(italic|normal)$/],
        'text-decoration': [/^(underline|none)$/],
      },
    },
    disallowedTagsMode: 'discard',
    allowedSchemes: [],
  }).trim();

  // Treat whitespace-only markup as empty.
  const textOnly = clean.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return textOnly.length > 0 ? clean : null;
}

/** Plain-text projection of story HTML, kept in `story` for previews/metadata. */
export function storyHtmlToPlain(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\/(p|div|h1|h2|h3|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
  return text.length > 0 ? text : null;
}
