'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Heart, User, LogOut, X } from 'lucide-react';
import { getCoupleSupabase } from '@/lib/couple-browser';
import { topBarSafeAreaPadding } from '@/lib/platform';
import { HUB_TOOLS } from './CoupleNav';

// Destinations already promoted to primary bottom tabs — excluded from the sheet.
const PRIMARY_HREFS = new Set(['/couple/wedding', '/couple/guests', '/couple/messages', '/couple/checklist']);

/**
 * Full-screen sheet opened by the "More" tab on the couple app. Lists every
 * wedding tool not already on the primary tab bar, plus Favorites, Profile, and
 * Log out. Fills the screen so the list scrolls vertically and closes via the X.
 * Owner-only tools (Budget, Invite to website) are hidden from collaborators,
 * matching the desktop Wedding Planner modal.
 */
export default function CoupleMoreSheet({
  isCollaborator,
  onClose,
}: {
  isCollaborator: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function signOut() {
    const supabase = getCoupleSupabase();
    await supabase.auth.signOut();
    onClose();
    router.push('/couple/login');
    router.refresh();
  }

  const tools = HUB_TOOLS.filter(
    (t) => !PRIMARY_HREFS.has(t.href) && (!t.ownerOnly || !isCollaborator),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="More"
      className="lg:hidden fixed inset-0 z-50 flex flex-col bg-white"
    >
      <div
        className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 pb-4"
        style={{ paddingTop: `calc(1rem + ${topBarSafeAreaPadding()})` }}
      >
        <h2 className="font-heading text-lg text-gray-900">More</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              onClick={onClose}
              className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors active:bg-gray-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
                {t.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{t.label}</p>
                <p className="truncate text-xs text-gray-500">{t.desc}</p>
              </div>
            </Link>
          ))}

          <Link
            href="/couple/favorites"
            onClick={onClose}
            className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors active:bg-gray-50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
              <Heart className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Favorites</p>
              <p className="truncate text-xs text-gray-500">Venues you&apos;ve saved</p>
            </div>
          </Link>

          <Link
            href="/couple/profile"
            onClick={onClose}
            className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors active:bg-gray-50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
              <User className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Profile</p>
              <p className="truncate text-xs text-gray-500">Your account &amp; wedding details</p>
            </div>
          </Link>
        </div>

        <div className="border-t border-gray-100 p-4">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 transition-colors active:bg-gray-50"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}
