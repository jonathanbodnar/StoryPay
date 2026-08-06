/**
 * Lightweight formatting for the support-reply composer.
 *
 * The composer stays a plain `<textarea>` (no contentEditable / rich DOM) —
 * the toolbar just inserts lightweight markdown-style tokens at the cursor:
 *   **bold**, *italic*, "- " bullet lines, [text](url) links.
 *
 * `markdownLiteToHtml` converts that to simple HTML for EMAIL sends only.
 * SMS sends always use the raw textarea value untouched (plain text — SMS
 * can't render HTML), so the toolbar is hidden entirely when the effective
 * channel is SMS (see RichTextToolbar's `disabled` prop usage).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function markdownLiteToHtml(text: string): string {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const htmlLines: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      htmlLines.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      if (!inList) {
        htmlLines.push('<ul style="margin:0 0 12px;padding-left:20px;">');
        inList = true;
      }
      htmlLines.push(`<li>${inlineFormat(bulletMatch[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim() === '') {
      htmlLines.push('<br/>');
    } else {
      htmlLines.push(`<p style="margin:0 0 12px">${inlineFormat(line)}</p>`);
    }
  }
  closeList();
  return htmlLines.join('\n');
}

function inlineFormat(line: string): string {
  let escaped = escapeHtml(line);
  // Links: [text](url)
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" style="color:#2563eb;text-decoration:underline;">${label}</a>`;
  });
  // Bold: **text**
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (after bold so `**` pairs are already consumed)
  escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Bare URLs not already turned into an <a> tag
  escaped = escaped.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, (m, pre, url) => `${pre}<a href="${url}" style="color:#2563eb;text-decoration:underline;">${url}</a>`);
  return escaped;
}

export type FormatAction = 'bold' | 'italic' | 'bullet' | 'link';

/**
 * Apply a formatting action to a textarea's current selection, returning the
 * new full value + the new selection range so the caller can restore focus.
 */
export function applyFormatting(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: FormatAction,
): { value: string; selectionStart: number; selectionEnd: number } {
  const before = value.slice(0, selectionStart);
  const selected = value.slice(selectionStart, selectionEnd);
  const after = value.slice(selectionEnd);

  if (action === 'bold') {
    const text = selected || 'bold text';
    const inserted = `**${text}**`;
    return {
      value: before + inserted + after,
      selectionStart: before.length + 2,
      selectionEnd: before.length + 2 + text.length,
    };
  }
  if (action === 'italic') {
    const text = selected || 'italic text';
    const inserted = `*${text}*`;
    return {
      value: before + inserted + after,
      selectionStart: before.length + 1,
      selectionEnd: before.length + 1 + text.length,
    };
  }
  if (action === 'bullet') {
    const text = selected || 'list item';
    const linePrefix = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    const inserted = `${linePrefix}- ${text}`;
    return {
      value: before + inserted + after,
      selectionStart: before.length + linePrefix.length + 2,
      selectionEnd: before.length + inserted.length,
    };
  }
  // link
  const label = selected || 'link text';
  const inserted = `[${label}](https://)`;
  const urlStart = before.length + label.length + 3; // position right after "](" — inside the "https://" placeholder
  return {
    value: before + inserted + after,
    selectionStart: urlStart,
    selectionEnd: urlStart + 'https://'.length,
  };
}
