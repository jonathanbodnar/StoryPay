'use client';

/**
 * LeadFinder™ review queue.
 *
 * The arrivals the pipeline created but did NOT contact the couple about,
 * because it was not confident enough in what it extracted. A human reads the
 * original email next to our extraction and either confirms (release the guide)
 * or dismisses (leave the lead alone; nothing is deleted).
 *
 * Styling deliberately mirrors the Integrations page's LeadFinder card.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, Check, X, Loader2, Mail, Inbox } from 'lucide-react';

interface Extracted {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  guestCount: number | null;
  weddingDate: string | null;
  venueMatters: string | null;
  timeline: string | null;
  message: string | null;
}

interface ReviewImport {
  id: string;
  subject: string | null;
  sender: string | null;
  senderDomain: string | null;
  receivedAt: string | null;
  detectedSource: string | null;
  classificationConfidence: number | null;
  extractionConfidence: number | null;
  fieldConfidence: Record<string, number>;
  reviewReason: string | null;
  rawExcerpt: string;
  leadId: string | null;
  extracted: Extracted | null;
}

const REASON_LABEL: Record<string, string> = {
  low_confidence: 'Low confidence',
  ai_fallback_uncertain: 'AI fallback uncertain',
};

function pct(v: number | null | undefined): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

function when(iso: string | null): string | null {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
}

/** The extracted fields, in the order a human reads them, with their confidence. */
function fieldRows(
  e: Extracted,
  conf: Record<string, number>,
): Array<{ label: string; value: string; conf: number | undefined }> {
  const rows = [
    { label: 'Name', value: e.name ?? '', key: 'name' },
    { label: 'Email', value: e.email ?? '', key: 'email' },
    { label: 'Phone', value: e.phone ?? '', key: 'phone' },
    { label: 'Wedding date', value: e.weddingDate ?? '', key: 'weddingDate' },
    { label: 'Guest count', value: e.guestCount !== null ? String(e.guestCount) : '', key: 'guestCount' },
    { label: 'What matters most', value: e.venueMatters ?? '', key: 'venueMatters' },
    { label: 'Timeline', value: e.timeline ?? '', key: 'timeline' },
    { label: 'Message', value: e.message ?? '', key: 'message' },
  ];
  return rows.map((r) => ({ label: r.label, value: r.value, conf: conf?.[r.key] }));
}

export default function LeadFinderReviewPage() {
  const [items, setItems] = useState<ReviewImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/leadfinder/review', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load the review queue');
      const data = (await res.json()) as { imports?: ReviewImport[] };
      setItems(data.imports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the review queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, action: 'confirm' | 'dismiss') {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/venue/leadfinder/review/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || 'Could not save your decision');
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your decision');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/settings/integrations"
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            <ArrowLeft size={13} /> Back to Integrations
          </Link>
          <h1 className="font-heading text-2xl text-gray-900">LeadFinder review</h1>
          <p className="mt-1 text-sm text-gray-500">
            Inquiries we captured but were not confident enough to email the couple about. Confirm to
            send them the guide, or dismiss to leave the lead untouched.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-10 text-center">
          <Inbox size={22} className="mx-auto text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-700">Nothing needs review right now.</p>
          <p className="mt-1 text-xs text-gray-400">
            Any inquiry we could not read with confidence will appear here.
          </p>
        </div>
      )}

      <div className="space-y-5">
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex flex-wrap items-start gap-3 px-6 pt-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50">
                <Mail size={18} className="text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="min-w-0 truncate text-sm font-semibold text-gray-900">
                    {item.subject || '(no subject)'}
                  </h2>
                  {item.reviewReason && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      {REASON_LABEL[item.reviewReason] ?? item.reviewReason.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  <span className="truncate">{item.sender || item.senderDomain || 'Unknown sender'}</span>
                  {item.detectedSource ? ` · ${item.detectedSource}` : ''}
                  {when(item.receivedAt) ? ` · ${when(item.receivedAt)}` : ''}
                  {` · extraction ${pct(item.extractionConfidence)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void resolve(item.id, 'dismiss')}
                  disabled={busyId !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  {busyId === item.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                  Dismiss
                </button>
                <button
                  onClick={() => void resolve(item.id, 'confirm')}
                  disabled={busyId !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busyId === item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Confirm &amp; send guide
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 border-t border-gray-100 px-6 py-5 md:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Original email
                </span>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[12px] leading-relaxed text-gray-700">
                  {item.rawExcerpt || '(no body captured)'}
                </pre>
              </div>

              <div>
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Extracted fields
                </span>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <dl className="space-y-1.5">
                    {fieldRows(
                      item.extracted ?? {
                        name: null,
                        firstName: null,
                        lastName: null,
                        email: null,
                        phone: null,
                        guestCount: null,
                        weddingDate: null,
                        venueMatters: null,
                        timeline: null,
                        message: null,
                      },
                      item.fieldConfidence ?? {},
                    ).map((row) => (
                      <div key={row.label} className="flex items-start gap-2 text-[12px]">
                        <dt className="w-32 shrink-0 text-gray-400">{row.label}</dt>
                        <dd className={`min-w-0 flex-1 break-words ${row.value ? 'text-gray-800' : 'text-gray-300'}`}>
                          {row.value || '—'}
                          {row.value && typeof row.conf === 'number' && (
                            <span className="ml-1.5 text-[10px] text-gray-400">{pct(row.conf)}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
