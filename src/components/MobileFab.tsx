'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, X, MessageCircle, UserPlus, CreditCard, FileText } from 'lucide-react';

/**
 * Floating action button — bottom-right above the tab bar.
 * Tapping reveals the most common "create" actions.
 */
const ACTIONS = [
  { label: 'New message',  href: '/dashboard/conversations', icon: MessageCircle },
  { label: 'Add contact',  href: '/dashboard/contacts',      icon: UserPlus },
  { label: 'New payment',  href: '/dashboard/payments/new',  icon: CreditCard },
  { label: 'New proposal', href: '/dashboard/proposals',     icon: FileText },
];

export default function MobileFab() {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div
      className="lg:hidden fixed right-4 z-40"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
    >
      {/* Action menu */}
      {open && (
        <>
          <div
            className="fixed inset-0 -z-10 bg-black/20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <ul className="mb-3 flex flex-col items-end gap-2">
            {ACTIONS.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <Link
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-full bg-white pl-4 pr-4 py-2.5 text-sm font-medium text-gray-900 shadow-lg ring-1 ring-gray-200"
                >
                  <Icon size={16} className="text-gray-600" />
                  <span>{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* FAB button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition-transform active:scale-95"
        style={{ backgroundColor: '#1b1b1b' }}
        aria-label={open ? 'Close quick actions' : 'Open quick actions'}
      >
        {open ? <X size={22} /> : <Plus size={24} />}
      </button>
    </div>
  );
}
