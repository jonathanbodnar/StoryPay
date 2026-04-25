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

// Per-block default padding (kept in sync with the editor's BLOCK_PADDING_DEFAULTS).
const BLOCK_PADDING_DEFAULTS: Record<string, { top: number; bottom: number; left: number; right: number }> = {
  heading: { top: 8, bottom: 8, left: 24, right: 24 },
  text:    { top: 8, bottom: 8, left: 24, right: 24 },
  button:  { top: 10, bottom: 10, left: 0, right: 0 },
  image:   { top: 8, bottom: 8, left: 24, right: 24 },
  video:   { top: 16, bottom: 16, left: 24, right: 24 },
  social:  { top: 20, bottom: 20, left: 24, right: 24 },
  address: { top: 16, bottom: 16, left: 24, right: 24 },
  divider: { top: 12, bottom: 12, left: 24, right: 24 },
  spacer:  { top: 0,  bottom: 0,  left: 0,  right: 0  },
  html:    { top: 8, bottom: 8, left: 24, right: 24 },
  columns: { top: 8, bottom: 8, left: 16, right: 16 },
};

/** Returns "padding:Tpx Rpx Bpx Lpx;background:...;" for a block <td>. */
function blockBoxStyle(block: EmailBlock): string {
  const d = BLOCK_PADDING_DEFAULTS[block.type] ?? { top: 8, bottom: 8, left: 24, right: 24 };
  const t = block.paddingTop ?? d.top;
  const b = block.paddingBottom ?? d.bottom;
  const l = block.paddingLeft ?? d.left;
  const r = block.paddingRight ?? d.right;
  const bg = block.blockBgColor && block.blockBgColor !== 'transparent' ? `background:${block.blockBgColor};` : '';
  return `padding:${t}px ${r}px ${b}px ${l}px;${bg}`;
}

