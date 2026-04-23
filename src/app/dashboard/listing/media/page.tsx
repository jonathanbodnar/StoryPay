'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowLeft, Copy, Loader2, Trash2, Upload } from 'lucide-react';
import { useVenueMediaLibrary, type VenueMediaAssetRow } from '@/components/venue-media/useVenueMediaLibrary';

const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';
const ACCEPT =
  'image/jpeg,image/jpg,image/png,image/webp,image/avif,image/gif,.jpg,.jpeg,.png,.webp,.avif,.gif';

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VenueMediaPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { assets, loading, uploading, error, setError, uploadFiles, remove } = useVenueMediaLibrary();

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    await uploadFiles(files);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  async function handleDelete(a: VenueMediaAssetRow) {
    if (!window.confirm(`Remove “${a.file_name}” from your library? Links that use this URL will break.`)) return;
    await remove(a.id);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/dashboard/listing" className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to listing
          </Link>
          <h1 className="font-heading text-2xl text-gray-900 mt-1">Media library</h1>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading…' : 'Upload images'}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className={CARD}>
        {loading ? (
          <div className="flex justify-center py-20 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center text-gray-400">
            <p className="text-sm">No images in your library yet.</p>
            <p className="mt-1 text-xs text-gray-400">Video uploads are not supported.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((a) => (
              <div key={a.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                <div className="relative aspect-[4/3] bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.public_url} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="space-y-2 p-3">
                  <p className="truncate text-xs font-medium text-gray-900" title={a.file_name}>
                    {a.file_name}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {formatBytes(a.size_bytes)} · {a.content_type}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyUrl(a.public_url)}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
                    >
                      <Copy className="h-3 w-3" />
                      {copied === a.public_url ? 'Copied' : 'Copy URL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(a)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-100 bg-white px-2 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
