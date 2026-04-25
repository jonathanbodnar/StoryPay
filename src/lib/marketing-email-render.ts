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
      const presetRadius: Record<string, number> = {
        'filled-rect':       0,  'filled-rounded':    4,  'filled-rounded-lg':    10,  'filled-pill':    999,
        'outline-rect':      0,  'outline-rounded':   4,  'outline-rounded-lg':   10,  'outline-pill':   999,
      };
      const styleId = block.buttonStyle ?? 'outline-rect';
      const isFilled = styleId.startsWith('filled');
      const radius = presetRadius[styleId] ?? 4;
      const bg = block.buttonBgColor ?? (isFilled ? '#000000' : 'transparent');
      const fg = block.color ?? (isFilled ? '#ffffff' : '#000000');
      const borderW = block.buttonBorderWidth ?? (isFilled ? 0 : 2);
      const borderColor = block.buttonBorderColor ?? '#000000';
      const padX = block.buttonWidth ?? 30;
      const padY = block.buttonHeight ?? 15;
      const ff = block.fontFamily ?? theme.fontFamily;
      const fw = block.fontWeight ?? '400';
      const fs = block.fontSize ?? '14px';
      const ls = block.letterSpacing ?? 1.8;
      const tt = (block.textTransform && block.textTransform !== 'none') ? `text-transform:${block.textTransform};` : '';
      const blockBg = block.blockBgColor && block.blockBgColor !== 'transparent' ? `background:${block.blockBgColor};` : '';
      const padTop = block.paddingTop ?? 16;
      const padBot = block.paddingBottom ?? 16;
      const padLeft = block.paddingLeft ?? 24;
      const padRight = block.paddingRight ?? 24;

      return `<tr><td style="padding:${padTop}px ${padRight}px ${padBot}px ${padLeft}px;${align};${blockBg}"><a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:${bg};color:${fg};border:${borderW}px solid ${borderColor};padding:${padY}px ${padX}px;border-radius:${radius}px;text-decoration:none;font-weight:${fw};font-size:${fs};line-height:${block.lineHeight ?? 1};letter-spacing:${ls}px;${tt}font-family:${ff};">${lab}</a></td></tr>`;
    }
    case 'image': {
      if (!block.src?.trim()) {
        return `<tr><td style="padding:8px 24px;${align};color:${theme.mutedColor};font-size:13px;">[Image — add URL in editor]</td></tr>`;
      }
      const src = esc(block.src.trim());
      const alt = esc(block.alt || '');
      const linkHref = block.href?.trim() ? esc(block.href.trim()) : '';
      const img = `<img src="${src}" alt="${alt}" width="552" style="max-width:100%;height:auto;border-radius:8px;display:inline-block;border:0;" />`;
      const inner = linkHref
        ? `<a href="${linkHref}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block;">${img}</a>`
        : img;
      return `<tr><td style="padding:8px 24px;${align};">${inner}</td></tr>`;
    }
    case 'video': {
      const href = block.href?.trim() ? esc(block.href.trim()) : '';
      const src = block.src?.trim() ? esc(block.src.trim()) : '';
      const caption = (block.content || '').trim();
      const thumbInner = src
        ? `<img src="${src}" alt="Watch video" width="552" style="max-width:100%;height:auto;display:block;border:0;" />`
        : `<div style="height:200px;background:#18181b;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-family:${theme.fontFamily};font-size:13px;">[Video — add URL and thumbnail]</div>`;
      const playBtn = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"><tr><td style="width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,0.92);box-shadow:0 4px 12px rgba(0,0,0,0.3);text-align:center;vertical-align:middle;font-size:24px;color:#18181b;line-height:58px;">▶</td></tr></table>`;
      const wrapper = `<div style="position:relative;border-radius:10px;overflow:hidden;background:#18181b;">${thumbInner}${src ? playBtn : ''}</div>`;
      const linked = href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block;">${wrapper}</a>`
        : wrapper;
      const cap = caption
        ? `<p style="margin:10px 0 0;font-size:13px;color:${theme.mutedColor};text-align:center;font-family:${theme.fontFamily};">${esc(caption)}</p>`
        : '';
      return `<tr><td style="padding:16px 24px;${align};">${linked}${cap}</td></tr>`;
    }
    case 'social': {
      const links = (block.socialLinks ?? []).filter((l) => l.url?.trim());
      if (links.length === 0) {
        return `<tr><td style="padding:20px 24px;text-align:center;color:${theme.mutedColor};font-size:13px;font-family:${theme.fontFamily};">[Add social links in editor]</td></tr>`;
      }
      const labelFor = (p: string) => {
        const k = p.toLowerCase();
        if (k.includes('instagram')) return 'Instagram';
        if (k.includes('facebook')) return 'Facebook';
        if (k.includes('twitter') || k === 'x') return 'X';
        if (k.includes('tiktok')) return 'TikTok';
        if (k.includes('youtube')) return 'YouTube';
        if (k.includes('linkedin')) return 'LinkedIn';
        if (k.includes('pinterest')) return 'Pinterest';
        if (k.includes('threads')) return 'Threads';
        return p.charAt(0).toUpperCase() + p.slice(1);
      };
      const items = links
        .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:6px 12px;margin:0 4px;border-radius:999px;border:1px solid ${theme.mutedColor};color:${theme.textColor};font-size:12px;font-family:${theme.fontFamily};text-decoration:none;">${esc(labelFor(l.platform))}</a>`)
        .join('');
      return `<tr><td style="padding:20px 24px;text-align:center;">${items}</td></tr>`;
    }
    case 'address': {
      // Filled at runtime via mergeMarketingFields — vars contain venue_name, venue_full_address, etc.
      return `<tr><td style="padding:16px 24px;text-align:center;font-family:${theme.fontFamily};">
  <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:${theme.textColor};">{{venue_name}}</p>
  <p style="margin:0;font-size:12px;color:${theme.mutedColor};">{{venue_full_address}}</p>
</td></tr>`;
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
    <p style="margin:0;"><a href="{{unsubscribe_url}}" style="color:${theme.mutedColor};">Unsubscribe</a>
    · <a href="{{resubscribe_url}}" style="color:${theme.mutedColor};">Subscribe again</a></p>
  </td></tr>`;
  const raw = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${theme.pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${theme.maxWidth};background:${theme.cardBg};border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);">
        ${inner}${footer}
      </table>
    </td></tr>
  </table>
</body></html>`;
  return mergeMarketingFields(raw, vars);
}
