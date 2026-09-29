'use client';

/**
 * Admin → Directory plans: StoryVenue's cut on venues' couple payments (Stripe
 * Connect), per tier. Venues see "cards X% + 30¢, bank Y%" with Stripe's fee
 * included. Changes apply to payments made after saving.
 */

import { useEffect, useState } from 'react';
import { Loader2, Percent } from 'lucide-react';

interface Tier {
  tier: 'paid' | 'free';
  card_fee_percent: number | string;
  bank_total_percent: number | string;
}

export function PaymentFeesAdminCard() {
  const [tiers, setTiers] = useState<Record<string, { card: string; bank: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/payment-fees', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { tiers?: Tier[] }) => {
        const next: Record<string, { card: string; bank: string }> = {};
        for (const t of d.tiers ?? []) next[t.tier] = { card: String(Number(t.card_fee_percent)), bank: String(Number(t.bank_total_percent)) };
        setTiers(next);
      })
      .catch(() => setMsg('Could not load the fee schedule.'));
  }, []);

  async function save(tier: 'paid' | 'free') {
    const t = tiers[tier];
    if (!t) return;
    setSaving(tier);
    setMsg(null);
    const res = await fetch('/api/admin/payment-fees', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, card_fee_percent: parseFloat(t.card), bank_total_percent: parseFloat(t.bank) }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    setMsg(res.ok ? `Saved ${tier === 'paid' ? 'paid plans' : 'Free'}. Applies to payments from now on.` : d.error || 'Could not save.');
    setSaving(null);
  }

  const row = (tier: 'paid' | 'free', label: string) => {
    const t = tiers[tier] ?? { card: '', bank: '' };
    const cardTotal = Number.isFinite(parseFloat(t.card)) ? Math.round((2.9 + parseFloat(t.card)) * 100) / 100 : null;
    return (
      <tr className="border-t border-gray-100">
        <td className="px-5 py-3 text-sm font-medium text-gray-900">{label}</td>
        <td className="px-3 py-3">
          <input value={t.card} onChange={(e) => setTiers((p) => ({ ...p, [tier]: { ...t, card: e.target.value } }))}
            className="w-20 rounded-md border border-gray-200 px-2 py-1 text-sm" aria-label={`${label} card fee`} />
          <span className="ml-1 text-xs text-gray-400">% {cardTotal != null && `→ venue pays ${cardTotal}% + 30¢`}</span>
        </td>
        <td className="px-3 py-3">
          <input value={t.bank} onChange={(e) => setTiers((p) => ({ ...p, [tier]: { ...t, bank: e.target.value } }))}
            className="w-20 rounded-md border border-gray-200 px-2 py-1 text-sm" aria-label={`${label} bank rate`} />
          <span className="ml-1 text-xs text-gray-400">% all-in</span>
        </td>
        <td className="px-5 py-3 text-right">
          <button type="button" onClick={() => void save(tier)} disabled={saving !== null}
            className="inline-flex items-center gap-1 rounded-md bg-[#1b1b1b] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {saving === tier && <Loader2 size={12} className="animate-spin" />} Save
          </button>
        </td>
      </tr>
    );
  };

  return (
    <section className="mb-8 rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Percent size={16} className="text-gray-700" /> Venue payment fees (Stripe)</h3>
        <p className="mt-1 text-xs text-gray-500 max-w-3xl">
          StoryVenue&apos;s cut on couple payments, taken automatically from the venue&apos;s payout. Card: your % on top of
          Stripe&apos;s 2.9% + 30¢. Bank: the venue&apos;s all-in rate; you keep it minus Stripe&apos;s 0.8% (max $5). Changes apply to
          payments made after saving. Give venues notice before raising them. Set a single venue&apos;s rate in Venue Management → Billing.
        </p>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <th className="px-5 py-2">Tier</th>
            <th className="px-3 py-2">Your card fee</th>
            <th className="px-3 py-2">Bank rate</th>
            <th className="px-5 py-2" />
          </tr>
        </thead>
        <tbody>
          {row('paid', 'Paid plans')}
          {row('free', 'Free')}
        </tbody>
      </table>
      {msg && <p className="px-5 pb-4 text-xs text-gray-600">{msg}</p>}
    </section>
  );
}
