import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CoupleNav } from './CoupleNav';

export default function CoupleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href="/" className="inline-flex items-center" aria-label="StoryVenue home">
            <Image
              src="/storyvenue-logo-dark.png"
              alt="StoryVenue"
              width={130}
              height={32}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <CoupleNav />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
