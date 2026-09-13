'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { getCoupleSupabase } from '@/lib/couple-browser';

/**
 * StoryVenue logo in the couple header. When the couple is logged in it links
 * back to their wedding page (never signs them out); logged-out it goes to the
 * marketing home.
 */
export function CoupleLogo() {
  const [session, setSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = getCoupleSupabase();
    void supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const href = session ? '/couple/wedding' : '/';

  return (
    <div className="flex items-center gap-2.5">
      <Link href={href} className="inline-flex items-center" aria-label="StoryVenue home">
        <Image
          src="/storyvenue-logo-dark.png"
          alt="StoryVenue"
          width={130}
          height={32}
          priority
          className="h-7 w-auto"
        />
      </Link>
      {session && (
        <>
          <span className="h-5 w-px bg-gray-200" aria-hidden />
          <span className="rounded-full bg-[#1b1b1b] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white">
            Wedding Planner
          </span>
        </>
      )}
    </div>
  );
}