function renderBlock(block: EmailBlock, theme: ReturnType<typeof mergeEmailTheme>): string {
  const align = alignStyle(block.align);
  const box = blockBoxStyle(block);
  switch (block.type) {
    case 'heading': {
      const L = Math.min(3, Math.max(1, block.level ?? 2));
      const sizes = ['28px', '22px', '18px'];
      const size = block.fontSize ?? sizes[L - 1];
      const ff = block.fontFamily ?? theme.fontFamily;
      const fw = block.fontWeight ?? 600;
      const color = block.color ?? theme.textColor;
      const lh = block.lineHeight ?? 1.25;
      const ls = block.letterSpacing != null ? `letter-spacing:${block.letterSpacing}px;` : '';
      const tt = (block.textTransform && block.textTransform !== 'none') ? `text-transform:${block.textTransform};` : '';
      const text = esc((block.content || '').replace(/<[^>]+>/g, '').trim() || ' ');
      return `<tr><td style="${box}${align};font-family:${ff};font-size:${size};font-weight:${fw};color:${color};line-height:${lh};${ls}${tt}">${text}</td></tr>`;
    }
    case 'text': {
      const html = sanitizeFormHtml(block.content || '');
      const ff = block.fontFamily ?? theme.fontFamily;
      const fs = block.fontSize ?? '16px';
      const fw = block.fontWeight ?? 400;
      const color = block.color ?? theme.textColor;
      const lh = block.lineHeight ?? 1.6;
      const ls = block.letterSpacing != null ? `letter-spacing:${block.letterSpacing}px;` : '';
      const tt = (block.textTransform && block.textTransform !== 'none') ? `text-transform:${block.textTransform};` : '';
      return `<tr><td style="${box}${align};font-family:${ff};font-size:${fs};font-weight:${fw};line-height:${lh};color:${color};${ls}${tt}">${html || '<p></p>'}</td></tr>`;
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

      return `<tr><td style="${box}${align};"><a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:${bg};color:${fg};border:${borderW}px solid ${borderColor};padding:${padY}px ${padX}px;border-radius:${radius}px;text-decoration:none;font-weight:${fw};font-size:${fs};line-height:${block.lineHeight ?? 1};letter-spacing:${ls}px;${tt}font-family:${ff};">${lab}</a></td></tr>`;
    }
    case 'image': {
      const cols = Math.max(1, Math.min(4, block.imageGridColumns ?? 1));
      const slots: { src: string; alt: string }[] = [
        { src: (block.src ?? '').trim(), alt: block.alt ?? '' },
        ...((block.imageGridImages ?? []).map(g => ({ src: (g.src ?? '').trim(), alt: g.alt ?? '' }))),
      ];
      const totalCount = Math.max(slots.length, cols);
      // Pad to a multiple of cols so the table is rectangular.
      while (slots.length < totalCount) slots.push({ src: '', alt: '' });
      while (slots.length % cols !== 0) slots.push({ src: '', alt: '' });

      const linkHref = block.href?.trim() ? esc(block.href.trim()) : '';
      const totalWidth = Math.max(50, Math.min(600, block.imageWidth ?? 600));
      const gap = Math.max(0, Math.min(64, block.imageGridGap ?? 16));
      const colWidth = cols > 1
        ? Math.floor((totalWidth - gap * (cols - 1)) / cols)
        : totalWidth;
      const totalRows = Math.ceil(slots.length / cols);

      // Single-image fast path keeps existing email-client compatibility.
      if (cols === 1 && slots.length === 1) {
        if (!slots[0].src) {
          return `<tr><td style="${box}${align};color:${theme.mutedColor};font-size:13px;">[Image — add URL in editor]</td></tr>`;
        }
        const src = esc(slots[0].src);
        const alt = esc(slots[0].alt);
        const img = `<img src="${src}" alt="${alt}" width="${totalWidth}" style="max-width:100%;width:100%;height:auto;border-radius:8px;display:block;border:0;" />`;
        const inner = linkHref
          ? `<a href="${linkHref}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block;">${img}</a>`
          : img;
        return `<tr><td style="${box}${align};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;max-width:${totalWidth}px;width:100%;"><tr><td>${inner}</td></tr></table></td></tr>`;
      }

      // Grid path: build a real <table> with rows of `cols` cells.
      // Even gutters: padding-left between columns, padding-bottom between rows
      // (skipped on the last row so total height stays tight).
      const rows: string[] = [];
      for (let r = 0; r < slots.length; r += cols) {
        const rowIdx = r / cols;
        const isLastRow = rowIdx === totalRows - 1;
        const cells: string[] = [];
        for (let c = 0; c < cols; c++) {
          const slot = slots[r + c] ?? { src: '', alt: '' };
          const left = c === 0 ? 0 : gap;
          const bottom = isLastRow ? 0 : gap;
          const cellStyle = `padding-left:${left}px;padding-bottom:${bottom}px;width:${colWidth}px;vertical-align:top;`;
          if (slot.src) {
            const src = esc(slot.src);
            const alt = esc(slot.alt);
            const img = `<img src="${src}" alt="${alt}" width="${colWidth}" style="display:block;width:100%;max-width:${colWidth}px;height:auto;border-radius:6px;border:0;${cols > 1 ? 'aspect-ratio:1/1;object-fit:cover;' : ''}" />`;
            const inner = linkHref
              ? `<a href="${linkHref}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block;">${img}</a>`
              : img;
            cells.push(`<td style="${cellStyle}">${inner}</td>`);
          } else {
            cells.push(`<td style="${cellStyle}">&nbsp;</td>`);
          }
        }
        rows.push(`<tr>${cells.join('')}</tr>`);
      }
      const tableAlign = block.align === 'left' ? 'left' : block.align === 'right' ? 'right' : 'center';
      return `<tr><td style="${box}${align};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${tableAlign}" style="border-collapse:separate;border-spacing:0;max-width:${totalWidth}px;width:100%;margin:0 auto;">${rows.join('')}</table></td></tr>`;
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
      return `<tr><td style="${box}${align};">${linked}${cap}</td></tr>`;
    }
    case 'social': {
      const links = (block.socialLinks ?? []).filter((l) => l.url?.trim());
      if (links.length === 0) {
        return `<tr><td style="${box}text-align:center;color:${theme.mutedColor};font-size:13px;font-family:${theme.fontFamily};">[Add social links in editor]</td></tr>`;
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
      return `<tr><td style="${box}text-align:center;">${items}</td></tr>`;
    }
    case 'address': {
      // Filled at runtime via mergeMarketingFields — vars contain venue_name, venue_full_address, etc.
      return `<tr><td style="${box}text-align:center;font-family:${theme.fontFamily};">
  <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:${theme.textColor};">{{venue_name}}</p>
  <p style="margin:0;font-size:12px;color:${theme.mutedColor};">{{venue_full_address}}</p>
</td></tr>`;
    }
    case 'divider':
      return `<tr><td style="${box}"><hr style="border:none;border-top:1px solid #e4e4e7;margin:0;" /></td></tr>`;
    case 'spacer': {
      const h = Math.min(120, Math.max(4, block.spacerHeight ?? 16));
      const bgPart = block.blockBgColor && block.blockBgColor !== 'transparent' ? `background:${block.blockBgColor};` : '';
      return `<tr><td style="height:${h}px;font-size:0;line-height:0;${bgPart}">&nbsp;</td></tr>`;
    }
    case 'html':
      return `<tr><td style="${box}${align};font-family:${theme.fontFamily};font-size:15px;color:${theme.textColor};">${sanitizeFormHtml(block.content || '')}</td></tr>`;
    case 'columns': {
      const left = (block.left ?? []).map((b) => renderBlock(b, theme)).join('');
      const right = (block.right ?? []).map((b) => renderBlock(b, theme)).join('');
      return `<tr><td style="${box}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
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
