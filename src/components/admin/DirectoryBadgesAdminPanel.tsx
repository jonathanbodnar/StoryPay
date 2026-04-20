'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { DIRECTORY_BADGE_STATUSES, directoryBadgeLabel } from '@/lib/directory-badges';

export type VenueDirectoryRow = Record<string, unknown> & {
  id: string;
  name: string;
  slug?: string | null;
  directory_verified_status?: string | null;
  directory_sponsored_status?: string | null;
};

export function DirectoryBadgesAdminPanel({
  venues,
  onRefresh,
}: {
  venues: VenueDirectoryRow[];
  onRefresh: () => Promise<void>;
}) {
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const patch = useCallback(
    async (venueId: string, field: 'directory_verified_status' | 'directory_sponsored_status', value: string) => {
      const key = `${venueId}:${field}`;
      setSavingKey(key);
      try {
        const res = await fetch(`/api/admin/venues/${venueId}/directory-badges`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          alert(j.error || 'Save failed');
          return;
        }
        await onRefresh();
      } finally {
        setSavingKey(null);
      }
    },
    [onRefresh],
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-heading text-xl text-gray-900">Verified &amp; sponsored listings</h2>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          Control the blue verified badge (Instagram-style) and the &quot;Sponsored&quot; label on public directory
          pages, search, and venue profiles. Venues can request approval from their dashboard; set status here. Only{' '}
          <strong>Approved</strong> shows badges publicly. <strong>Draft</strong> is internal (not shown to couples).
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 min-w-[180px]">Venue</th>
                <th className="px-4 py-3 min-w-[160px]">Verified</th>
                <th className="px-4 py-3 min-w-[160px]">Sponsored</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {venues.map((v: VenueDirectoryRow) => {
                const vs = (v.directory_verified_status as string) || 'none';
                const ss = (v.directory_sponsored_status as string) || 'none';
                const rowBusy = savingKey !== null && savingKey.startsWith(`${v.id}:`);
                return (
                  <tr key={v.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-gray-900">{v.name}</div>
                      {v.slug ? (
                        <div className="text-[11px] text-gray-400 mt-0.5 font-mono">{v.slug}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusSelect
                        value={vs}
                        disabled={rowBusy}
                        saving={savingKey === `${v.id}:directory_verified_status`}
                        onChange={(val) => void patch(v.id, 'directory_verified_status', val)}
                      />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusSelect
                        value={ss}
                        disabled={rowBusy}
                        saving={savingKey === `${v.id}:directory_sponsored_status`}
                        onChange={(val) => void patch(v.id, 'directory_sponsored_status', val)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {venues.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">No venues loaded</p>
        ) : null}
      </div>

      <p className="text-xs text-gray-400">
        Labels: {DIRECTORY_BADGE_STATUSES.map((s) => `${s} (${directoryBadgeLabel(s)})`).join(' · ')}
      </p>
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
  disabled,
  saving,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  saving: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-[200px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 disabled:opacity-50"
      >
        {DIRECTORY_BADGE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {directoryBadgeLabel(s)}
          </option>
        ))}
      </select>
      {saving ? <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" /> : null}
    </div>
  );
}
