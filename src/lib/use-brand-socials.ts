'use client';

import { useCallback, useEffect, useState } from 'react';

// Per-venue social network links — singleton cache shared across every
// component that calls useBrandSocials() so a save in one place updates
// every open editor simultaneously.
//
// Stored on the server as venues.brand_socials (jsonb). The API validates
// each entry is { platform: <known>, url: http(s) URL } and dedupes by
// platform.

export type SocialLink = { platform: string; url: string };

export const SOCIAL_PLATFORM_DEFS = [
  { id: 'facebook',  label: 'Facebook',     placeholder: 'https://facebook.com/yourpage' },
  { id: 'instagram', label: 'Instagram',    placeholder: 'https://instagram.com/handle' },
  { id: 'youtube',   label: 'YouTube',      placeholder: 'https://youtube.com/@channel' },
  { id: 'tiktok',    label: 'TikTok',       placeholder: 'https://tiktok.com/@handle' },
  { id: 'pinterest', label: 'Pinterest',    placeholder: 'https://pinterest.com/handle' },
  { id: 'linkedin',  label: 'LinkedIn',     placeholder: 'https://linkedin.com/company/handle' },
  { id: 'twitter',   label: 'X / Twitter',  placeholder: 'https://x.com/handle' },
  { id: 'threads',   label: 'Threads',      placeholder: 'https://threads.net/@handle' },
  { id: 'website',   label: 'Website',      placeholder: 'https://yourvenue.com' },
] as const;

export type SocialPlatformId = typeof SOCIAL_PLATFORM_DEFS[number]['id'];

const KNOWN = new Set<string>(SOCIAL_PLATFORM_DEFS.map(p => p.id));

let cached: SocialLink[] | null = null;
let pending: Promise<SocialLink[]> | null = null;
const listeners = new Set<(links: SocialLink[]) => void>();

function broadcast(next: SocialLink[]) {
  cached = next;
  for (const l of listeners) l(next);
}

function normalize(raw: { platform?: unknown; url?: unknown } | null | undefined): SocialLink | null {
  if (!raw) return null;
  const p = String(raw.platform ?? '').trim().toLowerCase();
  const u = String(raw.url ?? '').trim();
  if (!KNOWN.has(p) || !u) return null;
  const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    const url = new URL(withProto);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { platform: p, url: withProto };
}

async function loadFromServer(): Promise<SocialLink[]> {
  if (cached) return cached;
  if (pending) return pending;
  pending = fetch('/api/venues/me', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((d): SocialLink[] => {
      if (!d || !Array.isArray(d.brand_socials)) return [];
      const seen = new Set<string>();
      const out: SocialLink[] = [];
      for (const raw of d.brand_socials) {
        const n = normalize(raw);
        if (!n || seen.has(n.platform)) continue;
        seen.add(n.platform);
        out.push(n);
      }
      return out;
    })
    .then(links => {
      broadcast(links);
      pending = null;
      return links;
    })
    .catch(() => {
      pending = null;
      return [];
    });
  return pending;
}

async function persist(next: SocialLink[]) {
  try {
    await fetch('/api/venues/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_socials: next }),
    });
  } catch {
    // Non-critical — UI already reflects the optimistic value.
  }
}

export function useBrandSocials() {
  const [socials, setSocials] = useState<SocialLink[]>(cached ?? []);

  useEffect(() => {
    listeners.add(setSocials);
    if (cached === null) {
      void loadFromServer();
    } else {
      setSocials(cached);
    }
    return () => {
      listeners.delete(setSocials);
    };
  }, []);

  const setUrl = useCallback(async (platform: string, url: string) => {
    const p = platform.trim().toLowerCase();
    if (!KNOWN.has(p)) return;
    const current = cached ?? [];
    const trimmed = url.trim();
    let next: SocialLink[];
    if (!trimmed) {
      next = current.filter(l => l.platform !== p);
    } else {
      const n = normalize({ platform: p, url: trimmed });
      if (!n) return;
      const others = current.filter(l => l.platform !== p);
      next = [...others, n];
    }
    broadcast(next);
    await persist(next);
  }, []);

  const remove = useCallback(async (platform: string) => {
    const p = platform.trim().toLowerCase();
    const current = cached ?? [];
    const next = current.filter(l => l.platform !== p);
    if (next.length === current.length) return;
    broadcast(next);
    await persist(next);
  }, []);

  const refresh = useCallback(async () => {
    cached = null;
    pending = null;
    const next = await loadFromServer();
    setSocials(next);
  }, []);

  const get = useCallback((platform: string) => {
    return socials.find(l => l.platform === platform)?.url ?? '';
  }, [socials]);

  return { socials, setUrl, remove, refresh, get };
}
