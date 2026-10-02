'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Per-venue brand color palette — singleton cache shared across every
// component that calls useBrandColors() so a save in one place updates
// every open color picker simultaneously.
//
// Stored on the server as venues.brand_colors (jsonb). The API normalizes
// to lowercase #rrggbb hex strings and dedupes.

let cached: string[] | null = null;
let pending: Promise<string[]> | null = null;
const listeners = new Set<(colors: string[]) => void>();
const NONE: string[] = [];

function broadcast(next: string[]) {
  cached = next;
  for (const l of listeners) l(next);
}

function normalizeHex(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  const hex = v.startsWith('#') ? v : `#${v}`;
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

async function loadFromServer(force = false): Promise<string[]> {
  if (cached && !force) return cached;
  if (pending) return pending;
  pending = fetch('/api/venues/me', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((d): string[] => {
      if (!d || !Array.isArray(d.brand_colors)) return [];
      return d.brand_colors
        .map((c: unknown) => (typeof c === 'string' ? normalizeHex(c) : null))
        .filter((c: string | null): c is string => Boolean(c));
    })
    .then(c => {
      broadcast(c);
      pending = null;
      return c;
    })
    .catch(() => {
      pending = null;
      return [];
    });
  return pending;
}

async function persist(next: string[]) {
  try {
    await fetch('/api/venues/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_colors: next }),
    });
  } catch {
    // Non-critical — UI already reflects the optimistic value.
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (cached === null) void loadFromServer();
  return () => { listeners.delete(onChange); };
}

export function useBrandColors() {
  const colors = useSyncExternalStore(subscribe, () => cached ?? NONE, () => NONE);

  const addColor = useCallback(async (raw: string) => {
    const hex = normalizeHex(raw);
    if (!hex) return;
    const current = cached ?? [];
    if (current.includes(hex)) return;
    const next = [...current, hex].slice(0, 50);
    broadcast(next);
    await persist(next);
  }, []);

  const removeColor = useCallback(async (raw: string) => {
    const hex = normalizeHex(raw);
    if (!hex) return;
    const current = cached ?? [];
    if (!current.includes(hex)) return;
    const next = current.filter(c => c !== hex);
    broadcast(next);
    await persist(next);
  }, []);

  const setAll = useCallback(async (raws: string[]) => {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const r of raws) {
      const hex = normalizeHex(r);
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      next.push(hex);
    }
    broadcast(next);
    await persist(next);
  }, []);

  const refresh = useCallback(async () => {
    pending = null;
    await loadFromServer(true); // tells every caller
  }, []);

  return { colors, addColor, removeColor, setAll, refresh };
}
