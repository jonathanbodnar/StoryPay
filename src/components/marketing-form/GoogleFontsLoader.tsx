'use client';

import { useEffect, useMemo } from 'react';
import { googleFontsStylesheetHref } from '@/lib/google-fonts';

/** Injects a Google Fonts stylesheet for the given family names (weights 400–700). */
export function GoogleFontsLoader({ families }: { families: string[] }) {
  const href = useMemo(() => googleFontsStylesheetHref(families), [families]);

  useEffect(() => {
    if (!href) return;
    const id = `gf-${href.replace(/[^a-z0-9]/gi, '').slice(0, 48)}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [href]);

  return null;
}
