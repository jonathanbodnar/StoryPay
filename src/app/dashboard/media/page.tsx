'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Grid3x3,
  Images,
  Image as ImageIcon,
  Link2,
  List as ListIcon,
  Loader2,
  Megaphone,
  MoreVertical,
  Palette,
  Pencil,
  Search,
  Store,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useVenueMediaLibrary,
  type VenueMediaAssetRow,
} from '@/components/venue-media/useVenueMediaLibrary';

type FilterMode = 'all' | 'image' | 'document';
type SortMode = 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'largest' | 'smallest';
type ViewMode = 'grid' | 'list';

type UsageRef = {
  kind:
    | 'logo'
    | 'listing_cover'
    | 'listing_gallery'
    | 'email_campaign'
    | 'email_template'
    | 'form';
  label: string;
  href: string;
};

const VIEW_KEY = 'storypay:media:view';
const SORT_KEY = 'storypay:media:sort';
const MAX_BYTES = 25 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAsset(a: VenueMediaAssetRow): boolean {
  return a.content_type.toLowerCase().startsWith('image/');
}

function fileTypeLabel(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) {
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'JPG';
    if (ct.includes('png')) return 'PNG';
    if (ct.includes('webp')) return 'WEBP';
    if (ct.includes('avif')) return 'AVIF';
    if (ct.includes('gif')) return 'GIF';
    return 'IMG';
  }
  if (ct.includes('pdf')) return 'PDF';
  if (ct.includes('wordprocessing') || ct === 'application/msword') return 'DOC';
  if (ct.includes('spreadsheet') || ct === 'application/vnd.ms-excel') return 'XLS';
  if (ct.includes('presentation') || ct === 'application/vnd.ms-powerpoint') return 'PPT';
  if (ct === 'text/csv') return 'CSV';
  if (ct === 'text/plain') return 'TXT';
  return 'FILE';
}

type PreviewKind = 'image' | 'pdf' | 'office' | 'text' | 'unsupported';

function previewKind(contentType: string): PreviewKind {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.includes('pdf')) return 'pdf';
  if (
    ct.includes('wordprocessing') ||
    ct === 'application/msword' ||
    ct.includes('spreadsheet') ||
    ct === 'application/vnd.ms-excel' ||
    ct.includes('presentation') ||
    ct === 'application/vnd.ms-powerpoint'
  ) {
    return 'office';
  }
  if (ct === 'text/plain' || ct === 'text/csv' || ct.startsWith('text/')) return 'text';
  return 'unsupported';
}

function downloadHref(asset: VenueMediaAssetRow, opts?: { inline?: boolean }): string {
  return `/api/venue-media/${asset.id}/download${opts?.inline ? '?inline=1' : ''}`;
}

function FileTypeIcon({
  contentType,
  className = 'h-7 w-7',
}: {
  contentType: string;
  className?: string;
}) {
  const ct = contentType.toLowerCase();
  if (ct.includes('spreadsheet') || ct === 'application/vnd.ms-excel' || ct === 'text/csv') {
    return <FileSpreadsheet className={className} />;
  }
  return <FileText className={className} />;
}

function UsageIcon({ kind, className = 'h-3.5 w-3.5' }: { kind: UsageRef['kind']; className?: string }) {
  if (kind === 'logo') return <Palette className={className} />;
  if (kind === 'listing_cover' || kind === 'listing_gallery') return <Store className={className} />;
  if (kind === 'email_campaign' || kind === 'email_template') return <Megaphone className={className} />;
  return <FileText className={className} />;
}

function displayName(a: VenueMediaAssetRow): string {
  return a.display_name?.trim() || a.file_name;
}

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name_asc', label: 'Name A → Z' },
  { id: 'name_desc', label: 'Name Z → A' },
  { id: 'largest', label: 'Largest first' },
  { id: 'smallest', label: 'Smallest first' },
];

