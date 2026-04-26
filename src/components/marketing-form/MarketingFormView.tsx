'use client';

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { GoogleFontsLoader } from '@/components/marketing-form/GoogleFontsLoader';
import {
  type FormBlock,
  type FormBlockStyle,
  type MarketingFormDefinition,
  formFieldName,
  mergeTheme,
  resolveBlockPadding,
  resolvePostSubmit,
} from '@/lib/marketing-form-schema';
import { collectGoogleFontFamiliesFromDefinition } from '@/lib/google-fonts';
import { sanitizeFormHtml } from '@/lib/sanitize-form-html';

function blockStyleCss(s?: FormBlockStyle): CSSProperties {
  if (!s) return {};
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight as CSSProperties['fontWeight'],
    color: s.color,
    textAlign: s.textAlign,
    lineHeight: s.lineHeight,
    textTransform: s.textTransform === 'uppercase' ? 'uppercase' : undefined,
  };
}

/** Resolved per-block padding + background for the outer block wrapper.
 *  Empty unless the user has explicitly set fields, so existing forms
 *  render unchanged. */
function blockBoxCss(block: FormBlock): CSSProperties {
  const p = resolveBlockPadding(block);
  const bg = block.blockBgColor;
  const out: CSSProperties = {};
  if (p.top)    out.paddingTop    = `${p.top}px`;
  if (p.bottom) out.paddingBottom = `${p.bottom}px`;
  if (p.left)   out.paddingLeft   = `${p.left}px`;
  if (p.right)  out.paddingRight  = `${p.right}px`;
  if (bg && bg !== 'transparent') out.background = bg;
  return out;
}

function blockOptions(block: FormBlock): string[] {
  const o = block.options;
  if (!Array.isArray(o) || o.length === 0) return ['Option'];
  return o.map((x) => String(x).trim()).filter(Boolean);
}

export type FormBuilderCanvasOpts = {
  selectedId: string | null;
  onSelectBlock: (id: string) => void;
  onPatchBlock: (id: string, patch: Partial<FormBlock>) => void;
};

