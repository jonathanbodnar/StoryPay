'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export const EMOJIS = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '🤣',
  '😂',
  '🙂',
  '🙃',
  '😉',
  '😊',
  '😇',
  '🥰',
  '😍',
  '🤩',
  '😘',
  '😗',
  '😚',
  '😙',
  '😋',
  '😛',
  '😜',
  '🤪',
  '😝',
  '🤑',
  '🤗',
  '🤭',
  '🫣',
  '🤫',
  '🤔',
  '🫠',
  '🤐',
  '🤨',
  '😐',
  '😑',
  '😶',
  '😏',
  '😒',
  '🙄',
  '😬',
  '🤥',
  '😌',
  '😔',
  '😪',
  '🤤',
  '😴',
  '😷',
  '🤒',
  '🤕',
  '👋',
  '🤚',
  '🖐',
  '✋',
  '🖖',
  '🫱',
  '🫲',
  '🤝',
  '👍',
  '👎',
  '👏',
  '🙌',
  '🤲',
  '🫶',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🎉',
  '🎊',
  '✨',
  '🔥',
  '⚡',
  '💫',
  '⭐',
  '🌟',
  '💯',
  '✅',
];

export function EmojiPickerPopover({
  onSelect,
  onClose,
}: {
  onSelect: (e: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        zIndex: 30,
      }}
    >
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Emoji</p>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onClose();
          }}
          className="text-gray-400 hover:text-gray-600"
        >
          <X size={13} />
        </button>
      </div>
      <div
        className="overflow-y-auto p-2"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 2,
          maxHeight: 180,
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
        }}
      >
        {EMOJIS.map((emoji, i) => (
          <button
            key={i}
            type="button"
            onMouseDown={(ev) => {
              ev.preventDefault();
              onSelect(emoji);
              onClose();
            }}
            className="flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
            style={{ height: 38, fontSize: 20, lineHeight: 1 }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
