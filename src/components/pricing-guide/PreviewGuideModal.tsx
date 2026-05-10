'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Renders the pricing guide PDF inline using the server-side generator,
 * identical to what the couple downloads from the public listing page.
 */
export default function PreviewGuideModal({ open, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const prevBlobUrl = useRef<string | null>(null);

  // Fetch PDF bytes → object URL each time the modal opens
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setBlobUrl(null);
    setError('');
    setLoading(true);

    (async () => {
      try {
        const res = await fetch('/api/listing/pricing-guide/download?inline=1', {
          cache: 'no-store',
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const bytes = await res.arrayBuffer();
        if (cancelled) return;
        // Revoke previous URL to avoid memory leaks
        if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        prevBlobUrl.current = url;
        setBlobUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Cleanup blob URL on unmount
  useEffect(() => () => {
    if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6">
      <div className="relative flex h-full max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <div>
            <h3 className="font-heading text-lg text-gray-900">Guide preview</h3>
            <p className="text-xs text-gray-500">Exact PDF your couples will download</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* PDF iframe / states */}
        <div className="flex-1 bg-stone-100">
          {loading && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 size={18} className="animate-spin" />
              Generating preview…
            </div>
          )}
          {error && !loading && (
            <div className="flex h-full items-center justify-center text-sm text-red-500">
              {error}
            </div>
          )}
          {blobUrl && !loading && (
            <iframe
              src={blobUrl}
              className="h-full w-full border-0"
              title="Pricing Guide Preview"
            />
          )}
        </div>
      </div>
    </div>
  );
}
