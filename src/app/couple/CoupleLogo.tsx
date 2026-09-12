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
  );
}
