'use client';

import { useEffect, useState, useRef } from 'react';

interface Announcement {
  id: string;
  message: string;
  link_text: string | null;
  link_url: string | null;
}

// The announcement ticker is intentionally NOT dismissible from the venue
// side — operators (super admins) need to be able to broadcast platform-wide
// messages (downtime, new features, billing changes, compliance updates)
// with confidence that every venue actually sees them.
//
// Visibility is controlled exclusively from the super admin dashboard
// (Admin → Announcements → Activate/Deactivate). The active flag drives the
// `get_active_announcements` RPC that this component reads, so a super admin
// toggle is the single source of truth for "show this on every dashboard."
//
// If we ever want a venue-side opt-out it has to be a per-announcement
// "dismissable" boolean set on the super admin side — never a client-only
// dismiss as we used to have here.
export default function AnnouncementTicker() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const tickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.ok ? r.json() : [])
      .then(data => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  if (!announcements.length) return null;

  // Build the ticker text — repeat items so it scrolls continuously
  const items = [...announcements, ...announcements];

  return (
    <div className="flex items-center text-sm text-white relative overflow-hidden border-b-4 border-b-white/10" style={{ backgroundColor: '#1b1b1b', minHeight: 42 }}>
      {/* Label */}
      <div className="flex-shrink-0 flex items-center px-3 border-r border-white/20 self-stretch">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-white/70 whitespace-nowrap">News</span>
      </div>

      {/* Scrolling ticker — fills the remaining space now that there's no
          dismiss button. Right-side fade keeps the visual treatment from
          before so the text doesn't hard-stop at the edge. */}
      <div ref={tickerRef} className="flex-1 overflow-hidden relative pr-3" style={{ maskImage: 'linear-gradient(90deg, transparent, black 40px, black calc(100% - 40px), transparent)' }}>
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
