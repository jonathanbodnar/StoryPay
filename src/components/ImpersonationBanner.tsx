'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

export default function ImpersonationBanner() {
  const [state, setState] = useState<{
    impersonating: boolean;
    venueName?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/impersonation-status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { impersonating?: boolean; venueName?: string } | null) => {
        if (cancelled || !d) return;
        setState({ impersonating: !!d.impersonating, venueName: d.venueName });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const exit = useCallback(async () => {
    await fetch('/api/admin/impersonate/exit', { method: 'POST' });
    window.location.href = '/admin';
  }, []);

  if (!state?.impersonating) return null;

  return (
    <div
      className="sticky top-0 z-[60] flex items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950"
      role="status"
    >
      <span>
        Viewing as <strong>{state.venueName}</strong> — super admin preview
      </span>
      <button
        type="button"
        onClick={() => void exit()}
        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
      >
        <X size={14} /> Exit to admin
      </button>
    </div>
  );
}
