import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CoupleNav } from './CoupleNav';
import { CoupleLogo } from './CoupleLogo';

export const metadata: Metadata = {
  title: {
    default: 'Wedding Hub',
    template: '%s · Wedding Hub',
  },
};

export default function CoupleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#fafaf9]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <CoupleLogo />
          <CoupleNav />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
