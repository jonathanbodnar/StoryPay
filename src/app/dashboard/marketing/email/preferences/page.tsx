'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw } from 'lucide-react';

type Row = {
  lead_id: string;
  email: string;
  name: string | null;
  reason: string;
  created_at: string | null;
  source: 'unsubscribe' | 'opt_out';
};

export default function EmailPreferencesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/marketing/email-subscriptions', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to load');
        setRows([]);
        return;
      }
      setRows(data.subscriptions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resubscribe(leadId: string) {
    setBusyId(leadId);
    try {
      const res = await fetch('/api/marketing/email-subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });
      if (res.ok) await load();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not update');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Email opt-in &amp; unsubscribes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Contacts who have opted out of marketing email or used the unsubscribe link. Restoring consent removes them
            from this list and allows campaigns and automations to include them again (if they match your segments).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          <Mail className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          No opted-out contacts. Everyone with an email is eligible for marketing sends unless they unsubscribe or you
          turn off consent on their lead profile.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 hidden sm:table-cell">Date</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.lead_id}-${r.source}`} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.name || '—'}</p>
                    <p className="text-xs text-gray-500">{r.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.source === 'unsubscribe' ? 'Unsubscribe link' : 'Opt-out (manual)'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busyId === r.lead_id}
                      onClick={() => void resubscribe(r.lead_id)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {busyId === r.lead_id ? <Loader2 className="inline h-3 w-3 animate-spin" /> : 'Restore consent'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
