'use client';

import { Bold, Italic, List, Link2 } from 'lucide-react';
import { applyFormatting, type FormatAction } from '@/lib/support/rich-text-lite';

/**
 * Small formatting toolbar for the reply composer's plain `<textarea>`.
 * Only meaningful for EMAIL-channel replies (markdownLiteToHtml converts the
 * result to HTML at send time) — callers should not render this at all when
 * the effective channel is SMS, since SMS sends the raw text untouched.
 */
export function RichTextToolbar({
  textareaRef,
  value,
  onChange,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  function run(action: FormatAction) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const result = applyFormatting(value, start, end, action);
    onChange(result.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  const btnCls = 'inline-flex items-center justify-center h-6 w-6 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors';

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-gray-200 bg-white px-1 py-0.5">
      <button type="button" title="Bold" onClick={() => run('bold')} className={btnCls}><Bold size={12} /></button>
      <button type="button" title="Italic" onClick={() => run('italic')} className={btnCls}><Italic size={12} /></button>
      <button type="button" title="Bulleted list" onClick={() => run('bullet')} className={btnCls}><List size={12} /></button>
      <button type="button" title="Link" onClick={() => run('link')} className={btnCls}><Link2 size={12} /></button>
    </div>
  );
}
