'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  Check,
  AlertTriangle,
  Image as ImageIcon,
  Link as LinkIcon,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Heart,
} from 'lucide-react';
import {
  sanitizeInspiration,
  safeHttpUrl,
  newInspirationId,
  type InspirationItem,
  type WeddingInspiration,
} from '@/lib/wedding-inspiration';

type SaveResult = { ok: boolean; conflict?: boolean; inspiration?: WeddingInspiration };

export interface InspirationBoardHandle {
  addItems: (items: InspirationItem[]) => void;
}

interface PinterestControls {
  configured: boolean;
  connected: boolean;
  username: string | null;
  onConnect: () => void;
  onImport: () => void;
  onDisconnect?: () => void;
}

interface InspirationBoardProps {
  initial: WeddingInspiration;
  onSave: (next: WeddingInspiration) => Promise<SaveResult>;
  /** Resolve a pasted link into an { imageUrl, title } preview (couple side). */
  resolveLink?: (url: string) => Promise<{ imageUrl: string | null; title: string | null }>;
  pinterest?: PinterestControls;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const InspirationBoard = forwardRef<InspirationBoardHandle, InspirationBoardProps>(function InspirationBoard(
  { initial, onSave, resolveLink, pinterest },
  ref,
) {
  const [rev, setRev] = useState<number>(initial?.rev ?? 0);
  const [items, setItems] = useState<InspirationItem[]>(initial?.items ?? []);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');

  const [urlInput, setUrlInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());

  // Everything auto-saves. Refs (not state) back the debounced/async save path
  // so it always reads the latest values regardless of React's render timing.
  const itemsRef = useRef<InspirationItem[]>(initial?.items ?? []);
  const revRef = useRef<number>(initial?.rev ?? 0);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const rerunRef = useRef(false);

  const persist = useCallback(async () => {
    if (savingRef.current) {
      rerunRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const cleaned = sanitizeInspiration({ rev: revRef.current, items: itemsRef.current });
      const res = await onSaveRef.current({ rev: revRef.current, items: cleaned.items });
      if (res.conflict) {
        if (res.inspiration) {
          itemsRef.current = res.inspiration.items;
          revRef.current = res.inspiration.rev;
          setItems(res.inspiration.items);
          setRev(res.inspiration.rev);
        }
        setConflict(true);
        return;
      }
      if (!res.ok) {
        setError('Could not save. Please try again.');
        return;
      }
      if (res.inspiration) {
        itemsRef.current = res.inspiration.items;
        revRef.current = res.inspiration.rev;
        setItems(res.inspiration.items);
        setRev(res.inspiration.rev);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
      savingRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        void persist();
      }
    }
  }, []);

  /** Apply a local change and auto-save it — immediately for discrete actions
   * (add/remove/reorder/import), debounced for continuous typing (notes). */
  const applyAndSave = useCallback(
    (next: InspirationItem[], opts?: { immediate?: boolean }) => {
      itemsRef.current = next;
      setItems(next);
      setConflict(false);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (opts?.immediate) {
        void persist();
      } else {
        saveTimerRef.current = setTimeout(() => void persist(), 900);
      }
    },
    [persist],
  );

  // Flush a pending debounced save (e.g. a note edit) if the board unmounts.
  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        void persist();
      }
    },
    [persist],
  );

  const addItems = useCallback(
    (newItems: InspirationItem[]) => {
      if (!newItems.length) return;
      const seen = new Set(itemsRef.current.map((i) => i.imageUrl || i.linkUrl || i.id));
      const deduped = newItems.filter((i) => {
        const key = i.imageUrl || i.linkUrl || i.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!deduped.length) return;
      applyAndSave([...itemsRef.current, ...deduped], { immediate: true });
    },
    [applyAndSave],
  );

  useImperativeHandle(ref, () => ({ addItems }), [addItems]);

  /**
   * Single "Add" flow for pasted URLs. Always resolves server-side when possible
   * (handles direct image links AND page links with an og:image alike — see
   * fetchLinkPreview), so there's no more "Image vs Link" button to mis-click.
   * Falls back to using the raw URL as the image if no resolver is wired up.
   */
  async function addUrl() {
    const url = safeHttpUrl(urlInput);
    if (!url) {
      setError('Enter a valid URL (starting with http).');
      return;
    }
    setError('');
    setAdding(true);
    try {
      let imageUrl: string | null = url;
      let title: string | null = null;
      if (resolveLink) {
        const preview = await resolveLink(url).catch(() => ({ imageUrl: null, title: null }));
        imageUrl = preview.imageUrl;
        title = preview.title;
      }
      addItems([
        {
          id: newInspirationId(),
          type: imageUrl ? 'image' : 'link',
          imageUrl,
          linkUrl: url,
          title: title || hostnameOf(url),
          note: null,
          source: 'manual',
        },
      ]);
      setUrlInput('');
    } finally {
      setAdding(false);
    }
  }

  function remove(id: string) {
    applyAndSave(
      itemsRef.current.filter((i) => i.id !== id),
      { immediate: true },
    );
  }
  function move(id: string, dir: -1 | 1) {
    const prev = itemsRef.current;
    const idx = prev.findIndex((i) => i.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= prev.length) return;
    const copy = [...prev];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    applyAndSave(copy, { immediate: true });
  }
  function setNote(id: string, note: string) {
    applyAndSave(itemsRef.current.map((i) => (i.id === id ? { ...i, note } : i)));
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {pinterest && (
            <>
              {pinterest.connected ? (
                <button
                  type="button"
                  onClick={pinterest.onImport}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#e60023] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  <Heart className="h-4 w-4" /> Import from Pinterest
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pinterest.onConnect}
                  disabled={!pinterest.configured}
                  title={pinterest.configured ? '' : 'Pinterest connection is not set up yet.'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#e60023] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Heart className="h-4 w-4" /> Connect Pinterest
                </button>
              )}
            </>
          )}

          <div className="flex min-w-[220px] flex-1 items-center gap-1.5">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste an image URL or link…"
              className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
            <button
              type="button"
              onClick={() => void addUrl()}
              disabled={!urlInput.trim() || adding}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Add — pulls in a preview image automatically"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          ) : savedFlash ? (
            <span className="flex items-center gap-1 text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          ) : null}
        </div>
      </div>

      {pinterest?.connected && (
        <p className="mt-2 text-xs text-gray-400">
          Pinterest connected{pinterest.username ? ` as @${pinterest.username}` : ''}.
          {pinterest.onDisconnect && (
            <button type="button" onClick={pinterest.onDisconnect} className="ml-1 underline hover:text-gray-600">
              Disconnect
            </button>
          )}
        </p>
      )}

      {conflict && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The board was updated by someone else, so we loaded the latest version. Re-add any changes you made.</span>
        </div>
      )}
      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {/* Grid */}
      {items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Start your inspiration board.</p>
          <p className="mt-1 text-xs text-gray-400">
            {pinterest ? 'Import from Pinterest, or paste image URLs and links above.' : 'Paste image URLs and links above.'}
          </p>
        </div>
      ) : (
        <div className="mt-6 [column-fill:_balance] columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
          {items.map((item, idx) => (
            <div key={item.id} className="group relative break-inside-avoid overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <a
                href={item.linkUrl || item.imageUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {item.imageUrl && !brokenImageIds.has(item.id) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.title || 'Inspiration'}
                    loading="lazy"
                    className="w-full object-cover"
                    onError={() => setBrokenImageIds((prev) => new Set(prev).add(item.id))}
                  />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-gray-50 p-4 text-center">
                    <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
                      <LinkIcon className="h-4 w-4" /> {item.title || hostnameOf(item.linkUrl || '')}
                    </span>
                  </div>
                )}
              </a>

              {/* Hover controls */}
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="pointer-events-auto flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(item.id, -1)}
                    disabled={idx === 0}
                    className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm hover:bg-white disabled:opacity-40"
                    title="Move left"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(item.id, 1)}
                    disabled={idx === items.length - 1}
                    className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm hover:bg-white disabled:opacity-40"
                    title="Move right"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="pointer-events-auto flex gap-1">
                  {item.linkUrl && (
                    <a
                      href={item.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm hover:bg-white"
                      title="Open source"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm hover:bg-red-50 hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Note */}
              <div className="p-2">
                <input
                  type="text"
                  value={item.note ?? ''}
                  onChange={(e) => setNote(item.id, e.target.value)}
                  placeholder="Add a note…"
                  className="w-full rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-xs text-gray-600 hover:border-gray-200 focus:border-gray-300 focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
          <Plus className="h-3.5 w-3.5" />
          Drag order with the arrows and add notes — changes save automatically. Both you and your{' '}
          {pinterest ? 'venue' : 'couple'} see this board.
        </div>
      )}
    </div>
  );
});

export default InspirationBoard;
