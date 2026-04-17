import { sanitizeFormHtml } from '@/lib/sanitize-form-html';
import {
  type EmailBlock,
  type MarketingEmailDefinition,
  mergeEmailTheme,
} from '@/lib/marketing-email-schema';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type MergeFieldRecord = Record<string, string>;

export function mergeMarketingFields(template: string, vars: MergeFieldRecord): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'gi');
    out = out.replace(re, v);
  }
  return out;
}

function alignStyle(a: EmailBlock['align']): string {
  const x = a ?? 'left';
  if (x === 'center') return 'text-align:center';
  if (x === 'right') return 'text-align:right';
  return 'text-align:left';
}

function renderBlock(block: EmailBlock, theme: ReturnType<typeof mergeEmailTheme>): string {
  const align = alignStyle(block.align);
  switch (block.type) {
    case 'heading': {
      const L = Math.min(3, Math.max(1, block.level ?? 2));
      const sizes = ['28px', '22px', '18px'];
      const size = sizes[L - 1];
      const text = esc((block.content || '').replace(/<[^>]+>/g, '').trim() || ' ');
      return `<tr><td style="padding:8px 24px;${align};font-family:${theme.fontFamily};font-size:${size};font-weight:600;color:${theme.textColor};line-height:1.25;">${text}</td></tr>`;
    }
    case 'text': {
      const html = sanitizeFormHtml(block.content || '');
      return `<tr><td style="padding:8px 24px;${align};font-family:${theme.fontFamily};font-size:16px;line-height:1.6;color:${theme.textColor};">${html || '<p></p>'}</td></tr>`;
    }
    case 'button': {
      const href = esc(block.href?.trim() || '#');
      const lab = esc(block.buttonLabel?.trim() || 'Button');
      const bg = theme.buttonBg;
      const fg = theme.buttonText;
      return `<tr><td style="padding:16px 24px;${align};"><a href="${href}" style="display:inline-block;background:${bg};color:${fg};padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;font-family:sans-serif;">${lab}</a></td></tr>`;
    }
    case 'image': {
      if (!block.src?.trim()) {
        return `<tr><td style="padding:8px 24px;${align};color:${theme.mutedColor};font-size:13px;">[Image — add URL in editor]</td></tr>`;
      }
      const src = esc(block.src.trim());
      const alt = esc(block.alt || '');
      return `<tr><td style="padding:8px 24px;${align};"><img src="${src}" alt="${alt}" width="552" style="max-width:100%;height:auto;border-radius:8px;display:inline-block;" /></td></tr>`;
    }
    case 'divider':
      return `<tr><td style="padding:12px 24px;"><hr style="border:none;border-top:1px solid #e4e4e7;margin:0;" /></td></tr>`;
    case 'spacer': {
      const h = Math.min(120, Math.max(4, block.spacerHeight ?? 16));
      return `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    }
    case 'html':
      return `<tr><td style="padding:8px 24px;${align};font-family:${theme.fontFamily};font-size:15px;color:${theme.textColor};">${sanitizeFormHtml(block.content || '')}</td></tr>`;
    case 'columns': {
      const left = (block.left ?? []).map((b) => renderBlock(b, theme)).join('');
      const right = (block.right ?? []).map((b) => renderBlock(b, theme)).join('');
      return `<tr><td style="padding:8px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="50%" valign="top" style="padding:8px;">${left || '<table width="100%"><tr><td>&nbsp;</td></tr></table>'}</td>
        <td width="50%" valign="top" style="padding:8px;">${right || '<table width="100%"><tr><td>&nbsp;</td></tr></table>'}</td>
      </tr></table></td></tr>`;
    }
    default:
      return '';
  }
}

export function renderMarketingEmailHtml(
  definition: MarketingEmailDefinition,
  vars: MergeFieldRecord,
): string {
  const theme = mergeEmailTheme(definition.theme);
  const inner = definition.blocks.map((b) => renderBlock(b, theme)).join('');
  const footer = `<tr><td style="padding:24px;font-size:11px;color:${theme.mutedColor};text-align:center;font-family:sans-serif;">
    <p style="margin:0 0 8px;">You received this because you are in our contacts at {{venue_name}}.</p>
    <p style="margin:0;"><a href="{{unsubscribe_url}}" style="color:${theme.mutedColor};">Unsubscribe</a></p>
  </td></tr>`;
  const raw = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${theme.pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${theme.maxWidth};background:${theme.cardBg};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        ${inner}${footer}
      </table>
    </td></tr>
  </table>
</body></html>`;
  return mergeMarketingFields(raw, vars);
}
