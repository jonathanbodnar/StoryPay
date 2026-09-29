'use client';

/**
 * Payments setup for the venue: Stripe Connect when it's available to this
 * venue, otherwise the LunarPay (StoryPay) application.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import LunarPayOnboarding from '@/components/settings/LunarPayOnboarding';
import StripeConnectPanel from '@/components/settings/StripeConnectPanel';

export default function PaymentsOnboarding({ onActivated }: { onActivated?: () => void }) {
  const [provider, setProvider] = useState<'stripe' | 'lunarpay' | null>(null);

  useEffect(() => {
    fetch('/api/lunarpay/active', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stripe?: { available?: boolean } } | null) => setProvider(d?.stripe?.available ? 'stripe' : 'lunarpay'))
      .catch(() => setProvider('lunarpay'));
  }, []);

  if (!provider) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }
  return provider === 'stripe'
    ? <StripeConnectPanel onActivated={onActivated} />
    : <LunarPayOnboarding onActivated={onActivated} />;
}
