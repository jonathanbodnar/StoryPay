'use client';

import { FileText, Loader2, Upload, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useVenueMediaLibrary, type VenueMediaAssetRow } from './useVenueMediaLibrary';

const IMAGE_ACCEPT =
  'image/jpeg,image/jpg,image/png,image/webp,image/avif,image/gif,.jpg,.jpeg,.png,.webp,.avif,.gif';

const FILE_ACCEPT = [
  'application/pdf,.pdf',
  'application/msword,.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx',
  'application/vnd.ms-excel,.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx',
  'application/vnd.ms-powerpoint,.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx',
  'text/plain,.txt',
  'text/csv,.csv',
].join(',');

const ALL_ACCEPT = `${IMAGE_ACCEPT},${FILE_ACCEPT}`;

function isImageAsset(a: { content_type: string }): boolean {
  return a.content_type.toLowerCase().startsWith('image/');
}

function fileLabel(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf')) return 'PDF';
  if (ct.includes('wordprocessing') || ct === 'application/msword') return 'Word';
  if (ct.includes('spreadsheet') || ct === 'application/vnd.ms-excel') return 'Excel';
  if (ct.includes('presentation') || ct === 'application/vnd.ms-powerpoint') return 'PowerPoint';
  if (ct === 'text/csv') return 'CSV';
  if (ct === 'text/plain') return 'Text';
  return 'File';
}

export type VenueMediaSelection = {
  url: string;
  fileName: string;
  contentType: string;
  isImage: boolean;
};

export type VenueMediaPickerMode = 'image' | 'file' | 'all';

export function VenueMediaPickerModal({
  open,
  onOpenChange,
  onSelect,
  title = 'Media library',
  mode = 'image',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with a string for backwards compat; use `onSelectAsset` for richer payload */
  onSelect: (url: string, asset?: VenueMediaSelection) => void;
  title?: string;
  /** `image` keeps the original image-only flow. `file` shows non-image docs. `all` shows everything. */
  mode?: VenueMediaPickerMode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { assets, loading, uploading, error, uploadFiles, reload } = useVenueMediaLibrary();
  const [activeTabState, setActiveTabState] = useState<VenueMediaPickerMode>(mode);
  
  // If mode is forced to 'image' or 'file', use that. Otherwise use the selected tab.
  const activeTab = mode === 'all' ? activeTabState : mode;

  const handlePick = useCallback(
    (a: VenueMediaAssetRow) => {
      onSelect(a.public_url, {
        url: a.public_url,
        fileName: a.file_name,
        contentType: a.content_type,
        isImage: isImageAsset(a),
      });
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

  const filtered = useMemo(() => {
    if (activeTab === 'image') return assets.filter(isImageAsset);
    if (activeTab === 'file') return assets.filter((a) => !isImageAsset(a));
    return assets;
  }, [assets, activeTab]);

  const acceptString =
    mode === 'file' || activeTab === 'file'
      ? FILE_ACCEPT
      : activeTab === 'image'
      ? IMAGE_ACCEPT
      : ALL_ACCEPT;
  const uploadLabel =
    mode === 'file' || activeTab === 'file'
      ? uploading ? 'Uploading…' : 'Upload files'
      : activeTab === 'image'
      ? uploading ? 'Uploading…' : 'Upload images'
      : uploading ? 'Uploading…' : 'Upload files';

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

        {mode === 'all' ? (
          <div className="flex items-center gap-1 border-b border-gray-100 bg-gray-50 px-4 py-2">
            {(['all', 'image', 'file'] as VenueMediaPickerMode[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTabState(t)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                  activeTab === t
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Files'}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-50 px-4 py-2">
          <input
            ref={fileRef}
            type="file"
            accept={acceptString}
            multiple
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploadLabel}
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
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">
              {activeTab === 'image'
                ? 'No images yet. Upload to add to your library.'
                : activeTab === 'file'
                ? 'No files yet. Upload PDFs, Word docs, spreadsheets, and more.'
                : 'No media yet. Upload to get started.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handlePick(a)}
                  className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-left transition hover:border-gray-400 hover:ring-2 hover:ring-gray-900/10"
                >
                  {isImageAsset(a) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={a.public_url} alt="" className="h-28 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-gray-100 to-gray-50 text-gray-500">
                      <FileText className="h-7 w-7" />
                      <span className="text-[11px] font-semibold uppercase tracking-wide">
                        {fileLabel(a.content_type)}
                      </span>
                    </div>
                  )}
                  <span className="block truncate px-2 py-1.5 text-[11px] text-gray-600">
                    {a.display_name ?? a.file_name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
          Images, PDFs, Word, Excel, PowerPoint, CSV, and text — videos are not supported.
        </p>
      </div>
    </div>
  );
}
