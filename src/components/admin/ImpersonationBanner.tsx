'use client';

import { useState } from 'react';
import { ShieldCheck, LogOut, Loader2 } from 'lucide-react';

export default function ImpersonationBanner({ venueName }: { venueName: string }) {
  const [loading, setLoading] = useState(false);

  async function exit() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate/exit', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      window.location.href = data.redirect || '/admin/support';
    } catch {
      window.location.href = '/admin/support';
    }
  }

  return (
    <div className="fixed top-0 inset-x-0 z-[200] flex items-center justify-between gap-3 bg-gray-900 px-4 py-2 text-white shadow-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
        <span className="text-gray-300">Viewing as</span>
        <span className="font-semibold truncate">{venueName}</span>
      </div>
      <button
        onClick={() => void exit()}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 transition-colors shrink-0 disabled:opacity-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
        Exit to support inbox
      </button>
    </div>
  );
}
