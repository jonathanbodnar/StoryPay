'use client';

import { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';

interface Announcement {
  id: string;
  message: string;
  link_text: string | null;
  link_url: string | null;
}

export default function AnnouncementTicker() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed]         = useState(false);
  const tickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.ok ? r.json() : [])
      .then(data => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  if (!announcements.length || dismissed) return null;

  // Build the ticker text — repeat items so it scrolls continuously
  const items = [...announcements, ...announcements];

  return (
    <div className="flex items-center text-sm text-white relative overflow-hidden border-b-4 border-b-white/10" style={{ backgroundColor: '#1b1b1b', minHeight: 42 }}>
      {/* Label */}
      <div className="flex-shrink-0 flex items-center px-3 border-r border-white/20 self-stretch">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/70 whitespace-nowrap">News</span>
      </div>

      {/* Scrolling ticker */}
      <div ref={tickerRef} className="flex-1 overflow-hidden relative" style={{ maskImage: 'linear-gradient(90deg, transparent, black 40px, black calc(100% - 40px), transparent)' }}>
        <div className="flex items-center whitespace-nowrap animate-ticker gap-16 py-2 px-4">
          {items.map((ann, i) => (
            <span key={`${ann.id}-${i}`} className="inline-flex items-center gap-2 text-white/90 text-xs">
              <span className="h-1 w-1 rounded-full bg-white/40 flex-shrink-0" />
              <span>{ann.message}</span>
              {ann.link_text && ann.link_url && (
                <a
                  href={ann.link_url}
                  target={ann.link_url.startsWith('http') ? '_blank' : '_self'}
                  rel="noreferrer"
                  className="underline font-semibold text-white hover:text-white/80 transition-colors"
                >
                  {ann.link_text}
                </a>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 flex items-center justify-center self-center mx-2 h-5 w-5 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X size={12} />
      </button>

      <style>{`
        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-ticker {
          animation: ticker 30s linear infinite;
        }
        .animate-ticker:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
