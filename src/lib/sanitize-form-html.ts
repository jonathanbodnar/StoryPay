import DOMPurify from 'isomorphic-dompurify';

/** Safe subset for rich text + custom HTML blocks inside embedded forms. */
export function sanitizeFormHtml(dirty: string | undefined | null): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'style', 'class'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|sms|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
