import { sanitizeFormHtml } from '@/lib/sanitize-form-html';
import {
  type EmailBlock,
  type MarketingEmailDefinition,
  mergeEmailTheme,
} from '@/lib/marketing-email-schema';
import { parseVideoUrl } from '@/lib/video-providers';
import { renderMergeVars } from '@/lib/merge-variables';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline-SVG paths for social icons — Flodesk-style minimalist glyphs:
// filled letterforms (f, in, P, d, X) for letter glyphs, stroked outlines
// (Instagram camera, Globe, YouTube) with small filled accents for shape
// glyphs. Paths are kept in lockstep with the `SocialIcon` component in
// `CampaignFlodeskBuilder.tsx` so editor / preview / inbox match 1:1.
// SVG ships with `vertical-align:middle` so it lines up cleanly inside the
// chip wrapper (which uses line-height = chip height to vertically center —
// works in every email client we test).
function socialIconSvg(platform: string, size: number, color: string): string {
  const c = esc(color);
  const wrap = (inner: string, opts?: { fill?: boolean }) => {
    const fillAttr = opts?.fill === false ? 'fill="none"' : `fill="${c}"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ${fillAttr} style="display:inline-block;vertical-align:middle;">${inner}</svg>`;
  };
  switch (platform) {
    // Lowercase "f" letterform with hooked top + crossbar.
    case 'facebook':
      return wrap('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>');

    // Modern "X" (Twitter rebrand) — angular thick X.
    case 'twitter':
      return wrap('<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>');

    // Camera silhouette: rounded square + lens circle + viewfinder dot.
    case 'instagram':
      return wrap(
        `<rect x="3" y="3" width="18" height="18" rx="5" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
        `<circle cx="12" cy="12" r="4" stroke="${c}" stroke-width="2" fill="none"/>` +
        `<circle cx="17.5" cy="6.5" r="1.1" fill="${c}"/>`,
        { fill: false },
      );

    // "d" with a small flag — TikTok mark, simplified to a single solid silhouette.
    case 'tiktok':
      return wrap('<path d="M14 2h2.6c.2 1.2.8 2.3 1.7 3.1.9.8 2 1.3 3.2 1.4v3a8 8 0 0 1-4.5-1.5v6.4c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6c.4 0 .7 0 1 .1v3.1c-.3-.1-.6-.1-1-.1a2.9 2.9 0 1 0 2.9 2.9V2z"/>');

    // Pinterest "P" — canonical Pinterest brand mark (bowl + stem with curl
    // at the base). Native path is in a 384×512 viewBox; the inner <g>
    // scale+translate squashes it to ~14×18 inside the 24×24 viewBox so it
    // matches the visual weight of the other social glyphs.
    case 'pinterest':
      return wrap('<g transform="translate(5, 3) scale(0.0352)"><path d="M204 6.5C101.4 6.5 0 74.9 0 185.6 0 256 39.6 296 63.6 296c9.9 0 15.6-27.6 15.6-35.4 0-9.3-23.7-29.1-23.7-67.8 0-80.4 61.2-137.4 140.4-137.4 68.1 0 118.5 38.7 118.5 109.8 0 53.1-21.3 152.7-90.3 152.7-24.9 0-46.2-18-46.2-43.8 0-37.8 26.4-74.4 26.4-113.4 0-66.2-93.9-54.2-93.9 25.8 0 16.8 2.1 35.4 9.6 50.7-13.8 59.4-42 147.9-42 209.1 0 18.9 2.7 37.5 4.5 56.4 3.4 3.8 1.7 3.4 6.9 1.5 50.4-69 48.6-82.5 71.4-172.8 12.3 23.4 44.1 36 69.3 36 106.2 0 153.9-103.5 153.9-196.8C384 71.3 298.2 6.5 204 6.5z"/></g>');

    // Canonical LinkedIn "in" brand mark — bold lowercase "in" with rounded
    // i-dot. Native path is in a 448×512 viewBox; the inner <g> scale +
    // translate squashes it to ~16×18 inside our 24×24 viewBox so it
    // matches the visual weight of the other social glyphs.
    case 'linkedin':
      return wrap('<g transform="translate(4, 3) scale(0.0352)"><path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z"/></g>');

    // Stroked rounded rectangle with a filled play triangle inside.
    case 'youtube':
      return wrap(
        `<rect x="2.5" y="5.5" width="19" height="13" rx="3.5" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
        `<path d="M10 9.4l5.5 2.6-5.5 2.6z" fill="${c}"/>`,
        { fill: false },
      );

    // Globe — circle + horizontal equator + curved meridian.
    case 'website':
      return wrap(
        `<circle cx="12" cy="12" r="9" stroke="${c}" stroke-width="2" fill="none"/>` +
        `<line x1="3" y1="12" x2="21" y2="12" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
        `<path d="M12 3a14 14 0 0 1 4 9 14 14 0 0 1-4 9 14 14 0 0 1-4-9 14 14 0 0 1 4-9z" stroke="${c}" stroke-width="2" stroke-linejoin="round" fill="none"/>`,
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
  return renderMergeVars(template, vars);
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

/**
 * Returns the FULL `<td>` opening attributes for a block: a `class="eb-pad"`
 * (so the mobile media query in `renderMarketingEmailHtml` can shrink the
 * horizontal padding on narrow screens) plus the open of `style="..."` with
 * the block's resolved padding + background. Callsites then append their own
 * style rules and close the attribute with `">${content}</td>`.
 *
 * Note: the returned string deliberately leaves the `style="..."` attribute
 * un-closed; the existing callsite trailing `">${content}` provides the
 * close. This keeps every callsite a uniform `<td ${box}...">` opener.
 */
function blockBoxStyle(block: EmailBlock): string {
  const d = BLOCK_PADDING_DEFAULTS[block.type] ?? { top: 8, bottom: 8, left: 24, right: 24 };
  const t = block.paddingTop ?? d.top;
  const b = block.paddingBottom ?? d.bottom;
  const l = block.paddingLeft ?? d.left;
  const r = block.paddingRight ?? d.right;
  const bg = block.blockBgColor && block.blockBgColor !== 'transparent' ? `background:${block.blockBgColor};` : '';
  return `class="eb-pad" style="padding:${t}px ${r}px ${b}px ${l}px;${bg}`;
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
      return `<tr><td ${box}${align};font-family:${ff};font-size:${size};font-weight:${fw};color:${color};line-height:${lh};${ls}${tt}">${text}</td></tr>`;
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
      return `<tr><td ${box}${align};font-family:${ff};font-size:${fs};font-weight:${fw};line-height:${lh};color:${color};${ls}${tt}">${html || '<p></p>'}</td></tr>`;
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

      return `<tr><td ${box}${align};"><a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:${bg};color:${fg};border:${borderW}px solid ${borderColor};padding:${padY}px ${padX}px;border-radius:${radius}px;text-decoration:none;font-weight:${fw};font-size:${fs};line-height:${block.lineHeight ?? 1};letter-spacing:${ls}px;${tt}font-family:${ff};">${lab}</a></td></tr>`;
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
          return `<tr><td ${box}${align};color:${theme.mutedColor};font-size:13px;">[Image — add URL in editor]</td></tr>`;
        }
        const src = esc(slots[0].src);
        const alt = esc(slots[0].alt);
        const img = `<img src="${src}" alt="${alt}" width="${totalWidth}" style="max-width:100%;width:100%;height:auto;border-radius:8px;display:block;border:0;" />`;
        const inner = linkHref
          ? `<a href="${linkHref}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block;">${img}</a>`
          : img;
        return `<tr><td ${box}${align};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;max-width:${totalWidth}px;width:100%;"><tr><td>${inner}</td></tr></table></td></tr>`;
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
      return `<tr><td ${box}${align};"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${tableAlign}" style="border-collapse:separate;border-spacing:0;max-width:${totalWidth}px;width:100%;margin:0 auto;">${rows.join('')}</table></td></tr>`;
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

      return `<tr><td ${box}${align};">${linked}${titleHtml}</td></tr>`;
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

      const halfGap = Math.max(2, Math.round(spacing / 2));
      // Each chip is an `<a>` rendered as `display:inline-block`. We use a
      // plain `<div>` (not a `<table>`) so the chips wrap onto a second row
      // automatically when the available width can't fit them all — which
      // is exactly what we need on narrow phones (iPhone Mail at 375px,
      // Gmail mobile, etc.) when a venue has 6–8 social links registered.
      // Inline-block on `<a>` is supported in Outlook 2007+, Apple Mail,
      // iOS Mail, Gmail (web + mobile), Outlook 365, and Yahoo.
      //
      // - `font-size:0;line-height:0` on the parent kills the inline-block
      //   whitespace gap, so spacing is determined entirely by chip margin.
      // - `mso-line-height-rule:exactly` keeps Outlook's line height behaved.
      // - chip's own `line-height:${outer}px` overrides the parent zero so
      //   the glyph still vertical-aligns correctly inside the chip.
      // - `margin:0 ${halfGap}px ${halfGap*2}px` gives horizontal spacing
      //   between chips and a small bottom margin so wrapped rows breathe.
      const chipBottomMargin = halfGap * 2;
      const chips = links.map((l) => {
        let chipStyle = `display:inline-block;width:${outer}px;height:${outer}px;line-height:${outer}px;text-align:center;text-decoration:none;mso-line-height-rule:exactly;box-sizing:border-box;margin:0 ${halfGap}px ${chipBottomMargin}px;vertical-align:top;`;
        let glyphColor = color;
        if (styleKind === 'filled-circle') {
          chipStyle += `background:${color};border-radius:${outer}px;`;
          glyphColor = isDarkColor(color) ? '#ffffff' : '#000000';
        } else if (styleKind === 'circle-outline') {
          chipStyle += `border:1.5px solid ${color};border-radius:${outer}px;`;
        }
        const svg = socialIconSvg(l.platform, inner, glyphColor);
        return `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" style="${chipStyle}">${svg}</a>`;
      }).join('');

      // Negative bottom margin on the wrapper absorbs the bottom margin of
      // the *last* (or only) row of chips, so when nothing wraps the social
      // block's overall height matches the legacy table layout.
      const wrapperStyle = `text-align:${aAlign};font-size:0;line-height:0;mso-line-height-rule:exactly;margin-bottom:-${chipBottomMargin}px;`;
      const inner2 = `<div style="${wrapperStyle}">${chips}</div>`;
      return `<tr><td ${box}text-align:${aAlign};">${inner2}</td></tr>`;
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
      return `<tr><td ${box}text-align:${aAlign};font-family:${ff};">
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
      return `<tr><td ${box}text-align:${dAlign};">${inner}</td></tr>`;
    }
    case 'spacer': {
      const h = Math.min(120, Math.max(4, block.spacerHeight ?? 16));
      const bgPart = block.blockBgColor && block.blockBgColor !== 'transparent' ? `background:${block.blockBgColor};` : '';
      return `<tr><td style="height:${h}px;font-size:0;line-height:0;${bgPart}">&nbsp;</td></tr>`;
    }
    case 'html':
      return `<tr><td ${box}${align};font-family:${theme.fontFamily};font-size:15px;color:${theme.textColor};">${sanitizeFormHtml(block.content || '')}</td></tr>`;
    case 'columns': {
      const left = (block.left ?? []).map((b) => renderBlock(b, theme)).join('');
      const right = (block.right ?? []).map((b) => renderBlock(b, theme)).join('');
      return `<tr><td ${box}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
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
  // The footer's outer <td> carries the eb-pad class so the mobile media
  // query trims its horizontal padding too — keeps the unsubscribe row from
  // wrapping awkwardly on narrow phones.
  const footer = `<tr><td class="eb-pad" style="padding:28px 24px;font-size:11px;color:${theme.mutedColor};text-align:center;font-family:sans-serif;line-height:1.6;">
    <p style="margin:0 0 6px;font-weight:600;color:${theme.textColor};">{{venue_name}}</p>
    <p style="margin:0;">
      <a href="{{unsubscribe_url}}" style="color:${theme.mutedColor};text-decoration:underline;">Unsubscribe</a>
      &nbsp;·&nbsp;
      <a href="{{preferences_url}}" style="color:${theme.mutedColor};text-decoration:underline;">Manage preferences</a>
    </p>
  </td></tr>`;
  // Mobile-optimization styles. We only ship a single tight media query
  // (max-width:480px) since we want desktop email clients (and Outlook,
  // which generally sits well above 480px) to render the full-fidelity
  // layout. Everything inside the query is `!important` because email
  // clients aggressively rewrite `<style>` selectors.
  //
  // - `.eb-pad` reduces side padding 24px → 16px so block content has
  //   ~16px more horizontal room — enough to keep long addresses, button
  //   labels, and headings from wrapping awkwardly on a 375px iPhone.
  // - `.eb-card` lets the email card breathe edge-to-edge on phones —
  //   no rounded corners or gutter on narrow screens (matches how Gmail
  //   and Apple Mail natively render emails).
  const mobileStyles = `
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  img { -ms-interpolation-mode:bicubic; }
  @media screen and (max-width:480px) {
    .eb-card {
      border-radius:0 !important;
      border:0 !important;
    }
    .eb-pad {
      padding-left:16px !important;
      padding-right:16px !important;
    }
    .eb-page {
      padding-left:0 !important;
      padding-right:0 !important;
    }
  }
</style>`;
  const raw = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${mobileStyles}</head>
<body style="margin:0;padding:0;background:${theme.pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.pageBg};padding:24px 0;">
    <tr><td class="eb-page" align="center" style="padding:0 12px;">
      <table role="presentation" class="eb-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${theme.maxWidth};background:${theme.cardBg};border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);">
        ${inner}${footer}
      </table>
    </td></tr>
  </table>
</body></html>`;
  return mergeMarketingFields(raw, vars);
}