const ALL_ACCEPT = [
  'image/jpeg,image/jpg,image/png,image/webp,image/avif,image/gif',
  '.jpg,.jpeg,.png,.webp,.avif,.gif',
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

export default function MediaLibraryPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    assets,
    loading,
    uploading,
    error,
    setError,
    uploadFiles,
    remove,
    rename,
    uploads,
  } = useVenueMediaLibrary();

  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('newest');
  const [view, setView] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VenueMediaAssetRow | null>(null);
  const [previewAsset, setPreviewAsset] = useState<VenueMediaAssetRow | null>(null);
  const [usage, setUsage] = useState<Record<string, UsageRef[]>>({});
  const [usageLoading, setUsageLoading] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Persist preferences
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem(VIEW_KEY) as ViewMode | null;
    if (v === 'grid' || v === 'list') setView(v);
    const s = window.localStorage.getItem(SORT_KEY) as SortMode | null;
    if (s && SORT_OPTIONS.some((o) => o.id === s)) setSort(s);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SORT_KEY, sort);
  }, [sort]);

  // Usage scan (optional but cheap)
  const refreshUsage = useCallback(async () => {
    try {
      setUsageLoading(true);
      const res = await fetch('/api/venue-media/usage', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { usage?: Record<string, UsageRef[]> };
      setUsage(data.usage ?? {});
    } finally {
      setUsageLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  // Outside click + scroll close for sort and asset menus.
  useEffect(() => {
    if (!menuId && !sortOpen) return;
    const closeAll = () => {
      setMenuId(null);
      setSortOpen(false);
    };
    window.addEventListener('mousedown', closeAll);
    // `capture: true` so we catch scrolls inside any nested scroll container.
    window.addEventListener('scroll', closeAll, true);
    return () => {
      window.removeEventListener('mousedown', closeAll);
      window.removeEventListener('scroll', closeAll, true);
    };
  }, [menuId, sortOpen]);

  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const list = Array.from(files);
      if (!list.length) return;
      const tooBig = list.find((f) => f.size > MAX_BYTES);
      if (tooBig) {
        setError(
          `${tooBig.name} is ${formatBytes(tooBig.size)} — files must be 25 MB or smaller.`,
        );
        return;
      }
      setError('');
      const added = await uploadFiles(list);
      if (added.length > 0) void refreshUsage();
      if (fileRef.current) fileRef.current.value = '';
    },
    [setError, uploadFiles, refreshUsage],
  );

  // Drag & drop on the page
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      setDragActive(true);
    }
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragActive(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  // Copy / download / rename / delete
  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  }, [setError]);

  const startRename = useCallback((a: VenueMediaAssetRow) => {
    setRenamingId(a.id);
    setRenameValue(displayName(a));
    setMenuId(null);
  }, []);

  const confirmRename = useCallback(async () => {
    if (!renamingId) return;
    const next = renameValue.trim();
    if (!next) {
      setRenamingId(null);
      return;
    }
    setSavingRename(true);
    const ok = await rename(renamingId, next);
    setSavingRename(false);
    if (ok) setRenamingId(null);
  }, [renamingId, renameValue, rename]);

  const requestDelete = useCallback((a: VenueMediaAssetRow) => {
    setPendingDelete(a);
    setMenuId(null);
  }, []);
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    const ok = await remove(pendingDelete.id);
    setDeletingId(null);
    if (ok) {
      setPendingDelete(null);
      void refreshUsage();
    }
  }, [pendingDelete, remove, refreshUsage]);

  // Filter + sort
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = assets.slice();
    if (filter === 'image') list = list.filter(isImageAsset);
    else if (filter === 'document') list = list.filter((a) => !isImageAsset(a));
    if (q) {
      list = list.filter((a) => {
        const name = displayName(a).toLowerCase();
        const fn = a.file_name.toLowerCase();
        return name.includes(q) || fn.includes(q);
      });
    }
    list.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return a.created_at.localeCompare(b.created_at);
        case 'name_asc':
          return displayName(a).localeCompare(displayName(b));
        case 'name_desc':
          return displayName(b).localeCompare(displayName(a));
        case 'largest':
          return b.size_bytes - a.size_bytes;
        case 'smallest':
          return a.size_bytes - b.size_bytes;
        case 'newest':
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return list;
  }, [assets, filter, query, sort]);

  const stats = useMemo(() => {
    const totalBytes = assets.reduce((acc, a) => acc + a.size_bytes, 0);
    const images = assets.filter(isImageAsset).length;
    const documents = assets.length - images;
    return { totalBytes, images, documents };
  }, [assets]);

  const visibleUploads = uploads.filter((u) => u.status !== 'done');

  return (
    <div
      className="px-4 py-8"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragActive ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-brand-900/10 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-brand-700 bg-white px-8 py-6 text-center shadow-xl">
            <Upload className="mx-auto mb-2 h-8 w-8 text-brand-700" />
            <p className="text-sm font-semibold text-gray-900">Drop to upload</p>
            <p className="text-xs text-gray-500">Up to 25 MB per file</p>
          </div>
        </div>
      ) : null}

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            ← Back to dashboard
          </Link>
          <h1 className="mt-1 flex items-center gap-2 font-heading text-2xl text-gray-900">
            <Images className="h-6 w-6 text-brand-600" />
            Media
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            One library for every image and file you reuse across your listing, branding, emails,
            and forms — upload once, copy a stable URL, and reuse it anywhere.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ALL_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            className="text-red-700/60 hover:text-red-900"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {visibleUploads.length > 0 ? (
        <div className="mb-4 space-y-2 rounded-xl border border-gray-200 bg-white p-3">
          {visibleUploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-medium text-gray-700">{u.fileName}</span>
                  <span className="text-[10px] text-gray-400">
                    {u.status === 'error'
                      ? u.error
                      : u.status === 'registering'
                      ? 'Saving…'
                      : `${u.progress ?? 0}%`}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full transition-all ${
                      u.status === 'error' ? 'bg-red-500' : 'bg-brand-700'
                    }`}
                    style={{ width: `${u.status === 'error' ? 100 : u.progress ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by file name…"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </div>
          <div className="hidden items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 sm:flex">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'image', label: 'Images' },
                { id: 'document', label: 'Documents' },
              ] as { id: FilterMode; label: string }[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  filter === f.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSortOpen((o) => !o);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Filter className="h-3.5 w-3.5" />
              {SORT_OPTIONS.find((o) => o.id === sort)?.label}
              <ChevronDown className="h-3 w-3" />
            </button>
            {sortOpen ? (
              <div
                className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setSort(o.id);
                      setSortOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                      sort === o.id ? 'text-brand-700' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {o.label}
                    {sort === o.id ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`rounded-md p-1.5 ${
                view === 'grid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
              aria-label="Grid view"
              title="Grid view"
            >
              <Grid3x3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`rounded-md p-1.5 ${
                view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
              aria-label="List view"
              title="List view"
            >
              <ListIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-xs sm:gap-4">
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Total</p>
          <p className="text-sm font-semibold text-gray-900">{assets.length} files</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Storage</p>
          <p className="text-sm font-semibold text-gray-900">{formatBytes(stats.totalBytes)}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Images / Docs</p>
          <p className="text-sm font-semibold text-gray-900">
            {stats.images} / {stats.documents}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-20 text-center">
          <Images className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">Your media library is empty</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
            Drop files here or click upload to add images, PDFs, Word docs, spreadsheets, and more.
            Each file gets a stable public URL you can reuse anywhere — listing, branding, emails,
            forms.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
          >
            <Upload className="h-4 w-4" /> Upload your first file
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          No matches. Try a different search or filter.
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((a) => (
            <AssetCardGrid
              key={a.id}
              asset={a}
              copied={copied === a.public_url}
              menuOpen={menuId === a.id}
              onOpenMenu={() => setMenuId(menuId === a.id ? null : a.id)}
              onCopy={() => copyUrl(a.public_url)}
              onRename={() => startRename(a)}
              onDelete={() => requestDelete(a)}
              usage={usage[a.public_url] ?? []}
              usageLoading={usageLoading}
              onPreview={() => setPreviewAsset(a)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="grid grid-cols-[1fr,120px,180px,160px] gap-4 border-b border-gray-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            <span>Name</span>
            <span>Type</span>
            <span>Used in</span>
            <span className="text-right">Size · Date · Actions</span>
          </div>
          <ul>
            {filtered.map((a) => (
              <AssetRowList
                key={a.id}
                asset={a}
                copied={copied === a.public_url}
                menuOpen={menuId === a.id}
                onOpenMenu={() => setMenuId(menuId === a.id ? null : a.id)}
                onCopy={() => copyUrl(a.public_url)}
                onRename={() => startRename(a)}
                onDelete={() => requestDelete(a)}
                usage={usage[a.public_url] ?? []}
                onPreview={() => setPreviewAsset(a)}
              />
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-gray-400">
        Allowed: images (JPG/PNG/WEBP/AVIF/GIF), PDF, Word, Excel, PowerPoint, CSV, TXT — up to 25 MB
        per file. Videos are not supported.
      </p>

      {/* ----- Rename modal ----- */}
      {renamingId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Rename file</h2>
              <button
                type="button"
                onClick={() => setRenamingId(null)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-xs text-gray-500">
                Renaming changes the display name only — the file&apos;s public URL stays the same,
                so existing links don&apos;t break.
              </p>
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setRenamingId(null)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmRename()}
                disabled={savingRename || !renameValue.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
              >
                {savingRename ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ----- Delete confirm ----- */}
      {pendingDelete ? (
        <DeleteConfirmModal
          asset={pendingDelete}
          usage={usage[pendingDelete.public_url] ?? []}
          deleting={deletingId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {/* ----- Preview modal (images, PDFs, Office docs, text) ----- */}
      {previewAsset ? (
        <PreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      ) : null}
    </div>
  );
}

function AssetCardGrid({
  asset,
  copied,
  menuOpen,
  onOpenMenu,
  onCopy,
  onRename,
  onDelete,
  usage,
  usageLoading,
  onPreview,
}: {
  asset: VenueMediaAssetRow;
  copied: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCopy: () => void;
  onRename: () => void;
  onDelete: () => void;
  usage: UsageRef[];
  usageLoading: boolean;
  onPreview: () => void;
}) {
  const isImage = isImageAsset(asset);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  return (
    <div className="group relative overflow-visible rounded-xl border border-gray-200 bg-white transition hover:border-gray-300 hover:shadow-sm">
      <button
        type="button"
        onClick={onPreview}
        className="relative block aspect-square w-full overflow-hidden rounded-t-xl bg-gray-50"
      >
        {isImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={asset.public_url}
            alt={displayName(asset)}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-gray-50 to-gray-100 text-gray-500">
            <FileTypeIcon contentType={asset.content_type} className="h-10 w-10" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {fileTypeLabel(asset.content_type)}
            </span>
          </div>
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 backdrop-blur">
          {fileTypeLabel(asset.content_type)}
        </span>
      </button>
      <div className="flex items-start justify-between gap-2 px-3 pb-3 pt-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-gray-900" title={displayName(asset)}>
            {displayName(asset)}
          </p>
          <p className="text-[10px] text-gray-500">
            {formatBytes(asset.size_bytes)} ·{' '}
            {new Date(asset.created_at).toLocaleDateString()}
          </p>
          <UsageChip usage={usage} loading={usageLoading} />
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-md p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
            aria-label="Delete"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            ref={setTriggerEl}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu();
            }}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="More actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <AssetMenu
              asset={asset}
              copied={copied}
              onCopy={onCopy}
              onRename={onRename}
              onDelete={onDelete}
              triggerEl={triggerEl}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AssetRowList({
  asset,
  copied,
  menuOpen,
  onOpenMenu,
  onCopy,
  onRename,
  onDelete,
  usage,
  onPreview,
}: {
  asset: VenueMediaAssetRow;
  copied: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCopy: () => void;
  onRename: () => void;
  onDelete: () => void;
  usage: UsageRef[];
  onPreview: () => void;
}) {
  const isImage = isImageAsset(asset);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  return (
    <li className="grid grid-cols-[1fr,120px,180px,160px] items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50">
      <button type="button" onClick={onPreview} className="flex min-w-0 items-center gap-3 text-left">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={asset.public_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <FileTypeIcon contentType={asset.content_type} className="h-5 w-5 text-gray-500" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-gray-900">
            {displayName(asset)}
          </span>
          <span className="block truncate text-[11px] text-gray-500">{asset.file_name}</span>
        </span>
      </button>
      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
          {fileTypeLabel(asset.content_type)}
        </span>
      </span>
      <span className="text-xs">
        <UsageChip usage={usage} loading={false} compact />
      </span>
      <div className="flex items-center justify-end gap-1 text-xs text-gray-500">
        <span className="hidden text-right sm:block">
          {formatBytes(asset.size_bytes)}
          <br />
          <span className="text-[10px] text-gray-400">
            {new Date(asset.created_at).toLocaleDateString()}
          </span>
        </span>
        <button
          type="button"
          onClick={onCopy}
          title="Copy URL"
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
          aria-label="Delete"
          className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          ref={setTriggerEl}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu();
          }}
          title="More actions"
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
        {menuOpen ? (
          <AssetMenu
            asset={asset}
            copied={copied}
            onCopy={onCopy}
            onRename={onRename}
            onDelete={onDelete}
            triggerEl={triggerEl}
          />
        ) : null}
      </div>
    </li>
  );
}

/**
 * Portal-rendered, viewport-aware asset action menu. We portal it to <body>
 * because the asset cards use `overflow-hidden` for the rounded image clip,
 * which would otherwise hide the popover. Position is computed from the
 * trigger button's bounding rect with a flip-up fallback if the menu would
 * spill below the viewport.
 */
function AssetMenu({
  asset,
  copied,
  onCopy,
  onRename,
  onDelete,
  triggerEl,
}: {
  asset: VenueMediaAssetRow;
  copied: boolean;
  onCopy: () => void;
  onRename: () => void;
  onDelete: () => void;
  triggerEl: HTMLElement | null;
}) {
  // `triggerEl` is set via a callback ref, which only fires on the client,
  // so its presence implies we've hydrated and `document` is safe to use.
  if (!triggerEl || typeof document === 'undefined') return null;

  const MENU_W = 192; // tailwind w-44 (176) + a little buffer
  const MENU_H = 240; // ~6 items
  const r = triggerEl.getBoundingClientRect();
  const wantBelow = r.bottom + MENU_H + 8 < window.innerHeight;
  const top = wantBelow ? r.bottom + 4 : Math.max(8, r.top - MENU_H - 4);
  const left = Math.max(8, Math.min(window.innerWidth - MENU_W - 8, r.right - MENU_W));

  return createPortal(
    <div
      style={{ position: 'fixed', top, left, zIndex: 100 }}
      className="w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <button
        type="button"
        onClick={onCopy}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy URL'}
      </button>
      <a
        href={downloadHref(asset)}
        download={asset.display_name?.trim() || asset.file_name}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </a>
      <a
        href={asset.public_url}
        target="_blank"
        rel="noreferrer"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
      >
        <Link2 className="h-3.5 w-3.5" />
        Open in new tab
      </a>
      <button
        type="button"
        onClick={onRename}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
      >
        <Pencil className="h-3.5 w-3.5" />
        Rename
      </button>
      <div className="my-1 h-px bg-gray-100" />
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    </div>,
    document.body,
  );
}

function UsageChip({
  usage,
  loading,
  compact = false,
}: {
  usage: UsageRef[];
  loading: boolean;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" /> checking…
      </span>
    );
  }
  if (usage.length === 0) {
    return (
      <span className={`mt-1 inline-flex items-center text-[10px] text-gray-400 ${compact ? '' : ''}`}>
        Not used yet
      </span>
    );
  }
  // Show first ref + count
  const first = usage[0];
  const more = usage.length - 1;
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-brand-700">
      <UsageIcon kind={first.kind} />
      <span className="truncate">
        {first.label}
        {more > 0 ? ` +${more}` : ''}
      </span>
    </span>
  );
}

function DeleteConfirmModal({
  asset,
  usage,
  deleting,
  onCancel,
  onConfirm,
}: {
  asset: VenueMediaAssetRow;
  usage: UsageRef[];
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Delete file?</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-white">
              {isImageAsset(asset) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={asset.public_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <FileTypeIcon contentType={asset.content_type} className="h-5 w-5 text-gray-500" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{displayName(asset)}</p>
              <p className="text-[11px] text-gray-500">
                {formatBytes(asset.size_bytes)} · {asset.content_type}
              </p>
            </div>
          </div>
          {usage.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="mb-2 font-semibold">
                <ImageIcon className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
                Used in {usage.length} place{usage.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-1">
                {usage.slice(0, 5).map((u, i) => (
                  <li key={i}>
                    <Link
                      href={u.href}
                      className="inline-flex items-center gap-1 text-amber-900 underline-offset-2 hover:underline"
                    >
                      <UsageIcon kind={u.kind} className="h-3 w-3" />
                      {u.label}
                    </Link>
                  </li>
                ))}
                {usage.length > 5 ? (
                  <li className="text-amber-700">+{usage.length - 5} more</li>
                ) : null}
              </ul>
              <p className="mt-2">
                Deleting will break the public URL in those places. Replace it there first if you
                want to keep them working.
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              We didn&apos;t find any references to this file in your listing, branding, emails, or
              forms. It should be safe to delete.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete file
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Unified preview modal. Picks a viewer based on the asset's content_type:
 *  - images → full-bleed <img>
 *  - PDFs → in-browser PDF viewer via <iframe> on the public URL
 *  - Office docs (doc / docx / xls / xlsx / ppt / pptx) → Microsoft Office
 *    Online "embed" viewer pointed at the public URL
 *  - text / csv → fetched and rendered in a styled <pre>
 *  - everything else → a graceful "preview not available" with a Download CTA
 *
 * The download / open-in-new-tab actions on the toolbar always work — even for
 * the unsupported case — so users can always get to the file.
 */
function PreviewModal({ asset, onClose }: { asset: VenueMediaAssetRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const kind = previewKind(asset.content_type);
  const name = displayName(asset);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-stretch bg-black/80 p-4 sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileTypeIcon contentType={asset.content_type} className="h-5 w-5 text-gray-500" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
              <p className="truncate text-[11px] text-gray-500">
                {fileTypeLabel(asset.content_type)} · {formatBytes(asset.size_bytes)}
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <a
              href={asset.public_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              title="Open in new tab"
            >
              <Link2 className="h-3.5 w-3.5" />
              Open
            </a>
            <a
              href={downloadHref(asset)}
              download={name}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden bg-gray-50">
          {kind === 'image' ? (
            <div className="flex h-full w-full items-center justify-center bg-black/5 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.public_url}
                alt={name}
                className="max-h-full max-w-full rounded object-contain"
              />
            </div>
          ) : kind === 'pdf' ? (
            <iframe
              title={name}
              src={`${asset.public_url}#view=FitH`}
              className="h-full w-full border-0 bg-white"
            />
          ) : kind === 'office' ? (
            <OfficePreview asset={asset} />
          ) : kind === 'text' ? (
            <TextPreview asset={asset} />
          ) : (
            <UnsupportedPreview asset={asset} />
          )}
        </div>
      </div>
    </div>
  );
}

function OfficePreview({ asset }: { asset: VenueMediaAssetRow }) {
  // Microsoft's hosted "Office Online" embed viewer renders Word, Excel, and
  // PowerPoint files as long as the source URL is publicly reachable, which
  // every Supabase public bucket already is.
  const src = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(asset.public_url)}`;
  return (
    <iframe
      title={displayName(asset)}
      src={src}
      className="h-full w-full border-0 bg-white"
      // The Office embed sets X-Frame-Options ALLOWALL; sandbox lightly so the
      // viewer keeps its scripts but can't pop new windows out.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}

function TextPreview({ asset }: { asset: VenueMediaAssetRow }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Stream through our own /download endpoint so we never hit a CORS wall
    // when fetching a text asset across origins.
    void fetch(downloadHref(asset, { inline: true }), { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((t) => {
        if (cancelled) return;
        // Cap visible content so opening a 25 MB CSV doesn't freeze the tab.
        setText(t.length > 200_000 ? `${t.slice(0, 200_000)}\n\n… file truncated for preview.` : t);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [asset]);
  if (err) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-red-700">
        {err}
      </div>
    );
  }
  if (text === null) {
    return (
      <div className="flex h-full w-full items-center justify-center text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  return (
    <pre className="h-full w-full overflow-auto bg-white p-4 font-mono text-xs leading-relaxed text-gray-800">
      {text}
    </pre>
  );
}

function UnsupportedPreview({ asset }: { asset: VenueMediaAssetRow }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center text-gray-600">
      <FileTypeIcon contentType={asset.content_type} className="mb-3 h-10 w-10 text-gray-400" />
      <p className="text-sm font-medium text-gray-800">In-browser preview isn&apos;t available for this file type.</p>
      <p className="mt-1 max-w-md text-xs text-gray-500">
        Use the Download button above to save it to your computer, or Open to view it directly in a new
        tab.
      </p>
    </div>
  );
}
