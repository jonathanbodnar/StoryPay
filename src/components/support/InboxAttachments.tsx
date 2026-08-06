'use client';

import { useCallback, useRef, useState } from 'react';
import { Paperclip, X, FileText, Download, Loader2 } from 'lucide-react';

/** Canonical attachment shape — matches /api/admin/support/attachments/upload's response
 *  and the `attachments` jsonb column on conversation_messages / support_thread_messages. */
export interface SupportAttachment {
  id:          string;
  url:         string;
  storagePath: string;
  filename:    string;
  size:        number;
  contentType: string;
}

const MAX_ATTACHMENTS = 10;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isImageAttachment(a: Pick<SupportAttachment, 'contentType'>): boolean {
  return (a.contentType || '').toLowerCase().startsWith('image/');
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadOne(
  file: File,
  scope: 'thread' | 'ticket',
  id: string,
): Promise<SupportAttachment> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('scope', scope);
  fd.append('id', id);
  const r = await fetch('/api/admin/support/attachments/upload', { method: 'POST', body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.ok) throw new Error(d?.error || `Upload failed (${r.status})`);
  return {
    id:          d.id,
    url:         d.url,
    storagePath: d.storagePath,
    filename:    d.filename,
    size:        d.size,
    contentType: d.contentType,
  };
}

/**
 * Composer-side attachment picker: paperclip button (file picker), drag/drop
 * onto the wrapping element, and paste-to-attach for images. Renders the
 * currently-pending attachments as removable chips/thumbnails.
 */
export function AttachmentComposerBar({
  scope,
  scopeId,
  attachments,
  onChange,
  disabled,
}: {
  scope: 'thread' | 'ticket';
  scopeId: string;
  attachments: SupportAttachment[];
  onChange: (next: SupportAttachment[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, MAX_ATTACHMENTS - attachments.length));
    if (list.length === 0) return;
    setError(null);
    setUploading(n => n + list.length);
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is too large (max 25MB)`);
        setUploading(n => Math.max(0, n - 1));
        continue;
      }
      try {
        const att = await uploadOne(file, scope, scopeId);
        onChange([...attachments, att]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setUploading(n => Math.max(0, n - 1));
      }
    }
  }, [attachments, scope, scopeId, onChange]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
  }, [addFiles, disabled]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) void addFiles(files);
  }, [addFiles, disabled]);

  function remove(id: string) {
    onChange(attachments.filter(a => a.id !== id));
  }

  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
      onPaste={onPaste}
      className="space-y-1.5"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
          onClick={() => inputRef.current?.click()}
          title="Attach a file or image"
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <Paperclip size={11} /> Attach
        </button>
        {uploading > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            <Loader2 size={11} className="animate-spin" /> Uploading {uploading}…
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }}
        />
        {attachments.length > 0 && (
          <span className="text-[10px] text-gray-400">Drag &amp; drop or paste images too</span>
        )}
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map(a => (
            <div key={a.id} className="group relative inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 pl-1.5 pr-1 py-1 text-[11px]">
              {isImageAttachment(a) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.filename} className="h-6 w-6 rounded object-cover" />
              ) : (
                <FileText size={12} className="text-gray-400" />
              )}
              <span className="max-w-[120px] truncate text-gray-700">{a.filename}</span>
              <span className="text-gray-400">{formatFileSize(a.size)}</span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="ml-0.5 rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                title="Remove"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only render of a message's attachments inside a MessageBubble / ticket row. */
export function AttachmentGallery({ attachments }: { attachments: SupportAttachment[] | null | undefined }) {
  if (!attachments || attachments.length === 0) return null;
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter(a => !isImageAttachment(a));

  return (
    <div className="mt-1.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map(a => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              title={`${a.filename} — click to view full size`}
              className="block overflow-hidden rounded-lg border border-black/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.filename} className="h-24 w-24 object-cover hover:opacity-90 transition-opacity" />
            </a>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map(a => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-white/60 px-2 py-1 text-[11px] hover:bg-white"
            >
              <FileText size={12} className="text-gray-400 shrink-0" />
              <span className="max-w-[160px] truncate">{a.filename}</span>
              <span className="text-gray-400 shrink-0">{formatFileSize(a.size)}</span>
              <Download size={11} className="text-gray-400 shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}