import { describe, expect, it } from 'vitest';
import { signedInOwner, signedInSuperAdmin } from './helpers';

// The admin settings that set what venues pay: the processing fee schedule and
// the add-on prices. A full admin's save goes through (the same values are
// saved back, so nothing changes), out-of-range values are refused, and a venue
// can't touch them.
describe('admin price settings', () => {
  it('the fee schedule saves; a fee above 5% is refused', async () => {
    const team = await signedInSuperAdmin();
    const before = (await (await team.fetch('/api/admin/payment-fees')).json()) as { tiers: Array<{ tier: string; card_fee_percent: number; bank_total_percent: number }> };
    expect(before.tiers.length).toBeGreaterThan(0);
    for (const { tier, card_fee_percent, bank_total_percent } of before.tiers) {
      const res = await team.fetch('/api/admin/payment-fees', { method: 'PUT', json: { tier, card_fee_percent, bank_total_percent } });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    expect((await team.fetch('/api/admin/payment-fees', { method: 'PUT', json: { tier: 'paid', card_fee_percent: 9, bank_total_percent: 1 } })).status).toBe(400);
    expect((await team.fetch('/api/admin/payment-fees', { method: 'PUT', json: { tier: 'gold', card_fee_percent: 3, bank_total_percent: 1 } })).status).toBe(400);
    const after = (await (await team.fetch('/api/admin/payment-fees')).json()) as typeof before;
    expect(after.tiers.map(({ tier, card_fee_percent, bank_total_percent }) => ({ tier, card_fee_percent, bank_total_percent })))
      .toEqual(before.tiers.map(({ tier, card_fee_percent, bank_total_percent }) => ({ tier, card_fee_percent, bank_total_percent })));
  });

  it('add-on prices save; a negative price is refused', async () => {
    const team = await signedInSuperAdmin();
    const prices = (await (await team.fetch('/api/admin/addon-prices')).json()) as Record<string, number>;
    const res = await team.fetch('/api/admin/addon-prices', { method: 'PATCH', json: prices });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await team.fetch('/api/admin/addon-prices', { method: 'PATCH', json: { verified_cents: -5 } })).status).toBe(400);
    expect(await (await team.fetch('/api/admin/addon-prices')).json()).toEqual(prices);
  });

  it('a venue can read the add-on prices but not change them or the fees', async () => {
    const owner = await signedInOwner();
    expect((await owner.fetch('/api/admin/addon-prices')).status).toBe(200);
    expect([401, 403]).toContain((await owner.fetch('/api/admin/addon-prices', { method: 'PATCH', json: { verified_cents: 1 } })).status);
    expect([401, 403]).toContain((await owner.fetch('/api/admin/payment-fees', { method: 'PUT', json: { tier: 'paid', card_fee_percent: 0, bank_total_percent: 0 } })).status);
  });
});
