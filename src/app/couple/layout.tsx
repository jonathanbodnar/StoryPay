import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import CoupleShell from './CoupleShell';

export const metadata: Metadata = {
  title: {
    default: 'Wedding Planner',
    template: '%s · Wedding Planner',
  },
};

export default function CoupleLayout({ children }: { children: ReactNode }) {
  return <CoupleShell>{children}</CoupleShell>;
}
