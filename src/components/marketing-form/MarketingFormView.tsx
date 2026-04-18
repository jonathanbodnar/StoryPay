'use client';

import { useCallback, useMemo, useState, type FormEvent } from 'react';
import {
  type FormBlock,
  type MarketingFormDefinition,
  formFieldName,
  mergeTheme,
} from '@/lib/marketing-form-schema';
import { sanitizeFormHtml } from '@/lib/sanitize-form-html';

function blockOptions(block: FormBlock): string[] {
  const o = block.options;
  if (!Array.isArray(o) || o.length === 0) return ['Option'];
  return o.map((x) => String(x).trim()).filter(Boolean);
}

function renderBlock(
  block: FormBlock,
  theme: ReturnType<typeof mergeTheme>,
  preview: boolean
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
      return (
        <Tag key={block.id} className={`mb-3 ${cls}`} style={{ color: theme.primaryColor }}>
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
          dangerouslySetInnerHTML={{ __html: html || '<p></p>' }}
        />
      );
    }
    case 'html': {
      const html = sanitizeFormHtml(block.content);
      return (
        <div
          key={block.id}
          className="mb-4 max-w-none text-gray-800"
          dangerouslySetInnerHTML={{ __html: html || '' }}
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
          disabled={preview}
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
          disabled={preview}
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
          disabled={preview}
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
          disabled={preview}
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
          disabled={preview}
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
          disabled={preview}
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
          disabled={preview}
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
          disabled={preview}
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
          disabled={preview}
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
                  disabled={preview}
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
          disabled={preview}
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
                  type="checkbox"
                  name={name}
                  value={opt}
                  disabled={preview}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span style={{ color: theme.labelColor }}>{opt}</span>
              </label>
            ))}
          </div>
          {hintEl}
        </fieldset>
      );
    }
    case 'submit':
      return (
        <div key={block.id} className="mb-2 mt-2">
          <button
            type="submit"
            disabled={preview}
            className="w-full px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
            style={{
              borderRadius: theme.borderRadius,
              background: theme.primaryColor,
            }}
          >
            {block.buttonLabel?.trim() || 'Submit'}
          </button>
        </div>
      );
    case 'button': {
      const lab = block.buttonLabel?.trim() || 'Button';
      const href = block.href?.trim();
      const v = block.buttonVariant ?? 'secondary';
      const base =
        'inline-flex items-center justify-center px-4 py-2 text-sm font-medium transition rounded-lg';
      const styles =
        v === 'primary'
          ? 'text-white shadow-sm'
          : v === 'outline'
            ? 'border-2 bg-transparent'
            : v === 'link'
              ? 'text-brand-700 underline-offset-2 hover:underline'
              : 'border border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100';
      if (href && /^https?:\/\//i.test(href)) {
        return (
          <div key={block.id} className="mb-4">
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
        <div key={block.id} className="mb-4">
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
  preview?: boolean;
  onPreviewSubmit?: () => void;
}

export function MarketingFormView({
  definition,
  embedToken,
  formTitle,
  preview = false,
  onPreviewSubmit,
}: MarketingFormViewProps) {
  const theme = useMemo(() => mergeTheme(definition.theme), [definition.theme]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (preview) {
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
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'Something went wrong.');
          return;
        }
        setStatus('success');
        setMessage('Thanks — your response was recorded.');
        form.reset();
      } catch {
        setStatus('error');
        setMessage('Network error. Please try again.');
      }
    },
    [embedToken, preview, onPreviewSubmit, definition.blocks]
  );

  return (
    <div
      className="min-h-0 w-full py-6"
      style={{
        background: theme.background,
        fontFamily: theme.fontFamily,
        color: theme.labelColor,
      }}
    >
      <div className="mx-auto w-full px-4" style={{ maxWidth: theme.maxWidth }}>
        <div
          className="border px-5 py-6 shadow-sm"
          style={{
            borderRadius: theme.borderRadius,
            borderColor: theme.inputBorder,
            background: theme.surface,
          }}
        >
          {formTitle ? (
            <h1 className="mb-1 text-lg font-semibold" style={{ color: theme.primaryColor }}>
              {formTitle}
            </h1>
          ) : null}
          {status === 'success' || status === 'error' ? (
            <div
              className={`mb-4 rounded-lg px-3 py-2 text-sm ${
                status === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              {message}
            </div>
          ) : null}
          <form onSubmit={onSubmit} className="mt-2">
            {definition.blocks.map((b) => renderBlock(b, theme, preview))}
          </form>
        </div>
      </div>
    </div>
  );
}
