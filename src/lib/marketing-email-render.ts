import { sanitizeFormHtml } from '@/lib/sanitize-form-html';
import {
  type EmailBlock,
  type MarketingEmailDefinition,
  mergeEmailTheme,
} from '@/lib/marketing-email-schema';
import { parseVideoUrl } from '@/lib/video-providers';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline-SVG paths for social icons. Kept in lockstep with the SocialIcon
// component in CampaignFlodeskBuilder so editor, preview, and sent emails
// render identically. The SVG ships with `vertical-align:middle` so it
// lines up cleanly inside the chip wrapper (which uses line-height = chip
// height to vertically center its content — works in every email client).
function socialIconSvg(platform: string, size: number, color: string): string {
  const c = esc(color);
  const wrap = (inner: string, opts?: { fill?: boolean }) => {
    const fillAttr = opts?.fill === false ? 'fill="none"' : `fill="${c}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ${fillAttr} style="display:inline-block;vertical-align:middle;">${inner}</svg>`;
  };
  switch (platform) {
    case 'facebook':
      // Solid Facebook "f" inside a square — fills the glyph cleanly so it
      // reads at small sizes and contrasts well against filled chips.
      return wrap('<path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.464.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.764v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z"/>');
    case 'twitter':
      return wrap('<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>');
    case 'instagram':
      // Slightly thicker strokes so the camera body + lens stay visible at
      // 14–20px sizes (thin 2-unit strokes get washed out below 16px).
      return wrap(
        `<rect x="2" y="2" width="20" height="20" rx="5" ry="5" stroke="${c}" stroke-width="2.4" fill="none"/>` +
        `<circle cx="12" cy="12" r="4.5" stroke="${c}" stroke-width="2.4" fill="none"/>` +
        `<circle cx="17.5" cy="6.5" r="1.1" fill="${c}"/>`,
        { fill: false },
      );
    case 'tiktok':
      return wrap('<path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.83a8.18 8.18 0 0 0 4.77 1.53V6.92a4.85 4.85 0 0 1-1-.23z"/>');
    case 'pinterest':
      return wrap('<path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>');
    case 'linkedin':
      return wrap('<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>');
    case 'youtube':
      return wrap('<path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>');
    case 'threads':
      return wrap('<path d="M17.65 11.13c-.07-.04-.16-.07-.24-.1-.13-2.43-1.46-3.83-3.69-3.84a3.9 3.9 0 0 0-3.27 1.66l1.21.82a2.45 2.45 0 0 1 2.05-1.05c.95 0 1.66.32 2.06.92.27.42.43.96.5 1.59-.6-.1-1.24-.13-1.92-.09-1.94.11-3.18 1.24-3.1 2.81.04.79.43 1.47 1.11 1.91a3.4 3.4 0 0 0 1.96.5c.91-.05 1.62-.4 2.13-1.03.38-.49.62-1.12.74-1.92.49.3.85.69 1.05 1.16.34.81.36 2.13-.72 3.21-.95.95-2.09 1.36-3.81 1.37-1.91-.02-3.36-.63-4.31-1.83-.89-1.13-1.36-2.75-1.37-4.83.02-2.07.48-3.7 1.37-4.83.95-1.2 2.4-1.81 4.31-1.83 1.93.01 3.39.63 4.34 1.83.47.6.82 1.34 1.04 2.21l1.41-.39a8.46 8.46 0 0 0-1.31-2.71C19.06 3.34 17.16 2.51 14.79 2.5h-.01c-2.36.02-4.22.85-5.55 2.5C8.04 6.46 7.43 8.5 7.4 11l0 .01 0 .01c.03 2.5.64 4.54 1.83 6 1.33 1.65 3.19 2.49 5.55 2.51h.01c2.1-.01 3.58-.57 4.81-1.79 1.6-1.6 1.55-3.6.74-4.83-.36-.55-.86-1.02-1.5-1.36zm-3.83 3.06c-.62.04-1.27-.24-1.31-.97-.03-.55.39-1.16 1.69-1.23.15-.01.3-.01.44-.01.46 0 .89.04 1.28.13-.15 1.81-1.01 2.04-2.1 2.08z"/>');
    case 'website':
      return wrap(
        `<circle cx="12" cy="12" r="9.5" stroke="${c}" stroke-width="2.2" fill="none"/>` +
        `<line x1="2.5" y1="12" x2="21.5" y2="12" stroke="${c}" stroke-width="2.2"/>` +
        `<path d="M12 2.5a14 14 0 0 1 3.8 9.5 14 14 0 0 1-3.8 9.5 14 14 0 0 1-3.8-9.5 14 14 0 0 1 3.8-9.5z" stroke="${c}" stroke-width="2.2" fill="none"/>`,
        { fill: false },
      );
    default:
      return '';
  }
}

