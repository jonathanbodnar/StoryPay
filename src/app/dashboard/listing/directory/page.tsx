'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BadgeCheck, Loader2, Megaphone } from 'lucide-react';
import { directoryBadgeLabel } from '@/lib/directory-badges';

const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';

type VenueRow = {
  directory_verified_status?: string | null;
  directory_sponsored_status?: string | null;
};

export default function ListingDirectoryStatusPage() {
  const [venue, setVenue] = useState<VenueRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'verified' | 'sponsored' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/venues/me', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load venue');
        return;
      }
      const data = (await res.json()) as VenueRow;
      setVenue(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(kind: 'verified' | 'sponsored') {
    setSubmitting(kind);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/listing/directory-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(data.error || 'Request failed');
        return;
      }
      setMessage(
        kind === 'verified'
          ? 'Verification request submitted. Our team will review your listing.'
          : 'Sponsored listing request submitted. Our team will be in touch.',
      );
      await load();
    } finally {
      setSubmitting(null);
    }
  }

  const vs = venue?.directory_verified_status ?? 'none';
  const ss = venue?.directory_sponsored_status ?? 'none';
  const canApplyVerified = vs === 'none' || vs === 'rejected';
  const canApplySponsored = ss === 'none' || ss === 'rejected';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/dashboard/listing"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to listing
        </Link>
        <h1 className="font-heading text-2xl text-gray-900">Verified &amp; sponsored</h1>
        <p className="text-sm text-gray-500 max-w-xl">
          Request a blue verified badge or sponsored placement on the public directory (storyvenue.com). Approval is
          handled by StoryVenue. Status updates appear here after our team reviews your venue.
        </p>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <section className={CARD}>
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ backgroundColor: '#3897F0' }}
          >
            <BadgeCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-gray-900">Verified venue</h2>
            <p className="mt-1 text-sm text-gray-500">
              Shows a blue verified badge next to your venue name on your public listing and in directory search
              results (similar to Instagram).
            </p>
            <p className="mt-3 text-sm">
              <span className="text-gray-500">Current status:</span>{' '}
              <span className="font-medium text-gray-900">{directoryBadgeLabel(vs)}</span>
            </p>
            {canApplyVerified ? (
              <button
                type="button"
                disabled={!!submitting}
                onClick={() => void apply('verified')}
                className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {submitting === 'verified' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Request verification
              </button>
            ) : (
              <p className="mt-4 text-sm text-gray-500">
                {vs === 'pending'
                  ? 'Your request is pending review.'
                  : vs === 'approved'
                    ? 'Your venue is verified on the directory.'
                    : vs === 'draft'
                      ? 'Your application is being prepared by our team.'
                      : null}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-900"
          >
            <Megaphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-gray-900">Sponsored listing</h2>
            <p className="mt-1 text-sm text-gray-500">
              Sponsored venues can appear with a &quot;Sponsored&quot; label and boosted placement in directory browse
              and search (subject to availability and approval).
            </p>
            <p className="mt-3 text-sm">
              <span className="text-gray-500">Current status:</span>{' '}
              <span className="font-medium text-gray-900">{directoryBadgeLabel(ss)}</span>
            </p>
            {canApplySponsored ? (
              <button
                type="button"
                disabled={!!submitting}
                onClick={() => void apply('sponsored')}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60"
              >
                {submitting === 'sponsored' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Request sponsored placement
              </button>
            ) : (
              <p className="mt-4 text-sm text-gray-500">
                {ss === 'pending'
                  ? 'Your request is pending review.'
                  : ss === 'approved'
                    ? 'Your venue is marked as sponsored on the directory.'
                    : ss === 'draft'
                      ? 'Your sponsorship is being set up by our team.'
                      : null}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
