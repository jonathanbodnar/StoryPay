'use client';

import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Check,
  Loader2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DIRECTORY_BADGE_STATUSES,
  directoryBadgeLabel,
  type DirectoryBadgeStatus,
} from '@/lib/directory-badges';
import type { AdminVenueRow } from './VenueManagementPortal';

const BRAND = '#1b1b1b';

type BadgeField = 'directory_verified_status' | 'directory_sponsored_status';

type ViewMode = 'queue' | 'all';

function getStatus(v: AdminVenueRow, field: BadgeField): DirectoryBadgeStatus {
  const raw = (v[field] as string | null | undefined) || 'none';
  return (DIRECTORY_BADGE_STATUSES as readonly string[]).includes(raw)
    ? (raw as DirectoryBadgeStatus)
    : 'none';
}

function statusBadgeClass(status: DirectoryBadgeStatus): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'pending':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'rejected':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'draft':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'none':
    default:
      return 'bg-gray-50 text-gray-500 border-gray-200';
  }
}

export function DirectoryBadgesAdminPanel({
  venues,
  venuesLoading,
  onRefresh,
}: {
  venues: AdminVenueRow[];
  venuesLoading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [view, setView] = useState<ViewMode>('all');
  const [search, setSearch] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const counts = useMemo(() => {
    const c = {
      pendingVerified: 0,
      pendingSponsored: 0,
      approvedVerified: 0,
      approvedSponsored: 0,
      rejected: 0,
      draft: 0,
    };
    for (const v of venues) {
      const vs = getStatus(v, 'directory_verified_status');
      const ss = getStatus(v, 'directory_sponsored_status');
      if (vs === 'pending') c.pendingVerified++;
      if (ss === 'pending') c.pendingSponsored++;
      if (vs === 'approved') c.approvedVerified++;
      if (ss === 'approved') c.approvedSponsored++;
      if (vs === 'rejected' || ss === 'rejected') c.rejected++;
      if (vs === 'draft' || ss === 'draft') c.draft++;
    }
    return c;
  }, [venues]);

  const searchFilter = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (v: AdminVenueRow) => {
      if (!q) return true;
      const blob = [v.name, v.email, v.phone, v.slug, v.ghl_location_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    };
  }, [search]);

  const queue = useMemo(() => {
    return venues
      .filter(searchFilter)
      .map((v) => ({
        venue: v,
        verified: getStatus(v, 'directory_verified_status'),
        sponsored: getStatus(v, 'directory_sponsored_status'),
      }))
      .filter((row) => row.verified === 'pending' || row.sponsored === 'pending')
      .sort((a, b) => {
        const aDate = (a.venue.created_at as string) || '';
        const bDate = (b.venue.created_at as string) || '';
        return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
      });
  }, [venues, searchFilter]);

  const allFiltered = useMemo(() => venues.filter(searchFilter), [venues, searchFilter]);

  async function patchBadge(
    venueId: string,
    body: Partial<Record<BadgeField, DirectoryBadgeStatus>>,
  ) {
    const key = `${venueId}:${JSON.stringify(body)}`;
    setSavingKey(key);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/directory-badges`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(j.error || 'Save failed');
        return;
      }
      await onRefresh();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl text-gray-900 flex items-center gap-2">
          <BadgeCheck size={18} style={{ color: BRAND }} /> Verified &amp; Sponsored
        </h2>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          Approve or deny badge requests from venues, and manage every verified / sponsored badge across the
          directory. Changes here sync instantly with the Venue management dropdowns.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Pending verified" value={counts.pendingVerified} tone="amber" />
        <MetricCard label="Pending sponsored" value={counts.pendingSponsored} tone="amber" />
        <MetricCard label="Approved verified" value={counts.approvedVerified} tone="emerald" />
        <MetricCard label="Approved sponsored" value={counts.approvedSponsored} tone="emerald" />
        <MetricCard label="Drafts" value={counts.draft} tone="blue" />
        <MetricCard label="Rejected" value={counts.rejected} tone="red" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search venues by name, email, phone, slug…"
            className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setView('all')}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
            view === 'all'
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          All venues ({allFiltered.length}
          {search ? ` / ${venues.length}` : ''})
        </button>
        <button
          type="button"
          onClick={() => setView('queue')}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
            view === 'queue'
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Pending only ({queue.length})
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {view === 'queue' ? (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {venuesLoading ? (
            <div className="py-12 text-center text-gray-400">
              <Loader2 size={18} className="animate-spin inline" />
            </div>
          ) : queue.length === 0 ? (
            <div className="py-12 text-center">
              <BadgeCheck size={32} className="mx-auto mb-2 text-gray-200" />
              <p className="text-sm font-medium text-gray-600">
                {search ? 'No pending requests match your search' : 'No pending requests'}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {search
                  ? 'Clear the search or switch to All venues to edit statuses directly.'
                  : 'New Verified or Sponsored submissions from venues will appear here.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {queue.map(({ venue, verified, sponsored }) => (
                <li key={venue.id} className="px-4 sm:px-6 py-4">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 truncate">{venue.name}</span>
                        {venue.slug ? (
                          <a
                            href={`/venue/${venue.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-mono text-gray-400 hover:text-gray-700"
                          >
                            /{venue.slug}
                          </a>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {venue.email || '—'}
                        {venue.phone ? ` · ${venue.phone}` : ''}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <StatusPill
                          icon={<BadgeCheck size={11} />}
                          label={`Verified: ${directoryBadgeLabel(verified)}`}
                          status={verified}
                        />
                        <StatusPill
                          icon={<Sparkles size={11} />}
                          label={`Sponsored: ${directoryBadgeLabel(sponsored)}`}
                          status={sponsored}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 md:items-end">
                      {verified === 'pending' && (
                        <BadgeDecision
                          label="Verified"
                          icon={<BadgeCheck size={12} />}
                          busyKey={savingKey}
                          venueId={venue.id}
                          field="directory_verified_status"
                          onDecide={(status) =>
                            patchBadge(venue.id, { directory_verified_status: status })
                          }
                        />
                      )}
                      {sponsored === 'pending' && (
                        <BadgeDecision
                          label="Sponsored"
                          icon={<Sparkles size={12} />}
                          busyKey={savingKey}
                          venueId={venue.id}
                          field="directory_sponsored_status"
                          onDecide={(status) =>
                            patchBadge(venue.id, { directory_sponsored_status: status })
                          }
                        />
                      )}
                      <div className="flex flex-wrap gap-1.5 md:justify-end">
                        <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                          <BadgeCheck size={11} />
                          <select
                            value={verified}
                            disabled={savingKey !== null}
                            onChange={(e) =>
                              patchBadge(venue.id, {
                                directory_verified_status: e.target.value as DirectoryBadgeStatus,
                              })
                            }
                            className={`rounded-lg border px-2 py-1 text-[11px] ${statusBadgeClass(verified)}`}
                          >
                            {DIRECTORY_BADGE_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {directoryBadgeLabel(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                          <Sparkles size={11} />
                          <select
                            value={sponsored}
                            disabled={savingKey !== null}
                            onChange={(e) =>
                              patchBadge(venue.id, {
                                directory_sponsored_status: e.target.value as DirectoryBadgeStatus,
                              })
                            }
                            className={`rounded-lg border px-2 py-1 text-[11px] ${statusBadgeClass(sponsored)}`}
                          >
                            {DIRECTORY_BADGE_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {directoryBadgeLabel(s)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-3">Venue</th>
                    <th className="px-3 py-3">Verified</th>
                    <th className="px-3 py-3">Sponsored</th>
                    <th className="px-3 py-3 text-right">Quick actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {venuesLoading ? (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-gray-400">
                        <Loader2 size={16} className="animate-spin inline" />
                      </td>
                    </tr>
                  ) : allFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-gray-400 text-sm">
                        {search ? 'No venues match your search.' : 'No venues yet.'}
                      </td>
                    </tr>
                  ) : (
                    allFiltered.map((venue) => {
                      const vs = getStatus(venue, 'directory_verified_status');
                      const ss = getStatus(venue, 'directory_sponsored_status');
                      const busy = savingKey !== null;
                      return (
                        <tr key={venue.id} className="hover:bg-gray-50/70 align-top">
                          <td className="px-3 py-3">
                            <div className="font-medium text-gray-900">{venue.name}</div>
                            {venue.slug ? (
                              <div className="text-[11px] text-gray-400 font-mono">{venue.slug}</div>
                            ) : null}
                            <div className="text-[11px] text-gray-500 mt-0.5">{venue.email || '—'}</div>
                          </td>
                          <td className="px-3 py-3">
                            <select
                              value={vs}
                              disabled={busy}
                              onChange={(e) =>
                                patchBadge(venue.id, {
                                  directory_verified_status: e.target.value as DirectoryBadgeStatus,
                                })
                              }
                              className={`w-full min-w-[140px] max-w-[200px] rounded-lg border px-2 py-1.5 text-xs ${statusBadgeClass(vs)}`}
                            >
                              {DIRECTORY_BADGE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {directoryBadgeLabel(s)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <select
                              value={ss}
                              disabled={busy}
                              onChange={(e) =>
                                patchBadge(venue.id, {
                                  directory_sponsored_status: e.target.value as DirectoryBadgeStatus,
                                })
                              }
                              className={`w-full min-w-[140px] max-w-[200px] rounded-lg border px-2 py-1.5 text-xs ${statusBadgeClass(ss)}`}
                            >
                              {DIRECTORY_BADGE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {directoryBadgeLabel(s)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="inline-flex flex-wrap gap-1.5 justify-end">
                              {(vs !== 'approved' || ss !== 'approved') && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    patchBadge(venue.id, {
                                      directory_verified_status: 'approved',
                                      directory_sponsored_status: 'approved',
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
                                >
                                  <Check size={11} /> Approve both
                                </button>
                              )}
                              {(vs === 'approved' || ss === 'approved') && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    patchBadge(venue.id, {
                                      directory_verified_status: 'none',
                                      directory_sponsored_status: 'none',
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                                >
                                  <X size={11} /> Remove all
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'emerald' | 'blue' | 'red' | 'gray';
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : tone === 'blue'
          ? 'border-blue-200 bg-blue-50 text-blue-800'
          : tone === 'red'
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-gray-200 bg-white text-gray-700';
  return (
    <div className={`rounded-xl border px-3 py-3 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  status: DirectoryBadgeStatus;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(status)}`}
    >
      {icon} {label}
    </span>
  );
}

function BadgeDecision({
  label,
  icon,
  busyKey,
  venueId,
  field,
  onDecide,
}: {
  label: string;
  icon: React.ReactNode;
  busyKey: string | null;
  venueId: string;
  field: BadgeField;
  onDecide: (status: DirectoryBadgeStatus) => void;
}) {
  const isBusy = busyKey?.startsWith(`${venueId}:`) && busyKey.includes(field);
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[11px] font-semibold text-gray-500 mr-1 inline-flex items-center gap-1">
        {icon} {label}
      </span>
      <button
        type="button"
        disabled={Boolean(busyKey)}
        onClick={() => onDecide('approved')}
        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
      >
        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Approve
      </button>
      <button
        type="button"
        disabled={Boolean(busyKey)}
        onClick={() => onDecide('rejected')}
        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40"
      >
        <X size={11} /> Reject
      </button>
    </div>
  );
}
