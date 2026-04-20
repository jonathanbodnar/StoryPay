/**
 * StoryPay-owned billing (venues pay you). Per-plan Fortis merchant overrides env default.
 */
export function getPlatformFortisMerchantId(planFortisOverride?: string | null): string | null {
  const o = planFortisOverride?.trim();
  if (o) return o;
  const env = process.env.STORYPAY_PLATFORM_FORTIS_MERCHANT_ID?.trim();
  return env || null;
}

export function isPlatformFortisMerchantConfigured(): boolean {
  return Boolean(process.env.STORYPAY_PLATFORM_FORTIS_MERCHANT_ID?.trim());
}
