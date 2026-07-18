'use client';

import { useEffect, useState } from 'react';

export interface FeatureAccess {
  hasSms: boolean;
  hasConcierge: boolean;
  isLegacy: boolean;
  planSlug: string | null;
}

let cached: FeatureAccess | null = null;
let inflight: Promise<FeatureAccess | null> | null = null;

async function fetchAccess(): Promise<FeatureAccess | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch('/api/venue/feature-access')
    .then((r) => (r.ok ? r.json() : null))
    .then((data: FeatureAccess | null) => {
      if (data) cached = data;
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Client hook for the current venue's SMS + Concierge access flags.
 * Returns null while loading. Result is process-cached so multiple
 * components share a single request.
 */
export function useFeatureAccess(): FeatureAccess | null {
  const [access, setAccess] = useState<FeatureAccess | null>(cached);
  useEffect(() => {
    let mounted = true;
    if (!cached) {
      fetchAccess().then((data) => {
        if (mounted && data) setAccess(data);
      });
    }
    return () => {
      mounted = false;
    };
  }, []);
  return access;
}
