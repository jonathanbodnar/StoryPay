'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, X, Check, ChevronLeft, Heart } from 'lucide-react';
import { coupleAuthedFetch } from '@/lib/couple-browser';
import { newInspirationId, type InspirationItem } from '@/lib/wedding-inspiration';

type Board = { id: string; name: string; coverImageUrl: string | null; pinCount: number | null };
type Pin = { id: string; imageUrl: string | null; linkUrl: string; title: string | null };

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (items: InspirationItem[]) => void;
}

export default function PinterestImportModal({ open, onClose, onAdd }: Props) {
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState('');

  const [board, setBoard] = useState<Board | null>(null);
  const [loadingPins, setLoadingPins] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadBoards = useCallback(async () => {
    setLoadingBoards(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/integrations/pinterest/boards');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load your boards.');
        return;
      }
      setBoards(Array.isArray(data.boards) ? data.boards : []);
    } finally {
      setLoadingBoards(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setBoard(null);
      setPins([]);
      setSelected(new Set());
      void loadBoards();
    }
  }, [open, loadBoards]);

  async function openBoard(b: Board) {
    setBoard(b);
    setSelected(new Set());
    setLoadingPins(true);
    setError('');
    try {
      const res = await coupleAuthedFetch(`/api/couple/integrations/pinterest/boards/${encodeURIComponent(b.id)}/pins`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load pins.');
        return;
      }
      const list = (Array.isArray(data.pins) ? data.pins : []).filter((p: Pin) => p.imageUrl);
      setPins(list);
      // Preselect everything — most brides want the whole board.
      setSelected(new Set(list.map((p: Pin) => p.id)));
    } finally {
      setLoadingPins(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelected() {
    const chosen = pins.filter((p) => selected.has(p.id));
    const items: InspirationItem[] = chosen.map((p) => ({
      id: newInspirationId(),
      type: 'pin',
      imageUrl: p.imageUrl,
      linkUrl: p.linkUrl,
      title: p.title,
      note: null,
      source: 'pinterest',
    }));
    onAdd(items);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2">
            {board && (
              <button type="button" onClick={() => setBoard(null)} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <Heart className="h-4 w-4 text-[#e60023]" />
            <h3 className="text-sm font-semibold text-gray-900">
              {board ? board.name : 'Import from Pinterest'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

          {!board ? (
            loadingBoards ? (
              <div className="flex justify-center py-16 text-gray-400"><Loader2 className="h-7 w-7 animate-spin" /></div>
            ) : boards.length === 0 && !error ? (
              <p className="py-16 text-center text-sm text-gray-400">No boards found on your Pinterest account.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {boards.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => void openBoard(b)}
                    className="group overflow-hidden rounded-xl border border-gray-200 text-left transition-shadow hover:shadow-md"
                  >
                    <div className="aspect-[4/3] w-full bg-gray-100">
                      {b.coverImageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.coverImageUrl} alt={b.name} loading="lazy" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="p-2">
                      <p className="truncate text-sm font-medium text-gray-900">{b.name}</p>
                      {b.pinCount !== null && <p className="text-[11px] text-gray-400">{b.pinCount} pins</p>}
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : loadingPins ? (
            <div className="flex justify-center py-16 text-gray-400"><Loader2 className="h-7 w-7 animate-spin" /></div>
          ) : pins.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">No pins with images on this board.</p>
          ) : (
            <div className="columns-2 gap-3 sm:columns-3 [&>*]:mb-3">
              {pins.map((p) => {
                const on = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`relative block w-full break-inside-avoid overflow-hidden rounded-xl border-2 ${on ? 'border-[#e60023]' : 'border-transparent'}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.imageUrl!} alt={p.title || 'Pin'} loading="lazy" className="w-full object-cover" />
                    <span
                      className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border ${
                        on ? 'border-[#e60023] bg-[#e60023] text-white' : 'border-white bg-white/80 text-transparent'
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {board && pins.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <span className="text-sm text-gray-500">{selected.size} selected</span>
            <button
              type="button"
              onClick={addSelected}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              Add {selected.size > 0 ? selected.size : ''} to board
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
