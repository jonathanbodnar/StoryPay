'use client';

import { Loader2, Upload, X } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useVenueMediaLibrary, type VenueMediaAssetRow } from './useVenueMediaLibrary';

const ACCEPT =
  'image/jpeg,image/jpg,image/png,image/webp,image/avif,image/gif,.jpg,.jpeg,.png,.webp,.avif,.gif';

export function VenueMediaPickerModal({
  open,
  onOpenChange,
  onSelect,
  title = 'Media library',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string) => void;
  title?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { assets, loading, uploading, error, uploadFiles, reload } = useVenueMediaLibrary();

  const handlePick = useCallback(
    (a: VenueMediaAssetRow) => {
      onSelect(a.public_url);
      onOpenChange(false);
    },
    [onSelect, onOpenChange],
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      await uploadFiles(files);
      if (fileRef.current) fileRef.current.value = '';
    },
    [uploadFiles],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[min(640px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-50 px-4 py-2">
          <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading…' : 'Upload images'}
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <div className="mx-4 mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : assets.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">No images yet. Upload to add to your library.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handlePick(a)}
                  className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-left transition hover:border-gray-400 hover:ring-2 hover:ring-gray-900/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.public_url} alt="" className="h-28 w-full object-cover" />
                  <span className="block truncate px-2 py-1.5 text-[11px] text-gray-600">{a.file_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">Images only — video is not supported.</p>
      </div>
    </div>
  );
}
