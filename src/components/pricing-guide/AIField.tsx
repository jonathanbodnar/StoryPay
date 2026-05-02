'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, RefreshCw, Wand2 } from 'lucide-react';

/**
 * Reusable wrapper that turns any text field (input or textarea) into an
 * "Ask AI"-enabled field. Renders the underlying control plus a small floating
 * sparkle button that opens a popover with three actions:
 *
 *   • Generate   — when the field is empty, write a fresh paragraph from scratch
 *   • Improve    — rewrite the current draft for clarity/grammar/tone
 *   • Try a variation — produce a different angle, same intent
 *
 * All three call POST /api/ai/pricing-guide with the section key.
 */

export type AIMode = 'generate' | 'rewrite' | 'variation';

interface Props {
  /** Section key, must match SECTION_PROMPTS in /api/ai/pricing-guide */
  section: string;
  /** Current value */
  value: string;
  /** Called with the new value */
  onChange: (value: string) => void;
  /** Optional context passed through to the AI (e.g. package name, capacity) */
  extras?: Record<string, unknown>;
  /** Render the underlying control with these props */
  render: (controlProps: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  }) => React.ReactNode;
  /** Position the AI button at the top-right of a containing block instead of inline */
  buttonPlacement?: 'top-right' | 'inline';
  /** Optional CSS class on the wrapper */
  className?: string;
}

export function AIField({
  section,
  value,
  onChange,
  extras,
  render,
  buttonPlacement = 'top-right',
  className = '',
}: Props) {
  const [busy, setBusy] = useState<AIMode | null>(null);
  const [open, setOpen] = useState(false);
  const [variationCount, setVariationCount] = useState(0);
  const [error, setError] = useState<string>('');
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function run(mode: AIMode) {
    setBusy(mode);
    setError('');
    try {
      const res = await fetch('/api/ai/pricing-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section,
          mode,
          draft: value,
          variation: mode === 'variation' ? variationCount : 0,
          extras,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'AI request failed');
      }
      const { text } = (await res.json()) as { text: string };
      if (text?.trim()) {
        onChange(text.trim());
        if (mode === 'variation') setVariationCount((n) => n + 1);
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed');
    } finally {
      setBusy(null);
    }
  }

  const button = (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60"
        title="Ask AI"
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Sparkles size={12} />
        )}
        Ask AI
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <button
            type="button"
            onClick={() => run(value.trim() ? 'rewrite' : 'generate')}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50"
          >
            <Wand2 size={14} className="text-violet-600" />
            {value.trim() ? 'Improve this draft' : 'Generate from scratch'}
          </button>
          {value.trim() && (
            <button
              type="button"
              onClick={() => run('variation')}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50"
            >
              <RefreshCw size={14} className="text-violet-600" />
              Try a different angle
            </button>
          )}
          {error && (
            <div className="border-t border-gray-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`relative ${className}`}>
      {buttonPlacement === 'top-right' && (
        <div className="absolute right-2 top-2 z-10">{button}</div>
      )}
      {render({
        value,
        onChange: (e) => onChange(e.target.value),
      })}
      {buttonPlacement === 'inline' && (
        <div className="mt-1.5 flex justify-end">{button}</div>
      )}
    </div>
  );
}