function isDarkColor(hex: string): boolean {
  const m = hex.replace('#', '');
  if (m.length !== 6) return true;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma < 0.55;
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
      // Render as a 16:9 YouTube-style preview (clickable thumbnail) that
      // opens the original video URL in a new tab. We never embed an iframe
      // — most email clients strip them — and we never accept video uploads.
      const parsed = parseVideoUrl(block.href);
      const watchUrl = parsed?.watchUrl ?? (block.href?.trim() ?? '');
      const userThumb = block.src?.trim();
      const thumbnail = userThumb || parsed?.thumbnail || '';
      const title = (block.content || '').trim();
      const showTitle = block.videoShowTitle !== false;

      // 16:9 within a 600px max-width content column (552 inner accounts for
      // default 24px padding). 552 * 9 / 16 = 310.5 → 310.
      const VIDEO_W = 552;
      const VIDEO_H = 310;

      // Overlay opacity 0–100 — applied to the thumbnail itself for max
      // email-client compatibility. Higher opacity = darker overlay → we
      // dim the image proportionally. Opacity is widely supported across
      // modern clients (Gmail, Apple Mail, Outlook 365, iOS, Android).
      const overlayOp = Math.max(0, Math.min(100, block.videoOverlayOpacity ?? 0)) / 100;
      const imgOpacity = 1 - overlayOp * 0.85;
      const imgOpacityCss = imgOpacity < 1 ? `opacity:${imgOpacity.toFixed(2)};` : '';

      // YouTube-style red play button using a rounded rectangle table cell.
      const playBtn = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="position:absolute;top:50%;left:50%;margin-top:-24px;margin-left:-34px;border-collapse:separate;"><tr><td style="width:68px;height:48px;border-radius:14px;background:rgba(33,33,33,0.85);text-align:center;vertical-align:middle;font-size:20px;color:#ffffff;line-height:48px;font-family:Arial,sans-serif;">&#9654;</td></tr></table>`;

      const thumbInner = thumbnail
        ? `<img src="${esc(thumbnail)}" alt="${esc(parsed?.label ? parsed.label + ' video' : 'Video')}" width="${VIDEO_W}" height="${VIDEO_H}" style="max-width:100%;width:100%;height:auto;display:block;border:0;${imgOpacityCss}" />`
        : `<div style="width:100%;padding-top:56.25%;background:#0f0f0f;"></div>`;

      // Wrapper with relative positioning so the play button can sit on top.
      const wrapper = `<div style="position:relative;width:100%;max-width:${VIDEO_W}px;margin:0 auto;border-radius:10px;overflow:hidden;background:#0f0f0f;">${thumbInner}${playBtn}</div>`;

      const linked = watchUrl
        ? `<a href="${esc(watchUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block;color:inherit;">${wrapper}</a>`
        : wrapper;

      // Title color follows the block bg (white over dark, theme color over light).
      let titleColor = theme.textColor;
      if (block.blockBgColor && block.blockBgColor !== 'transparent') {
        const m = /^#?([0-9a-fA-F]{6})$/.exec(block.blockBgColor);
        if (m) {
          const v = parseInt(m[1], 16);
          const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
          if (lum < 0.5) titleColor = '#ffffff';
        }
      }

      const titleHtml = showTitle && title
        ? `<p style="margin:14px 0 0;font-size:15px;color:${titleColor};text-align:center;font-family:${theme.fontFamily};line-height:1.4;">${esc(title)}</p>`
        : '';

      return `<tr><td style="${box}${align};">${linked}${titleHtml}</td></tr>`;
    }
    case 'social': {
      // The block's `socialLinks` are populated at render time from
      // venues.brand_socials (see marketing-email-injection). If the venue
      // hasn't configured any links, we hide the block entirely so recipients
      // never see a placeholder.
      const links = (block.socialLinks ?? []).filter((l) => l.url?.trim());
      if (links.length === 0) {
        return '';
      }
      const styleKind = block.socialIconStyle ?? 'outline';
      const sizeKey = block.socialIconSize ?? 'md';
      const spacing = Math.max(0, Math.min(40, block.socialIconSpacing ?? 10));
      const color = block.color ?? theme.textColor;
      const aAlign = block.align === 'left' ? 'left' : block.align === 'right' ? 'right' : 'center';

      // Inner glyph fills ~62–66% of the chip diameter. The "outline" style
      // (no chip background) gets a slightly larger glyph since there's no
      // chip border eating into the visible area.
      const sizeMap = {
        sm: { outer: 28, withChip: 18, noChip: 22 },
        md: { outer: 36, withChip: 22, noChip: 28 },
        lg: { outer: 48, withChip: 30, noChip: 38 },
      } as const;
      const dims = sizeMap[sizeKey];
      const outer = dims.outer;
      const inner = styleKind === 'outline' ? dims.noChip : dims.withChip;

      const halfGap = Math.round(spacing / 2);
      // Each icon is a single <a> styled as a centered chip. Using
      // line-height = chip height + vertical-align:middle on the SVG centers
      // the glyph reliably across Gmail/Apple Mail/Outlook web/iOS.
      const cells = links.map((l) => {
        let chipStyle = `display:inline-block;width:${outer}px;height:${outer}px;line-height:${outer}px;text-align:center;text-decoration:none;mso-line-height-rule:exactly;box-sizing:border-box;`;
        let glyphColor = color;
        if (styleKind === 'filled-circle') {
          chipStyle += `background:${color};border-radius:${outer}px;`;
          glyphColor = isDarkColor(color) ? '#ffffff' : '#000000';
        } else if (styleKind === 'circle-outline') {
          chipStyle += `border:1.5px solid ${color};border-radius:${outer}px;`;
        }
        const svg = socialIconSvg(l.platform, inner, glyphColor);
        return `<td style="padding:0 ${halfGap}px;line-height:0;font-size:0;mso-line-height-rule:exactly;"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" style="${chipStyle}">${svg}</a></td>`;
      }).join('');

      const inner2 = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${aAlign}" style="border-collapse:collapse;"><tr>${cells}</tr></table>`;
      return `<tr><td style="${box}text-align:${aAlign};">${inner2}</td></tr>`;
    }
    case 'address': {
      // Filled at runtime via mergeMarketingFields — vars contain venue_name, venue_full_address, etc.
      const ff = block.fontFamily ?? theme.fontFamily;
      const fw = block.fontWeight ?? '400';
      const fs = block.fontSize ?? '12px';
      const color = block.color ?? theme.mutedColor;
      const lh = block.lineHeight ?? 1.6;
      const ls = block.letterSpacing ?? 0;
      const tt = block.textTransform && block.textTransform !== 'none' ? `text-transform:${block.textTransform};` : '';
      const aAlign = block.align === 'left' ? 'left' : block.align === 'right' ? 'right' : 'center';
      return `<tr><td style="${box}text-align:${aAlign};font-family:${ff};">
  <p style="margin:0 0 3px;font-size:${fs};font-weight:600;color:${color};line-height:${lh};letter-spacing:${ls}px;${tt}">{{venue_name}}</p>
  <p style="margin:0;font-size:${fs};font-weight:${fw};color:${color};line-height:${lh};letter-spacing:${ls}px;${tt}">{{venue_full_address}}</p>
</td></tr>`;
    }
    case 'divider': {
      const dStyle = (block.dividerStyle ?? 'solid') as 'solid' | 'dashed' | 'dotted';
      const dColor = block.dividerColor ?? '#D7D7D7';
      const dThick = Math.max(1, Math.min(20, block.dividerThickness ?? 1));
      const dWidth = Math.max(20, Math.min(600, block.dividerWidth ?? 300));
      const dAlign = block.align === 'left' ? 'left' : block.align === 'right' ? 'right' : 'center';
      const inner = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${dAlign}" style="border-collapse:collapse;width:${dWidth}px;max-width:100%;"><tr><td style="font-size:0;line-height:0;border-top:${dThick}px ${dStyle} ${dColor};">&nbsp;</td></tr></table>`;
      return `<tr><td style="${box}text-align:${dAlign};">${inner}</td></tr>`;
    }
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
  // Compliance footer — venue identity + one-click unsubscribe + preference center.
  // Always rendered. NOT user-editable, by design (CAN-SPAM / GDPR requirement).
  const footer = `<tr><td style="padding:28px 24px;font-size:11px;color:${theme.mutedColor};text-align:center;font-family:sans-serif;line-height:1.6;">
    <p style="margin:0 0 6px;font-weight:600;color:${theme.textColor};">{{venue_name}}</p>
    <p style="margin:0;">
      <a href="{{unsubscribe_url}}" style="color:${theme.mutedColor};text-decoration:underline;">Unsubscribe</a>
      &nbsp;·&nbsp;
      <a href="{{preferences_url}}" style="color:${theme.mutedColor};text-decoration:underline;">Manage preferences</a>
    </p>
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
