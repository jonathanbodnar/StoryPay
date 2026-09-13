'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, MessageCircle, ChevronDown, User, Gift, LogOut } from 'lucide-react';
import { getCoupleSupabase } from '@/lib/couple-browser';

export function CoupleNav() {
  const router = useRouter();
  const [session, setSession] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getCoupleSupabase();
    void supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(!!s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

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
    <nav className="flex items-center gap-1.5 text-sm">
      <Link
        href="/couple/wedding"
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <LayoutGrid className="h-4 w-4" /> Wedding Hub
      </Link>
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
            <MenuLink href="/couple/dashboard" icon={<Gift className="h-4 w-4" />} onClick={() => setMenuOpen(false)}>
              Wish list
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