function renderBlock(
  block: FormBlock,
  theme: ReturnType<typeof mergeTheme>,
  /** When true, every input/button is rendered with `disabled` — used by the
   *  builder canvas (so blocks are clickable/editable, not fillable) and by
   *  the static preview. The interactive *live preview* sets this to false. */
  inputsDisabled: boolean,
) {
  const name = formFieldName(block);
  const label = block.label?.trim() || '';
  const hint = block.hint?.trim();
  const ph = block.placeholder ?? '';

  const labelEl = (htmlFor: string) =>
    label ? (
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-sm font-medium"
        style={{ color: theme.labelColor }}
      >
        {label}
        {block.required ? <span className="text-red-500"> *</span> : null}
      </label>
    ) : null;

  const hintEl = hint ? (
    <p className="mt-1 text-xs" style={{ color: theme.mutedColor }}>
      {hint}
    </p>
  ) : null;

  const inputShell = (child: React.ReactNode, id: string) => (
    <div className="mb-4">
      {labelEl(id)}
      {child}
      {hintEl}
    </div>
  );

  switch (block.type) {
    case 'heading': {
      const L = Math.min(6, Math.max(1, block.level ?? 2));
      const Tag = (`h${L}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
      const text = block.content?.trim() || 'Heading';
      const cls =
        L === 1
          ? 'text-2xl font-semibold tracking-tight'
          : L === 2
            ? 'text-xl font-semibold tracking-tight'
            : 'text-lg font-semibold';
      const sty: CSSProperties = {
        color: block.style?.color ?? theme.primaryColor,
        fontFamily: block.style?.fontFamily ?? (theme.headingFontFamily || undefined),
        ...blockStyleCss(block.style),
      };
      // Heading text is edited via the inspector's "Text" field (not inline)
      // so clicks always fall through to the block wrapper for selection.
      return (
        <Tag key={block.id} className={`mb-3 min-h-[1.5em] ${cls}`} style={sty}>
          {text}
        </Tag>
      );
    }
    case 'rich_text': {
      const html = sanitizeFormHtml(block.content);
      return (
        <div
          key={block.id}
          className="prose prose-sm mb-4 max-w-none text-gray-700"
          style={{ textAlign: block.style?.textAlign ?? 'left' }}
          dangerouslySetInnerHTML={{ __html: html || '<p></p>' }}
        />
      );
    }
    case 'html': {
      const html = sanitizeFormHtml(block.content);
      if (!html) return null;
      return (
        <div
          key={block.id}
          className="mb-4 max-w-none text-gray-800"
          style={{ textAlign: block.style?.textAlign ?? 'left' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    case 'image': {
      if (!block.src?.trim()) {
        return (
          <div
            key={block.id}
            className="mb-4 rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400"
          >
            Image (add URL in builder)
          </div>
        );
      }
      return (
        <figure key={block.id} className="mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.src}
            alt={block.alt || ''}
            className="max-h-64 w-full rounded-lg object-contain"
          />
          {block.alt ? (
            <figcaption className="mt-1 text-center text-xs text-gray-500">{block.alt}</figcaption>
          ) : null}
        </figure>
      );
    }
    case 'first_name':
      return inputShell(
        <input
          id={name}
          name={name}
          type="text"
          autoComplete="given-name"
          placeholder={ph}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'last_name':
      return inputShell(
        <input
          id={name}
          name={name}
          type="text"
          autoComplete="family-name"
          placeholder={ph}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'email':
      return inputShell(
        <input
          id={name}
          name={name}
          type="email"
          autoComplete="email"
          placeholder={ph}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'phone':
      return inputShell(
        <input
          id={name}
          name={name}
          type="tel"
          autoComplete="tel"
          placeholder={ph}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'url':
      return inputShell(
        <input
          id={name}
          name={name}
          type="url"
          autoComplete="url"
          placeholder={ph}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'number':
      return inputShell(
        <input
          id={name}
          name={name}
          type="number"
          step="any"
          placeholder={ph}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'date':
      return inputShell(
        <input
          id={name}
          name={name}
          type="date"
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'address':
      return inputShell(
        <textarea
          id={name}
          name={name}
          rows={4}
          placeholder={ph}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full resize-y border px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        name
      );
    case 'file':
      return inputShell(
        <input
          id={name}
          name={name}
          type="file"
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-800 hover:file:bg-gray-200"
        />,
        name
      );
    case 'radio': {
      const opts = blockOptions(block);
      return (
        <fieldset key={block.id} className="mb-4">
          {label ? (
            <legend className="mb-2 text-sm font-medium" style={{ color: theme.labelColor }}>
              {label}
              {block.required ? <span className="text-red-500"> *</span> : null}
            </legend>
          ) : null}
          <div className="space-y-2">
            {opts.map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={name}
                  value={opt}
                  required={!!block.required}
                  disabled={inputsDisabled}
                  className="h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span style={{ color: theme.labelColor }}>{opt}</span>
              </label>
            ))}
          </div>
          {hintEl}
        </fieldset>
      );
    }
    case 'select': {
      const opts = blockOptions(block);
      const id = `${name}_sel`;
      return inputShell(
        <select
          id={id}
          name={name}
          required={!!block.required}
          disabled={inputsDisabled}
          className="w-full border bg-white px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
          defaultValue=""
        >
          <option value="" disabled>
            Select…
          </option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>,
        id
      );
    }
    case 'checkbox_group': {
      const opts = blockOptions(block);
      const isSingle = block.checkboxMode === 'single';
      return (
        <fieldset key={block.id} className="mb-4">
          {label ? (
            <legend className="mb-2 text-sm font-medium" style={{ color: theme.labelColor }}>
              {label}
              {block.required ? <span className="text-red-500"> *</span> : null}
            </legend>
          ) : null}
          <div className="space-y-2">
            {opts.map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type={isSingle ? 'radio' : 'checkbox'}
                  name={name}
                  value={opt}
                  required={isSingle ? !!block.required : undefined}
                  disabled={inputsDisabled}
                  className={`h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-500 ${isSingle ? '' : 'rounded'}`}
                />
                <span style={{ color: theme.labelColor }}>{opt}</span>
              </label>
            ))}
          </div>
          {hintEl}
        </fieldset>
      );
    }
    case 'textarea': {
      const rows = block.textareaSize === 'small' ? 3 : block.textareaSize === 'large' ? 10 : 6;
      const id = `${name}_ta`;
      return inputShell(
        <textarea
          id={id}
          name={name}
          rows={rows}
          required={!!block.required}
          disabled={inputsDisabled}
          placeholder={ph}
          className="w-full resize-y border bg-white px-3 py-2 text-sm outline-none ring-brand-500 focus:ring-2"
          style={{ borderRadius: theme.borderRadius, borderColor: theme.inputBorder }}
        />,
        id
      );
    }
    case 'submit': {
      const submitAlign = block.buttonAlign ?? 'center';
      const submitWidth = submitAlign === 'center' ? 'w-full' : 'inline-flex';
      const submitWrap = submitAlign === 'center' ? '' : submitAlign === 'right' ? 'flex justify-end' : 'flex justify-start';
      return (
        <div key={block.id} className={`mb-2 mt-2 ${submitWrap}`}>
          <button
            type="submit"
            disabled={inputsDisabled}
            className={`${submitWidth} items-center justify-center px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50`}
            style={{
              borderRadius: theme.borderRadius,
              background: theme.primaryColor,
            }}
          >
            {block.buttonLabel?.trim() || 'Submit'}
          </button>
        </div>
      );
    }
    case 'button': {
      const lab = block.buttonLabel?.trim() || 'Button';
      const href = block.href?.trim();
      const v = block.buttonVariant ?? 'secondary';
      const align = block.buttonAlign ?? 'left';
      const wrapAlign = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
      const base =
        'inline-flex items-center justify-center px-4 py-2 text-sm font-medium transition rounded-lg';
      const styles =
        v === 'primary'
          ? 'text-white'
          : v === 'outline'
            ? 'border-2 bg-transparent'
            : v === 'link'
              ? 'text-brand-700 underline-offset-2 hover:underline'
              : 'border border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100';
      if (href && /^https?:\/\//i.test(href)) {
        return (
          <div key={block.id} className={`mb-4 ${wrapAlign}`}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${base} ${styles}`}
              style={
                v === 'primary'
                  ? { background: theme.primaryColor, borderRadius: theme.borderRadius }
                  : { borderRadius: theme.borderRadius }
              }
            >
              {lab}
            </a>
          </div>
        );
      }
      return (
        <div key={block.id} className={`mb-4 ${wrapAlign}`}>
          <button
            type="button"
            className={`${base} ${styles}`}
            style={
              v === 'primary'
                ? { background: theme.primaryColor, borderRadius: theme.borderRadius }
                : { borderRadius: theme.borderRadius }
            }
          >
            {lab}
          </button>
        </div>
      );
    }
    default:
      return null;
  }
}

