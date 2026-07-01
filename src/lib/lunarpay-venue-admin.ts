/**
 * Derives super-admin display fields for venue LunarPay onboarding (merchant + API keys).
 */

export type LunarPayAdminCategory =
  | 'not_provisioned'
  | 'active_approved'
  | 'denied'
  | 'pending_review';

export type LunarPayAdminSummary = {
  category: LunarPayAdminCategory;
  /** Short label for tables and badges */
  label: string;
  /** True when onboarding is active and a secret key exists (typical “can charge” state) */
  payments_ready: boolean;
  /** Normalized onboarding_status from DB */
  onboarding_status: string;
};

export function getLunarPayAdminSummary(venue: Record<string, unknown>): LunarPayAdminSummary {
  const merchantId = venue.lunarpay_merchant_id;
  const hasMerchant =
    merchantId != null && merchantId !== '' && !(typeof merchantId === 'number' && !Number.isFinite(merchantId));

  const secretKey = venue.lunarpay_secret_key;
  const hasSecret = typeof secretKey === 'string' && secretKey.trim().length > 0;

  const rawStatus = String(venue.onboarding_status || '')
    .toLowerCase()
    .trim();

  if (!hasMerchant) {
    return {
      category: 'not_provisioned',
      label: 'No LunarPay merchant',
      payments_ready: false,
      onboarding_status: rawStatus || '—',
    };
  }

  if (rawStatus === 'denied') {
    return {
      category: 'denied',
      label: 'Denied',
      payments_ready: false,
      onboarding_status: rawStatus,
    };
  }

  if (rawStatus === 'active' && hasSecret) {
    return {
      category: 'active_approved',
      label: 'Active · approved',
      payments_ready: true,
      onboarding_status: rawStatus,
    };
  }

  if (rawStatus === 'active' && !hasSecret) {
    return {
      category: 'pending_review',
      label: 'Active (no API key)',
      payments_ready: false,
      onboarding_status: rawStatus,
    };
  }

  const labelMap: Record<string, string> = {
    not_started: 'Not started',
    registered: 'Registered',
    pending: 'Registered',
    bank_information_sent: 'Bank information sent',
    under_review: 'Under review',
  };
  const pretty = labelMap[rawStatus] || (rawStatus ? rawStatus.replace(/_/g, ' ') : 'In progress');

  return {
    category: 'pending_review',
    label: pretty,
    payments_ready: false,
    onboarding_status: rawStatus || 'pending',
  };
}
