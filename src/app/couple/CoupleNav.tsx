'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getCoupleSupabase } from '@/lib/couple-browser';

export function CoupleNav() {
  const router = useRouter();
  const [session, setSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = getCoupleSupabase();
    void supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(!!s);
    });
    return () => sub.subscription.unsubscribe();
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
    <nav className="flex flex-wrap items-center gap-4 text-sm">
      <Link href="/couple/dashboard" className="text-gray-700 hover:text-gray-900">
        Wish list
      </Link>
      <Link href="/couple/profile" className="text-gray-700 hover:text-gray-900">
        Profile
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        className="text-gray-500 hover:text-gray-800"
      >
        Log out
      </button>
    </nav>
  );
}
