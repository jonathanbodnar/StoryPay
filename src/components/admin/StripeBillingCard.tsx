'use client';

/**
 * Venue Management → Billing: the venue's billing in the owner's Stripe
 * account, read-only — the StoryVenue software subscription and any
 * private-client subscriptions on the same customer, plus the card on file.
 * Private-client fees are charged in the Stripe dashboard ("Open in Stripe").
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Loader2 } from 'lucide-react';

interface SubRow {
  id: string;
  status: string;
  amount_cents: number;
  interval: string | null;
  items: string[];
  next_charge_on: string | null;
  cancel_at: string | null;
  ended_at: string | null;
  card: { brand: string; last4: string } | null;
  is_storyvenue: boolean;
  url: string;
}

interface Data {
  configured: boolean;
  customer?: { id: string; name: string | null; email: string | null; linked: boolean; url: string } | null;
  subscriptions?: SubRow[];
  card?: { brand: string | null; last4: string | null; exp: string | null } | null;
  note?: string;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

function pill(status: string): string {
  if (status === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'trialing') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

export function StripeBillingCard({ venueId }: { venueId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkId, setLinkId] = useState('');
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/stripe`, { cache: 'no-store' });
      const d = (await res.json().catch(() => ({}))) as Data & { error?: string };
      if (!res.ok) throw new Error(d.error || 'Could not load Stripe billing');
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Stripe billing');
    }
  }, [venueId]);

  useEffect(() => { void load(); }, [load]);

  async function link(customerId: string) {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/stripe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || 'Could not link the customer');
      setLinkId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link the customer');
    } finally {
      setLinking(false);
    }
  }

  if (data && !data.configured) {
    return <p className="mb-5 text-[11px] text-gray-400">Stripe billing shows here once the Stripe keys are set.</p>;
  }

  const subs = data?.subscriptions ?? [];
  const current = subs.filter((s) => s.status !== 'canceled' && s.status !== 'incomplete_expired');
  const endedCount = subs.length - current.length;

  return (
    <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Stripe billing</span>
        {data?.customer && (
          <a href={data.customer.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline">
            Open in Stripe <ExternalLink size={11} />
          </a>
        )}
      </div>

      {!data && !error && (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" /> Loading from Stripe…</div>
      )}

      {data?.note && <p className="text-xs text-amber-700">{data.note}</p>}

      {data && !data.customer && !data.note && (
        <p className="text-xs text-gray-500">No customer with this venue&apos;s email in your Stripe account.</p>
      )}

      {data?.customer && (
        <div className="space-y-3">
          <div className="text-xs text-gray-700">
            <div className="font-medium text-gray-900">{data.customer.name || data.customer.email || data.customer.id}</div>
            <div className="text-[11px] text-gray-500">
              <span className="font-mono">{data.customer.id}</span>
              {data.customer.email && data.customer.name ? ` · ${data.customer.email}` : ''}
              {' · '}
              {data.customer.linked ? 'linked' : 'matched by email, not linked yet'}
            </div>
            {data.card && (
              <div className="mt-0.5 text-[11px] text-gray-500">
                Card on file: <span className="capitalize">{data.card.brand}</span> •••• {data.card.last4} · exp {data.card.exp}
              </div>
            )}
            {!data.customer.linked && (
              <button
                type="button"
                disabled={linking}
                onClick={() => void link(data.customer!.id)}
                className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                <Link2 size={11} /> Link this customer
              </button>
            )}
          </div>

          {current.length === 0 ? (
            <p className="text-xs text-gray-500">No active subscriptions.</p>
          ) : (
            <ul className="divide-y divide-indigo-100 rounded-lg border border-indigo-100 bg-white">
              {current.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-gray-900">{s.items.join(' + ')}</span>
                      {s.is_storyvenue && (
                        <span className="rounded-full bg-gray-900 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">StoryVenue software</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {usd(s.amount_cents)}{s.interval ? `/${s.interval}` : ''}
                      {s.cancel_at ? ` · ends ${day(s.cancel_at)}` : s.next_charge_on ? ` · next ${day(s.next_charge_on)}` : ''}
                      {s.card ? ` · ${s.card.brand} •••• ${s.card.last4}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${pill(s.status)}`}>{s.status.replace(/_/g, ' ')}</span>
                    <a href={s.url} target="_blank" rel="noreferrer" title="Open in Stripe" className="text-gray-400 hover:text-gray-700">
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {endedCount > 0 && <p className="text-[11px] text-gray-400">+ {endedCount} ended subscription{endedCount === 1 ? '' : 's'} (see Stripe)</p>}
        </div>
      )}

      {data && (
        <div className="mt-3 flex gap-2">
          <input
            value={linkId}
            onChange={(e) => setLinkId(e.target.value.trim())}
            placeholder={data.customer ? 'Link a different customer (cus_…)' : 'Link a customer (cus_…)'}
            className="min-w-0 flex-1 rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-300 focus:outline-none"
          />
          <button
            type="button"
            disabled={linking || !linkId}
            onClick={() => void link(linkId)}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {linking ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Link
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
