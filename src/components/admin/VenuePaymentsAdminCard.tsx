'use client';

/**
 * Venue Management → Billing: the venue's couple payments on Stripe Connect —
 * account status and an optional fee override (blank = its tier's rates).
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';

interface Data {
  provider: string | null;
  account: { id: string; status: string | null; chargesEnabled: boolean; url: string } | null;
  tier: 'paid' | 'free';
  tierRates: { card_fee_percent: number; bank_total_percent: number };
  override: { card_fee_percent: number | null; bank_total_percent: number | null };
}

export function VenuePaymentsAdminCard({ venueId }: { venueId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [card, setCard] = useState('');
  const [bank, setBank] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/venues/${venueId}/payments`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Data) : null;
  }, [venueId]);

  const apply = useCallback((d: Data | null) => {
    if (!d) return;
    setData(d);
    setCard(d.override.card_fee_percent != null ? String(d.override.card_fee_percent) : '');
    setBank(d.override.bank_total_percent != null ? String(d.override.bank_total_percent) : '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then((d) => { if (!cancelled) apply(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [load, apply]);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/admin/venues/${venueId}/payments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_fee_percent: card === '' ? null : parseFloat(card), bank_total_percent: bank === '' ? null : parseFloat(bank) }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? 'Saved.' : d.error || 'Could not save.');
    setSaving(false);
    if (res.ok) apply(await load());
  }

  if (!data) return null;
  const status = !data.account
    ? 'Not connected'
    : data.account.chargesEnabled
      ? 'Taking payments'
      : data.account.status === 'pending'
        ? 'Stripe reviewing'
        : 'Signup not finished';

  return (
    <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Couple payments (Stripe)</span>
        {data.account && (
          <a href={data.account.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:underline">
            Open in Stripe <ExternalLink size={11} />
          </a>
        )}
      </div>
      <p className="text-xs text-gray-700">
        {status}{data.account ? <span className="text-gray-400"> · <span className="font-mono">{data.account.id}</span></span> : null}
      </p>
      <p className="mt-1 text-[11px] text-gray-500">
        {data.tier === 'paid' ? 'Paid-plan' : 'Free'} rates: you keep {data.tierRates.card_fee_percent}% on cards; bank {data.tierRates.bank_total_percent}% all-in.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-600">Custom rate for this venue:</span>
        <input value={card} onChange={(e) => setCard(e.target.value)} placeholder={String(data.tierRates.card_fee_percent)}
          className="w-16 rounded-md border border-violet-200 bg-white px-2 py-1" aria-label="Card fee override" />
        <span className="text-gray-500">% cards</span>
        <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder={String(data.tierRates.bank_total_percent)}
          className="w-16 rounded-md border border-violet-200 bg-white px-2 py-1" aria-label="Bank rate override" />
        <span className="text-gray-500">% bank</span>
        <button type="button" onClick={() => void save()} disabled={saving}
          className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1 font-semibold text-white disabled:opacity-50">
          {saving && <Loader2 size={11} className="animate-spin" />} Save
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">Leave blank for the tier&apos;s rates. 0 = StoryVenue takes nothing (e.g. private clients).</p>
      {msg && <p className="mt-1 text-[11px] text-gray-600">{msg}</p>}
    </div>
  );
}
