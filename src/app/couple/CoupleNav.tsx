'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutGrid,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  User,
  Heart,
  LogOut,
  X,
  Home,
  Users,
  Armchair,
  Clock,
  ListChecks,
  Wallet,
  Contact,
  Images,
  Globe,
  Send,
  HelpCircle,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

export const HUB_TOOLS: { href: string; label: string; desc: string; icon: React.ReactNode; ownerOnly?: boolean }[] = [
  { href: '/couple/wedding', label: 'Wedding Planner home', desc: 'Your wedding overview', icon: <Home className="h-5 w-5" /> },
  { href: '/couple/guests', label: 'Guests & RSVPs', desc: 'Track invites, meals & replies', icon: <Users className="h-5 w-5" /> },
  { href: '/couple/seating', label: 'Seating', desc: 'Arrange tables & assign guests', icon: <Armchair className="h-5 w-5" /> },
  { href: '/couple/timeline', label: 'Day-of timeline', desc: 'Plan your day minute by minute', icon: <Clock className="h-5 w-5" /> },
  { href: '/couple/checklist', label: 'Checklist', desc: 'Every to-do with a countdown', icon: <ListChecks className="h-5 w-5" /> },
  { href: '/couple/budget', label: 'Budget', desc: 'Track spending — private to you', icon: <Wallet className="h-5 w-5" />, ownerOnly: true },
  { href: '/couple/vendors', label: 'Vendors', desc: 'All your day-of contacts', icon: <Contact className="h-5 w-5" /> },
  { href: '/couple/inspiration', label: 'Inspiration', desc: 'Your style & mood board', icon: <Images className="h-5 w-5" /> },
  { href: '/couple/site', label: 'Wedding website', desc: 'Your public wedding page', icon: <Globe className="h-5 w-5" /> },
  { href: '/couple/invite-guests', label: 'Invite to website', desc: 'Email guests your wedding site', icon: <Send className="h-5 w-5" />, ownerOnly: true },
  { href: '/couple/messages', label: 'Messages', desc: 'Chat directly with your venue', icon: <MessageCircle className="h-5 w-5" /> },
];

export function CoupleNav() {
  const router = useRouter();
  const [session, setSession] = useState<boolean | null>(null);
  const [isCollaborator, setIsCollaborator] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getCoupleSupabase();
    void supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(!!s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Determine whether this account is a collaborator (not the owning couple) so
  // we can hide the owner-private Budget tool from the nav.
  useEffect(() => {
    if (!session) {
      setIsCollaborator(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await coupleAuthedFetch('/api/couple/wedding');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setIsCollaborator(data.access === 'edit' || data.access === 'view');
      } catch {
        if (!cancelled) setIsCollaborator(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Close the Wedding Planner modal on Escape, and lock body scroll while it's open.
  useEffect(() => {
    if (!hubOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setHubOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [hubOpen]);

  async function signOut() {
    const supabase = getCoupleSupabase();
    await supabase.auth.signOut();
    router.push('/couple/login');
    router.refresh();
  }

  if (session === null) {
    return <nav className="flex gap-4 text-sm text-gray-400" aria-hidden />;
  }

  if (!session) {
    return (
      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href="/couple/login" className="text-gray-700 hover:text-gray-900">
          Log in
        </Link>
        <Link href="/couple/signup" className="font-medium text-gray-900 hover:underline">
          Sign up
        </Link>
      </nav>
    );
  }

  return (
    <>
      <nav className="flex items-center gap-1.5 text-sm">
        <button
          type="button"
          onClick={() => setHubOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
          aria-haspopup="dialog"
          aria-expanded={hubOpen}
        >
          <LayoutGrid className="h-4 w-4" /> Wedding Planner
        </button>
        <Link
          href="/couple/messages"
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          <MessageCircle className="h-4 w-4" /> Messages
        </Link>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-xl px-3 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <User className="h-4 w-4" /> Account
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
            >
              <MenuLink href="/couple/profile" icon={<User className="h-4 w-4" />} onClick={() => setMenuOpen(false)}>
                Profile
              </MenuLink>
              <MenuLink href="/couple/favorites" icon={<Heart className="h-4 w-4" />} onClick={() => setMenuOpen(false)}>
                Favorites
              </MenuLink>
              <MenuLink href="/couple/help" icon={<HelpCircle className="h-4 w-4" />} onClick={() => setMenuOpen(false)}>
                Help &amp; how-to
              </MenuLink>
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          )}
        </div>
      </nav>

      {hubOpen && <WeddingPlannerModal onClose={() => setHubOpen(false)} hideBudget={isCollaborator} />}
    </>
  );
}

function WeddingPlannerModal({ onClose, hideBudget }: { onClose: () => void; hideBudget: boolean }) {
  // `hideBudget` is really "is a collaborator" — hide all owner-only tools.
  const tools = hideBudget ? HUB_TOOLS.filter((t) => !t.ownerOnly) : HUB_TOOLS;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Wedding Planner"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16 sm:pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
              <LayoutGrid className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-heading text-lg text-gray-900">Wedding Planner</h2>
              <p className="text-xs text-gray-500">Jump to any part of your planning.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {tools.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              onClick={onClose}
              className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
                {t.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{t.label}</p>
                <p className="truncate text-xs text-gray-500">{t.desc}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
    >
      {icon}
      {children}
    </Link>
  );
}
