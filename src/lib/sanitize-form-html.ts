import DOMPurify from 'isomorphic-dompurify';

/** Safe subset for rich text + custom HTML blocks inside embedded forms.
 *  Iframes (e.g. Loom / YouTube embeds) are explicitly allowed since form
 *  blocks are authored by authenticated venue owners, not end-users. */
export function sanitizeFormHtml(dirty: string | undefined | null): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['iframe'],
    ADD_ATTR: [
      'target',
      'rel',
      'style',
      'class',
      // iframe attrs
      'src',
      'frameborder',
      'allowfullscreen',
      'webkitallowfullscreen',
      'mozallowfullscreen',
      'allow',
      'loading',
      'referrerpolicy',
    ],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|sms|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
