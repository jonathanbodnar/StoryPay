'use client';

/**
 * Payments setup for the venue: Stripe Connect when it's open to this venue,
 * otherwise what's coming (StoryPayComingSoon). LunarPay is retired
 * (lib/lunarpay-retired.ts), so there's no other signup.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import StoryPayComingSoon from '@/components/settings/StoryPayComingSoon';
import StripeConnectPanel from '@/components/settings/StripeConnectPanel';

export default function PaymentsOnboarding({ onActivated }: { onActivated?: () => void }) {
  const [stripeOpen, setStripeOpen] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/lunarpay/active', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stripe?: { available?: boolean } } | null) => setStripeOpen(d ? d.stripe?.available === true : true))
      // StripeConnectPanel loads its own status and explains any problem.
      .catch(() => setStripeOpen(true));
  }, []);

  if (stripeOpen === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }
  return stripeOpen ? <StripeConnectPanel onActivated={onActivated} /> : <StoryPayComingSoon />;
}