interface MarketingFormViewProps {
  definition: MarketingFormDefinition;
  embedToken: string;
  formTitle?: string;
  /** Static preview — inputs are disabled and submits are intercepted (used
   *  inside the builder canvas behind the block-edit overlay). */
  preview?: boolean;
  /** Live preview — inputs are interactive, validation runs locally, and the
   *  configured post-submit behavior (thank-you / inline message / redirect)
   *  is simulated client-side without persisting anything or sending notifs.
   *  Implies `preview` for routing/disabled purposes. */
  livePreview?: boolean;
  onPreviewSubmit?: () => void;
  /** Select blocks + edit heading in place on the canvas */
  builder?: FormBuilderCanvasOpts | null;
  /** Wrap each block (after builder chrome), e.g. sortable drag handles in the lead capture form editor */
  wrapBlock?: (block: FormBlock, node: ReactNode) => ReactNode;
  /** Shown inside the form when there are no blocks (e.g. builder drop zone) */
  emptyCanvasSlot?: ReactNode | null;
  /** Builder only: single flat white surface (no theme grey shell or card frame). */
  flatCanvas?: boolean;
}

export function MarketingFormView({
  definition,
  embedToken,
  formTitle,
  preview = false,
  livePreview = false,
  onPreviewSubmit,
  builder = null,
  wrapBlock,
  emptyCanvasSlot = null,
  flatCanvas = false,
}: MarketingFormViewProps) {
  const theme = useMemo(() => mergeTheme(definition.theme), [definition.theme]);
  const googleFontFamilies = useMemo(
    () => collectGoogleFontFamiliesFromDefinition(definition),
    [definition]
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [successHtml, setSuccessHtml] = useState<string | null>(null);

  // Inputs are disabled when:
  //  - we're inside the builder canvas (clicking blocks edits them, not fills),
  //  - or static preview is on AND live-preview is *not* on.
  const inputsDisabled = !!builder || (preview && !livePreview);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // Static preview (canvas / disabled preview) — bail without doing anything.
      if (preview && !livePreview) {
        onPreviewSubmit?.();
        return;
      }
      setStatus('idle');
      setMessage(null);
      const form = e.currentTarget;
      if (!form.reportValidity()) return;
      for (const b of definition.blocks) {
        if (b.type === 'checkbox_group' && b.required) {
          const nm = formFieldName(b);
          const n = form.querySelectorAll(`input[type="checkbox"][name="${nm}"]:checked`).length;
          if (n === 0) {
            setStatus('error');
            setMessage(`Please choose at least one option${b.label ? ` for “${b.label}”.` : '.'}`);
            return;
          }
        }
      }

      // Live-preview path: simulate the configured post-submit flow without
      // hitting the API so we don't persist a fake submission, route a fake
      // lead into a pipeline, or fire notification emails. The user gets the
      // exact UX their visitors will see.
      if (livePreview) {
        const ps = resolvePostSubmit(definition);
        if (ps.mode === 'redirect') {
          setStatus('success');
          setSuccessHtml(null);
          setMessage(
            ps.redirectUrl
              ? `Preview only — would redirect to ${ps.redirectUrl}.`
              : 'Preview only — would redirect (no URL set).',
          );
        } else if (ps.mode === 'inline_message') {
          setStatus('success');
          setMessage(null);
          setSuccessHtml(ps.messageHtml || '<p>Thanks — your response was recorded.</p>');
        } else {
          setStatus('success');
          setSuccessHtml(null);
          setMessage('Thanks — your response was recorded.');
        }
        form.reset();
        onPreviewSubmit?.();
        return;
      }

      setStatus('loading');
      const fd = new FormData(form);
      if (typeof window !== 'undefined') {
        const u = new URLSearchParams(window.location.search);
        for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const) {
          const v = u.get(key);
          if (v) fd.append(key, v);
        }
      }
      try {
        const res = await fetch(`/api/public/forms/${embedToken}/submit`, {
          method: 'POST',
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          postSubmit?: { mode?: string; redirectUrl?: string | null; messageHtml?: string | null };
        };
        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'Something went wrong.');
          return;
        }
        const ps = data.postSubmit;
        if (ps?.mode === 'redirect' && ps.redirectUrl?.trim()) {
          window.location.href = ps.redirectUrl.trim();
          return;
        }
        setStatus('success');
        setSuccessHtml(null);
        if (ps?.messageHtml?.trim()) {
          setMessage(null);
          setSuccessHtml(ps.messageHtml);
        } else {
          setMessage('Thanks — your response was recorded.');
        }
        form.reset();
      } catch {
        setStatus('error');
        setMessage('Network error. Please try again.');
      }
    },
    [embedToken, preview, livePreview, onPreviewSubmit, definition]
  );

  const shellBg = flatCanvas ? '#ffffff' : theme.background;
  const cardBg = flatCanvas ? '#ffffff' : theme.surface;

  return (
    <div
      className={`min-h-0 w-full ${flatCanvas ? 'py-2' : 'py-6'}`}
      style={{
        background: shellBg,
        fontFamily: theme.fontFamily,
        color: theme.labelColor,
      }}
    >
      <GoogleFontsLoader families={googleFontFamilies} />
      <div className="mx-auto w-full px-4" style={{ maxWidth: theme.maxWidth }}>
        <div
          className={flatCanvas ? 'px-2 py-2 sm:px-4 sm:py-4' : 'border px-5 py-6'}
          style={{
            borderRadius: flatCanvas ? 0 : theme.borderRadius,
            borderColor: flatCanvas ? 'transparent' : theme.inputBorder,
            background: cardBg,
          }}
        >
          {status === 'success' || status === 'error' ? (
            <div
              className={`mb-4 rounded-lg px-3 py-2 text-sm ${
                status === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {status === 'success' && successHtml ? (
                <div
                  className="prose prose-sm max-w-none text-green-900"
                  dangerouslySetInnerHTML={{ __html: sanitizeFormHtml(successHtml) }}
                />
              ) : (
                message
              )}
            </div>
          ) : null}
          <form onSubmit={onSubmit} className="mt-2">
            {definition.blocks.length === 0 && emptyCanvasSlot ? (
              emptyCanvasSlot
            ) : (
              <div className="grid grid-cols-2 gap-x-3">
                {definition.blocks.map((b) => {
                  // Layout/content blocks always span full width; input blocks use colSpan
                  const isLayoutBlock = ['heading', 'rich_text', 'image', 'html', 'submit', 'button'].includes(b.type);
                  const colClass = isLayoutBlock || (b.colSpan ?? 2) === 2
                    ? 'col-span-2'
                    : 'col-span-1';

                  const inner = renderBlock(b, theme, inputsDisabled);
                  const boxCss = blockBoxCss(b);
                  let node: ReactNode;
                  if (!builder) {
                    // Public embed — wrap only when the block actually carries
                    // padding or a background, so unchanged blocks keep their
                    // current layout exactly.
                    node =
                      Object.keys(boxCss).length > 0 ? (
                        <div style={boxCss}>{inner}</div>
                      ) : (
                        inner
                      );
                  } else {
                    const selected = builder.selectedId === b.id;
                    // In builder mode all child interactivity is muted with
                    // `pointer-events: none`, so clicks/taps anywhere on the
                    // block (including disabled-looking inputs and headings)
                    // bubble straight to the wrapper. This fixes the bug where
                    // a selected block would trap focus and require a canvas
                    // click before another block could be selected.
                    node = (
                      <div
                        role="presentation"
                        className="relative rounded-md transition group/fbblock"
                        style={{
                          ...boxCss,
                          outline: selected ? '1px solid #3b82f6' : '1px solid transparent',
                          outlineOffset: '-1px',
                          boxShadow: selected
                            ? '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)'
                            : 'none',
                          transition: 'outline 0.1s ease, box-shadow 0.2s ease',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) {
                            (e.currentTarget as HTMLDivElement).style.outline = '1px solid #3b82f6';
                            (e.currentTarget as HTMLDivElement).style.boxShadow =
                              '0 12px 40px rgba(0,0,0,0.13), 0 4px 12px rgba(0,0,0,0.08)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) {
                            (e.currentTarget as HTMLDivElement).style.outline = '1px solid transparent';
                            (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          builder.onSelectBlock(b.id);
                        }}
                      >
                        <div style={{ pointerEvents: 'none' }}>{inner}</div>
                      </div>
                    );
                  }
                  if (wrapBlock) node = wrapBlock(b, node);
                  return (
                    <div key={b.id} className={colClass}>
                      {node}
                    </div>
                  );
                })}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
