'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const CALENDAR_URL = 'https://api.leadconnectorhq.com/widget/booking/YeI4ZUC2SwV8MXDRKfzr';
const CALENDAR_ID  = 'YeI4ZUC2SwV8MXDRKfzr_1779890654536';
const GHL_SCRIPT   = 'https://link.msgsndr.com/js/form_embed.js';

/**
 * Strategy-call booking modal for the dashboard — same GHL embed used on the
 * /book-more-weddings and /strategy-call marketing pages.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <DashboardBookingModal open={open} onClose={() => setOpen(false)} />
 */
export default function DashboardBookingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const scriptLoaded = useRef(false);
  const [mounted, setMounted] = useState(false);

  // Load the GHL embed script once on first open.
  useEffect(() => {
    if (!open || scriptLoaded.current) return;
    scriptLoaded.current = true;
    if (!document.querySelector(`script[src="${GHL_SCRIPT}"]`)) {
      const s = document.createElement('script');
      s.src = GHL_SCRIPT;
      s.type = 'text/javascript';
      s.async = true;
      document.body.appendChild(s);
    }
    setMounted(true);
  }, [open]);

  // Prevent body scroll while open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open && !mounted) return null;

  return (
    <>
      {/* MOBILE — full-screen scroll container */}
      <div
        className={`sm:hidden fixed inset-0 z-[9999] bg-white overflow-y-auto ${open ? '' : '!hidden'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Book your free strategy call"
        aria-hidden={!open}
        style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onClose}
          className="fixed top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <iframe
          src={CALENDAR_URL}
          id={CALENDAR_ID}
          title="Book your free strategy call"
          scrolling="no"
          style={{ width: '100%', border: 'none', overflow: 'hidden', display: 'block' }}
        />
      </div>

      {/* DESKTOP — centered card */}
      <div
        className={`hidden sm:flex fixed inset-0 z-[9999] items-center justify-center bg-black/50 ${open ? '' : '!hidden'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Book your free strategy call"
        aria-hidden={!open}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Book a Strategy Call</h2>
              <p className="text-xs text-gray-500 mt-0.5">Free · 30 minutes · No pitch, no pressure.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          {/* Calendar */}
          <div className="bg-white px-10">
            <iframe
              src={CALENDAR_URL}
              id={`${CALENDAR_ID}_dashboard_desktop`}
              className="block bg-white"
              style={{ width: '100%', border: 'none', overflow: 'hidden' }}
              scrolling="no"
              title="Book your free strategy call"
            />
          </div>
          <p className="shrink-0 text-center text-xs text-gray-400 pb-4">
            We&apos;ll review your venue and come prepared with real numbers.
          </p>
        </div>
      </div>
    </>
  );
}
